// Accès SQL au journal et aux projections : migrations, ajout d'événements avec leurs lignes projetées (une transaction),
// lecture, reconstruction, contrôles d'intégrité. Aucune règle métier ici : elles sont dans src/domain.
import { MIGRATIONS, migrationSql } from './migrations/index.js';
import { TABLES, TABLE_ORDER, pk } from '../domain/schema.js';
import { stateFromRows, stateRows, stateHash, splitTouched } from '../domain/projection.js';

/** @typedef {import('./db.js').Db} Db */
/** @typedef {import('./db.js').Tx} Tx */
/** @typedef {import('../domain/projection.js').State} State */
/** @typedef {import('../domain/events.js').StoredEvent} StoredEvent */
/** @typedef {import('../domain/schema.js').Table} Table */

const EVENT_COLS = ['seq', 'id', 'type', 'v', 'at', 'device', 'payload', 'prev_hash', 'hash'];

/**
 * Applique les migrations manquantes, chacune dans une transaction. Renvoie la version de schéma.
 * @param {Db} db
 */
export async function migrate(db) {
  const [r] = await db.select('PRAGMA user_version');
  let version = Number(r ? Object.values(r)[0] : 0) || 0;
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    const sql = await migrationSql(m.file);
    await db.transaction(tx => { tx.exec(sql); tx.exec(`PRAGMA user_version = ${m.version}`); });
    version = m.version;
  }
  return version;
}
/** @param {Db} db */
export async function schemaVersion(db) {
  const [r] = await db.select('PRAGMA user_version');
  return Number(r ? Object.values(r)[0] : 0) || 0;
}

// --- meta (local à l'appareil) ---
/** @param {Db} db @param {string} key */
export async function getMeta(db, key) {
  const [r] = await db.select('SELECT value FROM meta WHERE key = ?', [key]);
  return r ? String(r.value) : null;
}
/** @param {Tx} tx @param {string} key @param {string} value */
export const setMeta = (tx, key, value) => tx.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);

// --- SQL des projections ---
/** @param {Table} t */
function upsertSql(t) {
  const cols = TABLES[t];
  const key = pk(t);
  return `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${key}) DO UPDATE SET ${cols.filter(c => c !== key).map(c => `${c} = excluded.${c}`).join(', ')}`;
}
const UPSERT = Object.fromEntries(TABLE_ORDER.map(t => [t, upsertSql(t)]));
/** @param {Tx} tx @param {Table} t @param {Record<string, any>} r */
const writeRow = (tx, t, r) => tx.exec(UPSERT[t], TABLES[t].map(c => r[c]));
/** @param {Tx} tx @param {StoredEvent} e */
const writeEvent = (tx, e) => tx.exec(`INSERT INTO events (${EVENT_COLS.join(', ')}) VALUES (${EVENT_COLS.map(() => '?').join(', ')})`, EVENT_COLS.map(c => /** @type {any} */ (e)[c]));

/**
 * Écrit des événements et les lignes de projection qu'ils ont touchées (dans la transaction donnée).
 * @param {Tx} tx
 * @param {StoredEvent[]} events
 * @param {State} next état après application (next.touched : lignes touchées)
 */
export function writeBatch(tx, events, next) {
  for (const e of events) writeEvent(tx, e);
  /** @type {Record<string, string[]>} */
  const byTable = {};
  for (const k of next.touched || []) {
    const [t, key] = splitTouched(k);
    (byTable[t] ||= []).push(key);
  }
  // effacements d'abord (enfants avant parents), puis écritures (parents avant enfants)
  for (const t of [...TABLE_ORDER].reverse()) for (const key of byTable[t] || []) if (!next[t].has(key)) tx.exec(`DELETE FROM ${t} WHERE ${pk(t)} = ?`, [key]);
  for (const t of TABLE_ORDER) for (const key of byTable[t] || []) { const r = next[t].get(key); if (r) writeRow(tx, t, r); }
}

/**
 * Vide les projections (le journal reste) et écrit toutes les lignes d'un état.
 * @param {Tx} tx
 * @param {State} s
 */
export function rewriteProjections(tx, s) {
  for (const t of [...TABLE_ORDER].reverse()) tx.exec(`DELETE FROM ${t}`);
  const rows = stateRows(s);
  for (const t of TABLE_ORDER) for (const r of rows[t]) writeRow(tx, t, r);
}

// Même déclencheur que dans 001_init.sql.
const NO_DELETE_TRIGGER = "CREATE TRIGGER events_no_delete BEFORE DELETE ON events\nBEGIN SELECT RAISE(ROLLBACK, 'events : journal en ajout seul'); END";

