// JSON canonique et empreintes SHA-256 (WebCrypto : disponible dans la WebView, Chrome et Node).
// Même données → même texte → même empreinte, sur tous les appareils.

/**
 * JSON canonique : clés triées à tous les niveaux, pas d'espaces, `undefined` retiré des objets.
 * @param {any} v
 * @returns {string}
 */
export function canonical(v) {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
  if (typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Nombre non fini dans un JSON canonique');
  return JSON.stringify(v);
}

/**
 * SHA-256 d'un texte, en hexadécimal.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
