// Sauvegarde (ROADMAP 1b, 2026-11-09) : copies automatiques vérifiées sur le téléphone (src/data/copies.js), sauvegarde
// hors du téléphone (partage du fichier du journal), restauration depuis une copie ou un fichier, et les messages de la
// cloche quand l'intégrité est atteinte ou que la dernière sauvegarde hors du téléphone date.
import { session, pref, transactions } from './store.js';
import { today } from './format.js';
import { autoCopy, safetyCopy, safetyCopyText, openCopyStore, checkJournalText } from '../data/copies.js';
import { currentStorage, currentSpace, spaces, storageOf } from './spaces.js';
import { openDb } from '../data/db.js';
import { openSession } from '../data/session.js';
import { folderName, folderCopies, writeToFolder } from './folder.js';
import { seal, unseal } from '../data/seal.js';
import { exportText, importText } from './devtools.js';
import { notify, resolve } from './inbox.js';

const DAY = 86400e3;
/** rappel « hors du téléphone » : au-delà de 14 jours sans, et pas plus d'une fois par semaine */
const EXTERNAL_DAYS = 14;

/** @type {Promise<import('../data/copies.js').CopyStore>|null} */
let storeP = null;
const store = () => (storeP ||= openCopyStore(currentStorage())); // les copies de l'espace ouvert (D19)

/** Les copies sur ce téléphone, la plus récente d'abord. */
export const listCopies = async () => (await store()).list();

/** Date de la dernière sauvegarde hors du téléphone (ISO), ou null. */
export const lastExternal = () => /** @type {string|null} */ (pref('lastExternal'));

/**
 * Copie du jour si elle est due, puis messages : problème d'intégrité (ou sa disparition), rappel hors du téléphone.
 * @param {{ force?: boolean }} [o] force : copie tout de suite (bouton « Copier maintenant »)
 */
export async function dailyCopy({ force = false } = {}) {
  let r;
  try { r = await autoCopy({ session, store: await store(), force }); } catch (e) { console.error('Copie automatique impossible', e); return { status: 'error' }; }
  if (r.status === 'broken') {
    const p = r.problems[0];
    notify({
      key: 'integrity', kind: 'error', title: 'Problème d’intégrité',
      body: `${p.name} : ${p.detail}. ${r.last ? 'Tes copies saines restent disponibles.' : 'Aucune copie saine encore.'}`,
      action: r.last ? { label: 'Restaurer', id: 'backup' } : undefined,
    });
  } else {
    resolve('integrity');
    await toFolder(r.status === 'done' ? r.copy.text : null);
  }
  remindExternal();
  return r;
}

/**
 * Les autres espaces aussi (2026-11-19, avec l'utilisateur) : une fois par jour, après la copie de l'espace ouvert, chaque
 * autre espace est ouvert en arrière-plan, vérifié et copié comme lui (rien de nouveau : rien n'est écrit), puis
 * refermé ; s'il n'a encore aucune copie dans le dossier choisi, la sienne y part. Un espace fermé dont la base
 * s'abîme se voit ainsi tout de suite (la cloche le nomme), et aucun n'est absent du dossier. Ne bloque rien.
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
        const p = r.problems[0];
        notify({ key: `integrity:${sp.id}`, kind: 'error', title: `Problème d’intégrité · ${sp.name}`,
          body: `${p.name} : ${p.detail}. ${r.last ? 'Ses copies saines restent disponibles : ouvre cet espace pour restaurer.' : 'Aucune copie saine encore.'}` });
        continue;
      }
      resolve(`integrity:${sp.id}`);
      if (folderName() && (r.status === 'done' || !folderCopies(sp.name).length)) {
        writeToFolder(await seal(r.status === 'done' ? r.copy.text : await ses.exportJournal()), new Date(), sp.name);
      }
    } catch (e) {
      console.error(`Copie de l’espace ${sp.name} impossible`, e);
    } finally {
      try { await db?.close(); } catch (e) { /* déjà fermée */ }
    }
  }
  try { localStorage.setItem(KEY, new Date().toISOString()); } catch (e) { /* rien */ }
}

/**
 * Copie hors de l'app (D15, 2026-11-17) : une nouvelle copie va aussi, chiffrée, dans le dossier choisi ; s'il n'y en a
 * encore aucune pour cet espace (dossier tout juste choisi), l'état présent y part tout de suite. Un échec le dit dans la cloche.
 * @param {string|null} text le journal de la nouvelle copie, ou null (rien de nouveau)
 */
async function toFolder(text) {
  if (!folderName()) return;
  if (text === null && folderCopies().length) return;
  try {
    if (!writeToFolder(await seal(text ?? await exportText()))) throw new Error('écriture');
    resolve('folder');
  } catch (e) {
    console.error('Copie dans le dossier impossible', e);
    notify({ key: 'folder', kind: 'warn', title: 'Dossier de sauvegarde', body: 'La copie n’a pas pu être écrite dans le dossier. Rechoisis-le dans Données et sauvegarde.', action: { label: 'Ouvrir', id: 'backup' } });
  }
}
/** Écrit tout de suite l'état présent dans le dossier (après l'avoir choisi). */
export const copyToFolderNow = () => toFolder(null);

/** Rappel de sauvegarde hors du téléphone (une fois par semaine au plus, seulement s'il y a des opérations). */
function remindExternal() {
  if (!transactions().length) return;
  const last = lastExternal();
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / DAY) : null;
  if (days !== null && days < EXTERNAL_DAYS) { resolve('external'); return; }
  notify({
    key: 'external', kind: 'warn', title: 'Sauvegarde hors du téléphone',
    body: days === null ? 'Aucune encore : si le téléphone disparaît, ton journal disparaît avec lui.' : `La dernière date de ${days} jours.`,
    action: { label: 'Sauvegarder', id: 'share' },
  }, { every: 7 * DAY });
}

/** Le fichier à partager : le journal complet, chiffré (lisible seulement par Bougette), et son nom. */
export async function journalFile() {
  return { name: `bougette-${today()}.bougette`, text: await seal(await exportText()) };
}
/** À appeler une fois le fichier partagé (ou téléchargé). */
export function markExternal() {
  pref('lastExternal', new Date().toISOString());
  resolve('external');
}

/** Relit un fichier avant de restaurer (chiffré ou en clair) : ce qu'il contient, ou une erreur lisible. @param {string} text */
export const inspect = async text => checkJournalText(await unseal(text));

/**
 * Copie de sécurité de l'état présent avant une action qui remplace tout (D15, 2026-11-17) ; rejette si elle est impossible.
 * @param {'reset'|'restore'|'sync'} reason sync : avant de refaire les changements du téléphone par-dessus ceux d'un autre appareil (D21)
 */
export const keepSafety = async reason => safetyCopy({ session, store: await store(), reason });
/** Copie de sécurité d'un journal donné (la synchro, juste avant de réécrire celui du téléphone, D21). @param {string} text */
export const keepSafetyText = async text => safetyCopyText({ store: await store(), reason: 'sync', text });

/** Restaure exactement l'état d'un journal (copie ou fichier, chiffré ou en clair), après vérification, et après une copie de sécurité de l'état présent. @param {string} text */
export async function restore(text) {
  const plain = await unseal(text);
  await keepSafety('restore');
  const hash = await importText(plain);
  resolve('integrity');
  return hash;
}
