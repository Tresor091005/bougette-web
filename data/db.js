// Interface commune `Db` et choix de l'adaptateur au démarrage : SQLite natif (Tauri) si la WebView de l'app
// est là, sinon SQLite en WebAssembly (Chrome pour le développement et les captures, Node pour les tests).

/**
 * @typedef {{
 *   exec: (sql: string, params?: any[]) => void,
 *   select?: (sql: string, params?: any[]) => Promise<Record<string, any>[]>
 * }} Tx
 * Dans une transaction, les écritures sont appliquées d'un bloc (tout ou rien).
 */
/**
 * @typedef {{
 *   kind: 'wasm'|'tauri',
 *   exec: (sql: string, params?: any[]) => Promise<void>,
 *   select: (sql: string, params?: any[]) => Promise<Record<string, any>[]>,
 *   transaction: (fn: (tx: Tx) => void|Promise<void>) => Promise<void>,
 *   size: () => Promise<number>,
 *   flush: () => Promise<void>,
 *   close: () => Promise<void>,
 * }} Db
 */

/**
 * Coupe un script SQL en morceaux exécutables tels quels, pour les assembler sans risquer qu'un commentaire de fin
 * avale le séparateur suivant.
 * @param {string[]} chunks
 */
export const joinSql = chunks => chunks.map(c => c.trim().replace(/;+$/, '')).filter(Boolean).join('\n;\n') + '\n;';

/**
 * Ouvre la base de l'app.
 * @param {{ persist?: boolean, url?: string, idbName?: string }} [opts] url / idbName : la base de l'espace ouvert (D19)
 * @returns {Promise<Db>}
 */
export async function openDb(opts = {}) {
  const g = /** @type {any} */ (globalThis);
  if (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === 'function') {
    const { openTauriDb } = await import('./db-tauri.js');
    return openTauriDb(opts.url);
  }
  const { openWasmDb } = await import('./db-wasm.js');
  return openWasmDb({ persist: opts.persist ?? typeof indexedDB !== 'undefined', idbName: opts.idbName });
}
