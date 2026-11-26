// Événements : la source de vérité de Bougette (ADR 0002). Ajout seul, ULID, version de format, chaîne d'empreintes.
// hash = SHA-256(prev_hash ‖ id ‖ type ‖ v ‖ at ‖ device ‖ payload), champs séparés par un saut de ligne
// (aucun champ n'en contient : le payload est du JSON canonique). Le premier événement a prev_hash = ''.
import { canonical, sha256hex } from './canonical.js';

/** Version courante du format de chaque type d'événement. */
export const EVENT_TYPES = {
  'app.onboarded': 1,
  'settings.changed': 1,
  'wallet.created': 1,
  'wallet.updated': 1,
  'wallet.archived': 1,
  'wallet.restored': 1,
  'wallet.reordered': 1,
  'wallet.deleted': 1,
  'wallet.undeleted': 1,
  'category.created': 1,
  'category.updated': 1,
  'category.archived': 1,
  'category.restored': 1,
  'category.deleted': 1,
  'category.undeleted': 1,
  'category.reordered': 1,
  'wallet.checked': 1,
  'entry.recorded': 1,
  'entry.amended': 1,
  'entry.voided': 1,
  'entry.restored': 1,
  'entry.reset': 1,
  // anciens budgets mensuels (avant D11 revu) : plus produits, toujours rejoués
  'budget.set': 1,
  'budget.cleared': 1,
  // budgets par répartition (D11 revu) : catégorie, montant, début et fin, répétition
  'budget.created': 1,
  'budget.updated': 1,
  'budget.deleted': 1,
  // réserves d'un portefeuille d'épargne (D17)
  'reserve.created': 1,
  'reserve.updated': 1,
  // en pause (D17 revu, 2026-11-23) : la réserve perd sa date ; Reprendre la lui redonne (reserve.updated)
  'reserve.paused': 1,
  'reserve.used': 1,
  'reserve.closed': 1,
  // répartition enregistrée (D17, revu) : de l'argent mis dans (ou repris d'une) réserve
  'reserve.allocated': 1,
  // échéances et opérations programmées (D18) : la règle, ses dates passées (« Passer ») ou rétablies, « Arrêter »
  'schedule.created': 1,
  'schedule.updated': 1,
  'schedule.stopped': 1,
  'schedule.skipped': 1,
  'schedule.unskipped': 1,
  'schedule.deleted': 1,
  // un autre montant pour une seule fois encore à régler (2026-11-24, avec l'utilisateur), ou le retour à celui de la
  // règle (amount null) : { id: la première règle de l'échéance, on, amount }
  'schedule.adjusted': 1,
};

/** @typedef {{ seq: number, id: string, type: string, v: number, at: string, device: string, payload: string, prev_hash: string, hash: string }} StoredEvent */
/** @typedef {{ seq: number, id: string, type: string, v: number, at: string, device: string, data: any }} AppliedEvent */
/** @typedef {{ type: string, payload: any }} NewEvent */
/** @typedef {(ev: AppliedEvent) => AppliedEvent} Upcaster */

/**
 * Convertisseurs `type@v → type@v+1`, appliqués à la lecture ; les événements stockés ne sont jamais réécrits.
 * Aucun pour la v1 du format. Exemple : UPCASTERS['entry.recorded'] = { 1: ev => ({ ...ev, v: 2, data: { ...ev.data, tags: [] } }) }.
 * @type {Record<string, Record<number, Upcaster>>}
 */
export const UPCASTERS = {};

/**
 * Événement stocké → événement prêt à projeter (payload lu, format mis à jour).
 * @param {StoredEvent} ev
 * @param {Record<string, Record<number, Upcaster>>} [upcasters]
 * @returns {AppliedEvent}
 */
