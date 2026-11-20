// Compte Google (D21, 2026-11-20, avec l'utilisateur) : un compte pour tout le téléphone (tous ses espaces, sauf la Démo),
// qui donne à l'app un jeton d'accès au seul dossier caché de Bougette dans le Drive (drive.appdata). Bougette ne voit ni
// les fichiers de la personne, ni son mot de passe. Rien d'autre ne part.
// - Sur Android : le compte Google du téléphone, par l'autorisation de Google Play (window.BougetteGoogle, GoogleBridge.kt) ;
//   Google refuse la connexion dans une WebView, la partie Android s'en charge, et renouvelle le jeton sans rien demander.
// - Dans le navigateur (iPhone…) : la page de Google, puis retour à l'app (redirection, pas de fenêtre surgissante :
//   l'app installée sur l'écran d'accueil d'un iPhone ne les gère pas bien). Le jeton dure une heure ; ensuite l'app
//   repasse par Google sans rien demander tant que la personne y reste connectée (prompt=none).

// L'identifiant du client « Application Web » du projet Google Cloud de Bougette (public, pas un secret).
export const WEB_CLIENT_ID = '58340371151-c646361lokdgh078vk3pvada21ol1ghl.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const KEY = 'bougette:google';
const TOKEN = 'bougette:google-token';
const PENDING = 'bougette:google-pending';

/** @typedef {{ email: string, name: string, linkedAt: string }} Account */

export class NeedsAuth extends Error {
  constructor(message = 'Relie ton compte Google pour synchroniser.') { super(message); }
}

const g = /** @type {any} */ (globalThis);
const androidBridge = () => g.BougetteGoogle || null;
const isWeb = () => !g.__TAURI_INTERNALS__;
/** @param {string} k */
const readJson = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
/** @param {string} k @param {any} v */
const writeJson = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } };

/** La synchro est-elle possible ici ? Android avec Google Play ; le navigateur, en https (ou en local), client configuré. */
export function googleAvailable() {
  if (androidBridge()) return true;
  if (!isWeb() || !WEB_CLIENT_ID) return false;
  return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}
/** Le compte lié à ce téléphone, ou null. @returns {Account|null} */
export const account = () => readJson(KEY);
/** @param {Account|null} a */
export const saveAccount = a => writeJson(KEY, a);

// --- Android : réponses de GoogleBridge par window.appGoogle(json) ---
let seq = 0;
/** @type {Map<string, { ok: (t: string) => void, ko: (e: Error) => void }>} */
const waiting = new Map();
g.appGoogle = (/** @type {string} */ json) => {
  /** @type {any} */
  let r = {};
  try { r = JSON.parse(json); } catch (e) { return; }
  const w = waiting.get(r.id);
  if (!w) return;
  waiting.delete(r.id);
  if (r.token) w.ok(r.token);
  else if (r.error === 'consent') w.ko(new NeedsAuth());
  else if (r.error === 'cancelled') w.ko(new NeedsAuth('Liaison annulée.'));
  else w.ko(new Error(r.error ? `Google : ${r.error}` : 'Google ne répond pas.'));
};
/** @param {boolean} interactive @param {string} [stale] un jeton refusé, que Google Play doit oublier avant d'en donner un autre */
function androidToken(interactive, stale = '') {
  return new Promise((ok, ko) => {
    const id = 'g' + (++seq);
    waiting.set(id, { ok, ko });
    try { androidBridge().authorize(id, interactive, account()?.email || '', stale); } catch (e) { waiting.delete(id); ko(/** @type {Error} */ (e)); }
  });
}

// --- navigateur : jeton gardé une heure, redirection vers Google ---
/** @returns {{ value: string, exp: number, email?: string }|null} */
const webToken = () => { const t = readJson(TOKEN); return t && t.value && t.exp > Date.now() + 60000 ? t : null; };