/**
 * Remplace tout le contenu (journal et projections) par un autre journal déjà vérifié et rejoué, dans la
 * transaction donnée : tout ou rien. Seul endroit où le journal est vidé (import, démo) ;
 * le déclencheur qui l'interdit est levé puis remis dans la même transaction.
 * @param {Tx} tx
 * @param {StoredEvent[]} events
 * @param {State} s état obtenu en rejouant ces événements
 * @param {Record<string, string>} meta
 */
export function replaceAll(tx, events, s, meta) {
  tx.exec('DROP TRIGGER IF EXISTS events_no_delete');
  tx.exec('DELETE FROM events');
  tx.exec(NO_DELETE_TRIGGER);
  for (const e of events) writeEvent(tx, e);
  rewriteProjections(tx, s);
  for (const [k, v] of Object.entries(meta)) setMeta(tx, k, v);
}

// --- lectures ---
/** @param {Db} db */
export async function readProjections(db) {
  /** @type {Record<string, any[]>} */
  const out = {};
  for (const t of TABLE_ORDER) out[t] = await db.select(`SELECT ${TABLES[t].join(', ')} FROM ${t}`);
  return /** @type {Record<Table, any[]>} */ (out);
}
/** État lu depuis les projections SQL, tête du journal comprise. @param {Db} db @returns {Promise<State>} */
export async function loadState(db) {
  const s = stateFromRows(await readProjections(db));
  s.head = await readHead(db);
  return s;
}
/** @param {Db} db @returns {Promise<{ seq: number, hash: string, at: string }>} */
export async function readHead(db) {
  const [r] = await db.select('SELECT seq, hash, at FROM events ORDER BY seq DESC LIMIT 1');
  return r ? { seq: Number(r.seq), hash: String(r.hash), at: String(r.at) } : { seq: 0, hash: '', at: '' };
}
/** @param {Db} db */
export async function countEvents(db) {
  const [r] = await db.select('SELECT COUNT(*) AS n FROM events');
  return Number(r?.n || 0);
}
/**
 * Événements dans l'ordre ; upToSeq : seulement jusqu'à ce numéro.
 * @param {Db} db
 * @param {{ upToSeq?: number }} [opts]
 * @returns {Promise<StoredEvent[]>}
 */
export async function readEvents(db, { upToSeq } = {}) {
  const rows = upToSeq == null
    ? await db.select(`SELECT ${EVENT_COLS.join(', ')} FROM events ORDER BY seq`)
    : await db.select(`SELECT ${EVENT_COLS.join(', ')} FROM events WHERE seq <= ? ORDER BY seq`, [upToSeq]);
  return rows.map(r => ({ seq: Number(r.seq), id: String(r.id), type: String(r.type), v: Number(r.v), at: String(r.at), device: String(r.device), payload: String(r.payload), prev_hash: String(r.prev_hash), hash: String(r.hash) }));
}
/** Empreinte d'état calculée depuis les tables SQL. @param {Db} db */
export const sqlStateHash = async db => stateHash(stateFromRows(await readProjections(db)));

/**
 * Contrôles SQL : partie double (somme nulle par écriture et devise), références, devise des portefeuilles
 * (chaque ligne active dans la devise de son portefeuille), aucune écriture active sur un compte supprimé.
 * @param {Db} db
 */
export async function sqlChecks(db) {
  const unbalanced = await db.select('SELECT entry_id, currency, SUM(amount) AS s FROM postings GROUP BY entry_id, currency HAVING SUM(amount) != 0');
  const orphans = await db.select('SELECT COUNT(*) AS n FROM postings p LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN entries e ON e.id = p.entry_id WHERE a.id IS NULL OR e.id IS NULL');
  const [cur] = await db.select("SELECT COUNT(*) AS n FROM postings p JOIN entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id WHERE e.status != 'void' AND a.kind IN ('wallet', 'equity') AND p.currency != a.currency");
  const [del] = await db.select("SELECT COUNT(*) AS n FROM postings p JOIN entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id WHERE e.status != 'void' AND a.deleted_at IS NOT NULL");
  const balances = await db.select("SELECT p.account_id AS id, SUM(p.amount) AS b FROM postings p JOIN entries e ON e.id = p.entry_id JOIN accounts a ON a.id = p.account_id WHERE e.status = 'posted' AND a.kind = 'wallet' GROUP BY p.account_id");
  return {
    unbalanced: unbalanced.length,
    orphans: Number(orphans[0]?.n || 0),
    wrongCurrency: Number(cur?.n || 0),
    onDeleted: Number(del?.n || 0),
    balances: Object.fromEntries(balances.map(r => [String(r.id), Number(r.b)])),
  };
}
