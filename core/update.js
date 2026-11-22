// Versions et mises à jour (D20, 2026-11-18). Le numéro d'une version est sa date et son heure, 0.AAMMJJ.HHMM ; on le lit
// en clair. Chercher et installer passent par le pont Android (window.BougetteUpdate, UpdateBridge.kt), le seul accès à
// internet de l'app, et seulement à la demande ; ses réponses arrivent par window.appUpdate.
import { APP_VERSION } from '../data/session.js';
import { dailyCopy } from './backup.js';
import { pref } from './store.js';
import { notify, resolve } from './inbox.js';
import { toast } from './ui.js';

const B = () => /** @type {any} */ (globalThis).BougetteUpdate;
/** Le pont est là (téléphone). */
export const updateAvailable = () => typeof B()?.check === 'function';

/** « 0.261118.1542 » → { y, m, d, h, mi } ; null pour un ancien numéro (0.6.0). @param {string} v */
function parts(v) {
  const m = /^v?0\.(\d{6})\.(\d{1,4})$/.exec(String(v || ''));
  if (!m) return null;
  const hm = Number(m[2]);
  return { y: 2000 + Number(m[1].slice(0, 2)), mo: Number(m[1].slice(2, 4)), d: Number(m[1].slice(4, 6)), h: Math.floor(hm / 100), mi: hm % 100 };
}
const MONTHS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
/** Le numéro en clair : « 18 nov 2026, 15 h 42 » (un ancien numéro reste tel quel). @param {string} v */
export function versionLabel(v) {
  const p = parts(v);
  return p ? `${p.d} ${MONTHS[p.mo - 1]} ${p.y}, ${p.h} h ${String(p.mi).padStart(2, '0')}` : String(v);
}
/** Pour comparer deux numéros (un ancien numéro vaut 0 : toute version datée est plus récente). @param {string} v */
export const versionKey = v => { const p = parts(v); return p ? ((p.y * 100 + p.mo) * 100 + p.d) * 10000 + p.h * 100 + p.mi : 0; };
export const currentVersion = () => APP_VERSION;

/** @type {((o: any) => void)|null} */
let listener = null;
/** @type {any} */ (globalThis).appUpdate = (/** @type {string} */ json) => { try { listener?.(JSON.parse(json)); } catch (e) { console.error(e); } };

/**
 * La dernière version publiée, et si elle est plus récente que celle-ci.
 * @returns {Promise<{ none?: boolean, newer?: boolean, tag?: string, title?: string, notes?: string, size?: number, url?: string }>}
 */
export function checkUpdate() {
  return new Promise((resolve, reject) => {
    listener = o => {
      if (o.step === 'error') { listener = null; reject(new Error(o.message)); }
      else if (o.step === 'info') { listener = null; resolve({ ...o, newer: !o.none && versionKey(o.tag) > versionKey(APP_VERSION) }); }
    };
    if (!B()?.check()) { listener = null; reject(new Error('Mises à jour indisponibles ici.')); }
  });
}

/**
 * Copie de sécurité (la copie du jour, forcée), téléchargement, puis
 * l'installation d'Android. onStep reçoit 'copy', 'progress' (pct), 'permission', 'ready'.
 * @param {string} url @param {(step: string, pct?: number) => void} onStep
 * @returns {Promise<'ready'|'permission'>}
 */
export async function installUpdate(url, onStep) {
  onStep('copy');
  const r = await dailyCopy({ force: true });
  if (r.status === 'broken' || r.status === 'error') throw new Error('La copie de sécurité a échoué : rien n’est installé.');
  return new Promise((resolve, reject) => {
    listener = o => {
      if (o.step === 'progress') onStep('progress', o.pct);
      else if (o.step === 'error') { listener = null; reject(new Error(o.message)); }
      else if (o.step === 'permission' || o.step === 'ready') { listener = null; onStep(o.step); resolve(o.step); }
    };
    if (!B()?.install(url)) { listener = null; reject(new Error('Téléchargement impossible.')); }
  });
}
/** Après avoir autorisé Bougette à installer des apps : ouvrir l'installation de l'APK déjà téléchargé. */
export const installDownloaded = () => !!B()?.installDownloaded();

/** Chercher tout seul (D20 revu le 2026-11-18) : oui par défaut ; non, seulement au bouton de Moi › Mises à jour. */
export const autoUpdate = () => pref('autoUpdate') !== false;
/** @param {boolean} on */
export const setAutoUpdate = on => pref('autoUpdate', on ? null : false);

/**
 * À l'ouverture : au plus une fois par jour, regarde s'il y a une version plus récente ; s'il y en a une, un message
 * « Nouvelle version · Installer » et la cloche l'ouvrent (événement bougette:open-update). Silencieux sans internet.
 */
export async function autoCheck() {
  if (!updateAvailable() || !autoUpdate()) return;
  const last = Date.parse(/** @type {string} */ (pref('updateCheckedAt')) || '') || 0;
  if (Date.now() - last < 20 * 3600e3) return;
  try {
    const u = await checkUpdate();
    pref('updateCheckedAt', new Date().toISOString());
    if (!u.newer) { resolve('update'); return; }
    const label = versionLabel(u.tag || '');
    notify({ key: 'update', kind: 'info', title: 'Nouvelle version', body: 'Prête à installer.', action: { label: 'Installer', id: 'update' } });
    toast(`Nouvelle version · ${label}`, { label: 'Installer', run: () => window.dispatchEvent(new CustomEvent('bougette:open-update', { detail: u })) });
  } catch (e) { /* pas d'internet : on réessaiera à la prochaine ouverture */ }
}