/**
 * Part chez Google, puis revient à l'app (la page se recharge). silent : sans rien demander (prompt=none), si la personne
 * est déjà connectée et a déjà accepté ; sinon Google revient avec une erreur et l'app le dit.
 * @param {{ purpose: 'link'|'sync', silent?: boolean }} o
 */
export function goToGoogle({ purpose, silent = false }) {
  const nonce = [...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  writeJson(PENDING, { nonce, purpose, route: location.hash || '#/', silent, at: Date.now() });
  const here = location.origin + location.pathname;
  const q = new URLSearchParams({
    client_id: WEB_CLIENT_ID, redirect_uri: here, response_type: 'token', scope: SCOPE, state: nonce,
    include_granted_scopes: 'true', ...(silent ? { prompt: 'none' } : {}), ...(account()?.email ? { login_hint: /** @type {Account} */ (account()).email } : {}),
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}

/**
 * Au démarrage, avant le premier écran : le retour de Google (#access_token=… ou #error=…) est lu, le jeton gardé, l'adresse
 * remise sur l'écran d'avant. Renvoie ce qui était demandé (link, sync) et si c'est réussi.
 * @returns {{ purpose: string, ok: boolean, error?: string, silent?: boolean }|null}
 */
export function takeGoogleReturn() {
  if (!isWeb()) return null;
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  const pending = readJson(PENDING);
  writeJson(PENDING, null);
  const route = pending?.route || '#/';
  try { history.replaceState(null, '', location.pathname + location.search + route); } catch (e) { location.hash = route; }
  if (!pending || p.get('state') !== pending.nonce || Date.now() - (Number(pending.at) || 0) > 15 * 60000) return null;
  const token = p.get('access_token');
  if (token) {
    writeJson(TOKEN, { value: token, exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 });
    return { purpose: pending.purpose, ok: true, silent: pending.silent };
  }
  return { purpose: pending.purpose, ok: false, error: p.get('error') || 'error', silent: pending.silent };
}

/**
 * Un jeton d'accès. interactive : la personne peut avoir à choisir son compte ou accepter (Android : la fenêtre de
 * Google ; navigateur : impossible sans quitter la page, NeedsAuth est levée et l'appelant propose goToGoogle).
 * @param {{ interactive?: boolean, refresh?: boolean }} [o]
 */
/** @type {{ value: string, exp: number }|null} jeton Android gardé en mémoire (Google Play le renouvelle de toute façon) */
let androidCache = null;
export async function getToken({ interactive = false, refresh = false } = {}) {
  if (androidBridge()) {
    if (!refresh && !interactive && androidCache && androidCache.exp > Date.now()) return androidCache.value;
    const value = /** @type {string} */ (await androidToken(interactive, refresh ? androidCache?.value || '' : ''));
    androidCache = { value, exp: Date.now() + 45 * 60000 };
    return value;
  }
  const t = refresh ? null : webToken();
  if (t) return t.value;
  if (refresh) writeJson(TOKEN, null);
  throw new NeedsAuth();
}
/** Navigateur : le compte du jeton, une fois vérifié (null : pas encore). */
export const webTokenEmail = () => webToken()?.email || null;
/** @param {string} email */
export function setWebTokenEmail(email) { const t = readJson(TOKEN); if (t) writeJson(TOKEN, { ...t, email }); }
export const dropWebToken = () => writeJson(TOKEN, null);
/** Le navigateur a-t-il un jeton valable (sans repasser par Google) ? */
export const hasWebToken = () => !!webToken();

/** Oublie le compte sur ce téléphone et retire l'accès donné à Bougette (le dossier du Drive reste). */
export async function forgetAccount() {
  let t = '';
  try { t = androidBridge() ? await androidToken(false) : webToken()?.value || ''; } catch (e) { /* plus d'accès : rien à retirer */ }
  if (t) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch (e) { /* hors ligne */ } }
  try { if (t && androidBridge()) androidBridge().clearToken(t); } catch (e) { /* rien */ }
  writeJson(TOKEN, null);
  androidCache = null;
  saveAccount(null);
}
