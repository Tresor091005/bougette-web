// La synchro dans l'app (D21) : quand synchroniser l'espace ouvert (à l'ouverture, quelques secondes après un changement,
// au retour dans l'app, au bouton), ce qu'on en dit (Moi › Compte Google, la cloche), et la liaison du compte.
// La Démo ne se synchronise jamais. Les autres espaces se synchronisent quand on les ouvre.
import { session, pref, settings } from './store.js';
import { keepSafetyText } from './backup.js';
import { notify, resolve } from './inbox.js';
import { spaces, currentSpace, isDemo, MAIN, applyCloud, useAccount, goneCids } from './spaces.js';
import { account, saveAccount, getToken, googleAvailable, goToGoogle, hasWebToken, forgetAccount, NeedsAuth, webTokenEmail, setWebTokenEmail, dropWebToken } from './google.js';
import { makeDrive, DriveError } from '../data/drive.js';
import { syncSpace } from '../data/cloud.js';
import { isPristine, describeEvent } from '../data/sync.js';
import { createUlid } from '../domain/ulid.js';
import { sheetOpen } from './ui.js';
import { keepSkipped } from './review.js';

const ulid = createUlid({ now: () => Date.now(), random: Math.random });
const g = /** @type {any} */ (globalThis);
const android = () => !!g.BougetteGoogle;
const SILENT = 'bougette:google-silent';
const SILENT_EVERY = 50 * 60000;

/** @typedef {{ at?: string, kind?: string, error?: string, needsAuth?: boolean, running?: boolean }} SyncStatus */
/** @type {Set<() => void>} */
const listeners = new Set();
const changed = () => [...listeners].forEach(f => { try { f(); } catch (e) { console.error(e); } });
/** L'état de la synchro de l'espace ouvert. @returns {SyncStatus} */
export const syncStatus = () => ({ ...(pref('sync') || {}), running: !!running });
/** @param {() => void} fn */
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** @param {SyncStatus} s */
function setStatus(s) {
  pref('sync', { ...(pref('sync') || {}), ...s, running: undefined });
  changed();
}

/** Cet espace se synchronise-t-il ? (compte lié, pas la Démo) */
export const syncOn = () => !!account() && !isDemo() && googleAvailable();

/** @type {Promise<any>|null} */
let running = null;
let again = false;

/**
 * Synchronise l'espace ouvert maintenant. interactive : sur Android, la fenêtre de Google peut s'ouvrir (choisir le compte,
 * accepter) ; dans le navigateur, sans jeton, il faut repasser par Google (reconnect).
 * @param {{ interactive?: boolean }} [o]
 * @returns {Promise<{ ok: boolean, error?: string, away?: boolean }>}
 */
export function syncNow({ interactive = false } = {}) {
  if (!syncOn()) return Promise.resolve({ ok: false, error: isDemo() ? 'La Démo ne se synchronise pas.' : 'Aucun compte lié.' });
  if (running) { again = true; return running; }
  running = run(interactive).finally(() => {
    running = null;
    changed();
    if (again) { again = false; schedule(1500); }
  });
  changed();
  return running;
}

/** Navigateur : le jeton est-il bien celui du compte lié ? (Google peut avoir laissé choisir un autre compte) @param {ReturnType<typeof makeDrive>} drive */
async function checkWebAccount(drive) {
  if (android() || webTokenEmail()) return;
  const who = await drive.about();
  const a = account();
  if (a && who.email.toLowerCase() !== a.email.toLowerCase()) {
    dropWebToken();
    throw new NeedsAuth(`Ce n’est pas le compte lié (${who.email}) : reconnecte-toi avec ${a.email}.`);
  }
  setWebTokenEmail(who.email);
}

