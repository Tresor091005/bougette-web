// Adaptateur `Db` sur tauri-plugin-sql (SQLite natif via Rust/sqlx), sans bundler : appels directs à l'IPC de Tauri.
// Le plugin tient un groupe de connexions : un BEGIN et un COMMIT envoyés séparément pourraient tomber sur deux
// connexions différentes. Une transaction est donc envoyée en UN seul appel (« BEGIN; …; COMMIT; »), les valeurs
// écrites comme littéraux SQL échappés (le plugin lierait aussi les entiers en nombres flottants). Les appels sont
// sérialisés ; après une erreur, les connexions sont refermées et rouvertes (toute transaction restée ouverte est annulée).
import { joinSql } from './db.js';

/** @typedef {import('./db.js').Db} Db */

const DEFAULT_URL = 'sqlite:bougette.db';

/** @param {string} cmd @param {Record<string, any>} args */
const invoke = (cmd, args) => /** @type {any} */ (globalThis).__TAURI_INTERNALS__.invoke(cmd, args);

/**
 * Valeur → littéral SQL.
 * @param {any} v
 */
export function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Nombre non fini');
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === 'string') return "'" + v.replace(/\u0000/g, '').replace(/'/g, "''") + "'";
  throw new Error('Valeur SQL non gérée : ' + typeof v);
}
/**
 * Remplace chaque « ? » par la valeur correspondante (nos requêtes n'ont jamais de « ? » dans un texte littéral).
 * @param {string} sql
 * @param {any[]} [params]
 */
export function inline(sql, params = []) {
  if (!params.length) return sql;
  const parts = sql.split('?');
  if (parts.length - 1 !== params.length) throw new Error(`Paramètres SQL : ${params.length} pour ${parts.length - 1} emplacements`);
  return parts.reduce((out, p, i) => out + p + (i < params.length ? literal(params[i]) : ''), '');
}

/** @param {string} [DB_URL] la base de l'espace ouvert (D19) @returns {Promise<Db>} */
export async function openTauriDb(DB_URL = DEFAULT_URL) {
  const load = () => invoke('plugin:sql|load', { db: DB_URL });
  await load();
  /** @param {string} query */
  const execute = query => invoke('plugin:sql|execute', { db: DB_URL, query, values: [] });
  /** @param {string} query */
  const select = query => invoke('plugin:sql|select', { db: DB_URL, query, values: [] });
  try { await select('PRAGMA journal_mode = WAL'); } catch (e) { /* déjà en WAL par défaut avec sqlx */ }

  /** @type {Promise<any>} */
  let queue = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  const recover = async () => {
    try { await invoke('plugin:sql|close', { db: DB_URL }); } catch (e) { /* déjà fermée */ }
    await load();
  };

  return {
    kind: 'tauri',
    exec: (sql, params) => serial(async () => { await execute(inline(sql, params)); }),
    select: (sql, params) => serial(() => select(inline(sql, params))),
    transaction: fn => serial(async () => {
      /** @type {string[]} */
      const stmts = [];
      await fn({ exec: (sql, params) => { stmts.push(inline(sql, params)); } });
      if (!stmts.length) return;
      try {
        await execute(joinSql(['BEGIN IMMEDIATE', ...stmts, 'COMMIT']));
      } catch (e) {
        await recover();
        throw new Error(String(e && /** @type {any} */ (e).message || e));
      }
    }),
    size: () => serial(async () => {
      const [r] = await select('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()');
      return Number(r?.n || 0);
    }),
    flush: async () => {},
    close: () => serial(async () => { await invoke('plugin:sql|close', { db: DB_URL }); }),
  };
}
