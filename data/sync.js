// Synchronisation d'un espace entre appareils (D21, 2026-11-20, avec l'utilisateur) : le journal d'un espace est gardé
// dans le Google Drive de la personne (dossier caché de l'app). Ici, la partie pure : comparer le journal du téléphone et
// celui du Drive, et dire quoi faire ; refaire les changements du téléphone par-dessus ceux d'un autre appareil.
//
// Les deux journaux ont toujours un début commun (le dernier point où ils étaient pareils), trouvé en comparant les
// empreintes (pas de mémoire à tenir juste : si un autre appareil a écrasé le Drive, le début commun le dit).
// - mêmes journaux : rien ;
// - le téléphone a des événements en plus : on envoie ;
// - le Drive a des événements en plus : on les prend (le journal du téléphone avance) ;
// - les deux en ont : on prend ceux du Drive, puis on refait par-dessus ceux du téléphone, chacun rescellé à la suite
//   (même identifiant, même date, même contenu ; seuls le numéro et les empreintes changent). Un événement qui ne
//   s'applique plus (il touche une chose supprimée ailleurs…) est mis de côté et signalé ; ceux qui en dépendent aussi.
// Deux journaux sans début commun (nés sur deux appareils) : un journal « vierge » (rien que l'installation) cède la place
// à l'autre ; un téléphone neuf prend ainsi le journal du Drive tel quel.
import { eventHash } from '../domain/events.js';
import { applyStored, replayStored } from '../domain/engine.js';
import { cloneState } from '../domain/projection.js';
import { DEFAULT_CATEGORIES } from '../domain/defaults.js';

/** @typedef {import('../domain/events.js').StoredEvent} StoredEvent */
/** @typedef {import('../domain/projection.js').State} State */
/** @typedef {{ kind: 'same'|'push'|'pull'|'adopt'|'rebase', k: number }} Plan */

const DEFAULT_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.id));
const SETUP_TYPES = new Set(['settings.changed', 'app.onboarded', 'category.created', 'category.updated']);

/**
 * Journal vierge : rien que ce que l'installation et l'accueil écrivent (réglages, catégories par défaut, icônes mises à
 * jour). Le moindre portefeuille, catégorie à soi, opération, budget, réserve ou échéance en fait un journal à garder.
 * @param {StoredEvent[]} events
 */
export function isPristine(events) {
  for (const e of events) {
    if (!SETUP_TYPES.has(e.type)) return false;
    if (e.type === 'category.created' || e.type === 'category.updated') {
      let id;
      try { id = JSON.parse(e.payload).id; } catch (err) { return false; }
      if (!DEFAULT_IDS.has(id)) return false;
    }
  }
  return true;
}

/**
 * Longueur du début commun (mêmes empreintes, dans l'ordre). La chaîne d'empreintes fait qu'une même empreinte au rang k
 * veut dire tout le début identique.
 * @param {StoredEvent[]} a @param {StoredEvent[]} b
 */
export function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  // la chaîne : si les têtes du plus court se retrouvent, tout le début est commun ; sinon on cherche par dichotomie
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid - 1].hash === b[mid - 1].hash) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Ce qu'il faut faire entre le journal du téléphone et celui du Drive (null : pas encore de journal sur le Drive).
 * @param {StoredEvent[]} local @param {StoredEvent[]|null} remote
 * @returns {Plan}
 */
export function syncPlan(local, remote) {
  if (!remote || !remote.length) return { kind: local.length ? 'push' : 'same', k: 0 };
  const k = commonPrefix(local, remote);
  if (k === local.length && k === remote.length) return { kind: 'same', k };
  if (k === remote.length) return { kind: 'push', k };
  if (k === local.length) return { kind: 'pull', k };
  // sans aucun début commun (deux journaux nés sur deux appareils) : un journal vierge cède la place à l'autre, sans
  // rien refaire (ses catégories par défaut ne doivent pas être recréées par-dessus). Avec un début commun, même un
  // réglage changé de chaque côté est refait.
  if (k === 0 && isPristine(local)) return { kind: 'adopt', k };
  if (k === 0 && isPristine(remote)) return { kind: 'push', k };
  return { kind: 'rebase', k };
}

/**
 * Refait des événements du téléphone à la suite du journal du Drive. Chacun est rescellé (numéro, lien, empreinte) et
 * appliqué sur une copie de l'état : s'il ne s'applique pas, il est mis de côté, l'état reste celui d'avant lui. Un
 * événement déjà présent dans le Drive (même identifiant, déjà envoyé par une synchro d'avant) n'est pas refait.
 * @param {StoredEvent[]} remote journal du Drive (vérifié)
 * @param {StoredEvent[]} extra événements du téléphone après le début commun
 * @param {State} [base] l'état du journal du Drive, s'il est déjà calculé
 * @returns {Promise<{ events: StoredEvent[], state: State, skipped: { event: StoredEvent, reason: string }[], kept: number }>}
 */
export async function rebase(remote, extra, base) {
  const ids = new Set(remote.map(e => e.id));
  let state = base || replayStored(remote);
  const events = remote.slice();
  /** @type {{ event: StoredEvent, reason: string }[]} */
  const skipped = [];
  let kept = 0;
  for (const e of extra) {
    if (ids.has(e.id)) continue;
    const head = state.head;
    const base2 = { seq: head.seq + 1, id: e.id, type: e.type, v: e.v, at: e.at, device: e.device, payload: e.payload, prev_hash: head.hash };
    const stored = { ...base2, hash: await eventHash(head.hash, base2) };
    const next = cloneState(state);
    try {
      applyStored(next, stored);
    } catch (err) {
      skipped.push({ event: e, reason: /** @type {Error} */ (err).message || String(err) });
      continue;
    }
    next.touched = null;
    state = next;
    events.push(stored);
    ids.add(e.id);
    kept++;
  }
  return { events, state, skipped, kept };
}

/**
 * Le journal à garder sur le téléphone après une synchro, selon le plan (null : le journal du téléphone ne change pas).
 * @param {StoredEvent[]} local @param {StoredEvent[]|null} remote @param {Plan} plan
 * @returns {Promise<{ events: StoredEvent[], state: State|null, skipped: { event: StoredEvent, reason: string }[] }|null>}
 */
export async function merged(local, remote, plan) {
  if (!remote || plan.kind === 'same' || plan.kind === 'push') return null;
  if (plan.kind === 'pull' || plan.kind === 'adopt') return { events: remote, state: null, skipped: [] };
  const r = await rebase(remote, local.slice(plan.k));
  return { events: r.events, state: r.state, skipped: r.skipped };
}

/** Ce qu'un événement mis de côté voulait faire, en mots simples. @param {StoredEvent} e */
export function describeEvent(e) {
  /** @type {any} */
  let p = {};
  try { p = JSON.parse(e.payload); } catch (err) { /* contenu illisible */ }
  const what = {
    entry: 'une opération', wallet: 'un portefeuille', category: 'une catégorie', budget: 'un budget', reserve: 'une réserve',
    schedule: 'une échéance', settings: 'un réglage', app: 'un réglage',
  }[e.type.split('.')[0]] || 'un changement';
  const name = typeof p.name === 'string' ? ` « ${p.name} »` : typeof p.note === 'string' && p.note ? ` « ${p.note} »` : '';
  return what + name;
}
