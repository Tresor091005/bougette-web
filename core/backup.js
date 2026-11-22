// Sauvegarde (ROADMAP 1b, 2026-11-09) : copies automatiques vérifiées sur le téléphone (src/data/copies.js), copies de
// sécurité, restauration depuis une copie, le message de la cloche quand l'intégrité est atteinte ; « Vérifier mes
// données ». Hors du téléphone, c'est la synchro Google Drive (D21) qui garde le journal.
import { session, migrateIcons, refuseNegatives, openSpaceId } from './store.js';
import { today, iso } from './format.js';
import { autoCopy, safetyCopy, safetyCopyText, openCopyStore, checkJournalText, pickHeal, keepUntil, isSafety, safetyReason } from '../data/copies.js';
import { spaces, storageOf } from './spaces.js';
import { openDb } from '../data/db.js';
import { openSession } from '../data/session.js';
import { notify, resolve } from './inbox.js';

// Remplace toutes les données par celles du journal, après vérification de la chaîne et de l'empreinte d'état.
// Les icônes d'un journal ancien sont ensuite migrées (D7) par une commande, visible dans le journal.
/** @param {string} text @param {string} [id] l'espace visé : rien ne se fait s'il n'est plus ouvert */
async function importText(text, id = openSpaceId()) {
  stay(id);
  const { hash } = await session.importJournal(text);
  stay(id);
  await migrateIcons();
  await refuseNegatives();
  return hash;
}
// Un geste commencé dans un espace (Restaurer, Réparer) s'arrête si on en a ouvert un autre entre-temps (D19).
/** @param {string} id */
export function stay(id) { if (openSpaceId() !== id) throw new Error('Tu as changé d’espace : rien n’est fait.'); }

/** « Vérifier mes données » (2026-11-21) : chaîne d'empreintes, partie double, devises, soldes, projections = rejeu. */
export const verifyData = () => session.verify();

/** @typedef {import('../data/copies.js').CopyStore} CopyStore */
/** @type {Promise<CopyStore>|null} */
let storeP = null;
let storeOf = '';
// les copies de l'espace de la session ouverte (D19), pas d'un espace choisi mais pas encore ouvert ; un autre espace
// ouvert, ce sont les siennes (celles d'avant se referment)
const store = () => {
  const id = openSpaceId();
  if (storeP && storeOf === id) return storeP;
  const old = storeP;
  storeOf = id;
  storeP = openCopyStore(storageOf(id));
  old?.then(s => s.close?.()).catch(() => {});
  return storeP;
};

// Passer d'un espace à l'autre sur place (D19) : les copies en cours de l'espace d'avant s'arrêtent à la prochaine étape
// (celles des autres espaces entre deux espaces) avant que sa base ne se referme ; rien ne part tant que le nouvel espace
// n'est pas ouvert.
let paused = false;
/** @type {Set<Promise<any>>} */
const busy = new Set();
/** @template T @param {Promise<T>} p @returns {Promise<T>} */
const track = p => { busy.add(p); p.finally(() => busy.delete(p)).catch(() => {}); return p; };
export async function pauseCopies() {
  paused = true;
  await Promise.allSettled([...busy]);
}
export function resumeCopies() { paused = false; }

/** Les copies sur ce téléphone, la plus récente d'abord. */
export const listCopies = async () => (await store()).list();

/**
 * Copie du jour si elle est due, puis le message d'intégrité (ou sa disparition).
 * @param {{ force?: boolean }} [o] force : copie tout de suite (avant une mise à jour)
 */
export function dailyCopy({ force = false } = {}) {
  if (paused) return Promise.resolve({ status: 'error' });
  return track(copyNow(force));
}
/** @param {boolean} force */
async function copyNow(force) {
  let r;
  try { r = await autoCopy({ session, store: await store(), force, stop: () => paused }); } catch (e) { console.error('Copie automatique impossible', e); return { status: 'error' }; }
  if (r.status === 'stopped') return r; // on change d'espace : elle repart à la prochaine ouverture
  if (r.status === 'broken') {
    notify({
      key: 'integrity', kind: 'error', title: 'Tes données ont un souci', body: 'Répare-les : on te dit avant ce qui serait perdu.',
      action: { label: 'Réparer', id: 'heal' },
    });
  } else resolve('integrity');
  resolve('external'); // l'ancien rappel « Sauvegarde hors du téléphone » (retiré le 2026-11-21) quitte la cloche
  resolve('folder'); // le dossier de sauvegarde (retiré le 2026-11-21) aussi
  return r;
}

/**
 * Les autres espaces aussi (2026-11-19, avec l'utilisateur) : une fois par jour, après la copie de l'espace ouvert, chaque
 * autre espace est ouvert en arrière-plan, vérifié et copié comme lui (rien de nouveau : rien n'est écrit), puis
 * refermé. Un espace fermé dont la base s'abîme se voit ainsi tout de suite (la cloche le nomme). Ne bloque rien.
 */
