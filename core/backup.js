// Sauvegarde (ROADMAP 1b, 2026-11-09) : copies automatiques vérifiées sur le téléphone (src/data/copies.js), copies de
// sécurité, restauration depuis une copie, le message de la cloche quand l'intégrité est atteinte ; « Vérifier mes
// données ». Hors du téléphone, c'est la synchro Google Drive (D21) qui garde le journal.
import { session, migrateIcons, refuseNegatives } from './store.js';
import { today, iso } from './format.js';
import { autoCopy, safetyCopy, safetyCopyText, openCopyStore, checkJournalText, pickHeal, keepUntil, isSafety, safetyReason } from '../data/copies.js';
import { currentStorage, currentSpace, spaces, storageOf } from './spaces.js';
import { openDb } from '../data/db.js';
import { openSession } from '../data/session.js';
import { notify, resolve } from './inbox.js';

// Remplace toutes les données par celles du journal, après vérification de la chaîne et de l'empreinte d'état.
// Les icônes d'un journal ancien sont ensuite migrées (D7) par une commande, visible dans le journal.
/** @param {string} text */
async function importText(text) { const { hash } = await session.importJournal(text); await migrateIcons(); await refuseNegatives(); return hash; }

/** « Vérifier mes données » (2026-11-21) : chaîne d'empreintes, partie double, devises, soldes, projections = rejeu. */
export const verifyData = () => session.verify();

/** @type {Promise<import('../data/copies.js').CopyStore>|null} */
let storeP = null;
const store = () => (storeP ||= openCopyStore(currentStorage())); // les copies de l'espace ouvert (D19)

/** Les copies sur ce téléphone, la plus récente d'abord. */
export const listCopies = async () => (await store()).list();

/**
 * Copie du jour si elle est due, puis le message d'intégrité (ou sa disparition).
 * @param {{ force?: boolean }} [o] force : copie tout de suite (avant une mise à jour)
 */
export async function dailyCopy({ force = false } = {}) {
  let r;
  try { r = await autoCopy({ session, store: await store(), force }); } catch (e) { console.error('Copie automatique impossible', e); return { status: 'error' }; }
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
export async function copyOtherSpaces() {
  const KEY = 'bougette:spacesCopiedAt';
  try { if (Date.now() - (Date.parse(localStorage.getItem(KEY) || '') || 0) < 20 * 3600e3) return; } catch (e) { /* sans stockage : on vérifie */ }
  const here = currentSpace().id;
  for (const sp of spaces()) {
    if (sp.id === here) continue;
    const st = storageOf(sp.id);
    /** @type {any} */
    let db = null;
    try {
      db = await openDb({ url: st.db, idbName: st.idb });
      const ses = await openSession({ db, today });
      const r = await autoCopy({ session: ses, store: await openCopyStore(st) });
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
/** Copie de sécurité d'un journal donné (la synchro, juste avant de réécrire celui du téléphone, D21). @param {string} text */
export const keepSafetyText = async text => safetyCopyText({ store: await store(), reason: 'sync', text });

/**
 * Restaure exactement l'état d'un journal (une copie), après vérification, et après une
 * copie de sécurité de l'état présent. Dans un espace synchronisé, le journal restauré remplace celui du Drive à la
 * synchro suivante (D21 : session.importJournal le marque), au lieu d'être rejoint avec lui.
 * @param {string} text
 */
export async function restore(text) {
  // l'état présent d'abord ; abîmé, il ne se recopie pas (une copie fausse ne se restaurerait pas) : on passe
  await keepSafety('restore').catch(async e => { if ((await session.verify()).every((/** @type {{ ok: boolean }} */ c) => c.ok)) throw e; });
  const hash = await importText(text);
  resolve('integrity');
  return hash;
}

/**
 * Réparer (2026-11-21, avec l'utilisateur) : ce qui est sain et garde le plus (data/copies.js pickHeal), parmi le journal
 * du téléphone, ses copies et le journal du Drive. Null si rien n'est sain.
 * @param {string|null} [driveText] le journal du Drive en clair (D21), s'il y en a un
 */
export async function healPlan(driveText = null) {
  return pickHeal({ events: await session.events(), journalText: session.journalText, copies: await listCopies(), driveText });
}

/**
 * Répare d'après healPlan. Journal intact : les tables sont refaites depuis lui, rien d'autre ne bouge. Le journal du
 * Drive repris tel quel ne le réécrit pas ; sinon, comme Restaurer, l'état repris remplace celui du Drive (gardé à côté, D21).
 * @param {import('../data/copies.js').Heal} plan
 */
export async function heal(plan) {
  if (plan.from === 'journal' && !plan.lost) await session.rebuild();
  else {
    await importText(plan.text);
    if (plan.from === 'drive') await session.clearForce();
  }
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