/** @param {boolean} interactive */
async function run(interactive) {
  try {
    if (interactive && android()) await getToken({ interactive: true });
    const drive = makeDrive(refresh => getToken({ refresh }));
    await checkWebAccount(drive);
    const email = /** @type {import('./google.js').Account} */ (account()).email;
    const space = currentSpace();
    const schema = (await session.info()).schema;
    const r = await syncSpace({
      drive, session, space, isMainSpace: space.id === MAIN, local: spaces(), gone: goneCids(),
      safety: text => keepSafetyText(text), newCid: () => ulid().toLowerCase(), newEpoch: () => ulid().toLowerCase(),
      newId: () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      schema, linkedAt: /** @type {import('./google.js').Account} */ (account()).linkedAt,
      onCid: me => applyCloud({ email, me, added: [], renamed: [] }),
    });
    applyCloud({ email, me: r.me, added: r.added, renamed: r.renamed });
    if (r.skipped.length) {
      const n = r.skipped.length;
      const what = [...new Set(r.skipped.map(x => describeEvent(x.event)))].slice(0, 3).join(', ');
      keepSkipped(r.skipped);
      notify({ key: 'sync-skip', kind: 'error', title: 'À revoir', body: `${n === 1 ? 'Un changement fait' : `${n} changements faits`} ici ${n === 1 ? 'n’a' : 'n’ont'} pas pu passer : un autre appareil avait déjà changé la même chose (${what}). Revois-${n === 1 ? 'le' : 'les'} pour ${n === 1 ? 'le' : 'les'} refaire ou ${n === 1 ? 'le' : 'les'} laisser tomber.`, action: { label: 'Revoir', id: 'review' } });
    }
    if (r.kind === 'reset') notify({ key: 'sync-reset', kind: 'info', title: 'Synchronisation', body: `« ${space.name} » a été restauré ou effacé sur un autre appareil : cet appareil a pris ce nouvel état, avec ce que tu avais noté ici depuis.` });
    if (r.forkedFrom) notify({ key: 'sync-fork', kind: 'info', title: 'Synchronisation', body: `Cet appareil et ton compte avaient des données différentes pour « ${space.name} » : rien n’est mélangé, ton compte garde les deux, chacun son espace.` });
    if (r.added.length) notify({ key: 'sync-spaces', kind: 'info', title: 'Espaces de ton compte', body: `${r.added.length === 1 ? 'Ajouté' : 'Ajoutés'} ici : ${r.added.map(s => s.name).join(', ')}. Ouvre-${r.added.length === 1 ? 'le' : 'les'} depuis Moi.` });
    resolve('sync-auth');
    setStatus({ at: r.kind === 'busy' ? syncStatus().at : new Date().toISOString(), kind: r.kind, error: '', needsAuth: false });
    if (r.kind === 'busy') again = true;
    return { ok: true };
  } catch (e) {
    const err = /** @type {Error} */ (e);
    const needsAuth = err instanceof NeedsAuth || (err instanceof DriveError && err.status === 401);
    if (!(err instanceof NeedsAuth)) console.error('Synchronisation', e);
    setStatus({ error: err.message || String(e), needsAuth });
    if (needsAuth) notify({ key: 'sync-auth', kind: 'warn', title: 'Synchronisation en pause', body: 'Google demande de te reconnecter pour que tes changements suivent sur tes autres appareils.', action: { label: 'Reconnecter', id: 'google' } }, { every: 24 * 3600000 });
    return { ok: false, error: err.message };
  }
}

/** @type {any} */
let timer = null;
/**
 * Une synchro dans un moment (les changements rapprochés partent ensemble). leave : le navigateur peut repasser par Google
 * (la page part et revient) — seulement au retour dans l'app, sans feuille ouverte, jamais juste après une saisie.
 * @param {number} ms @param {boolean} [leave]
 */
function schedule(ms, leave = false) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!syncOn()) return;
    if (android() || hasWebToken()) syncNow();
    else if (!(leave && !sheetOpen() && trySilent())) setStatus({ needsAuth: true, error: 'Google demande de te reconnecter.' });
  }, ms);
}

/**
 * Navigateur, jeton expiré : un aller-retour chez Google sans rien demander (au plus toutes les 50 minutes, jamais hors
 * ligne). Renvoie true si la page part.
 */