export function copyOtherSpaces() { return paused ? Promise.resolve() : track(copyOthers()); }
async function copyOthers() {
  const KEY = 'bougette:spacesCopiedAt';
  try { if (Date.now() - (Date.parse(localStorage.getItem(KEY) || '') || 0) < 20 * 3600e3) return; } catch (e) { /* sans stockage : on vérifie */ }
  const here = openSpaceId();
  for (const sp of spaces()) {
    if (paused) return; // on change d'espace : la suite au prochain jour (la date n'est pas posée)
    if (sp.id === here) continue;
    const st = storageOf(sp.id);
    /** @type {any} */
    let db = null;
    /** @type {CopyStore|null} */
    let copies = null;
    try {
      db = await openDb({ url: st.db, idbName: st.idb });
      const ses = await openSession({ db, today });
      copies = await openCopyStore(st);
      const r = await autoCopy({ session: ses, store: copies });
      if (r.status === 'broken') {
        notify({ key: `integrity:${sp.id}`, kind: 'error', title: `Problème dans « ${sp.name} »`,
          body: 'Ouvre-le pour le réparer.', action: { label: 'Ouvrir', id: `space:${sp.id}` } });
        continue;
      }
      resolve(`integrity:${sp.id}`);
    } catch (e) {
      console.error(`Copie de l’espace ${sp.name} impossible`, e);
    } finally {
      try { await db?.close(); } catch (e) { /* déjà fermée */ }
      try { await copies?.close?.(); } catch (e) { /* déjà fermé */ }
    }
  }
  try { localStorage.setItem(KEY, new Date().toISOString()); } catch (e) { /* rien */ }
}

/** Relit une copie avant de la restaurer : ce qu'elle contient, ou une erreur lisible. @param {string} text */
export const inspect = async text => checkJournalText(text);

/**
 * Copie de sécurité de l'état présent avant une action qui remplace tout (D15, 2026-11-17) ; rejette si elle est impossible.
 * @param {'restore'|'sync'} reason sync : avant de refaire les changements du téléphone par-dessus ceux d'un autre appareil (D21)
 */
const keepSafety = async reason => safetyCopy({ session, store: await store(), reason });
/**
 * Copie de sécurité d'un journal donné (la synchro, juste avant de réécrire celui du téléphone, D21), dans les copies de
 * l'espace id : celui de la synchro, même si un autre s'est ouvert entre-temps.
 * @param {string} text @param {string} [id]
 */
export async function keepSafetyText(text, id = openSpaceId()) {
  if (id === openSpaceId()) return safetyCopyText({ store: await store(), reason: 'sync', text });
  const copies = await openCopyStore(storageOf(id));
  try { return await safetyCopyText({ store: copies, reason: 'sync', text }); } finally { try { await copies.close?.(); } catch (e) { /* déjà fermé */ } }
}

/**
 * Restaure exactement l'état d'un journal (une copie), après vérification, et après une
 * copie de sécurité de l'état présent. Dans un espace synchronisé, le journal restauré remplace celui du Drive à la
 * synchro suivante (D21 : session.importJournal le marque), au lieu d'être rejoint avec lui.
 * @param {string} text
 */
export async function restore(text) {
  const id = openSpaceId();
  // l'état présent d'abord ; abîmé, il ne se recopie pas (une copie fausse ne se restaurerait pas) : on passe
  await keepSafety('restore').catch(async e => { if ((await session.verify()).every((/** @type {{ ok: boolean }} */ c) => c.ok)) throw e; });
  const hash = await importText(text, id);
  stay(id);
  resolve('integrity');
  return hash;
}

/**
 * Réparer (2026-11-21, avec l'utilisateur) : ce qui est sain et garde le plus (data/copies.js pickHeal), parmi le journal
 * du téléphone, ses copies et le journal du Drive. Null si rien n'est sain.
 * @param {string|null} [driveText] le journal du Drive en clair (D21), s'il y en a un
 */
export async function healPlan(driveText = null) {
  const id = openSpaceId(), ses = session;
  const events = await ses.events(), copies = await listCopies();
  stay(id);
  return pickHeal({ events, journalText: ses.journalText, copies, driveText });
}

/**
 * Répare d'après healPlan. Journal intact : les tables sont refaites depuis lui, rien d'autre ne bouge. Le journal du
 * Drive repris tel quel ne le réécrit pas ; sinon, comme Restaurer, l'état repris remplace celui du Drive (gardé à côté, D21).
 * @param {import('../data/copies.js').Heal} plan
 */
export async function heal(plan) {
  const id = openSpaceId();
  if (plan.from === 'journal' && !plan.lost) await session.rebuild();
  else {
    await importText(plan.text, id);
    stay(id);
    if (plan.from === 'drive') await session.clearForce();
  }
  stay(id);
  resolve('integrity');
}

const dayOf = (/** @type {string} */ at) => iso(new Date(at));
/** Le premier jour du journal (rien avant), ou null s'il est vide. */
export async function firstDay() {
  const events = await session.events();
  return events.length ? dayOf(events[0].at) : null;
}

/**
 * L'état à la fin d'un jour passé (data/copies.js keepUntil), relu et rejoué : son journal, ses opérations ; null si
 * rien n'a changé depuis (c'est l'état présent). Rejette si le journal est abîmé là (Réparer s'en occupe).
 * @param {string} day AAAA-MM-JJ
 * @returns {Promise<{ text: string, ops: number }|null>}
 */
export async function stateAt(day) {
  const events = await session.events();
  const n = keepUntil(events, day, dayOf);
  if (n === events.length) return null;
  const text = await session.journalText(events.slice(0, n));
  return { text, ops: (await checkJournalText(text)).ops };
}

/**
 * Annuler le dernier retour (2026-11-21, avec l'utilisateur) : la copie de sécurité faite juste avant la dernière
 * restauration ou le dernier retour en arrière, si elle a moins de 7 jours ; sinon null.
 * @param {Date} [now]
 */
export async function lastReturn(now = new Date()) {
  const c = (await listCopies()).find(x => isSafety(x) && safetyReason(x) === 'restore');
  return c && now.getTime() - Date.parse(c.at) < 7 * 86400e3 ? c : null;
}
