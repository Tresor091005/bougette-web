// La synchro dans l'app (D21) : quand synchroniser l'espace ouvert (à l'ouverture, quelques secondes après un changement,
// au retour dans l'app, au bouton), ce qu'on en dit (Moi › Compte Google, la cloche), et la liaison du compte.
// La Démo ne se synchronise jamais. Les autres espaces se synchronisent quand on les ouvre, avec le compte auquel ils sont
// attachés seulement : pas de transfert d'un compte à l'autre (2026-11-21, avec l'utilisateur).
import { session, pref, transactions, subscribe, openSpaceId } from './store.js';
import { keepSafetyText } from './backup.js';
import { notify, resolve, messages } from './inbox.js';
import { spaces, currentSpace, isDemo, MAIN, applyCloud, useAccount, goneCids, claimSpaces } from './spaces.js';
import { account, saveAccount, getToken, googleAvailable, goToGoogle, hasWebToken, forgetAccount, NeedsAuth, webTokenEmail, setWebTokenEmail, dropWebToken } from './google.js';
import { makeDrive, DriveError } from '../data/drive.js';
import { syncSpace, spaceFile, BrokenJournal } from '../data/cloud.js';
import { unsealSync } from '../data/seal.js';
import { createUlid } from '../domain/ulid.js';
import { sheetOpen } from './ui.js';
import { keepSkipped } from './review.js';

const ulid = createUlid({ now: () => Date.now(), random: Math.random });
const g = /** @type {any} */ (globalThis);
const android = () => !!g.BougetteGoogle;
const SILENT = 'bougette:google-silent';
const SILENT_EVERY = 50 * 60000;

/** @typedef {{ at?: string, kind?: string, error?: string, needsAuth?: boolean, running?: boolean, foreign?: string }} SyncStatus foreign : l'espace est attaché à un autre compte */
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

/** Cet espace se synchronise-t-il ? (compte lié, pas la Démo ; pas pendant le passage à un autre espace) */
export const syncOn = () => !!account() && !isDemo() && googleAvailable() && !paused && currentSpace().id === openSpaceId();

/** @type {Promise<any>|null} */
let running = null;
let again = false;
// Passer d'un espace à l'autre sur place (D19) : la synchro en cours finit sur l'espace d'avant (sa session, ses copies,
// son état), aucune autre ne part, puis la première synchro du nouvel espace, comme à l'ouverture. Si elle ne finit pas
// en ms (réseau bloqué), pauseCloud renvoie false : l'appelant recharge alors la page, qui l'arrête, comme avant.
let paused = false;
/** @param {number} [ms] @returns {Promise<boolean>} */
export async function pauseCloud(ms = 4000) {
  paused = true;
  clearTimeout(timer);
  /** @type {any} */
  let late = null;
  const done = await Promise.race([
    Promise.resolve(running).then(() => true, () => true),
    new Promise(ok => { late = setTimeout(() => ok(false), ms); }),
  ]);
  clearTimeout(late);
  clearTimeout(timer);
  again = false;
  return /** @type {boolean} */ (done);
}
export function resumeCloud() {
  paused = false;
  // comme à l'ouverture : un espace créé depuis est attaché au compte lié
  if (account()) claimSpaces(/** @type {import('./google.js').Account} */ (account()).email);
  firstSync();
}

/**
 * Synchronise l'espace ouvert maintenant. interactive : sur Android, la fenêtre de Google peut s'ouvrir (choisir le compte,
 * accepter) ; dans le navigateur, sans jeton, il faut repasser par Google (reconnect).
 * @param {{ interactive?: boolean }} [o]
 * @returns {Promise<{ ok: boolean, error?: string, away?: boolean }>}
 */
export function syncNow({ interactive = false } = {}) {
  if (paused) return Promise.resolve({ ok: false, error: '' });
  if (!syncOn()) return Promise.resolve({ ok: false, error: isDemo() ? 'La Démo ne se synchronise pas.' : 'Aucun compte Google lié.' });
  if (running) { again = true; return running; }
  running = run(interactive).finally(() => {
    running = null;
    changed();
    if (again) { again = false; schedule(1500); }
  });
  changed();
  return running;
}

let androidChecked = '';
/** Le jeton est-il bien celui du compte lié ? (navigateur : Google peut avoir laissé choisir un autre compte ; Android : une fois par ouverture) @param {ReturnType<typeof makeDrive>} drive */
async function checkWebAccount(drive) {
  if (android() ? androidChecked === account()?.email : webTokenEmail()) return;
  const who = await drive.about();
  const a = account();
  if (a && who.email.toLowerCase() !== a.email.toLowerCase()) {
    dropWebToken();
    throw new NeedsAuth(`Google t’a connecté avec ${who.email}. Reconnecte-toi avec ${a.email}.`);
  }
  if (android()) androidChecked = who.email; else setWebTokenEmail(who.email);
}