function trySilent() {
  if (android() || navigator.onLine === false) return false;
  let last = 0;
  try { last = Number(localStorage.getItem(SILENT)) || 0; } catch (e) { /* rien */ }
  if (Date.now() - last < SILENT_EVERY) return false;
  try { localStorage.setItem(SILENT, String(Date.now())); } catch (e) { return false; }
  setTimeout(() => goToGoogle({ purpose: 'sync', silent: true }), 300);
  return true;
}

/**
 * Lie un compte Google à ce téléphone. Android : la fenêtre de Google, puis la synchro. Navigateur : départ vers Google
 * (la page se recharge, la suite est dans startCloud).
 * @returns {Promise<{ ok: boolean, error?: string, away?: boolean }>}
 */
export async function linkAccount() {
  if (isDemo()) return { ok: false, error: 'Ouvre un autre espace que la Démo pour lier ton compte.' };
  if (!android()) { goToGoogle({ purpose: 'link' }); return { ok: false, away: true, error: '' }; }
  await getToken({ interactive: true });
  return finishLink();
}
/** @returns {Promise<{ ok: boolean, error?: string, away?: boolean }>} */
async function finishLink() {
  const drive = makeDrive(refresh => getToken({ refresh }));
  const who = await drive.about();
  if (!android()) setWebTokenEmail(who.email);
  useAccount(who.email);
  saveAccount({ email: who.email, name: who.name, linkedAt: new Date().toISOString() });
  resolve('sync-invite');
  changed();
  const r = await syncNow();
  return { ...r, away: false };
}
/** Délie ce téléphone (ses données restent sur lui ; celles du Drive restent sur le Drive). */
export async function unlinkAccount() {
  await forgetAccount();
  useAccount('');
  resolve('sync-auth');
  setStatus({ error: '', needsAuth: false, at: undefined, kind: undefined });
}
/** Navigateur : repasser par Google (le jeton a expiré et Google n'a pas pu le renouveler sans demander). */
export const reconnect = () => goToGoogle({ purpose: 'sync' });

/**
 * Au démarrage : le retour de Google (navigateur), la première synchro, puis les synchros après un changement et au
 * retour dans l'app ; l'invitation à lier un compte, une fois.
 * @param {{ purpose: string, ok: boolean, error?: string, silent?: boolean }|null} ret ce que takeGoogleReturn a lu
 * @param {(text: string) => void} toast
 */
export function startCloud(ret, toast) {
  if (ret && ret.purpose === 'link') {
    if (ret.ok) finishLink().then(r => toast(r.ok ? 'Compte Google lié' : `Lié, mais pas encore synchronisé : ${r.error}`)).catch(e => toast(`Liaison impossible : ${e.message}`));
    else if (ret.error !== 'access_denied') toast('Liaison avec Google impossible.');
  } else if (ret && ret.purpose === 'sync') {
    if (ret.ok) setTimeout(() => syncNow(), 800);
    else setStatus({ needsAuth: true, error: 'Google demande de te reconnecter.' });
  } else if (syncOn()) {
    if (android() || hasWebToken()) setTimeout(() => syncNow(), 1500);
    else if (trySilent()) return;
    else setStatus({ needsAuth: true });
  }
  // un changement pendant une synchro en relance une après elle (sinon il attendrait le prochain)
  session.subscribe(() => { if (!syncOn()) return; if (running) again = true; else schedule(8000); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !syncOn()) return;
    const last = Date.parse(syncStatus().at || '') || 0;
    if (Date.now() - last > 120000) schedule(500, true);
  });
  setTimeout(invite, 5000);
}

// Invitation à lier un compte (une fois) : un téléphone qui a de vraies données et aucun compte.
async function invite() {
  try {
    if (!googleAvailable() || account() || isDemo() || !settings().onboarded) return;
    if (localStorage.getItem('bougette:google-invited')) return;
    if (isPristine(await session.events())) return;
    localStorage.setItem('bougette:google-invited', new Date().toISOString());
    notify({ key: 'sync-invite', kind: 'info', title: 'Garde tes données dans ton Google Drive', body: 'Tu les retrouves sur tous tes appareils, même si tu en changes. Elles vont dans un dossier caché de ton Drive, que seule Bougette peut lire.', action: { label: 'Lier un compte', id: 'google' } });
  } catch (e) { /* plus tard */ }
}
