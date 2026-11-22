// Code de Bougette et verrouillage (ROADMAP étape 2, sécurité, 2026-11-09 ; « code exigé, app libre », 2026-11-21, avec
// l'utilisateur). Le code (4 à 6 chiffres) est exigé avant chaque action sensible : sans code, on en choisit un d'abord,
// et il ne se retire plus (seulement se changer). Verrouiller l'app elle-même est un choix à part (« Verrouiller à
// l'ouverture ») : demandé alors à l'ouverture et au retour dans l'app après une minute ailleurs. Un code choisi avant le
// 2026-11-21 garde ce verrou (réglage absent = activé) ; un code choisi depuis ne l'active pas. Le téléphone peut aussi
// attester que c'est toi (empreinte s'il en a une, sinon son code ou son schéma) ; pas de réglage « empreinte » : tous
// les téléphones ne l'ont pas, et le téléphone choisit lui-même. Le code n'est jamais
// gardé : seulement son empreinte (PBKDF2-SHA256, sel aléatoire), dans les préférences du téléphone (pas dans le
// journal, qui part dans les sauvegardes). Après 5 essais faux, une attente qui double à chaque nouvel échec.
// Code oublié : le téléphone atteste (phoneUnlock) et ouvre l'app ; jamais d'effacement depuis l'écran verrouillé.
import { pref } from './store.js';

const ITER = 120000;
export const AWAY_MS = 60000; // au-delà d'une minute hors de l'app, le code est redemandé

/** @typedef {{ salt: string, hash: string, len?: number }} LockConf */
/** @returns {LockConf|null} */
const conf = () => /** @type {LockConf|null} */ (pref('lock'));
/** Un code est-il choisi ? (exigé alors avant chaque action sensible) */
export const hasCode = () => !!conf();
/** L'app se verrouille-t-elle à l'ouverture ? Il faut un code ; réglage absent (code d'avant le 2026-11-21) : oui. */
export const lockAtOpen = () => hasCode() && pref('lockOpen') !== false;
/** Verrouiller à l'ouverture, ou plus. @param {boolean} on */
export function setLockOpen(on) {
  if (on && !hasCode()) throw new Error('Choisis d’abord un code.');
  pref('lockOpen', !!on);
}
/** Longueur du code (pour valider dès le dernier chiffre), ou null. */
export const codeLength = () => conf()?.len || null;

/** @param {Uint8Array} b */
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
/** @param {string} h */
const unhex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));

/** @param {string} code @param {Uint8Array} salt */
async function derive(code, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: /** @type {BufferSource} */ (salt), iterations: ITER }, k, 256)));
}

/** Code valide : 4 à 6 chiffres. @param {string} code */
export const validCode = code => /^\d{4,6}$/.test(code);

/** Choisit le code, ou le change. Un premier code ne verrouille pas l'app à l'ouverture (setLockOpen). @param {string} code */
export async function setCode(code) {
  if (!validCode(code)) throw new Error('Le code fait 4 à 6 chiffres.');
  if (!hasCode()) pref('lockOpen', false);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  pref('lock', { salt: hex(salt), hash: await derive(code, salt), len: code.length });
  pref('lockFails', null);
}

/** Attente restante (ms) avant un nouvel essai, après trop d'échecs. */
export function waitMs(now = Date.now()) {
  const f = /** @type {{ n: number, until: number }|null} */ (pref('lockFails'));
  return f && f.until > now ? f.until - now : 0;
}
/**
 * Vérifie le code. Renvoie true s'il est juste ; sinon compte l'échec (5 échecs : 30 s d'attente, puis le double).
 * @param {string} code
 */
export async function checkCode(code, now = Date.now()) {
  const c = conf();
  if (!c) return true;
  if (waitMs(now)) return false;
  const ok = (await derive(code, unhex(c.salt))) === c.hash;
  if (ok) { pref('lockFails', null); return true; }
  const f = /** @type {{ n: number, until: number }|null} */ (pref('lockFails')) || { n: 0, until: 0 };
  const n = f.n + 1;
  pref('lockFails', { n, until: n >= 5 ? now + 30000 * 2 ** (n - 5) : 0 });
  return false;
}

// --- le téléphone atteste (plugin biométrique de Tauri, seulement sur le téléphone) ---
/** @param {string} cmd @param {Record<string, any>} [args] */
const invoke = (cmd, args = {}) => /** @type {any} */ (globalThis).__TAURI_INTERNALS__?.invoke(cmd, args);
/** Sommes-nous dans l'app du téléphone (où le téléphone peut attester) ? */
export const canAskPhone = () => typeof (/** @type {any} */ (globalThis).__TAURI_INTERNALS__?.invoke) === 'function';
/**
 * Le téléphone confirme que c'est toi : empreinte s'il en a une, sinon son code ou son schéma. true si reconnu ;
 * false s'il échoue, est annulé, ou si le téléphone n'a aucun verrouillage (il reste alors le code de Bougette).
 */
/** @param {string} [reason] ce que la fenêtre du téléphone annonce */
export async function phoneUnlock(reason = 'Déverrouiller Bougette') {
  try {
    await invoke('plugin:biometric|authenticate', { reason, allowDeviceCredential: true, title: 'Bougette' });
    return true;
  } catch (e) { return false; }
}
