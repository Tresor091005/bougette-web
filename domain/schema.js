// Forme des projections : mêmes colonnes en mémoire et dans SQLite (src/data/migrations/001_init.sql).
// Une ligne en mémoire est exactement la ligne SQL (entiers pour les booléens, JSON canonique en texte),
// ce qui permet de calculer la même empreinte d'état depuis la mémoire ou depuis la base.

/** @typedef {'accounts'|'entries'|'postings'|'budgets'|'settings'|'entry_history'|'reserves'|'schedules'} Table */

/** Colonnes de chaque projection, clé primaire en premier. @type {Record<Table, string[]>} */
export const TABLES = {
  accounts: ['id', 'kind', 'subtype', 'name', 'currency', 'identifier', 'icon', 'emoji', 'color', 'sort', 'allow_negative', 'archived_at', 'deleted_at', 'created_at', 'parent_id', 'checked_at', 'off_total', 'savings', 'spend_ok', 'goal_amount', 'goal_on', 'emergency', 'alloc'],
  entries: ['id', 'kind', 'occurred_on', 'status', 'note', 'created_at', 'updated_at', 'voided_at', 'void_reason', 'status_before_void', 'schedule_id', 'due_on'],
  postings: ['id', 'entry_id', 'account_id', 'amount', 'currency'],
  budgets: ['id', 'account_id', 'amount', 'currency', 'valid_from', 'start_on', 'end_on', 'repeats', 'from_id'],
  settings: ['key', 'value'],
  entry_history: ['id', 'seq', 'entry_id', 'at', 'action', 'before', 'after'],
  reserves: ['id', 'wallet_id', 'name', 'amount', 'used', 'currency', 'start_on', 'due_on', 'mode', 'repeats', 'pinned', 'closed_on', 'created_at', 'from_id', 'uses', 'category_id', 'held', 'every', 'interval', 'by_day'],
  schedules: ['id', 'kind', 'amount', 'currency', 'wallet_id', 'to_wallet_id', 'category_id', 'note', 'start_on', 'every', 'end_on', 'times', 'reserve_id', 'stopped_on', 'skips', 'from_id', 'begins_on', 'created_at', 'interval', 'days', 'amounts', 'by_day'],
};
/**
 * Type de chaque colonne, comme SQLite la stocke : 'text' / 'int' (NOT NULL), suffixe « ? » si NULL est permis,
 * ou liste des valeurs admises (contrainte CHECK). La projection refuse toute ligne qui ne s'y conforme pas :
 * une valeur que SQLite refuserait ou convertirait (et qui changerait l'empreinte) n'entre jamais dans l'état.
 * @type {Record<Table, Record<string, string|(string|null)[]>>}
 */