export function readEvent(ev, upcasters = UPCASTERS) {
  /** @type {AppliedEvent} */
  let out = { seq: ev.seq, id: ev.id, type: ev.type, v: ev.v, at: ev.at, device: ev.device, data: JSON.parse(ev.payload) };
  for (let guard = 0; guard < 100; guard++) {
    const up = upcasters[out.type] && upcasters[out.type][out.v];
    if (!up) break;
    const next = up(out);
    if (next.v <= out.v) throw new Error(`Convertisseur ${out.type}@${out.v} : la version doit augmenter`);
    out = next;
  }
  return out;
}

/**
 * Empreinte d'un événement.
 * @param {string} prevHash
 * @param {{ id: string, type: string, v: number, at: string, device: string, payload: string }} ev
 */
export const eventHash = (prevHash, ev) => sha256hex([prevHash, ev.id, ev.type, String(ev.v), ev.at, ev.device, ev.payload].join('\n'));

/**
 * Scelle un nouvel événement à la suite de la tête du journal.
 * @param {NewEvent} e
 * @param {{ seq: number, hash: string }} head
 * @param {{ id: string, at: string, device: string }} meta
 * @returns {Promise<StoredEvent>}
 */
export async function seal(e, head, meta) {
  const v = EVENT_TYPES[e.type];
  if (!v) throw new Error('Type d’événement inconnu : ' + e.type);
  const base = { seq: head.seq + 1, id: meta.id, type: e.type, v, at: meta.at, device: meta.device, payload: canonical(e.payload ?? {}), prev_hash: head.hash };
  return { ...base, hash: await eventHash(head.hash, base) };
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEVICE = /^[A-Za-z0-9._:-]{1,64}$/;
/**
 * Champs d'un événement lisibles et sans ambiguïté pour l'empreinte (aucun saut de ligne possible hors du payload,
 * qui est du JSON canonique), version de format connue de cette app. Renvoie le problème, ou null.
 * @param {StoredEvent} ev
 */
export function eventProblem(ev) {
  if (typeof ev.id !== 'string' || !ULID.test(ev.id)) return 'identifiant illisible';
  const known = /** @type {Record<string, number>} */ (EVENT_TYPES)[ev.type];
  if (!known) return `type inconnu : ${ev.type}`;
  if (!Number.isInteger(ev.v) || ev.v < 1) return 'version de format illisible';
  if (ev.v > known) return `format ${ev.type}@${ev.v} plus récent que cette version de Bougette`;
  if (typeof ev.at !== 'string' || !AT.test(ev.at) || Number.isNaN(Date.parse(ev.at))) return 'horodatage illisible';
  if (typeof ev.device !== 'string' || !DEVICE.test(ev.device)) return 'appareil illisible';
  if (typeof ev.payload !== 'string') return 'contenu illisible';
  try { if (canonical(JSON.parse(ev.payload)) !== ev.payload) return 'contenu mal formé'; } catch (e) { return 'contenu illisible'; }
  return null;
}

/**
 * Vérifie la chaîne : numéros consécutifs, champs lisibles, liens prev_hash, empreintes recalculées.
 * @param {StoredEvent[]} events dans l'ordre
 * @returns {Promise<{ ok: boolean, count: number, head: string, problem?: string }>}
 */
export async function verifyChain(events) {
  let prev = '';
  let seq = 0;
  const ids = new Set();
  for (const ev of events) {
    seq++;
    if (ev.seq !== seq) return { ok: false, count: seq - 1, head: prev, problem: `numéro ${ev.seq} au lieu de ${seq}` };
    if (ids.has(ev.id)) return { ok: false, count: seq - 1, head: prev, problem: `identifiant en double à ${seq}` };
    ids.add(ev.id);
    if (ev.prev_hash !== prev) return { ok: false, count: seq - 1, head: prev, problem: `lien rompu à ${seq}` };
    const bad = eventProblem(ev);
    if (bad) return { ok: false, count: seq - 1, head: prev, problem: `${bad} à ${seq}` };
    if (await eventHash(prev, ev) !== ev.hash) return { ok: false, count: seq - 1, head: prev, problem: `événement modifié à ${seq}` };
    prev = ev.hash;
  }
  return { ok: true, count: seq, head: prev };
}
