// Journal chiffré pour le Drive (D16, D21) : AES-GCM avec une clé propre à Bougette. Illisible ailleurs, toute
// modification est détectée, il se relit sur n'importe quel appareil qui a Bougette, sans mot de passe à retenir.
// Limite assumée : la clé est dans l'app (dont le code est public depuis la version web, D21). Cela protège d'une
// lecture ordinaire du fichier, pas de quelqu'un qui la cherche.

// Clé de l'app (256 bits), tirée d'une phrase fixe : la changer rendrait illisibles les journaux déjà sur le Drive.
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

// Format : une ligne d'en-tête « BOUGETTE-SYNC 1 gz » (ou « txt »), puis le chiffré en base64 (12 octets d'IV, puis le
// chiffré) du journal compressé (gzip, quand le navigateur sait le faire).
export const SYNC_HEADER = 'BOUGETTE-SYNC 1';
/** @param {Uint8Array} bytes @param {'gzip'} fmt @param {boolean} inflate */
async function gz(bytes, fmt, inflate) {
  const g = /** @type {any} */ (globalThis);
  const S = inflate ? g.DecompressionStream : g.CompressionStream;
  const stream = new Blob([/** @type {BlobPart} */ (/** @type {unknown} */ (bytes))]).stream().pipeThrough(new S(fmt));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Le journal (texte) → fichier pour le Drive, compressé et chiffré. @param {string} text */
export async function sealSync(text) {
  let bytes = new TextEncoder().encode(text);
  const zip = typeof (/** @type {any} */ (globalThis)).CompressionStream === 'function';
  if (zip) bytes = await gz(bytes, 'gzip', false);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await key(), bytes));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv); all.set(ct, iv.length);
  return `${SYNC_HEADER} ${zip ? 'gz' : 'txt'}\n${toB64(all)}\n`;
}
/** Fichier du Drive → journal (texte). @param {string} text */
export async function unsealSync(text) {
  const t = String(text ?? '').trim();
  const nl = t.indexOf('\n');
  const head = nl < 0 ? t : t.slice(0, nl);
  if (!head.startsWith(SYNC_HEADER)) throw new SealError('Les données sur Google Drive ne viennent pas de Bougette.');
  const zip = head.slice(SYNC_HEADER.length).trim() === 'gz';
  let all;
  try { all = fromB64(t.slice(nl + 1)); } catch (e) { throw new SealError('Les données sur Google Drive sont abîmées.'); }
  if (all.length < 13) throw new SealError('Les données sur Google Drive sont abîmées.');
  let pt;
  try { pt = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, await key(), all.subarray(12))); } catch (e) { throw new SealError('Les données sur Google Drive sont abîmées, ou ne viennent pas de Bougette.'); }
  if (zip) {
    if (typeof (/** @type {any} */ (globalThis)).DecompressionStream !== 'function') throw new SealError('Tes données sur Google Drive ne se lisent pas ici. Mets à jour ton navigateur.');
    pt = await gz(pt, 'gzip', true);
  }
  return new TextDecoder().decode(pt);
}

