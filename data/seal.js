// Sauvegarde chiffrée (ROADMAP étape 2, sécurité, 2026-11-09) : le fichier qui part hors du téléphone (Drive, WhatsApp…)
// est chiffré en AES-GCM avec une clé propre à Bougette. Il est illisible ailleurs, toute modification est détectée,
// et il se restaure sur n'importe quel téléphone qui a Bougette, sans mot de passe à retenir.
// Limite assumée : la clé est dans l'app ; quelqu'un qui démonterait l'app pourrait la retrouver. Cela protège d'une
// lecture ordinaire du fichier, pas d'un expert (un mot de passe en plus : ROADMAP § 6).
// Format : une ligne d'en-tête « BOUGETTE-SAUVEGARDE 1 », puis le chiffré en base64 (12 octets d'IV, puis le chiffré).
// Un journal en clair (export Développeur, anciennes sauvegardes) reste accepté à la restauration.

export const SEAL_HEADER = 'BOUGETTE-SAUVEGARDE 1';
// Clé de l'app (256 bits), tirée d'une phrase fixe : la changer rendrait illisibles les sauvegardes déjà faites.
const KEY_SEED = 'Bougette · sauvegarde du journal · clé 1 · ne pas changer';

const subtle = () => /** @type {SubtleCrypto} */ (globalThis.crypto.subtle);
/** @type {Promise<CryptoKey>|null} */
let keyP = null;
const key = () => (keyP ||= (async () => {
  const raw = await subtle().digest('SHA-256', new TextEncoder().encode(KEY_SEED));
  return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
})());

/** @param {Uint8Array} bytes */
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** @param {string} b64 */
function fromB64(b64) {
  const s = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class SealError extends Error {}

/** Le journal (texte) → fichier de sauvegarde chiffré. @param {string} text */
export async function seal(text) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(text)));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv); all.set(ct, iv.length);
  return `${SEAL_HEADER}\n${toB64(all)}\n`;
}

/** Est-ce un fichier de sauvegarde chiffré ? @param {string} text */
export const isSealed = text => String(text ?? '').replace(/^﻿/, '').trimStart().startsWith(SEAL_HEADER);

/**
 * Fichier de sauvegarde → journal (texte). Un journal en clair est rendu tel quel. Rejette si le fichier chiffré est
 * abîmé ou n'a pas été fait par Bougette.
 * @param {string} text
 */
export async function unseal(text) {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  if (!t.startsWith(SEAL_HEADER)) return String(text ?? '');
  let all;
  try { all = fromB64(t.slice(SEAL_HEADER.length)); } catch (e) { throw new SealError('Sauvegarde abîmée : elle ne se lit pas.'); }
  if (all.length < 13) throw new SealError('Sauvegarde abîmée : elle ne se lit pas.');
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, await key(), all.subarray(12));
    return new TextDecoder().decode(pt);
  } catch (e) {
    throw new SealError('Sauvegarde abîmée ou faite par une autre app : elle ne se lit pas.');
  }
}