/** @param {boolean} interactive */
async function run(interactive) {
  const ses = session; // la session de l'espace synchronisé, gardée jusqu'au bout
  try {
    if (interactive && android()) await getToken({ interactive: true });
    const drive = makeDrive(refresh => getToken({ refresh }));
    await checkWebAccount(drive);
    const email = /** @type {import('./google.js').Account} */ (account()).email;
    // l'espace de la session ouverte, jamais un autre choisi entre-temps (son journal partirait sous le nom de celui-ci)
    const here = openSpaceId();
    const space = spaces().find(s => s.id === here);
    if (!space || space.id !== currentSpace().id) return { ok: false, error: '' };
    // attaché à un autre compte (lié avant) : il ne part jamais sur celui-ci (pas de transfert d'un compte à l'autre)
    if (space.owner && space.owner !== email.toLowerCase()) {
      setStatus({ error: `« ${space.name} » appartient au compte ${space.owner}. Il ne se synchronise pas avec celui-ci.`, foreign: space.owner, needsAuth: false });
      return { ok: false, error: 'foreign' };
    }
    // des données abîmées ne partent pas sur le Drive : on les répare d'abord (la cloche le dit)
    if (messages().some(m => m.key === 'integrity')) {
      setStatus({ error: 'Tes données ont un souci. Répare-les d’abord, depuis les notifications.', needsAuth: false });
      return { ok: false, error: 'integrity' };
    }
    const schema = (await ses.info()).schema;
    const r = await syncSpace({
      drive, session: ses, space, isMainSpace: space.id === MAIN, local: spaces(), gone: goneCids(),
      safety: text => keepSafetyText(text, here), newCid: () => ulid().toLowerCase(), newEpoch: () => ulid().toLowerCase(),
      newId: () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      schema, linkedAt: /** @type {import('./google.js').Account} */ (account()).linkedAt,
      onCid: me => applyCloud({ email, me, added: [], renamed: [] }),
    });
    applyCloud({ email, me: r.me, added: r.added, renamed: r.renamed });
    if (r.skipped.length) {
      const n = r.skipped.length;
      keepSkipped(r.skipped);
      notify({ key: 'sync-skip', kind: 'error', title: n === 1 ? 'Un changement à revoir' : `${n} changements à revoir`, body: `Un autre appareil ${n === 1 ? 'l’a modifié' : 'les a modifiés'} en même temps.`, action: { label: 'Revoir', id: 'review' } });
    }
    if (r.kind === 'reset') notify({ key: 'sync-reset', kind: 'info', title: `« ${space.name} » restauré ailleurs`, body: 'Cet appareil a suivi. Ce que tu y avais noté est gardé.' });
    if (r.forkedFrom) notify({ key: 'sync-fork', kind: 'info', title: `« ${space.name} » en deux versions`, body: 'Ton compte garde les deux, sans les mélanger.' });
    if (r.added.length) notify({ key: 'sync-spaces', kind: 'info', title: `${r.added.length === 1 ? 'Nouvel espace' : 'Nouveaux espaces'} : ${r.added.map(s => s.name).join(', ')}`, body: `Ouvre-${r.added.length === 1 ? 'le' : 'les'} depuis Moi.` });
    resolve('sync-auth');
    setStatus({ at: r.kind === 'busy' ? syncStatus().at : new Date().toISOString(), kind: r.kind, error: '', needsAuth: false, foreign: '' });
    if (r.kind === 'busy') again = true;
    return { ok: true };
  } catch (e) {
    const err = /** @type {Error} */ (e);
    const needsAuth = err instanceof NeedsAuth || (err instanceof DriveError && err.status === 401);
    if (!(err instanceof NeedsAuth)) console.error('Synchronisation', e);
    setStatus({ error: err.message || String(e), needsAuth });
    // un journal abîmé : la même alerte que la copie du jour, Réparer (D15)
    if (err instanceof BrokenJournal) notify({ key: 'integrity', kind: 'error', title: 'Tes données ont un souci', body: 'Répare-les : on te dit avant ce qui serait perdu.', action: { label: 'Réparer', id: 'heal' } });
    if (needsAuth) notify({ key: 'sync-auth', kind: 'warn', title: 'Synchro en pause', body: 'Google demande de te reconnecter.', action: { label: 'Reconnecter', id: 'google' } }, { every: 24 * 3600000 });
    return { ok: false, error: err.message };
  }
}