export const COLUMN_TYPES = {
  accounts: {
    id: 'text', kind: ['wallet', 'expense', 'income', 'equity'], subtype: 'text?', name: 'text', currency: 'text?', identifier: 'text',
    icon: 'text?', emoji: 'text?', color: 'text?', sort: 'int', allow_negative: 'int', archived_at: 'text?', deleted_at: 'text?', created_at: 'text',
    parent_id: 'text?', checked_at: 'text?', off_total: 'int?',
    savings: 'int?', spend_ok: 'int?', goal_amount: 'int?', goal_on: 'text?', emergency: 'int?', alloc: 'text?',
  },
  entries: {
    id: 'text', kind: ['expense', 'income', 'transfer', 'opening', 'adjustment'], occurred_on: 'text', status: ['posted', 'planned', 'void'],
    note: 'text', created_at: 'text', updated_at: 'text', voided_at: 'text?', void_reason: 'text?', status_before_void: 'text?',
    schedule_id: 'text?', due_on: 'text?',
  },
  postings: { id: 'text', entry_id: 'text', account_id: 'text', amount: 'int', currency: 'text' },
  budgets: { id: 'text', account_id: 'text?', amount: 'int', currency: 'text', valid_from: 'text', start_on: 'text?', end_on: 'text?', repeats: 'int?', from_id: 'text?' },
  settings: { key: 'text', value: 'text' },
  entry_history: { id: 'text', seq: 'int', entry_id: 'text', at: 'text', action: 'text', before: 'text?', after: 'text?' },
  reserves: {
    id: 'text', wallet_id: 'text', name: 'text', amount: 'int', used: 'int', currency: 'text', start_on: 'text', due_on: 'text', mode: ['once', 'gradual'],
    repeats: 'int', pinned: 'int?', closed_on: 'text?', created_at: 'text', from_id: 'text?', uses: 'text?', category_id: 'text?', held: 'int?',
    every: ['day', 'week', 'month', 'year', null], interval: 'int?', by_day: ['weekday', 'lastweekday', 'lastday', null],
  },
  schedules: {
    id: 'text', kind: ['expense', 'income', 'transfer'], amount: 'int', currency: 'text', wallet_id: 'text', to_wallet_id: 'text?', category_id: 'text?',
    note: 'text', start_on: 'text', every: ['day', 'week', 'month', 'quarter', 'half', 'year', null], end_on: 'text?', times: 'int?', reserve_id: 'text?',
    stopped_on: 'text?', skips: 'text?', from_id: 'text?', begins_on: 'text?', created_at: 'text', interval: 'int?', days: 'text?', amounts: 'text?',
    by_day: ['weekday', 'lastweekday', 'lastday', null],
  },
};
/**
 * Première colonne non conforme d'une ligne complète, ou null.
 * @param {Table} table
 * @param {Record<string, any>} r
 * @returns {string|null}
 */
export function badColumn(table, r) {
  const types = COLUMN_TYPES[table];
  for (const c of TABLES[table]) {
    const t = types[c], v = r[c];
    if (Array.isArray(t)) { if (!t.includes(v)) return c; continue; }
    if (v === null) { if (!t.endsWith('?')) return c; continue; }
    if (t.startsWith('int') ? !Number.isSafeInteger(v) : typeof v !== 'string') return c;
  }
  return null;
}
/**
 * Colonnes ajoutées après coup (migrations 002+ ; 004 : portefeuille « hors du total », budgets à dates ; 005 : portefeuille d'épargne) : absentes de l'empreinte d'état quand elles sont NULL, pour que
 * l'empreinte d'un ancien journal (qui ne les connaît pas) reste exactement la même.
 * @type {Partial<Record<Table, string[]>>}
 */
export const LATE_COLUMNS = { accounts: ['parent_id', 'checked_at', 'off_total', 'savings', 'spend_ok', 'goal_amount', 'goal_on', 'emergency', 'alloc'], entries: ['schedule_id', 'due_on'], budgets: ['start_on', 'end_on', 'repeats', 'from_id'], reserves: ['from_id', 'uses', 'category_id', 'held', 'every', 'interval', 'by_day'], schedules: ['interval', 'days', 'amounts', 'by_day'] };
/** Projections ajoutées après coup (006 : réserves ; 010 : opérations programmées) : absentes de l'empreinte d'état quand elles sont vides. @type {Table[]} */
export const LATE_TABLES = ['reserves', 'schedules'];
/** Ordre d'écriture (parents avant enfants) ; l'effacement se fait dans l'ordre inverse. @type {Table[]} */
export const TABLE_ORDER = ['accounts', 'entries', 'postings', 'budgets', 'settings', 'entry_history', 'reserves', 'schedules'];
/** @param {Table} t */
export const pk = t => TABLES[t][0];

/**
 * Ligne complète : toutes les colonnes, null pour les absentes.
 * @param {Table} table
 * @param {Record<string, any>} data
 * @returns {Record<string, any>}
 */
export function row(table, data) {
  /** @type {Record<string, any>} */
  const r = {};
  for (const c of TABLES[table]) r[c] = data[c] === undefined ? null : data[c];
  return r;
}