/**
 * Sans compte Google (2026-11-21, avec l'utilisateur : Google d'abord) : dès la première opération, la cloche dit que les
 * données ne sont que sur ce téléphone, jusqu'à ce qu'un compte soit lié. Pas dans la Démo, ni là où Google n'est pas.
 */
export function checkLinkInvite() {
  if (currentSpace().id !== openSpaceId()) return; // on passe à un autre espace : ses données ne sont pas encore là
  if (account() || isDemo() || !googleAvailable() || !transactions().length) { resolve('sync-invite'); return; }
  const title = 'Tes données sont seulement sur ce téléphone';
  // déjà là (une ancienne version du message comprise : son texte est remis à jour)
  if (messages().find(m => m.key === 'sync-invite')?.title === title) return;
  notify({ key: 'sync-invite', kind: 'warn', title, body: 'Garde-les sur Google Drive.', action: { label: 'Lier', id: 'google' } });
}

/**
 * Le journal de l'espace ouvert sur le Drive, en clair (pour Réparer, core/backup.js), ou null : pas de compte, espace
 * jamais envoyé ou attaché à un autre compte, hors ligne.
 * @returns {Promise<string|null>}
 */
export async function driveJournal() {
  const space = currentSpace(), a = account();
  if (!syncOn() || !space.cid || !a || (space.owner && space.owner !== a.email.toLowerCase())) return null;
  try {
    const drive = makeDrive(refresh => getToken({ refresh }));
    const f = (await drive.list()).find(x => x.name === spaceFile(/** @type {string} */ (space.cid)));
    return f ? await unsealSync(await drive.read(f.id)) : null;
  } catch (e) { console.error('Journal du Drive illisible', e); return null; }
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
  // déjà lié : changer de compte passe par Délier (qui redemande le code), jamais en écrasant le compte d'ici
  if (account()) return { ok: false, error: `Déjà lié à ${/** @type {import('./google.js').Account} */ (account()).email} : délie d’abord cet appareil.` };
  if (!android()) { goToGoogle({ purpose: 'link' }); return { ok: false, away: true, error: '' }; }
  await getToken({ interactive: true });
  return finishLink();
}
/** @returns {Promise<{ ok: boolean, error?: string, away?: boolean }>} */
async function finishLink() {
  const drive = makeDrive(refresh => getToken({ refresh }));
  const who = await drive.about();
  // le compte d'ici a pu être lié entre-temps (retour de Google) : on n'écrase jamais un autre compte
  const before = account();
  if (before && before.email.toLowerCase() !== who.email.toLowerCase()) { dropWebToken(); return { ok: false, error: `Déjà lié à ${before.email} : délie d’abord cet appareil.`, away: false }; }
  if (!android()) setWebTokenEmail(who.email);
  useAccount(who.email);
  claimSpaces(who.email);
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

/** La première synchro de l'espace ouvert. Renvoie true si la page part chez Google. */
function firstSync() {
  if (!syncOn()) return false;
  if (android() || hasWebToken()) { clearTimeout(timer); timer = setTimeout(() => syncNow(), 1500); return false; }
  if (trySilent()) return true;
  setStatus({ needsAuth: true });
  return false;
}

/**
 * Au démarrage : le retour de Google (navigateur), la première synchro, puis les synchros après un changement et au
 * retour dans l'app.
 * @param {{ purpose: string, ok: boolean, error?: string, silent?: boolean }|null} ret ce que takeGoogleReturn a lu
 * @param {(text: string) => void} toast
 */
export function startCloud(ret, toast) {
  // les espaces d'un appareil lié sont attachés à son compte (ceux d'avant le 2026-11-20 aussi, dès l'ouverture)
  if (account()) claimSpaces(/** @type {import('./google.js').Account} */ (account()).email);
  if (ret && ret.purpose === 'link') {
    if (ret.ok) finishLink().then(r => { toast(r.ok ? 'Compte Google lié' : `Lié, mais pas encore synchronisé : ${r.error}`); window.dispatchEvent(new CustomEvent('bougette:linked', { detail: r })); }).catch(e => toast(`Liaison impossible : ${e.message}`));
    else if (ret.error !== 'access_denied') toast('Liaison avec Google impossible.');
  } else if (ret && ret.purpose === 'sync') {
    if (ret.ok) setTimeout(() => syncNow(), 800);
    else setStatus({ needsAuth: true, error: 'Google demande de te reconnecter.' });
  } else if (firstSync()) return;
  // un changement pendant une synchro en relance une après elle (sinon il attendrait le prochain)
  subscribe(() => { if (!syncOn()) return; if (running) again = true; else schedule(8000); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !syncOn()) return;
    const last = Date.parse(syncStatus().at || '') || 0;
    if (Date.now() - last > 120000) schedule(500, true);
  });
}
