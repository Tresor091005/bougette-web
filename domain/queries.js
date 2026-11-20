// Lectures pures sur l'état projeté : formes utilisées par l'interface (portefeuilles, catégories, opérations),
// soldes, réglages. Aucune dépendance au DOM ni au stockage.
import { DEFAULT_SETTINGS, SETTING_KEYS } from './defaults.js';
import { DEFAULT_FMT } from './format.js';
import { linesToMove, MOVE_KINDS } from './ledger.js';
import { linesOf, isWallet } from './projection.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./projection.js').Row} Row */
/** @typedef {import('./ledger.js').Line} Line */
/** @typedef {{ id: string, kind: string, occurred_on: string, status: string, lines: Line[], note?: string }} Draft */
/** @typedef {{ id: string, name: string, kind: string, currency: string, ident: string, opening: number, color: string|null, archived: boolean, allowNegative: boolean, checkedAt: string|null, excluded: boolean, savings: boolean, spendOk: boolean, goal: { amount: number, on: string|null }|null, emergency: boolean }} Wallet */
/** @typedef {{ id: string, name: string, icon: string|null, emoji: string|null, color: string|null, type: string, archived: boolean, parent: string|null }} Category */
/**
 * Une opération à la forme de l'interface. schedule / due : l'échéance qu'elle confirme (sa règle et la date prévue).
 * @typedef {{ id: string, type: string, amount: number, accountId: string, toAccountId?: string, categoryId?: string, date: string, note: string, planned: boolean, createdAt: number, schedule?: string, due?: string }} TxView
 */

/** @param {Row} a @param {Row} b */
const bySort = (a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Réglages complets (valeurs par défaut + valeurs enregistrées).
 * @param {State} s
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function settingsOf(s) {
  /** @type {Record<string, any>} */
  const out = { ...DEFAULT_SETTINGS, fmt: { ...DEFAULT_FMT } };
  for (const k of SETTING_KEYS) {
    const r = s.settings.get(k);
    if (r) out[k] = JSON.parse(r.value);
  }
  out.fmt = { ...DEFAULT_FMT, ...(out.fmt || {}) };
  return /** @type {typeof DEFAULT_SETTINGS} */ (out);
}

/**
 * Écriture → brouillon (forme commune aux contrôles).
 * @param {State} s
 * @param {Row} e
 * @returns {Draft}
 */
export const draftOf = (s, e) => ({ id: e.id, kind: e.kind, occurred_on: e.occurred_on, status: e.status, note: e.note, lines: linesOf(s, e.id) });

/** Écritures non annulées. @param {State} s @returns {Row[]} */
export const liveEntries = s => [...s.entries.values()].filter(e => e.status !== 'void');

/**
 * Soldes des portefeuilles : écritures payées (les prévues ne comptent pas, les annulées non plus).
 * upTo : soldes de fin de journée à cette date (le solde de départ compte toujours).
 * @param {State} s
 * @param {string|null} [upTo]
 * @returns {Record<string, number>}
 */
export function walletBalances(s, upTo = null) {
  /** @type {Record<string, number>} */
  const b = {};
  for (const a of s.accounts.values()) if (a.kind === 'wallet') b[a.id] = 0;
  for (const e of s.entries.values()) {
    if (e.status !== 'posted') continue;
    if (upTo && e.kind !== 'opening' && e.occurred_on > upTo) continue;
    for (const id of s.byEntry.get(e.id) || []) {
      const p = s.postings.get(id);
      if (p && p.account_id in b) b[p.account_id] += p.amount;
    }
  }
  return b;
}

/**
 * Portefeuilles (supprimés exclus), dans l'ordre choisi.
 * @param {State} s
 * @returns {Wallet[]}
 */
export function walletList(s) {
  /** @type {Record<string, number>} */
  const opening = {};
  for (const e of s.entries.values()) {
    if (e.kind !== 'opening' || e.status === 'void') continue;
    for (const l of linesOf(s, e.id)) if (isWallet(s, l.account)) opening[l.account] = (opening[l.account] || 0) + l.amount;
  }
  return [...s.accounts.values()].filter(a => a.kind === 'wallet' && !a.deleted_at).sort(bySort).map(a => ({
    id: a.id, name: a.name, kind: a.subtype, currency: a.currency, ident: a.identifier || '', opening: opening[a.id] || 0,
    color: a.color, archived: !!a.archived_at, allowNegative: !!a.allow_negative, checkedAt: a.checked_at ?? null,
    // hors du total (D11) : ni dans le total ni dans Disponible ; un fonds d'urgence l'est toujours (2026-11-19)
    excluded: !!a.off_total || !!a.emergency,
    // épargne (D17) : compte dans le total, jamais dans Disponible ; objectif indicatif. Fonds d'urgence (revu le
    // 2026-11-19, avec l'utilisateur) : un genre de portefeuille à part — hors du total, sans réserve, dépenses permises,
    // sans objectif (on regarde les mois de dépenses qu'il couvre)
    savings: !!a.savings, spendOk: !!a.spend_ok || !!a.emergency,
    goal: a.goal_amount != null && !a.emergency ? { amount: a.goal_amount, on: a.goal_on ?? null } : null,
    emergency: !!a.emergency,
  }));
}

/**
 * Catégories (supprimées exclues) : dépenses puis revenus, chacune dans l'ordre choisi.
 * @param {State} s
 * @returns {Category[]}
 */
export function categoryList(s) {
  const all = [...s.accounts.values()].filter(a => (a.kind === 'expense' || a.kind === 'income') && !a.deleted_at);
  return [...all.filter(a => a.kind === 'expense').sort(bySort), ...all.filter(a => a.kind === 'income').sort(bySort)].map(a => {
    const p = a.parent_id ? s.accounts.get(a.parent_id) : null;
    return {
      id: a.id, name: a.name, icon: a.icon, emoji: a.emoji, color: p ? p.color : a.color, type: a.kind, archived: !!a.archived_at,
      parent: a.parent_id ?? null,
    };
  });
}

/**
 * Opérations (dépenses, revenus, virements) non annulées, à la forme de l'interface.
 * @param {State} s
 * @returns {TxView[]}
 */
export function txList(s) {
  /** @type {TxView[]} */
  const out = [];
  const w = (/** @type {string} */ id) => isWallet(s, id);
  for (const e of s.entries.values()) {
    if (e.status === 'void' || !MOVE_KINDS.includes(e.kind)) continue;
    const mv = linesToMove(e.kind, linesOf(s, e.id), w);
    if (mv) out.push(toTx(e, mv));
  }
  return out;
}
/**
 * @param {Row} e
 * @param {NonNullable<ReturnType<typeof linesToMove>>} mv
 * @returns {TxView}
 */
function toTx(e, mv) {
  /** @type {TxView} */
  const t = { id: e.id, type: e.kind, amount: mv.amount, accountId: mv.accountId, date: e.occurred_on, note: e.note || '', planned: e.status === 'planned', createdAt: Date.parse(e.created_at) || 0 };
  if (e.kind === 'transfer') t.toAccountId = mv.toAccountId; else t.categoryId = mv.categoryId;
  if (e.schedule_id) { t.schedule = e.schedule_id; t.due = e.due_on; }
  return t;
}
/**
 * Une opération par identifiant (annulée comprise), ou null.
 * @param {State} s
 * @param {string} id
 */
export function txById(s, id) {
  const e = s.entries.get(id);
  if (!e || !MOVE_KINDS.includes(e.kind)) return null;
  const mv = linesToMove(e.kind, linesOf(s, e.id), x => isWallet(s, x));
  return mv ? toTx(e, mv) : null;
}

/**
 * Nombre d'opérations non annulées qui touchent un compte (portefeuille ou catégorie). Les soldes de départ et corrections ne comptent pas.
 * @param {State} s
 * @param {string} accountId
 */
export function moveCount(s, accountId) {
  let n = 0;
  for (const e of s.entries.values()) {
    if (e.status === 'void' || !MOVE_KINDS.includes(e.kind)) continue;
    if ((s.byEntry.get(e.id) || []).some(pid => s.postings.get(pid)?.account_id === accountId)) n++;
  }
  return n;
}

/**
 * Toutes les écritures (annulées comprises, tous types) qui touchent un compte.
 * @param {State} s
 * @param {string} accountId
 * @returns {Row[]}
 */
export function entriesOn(s, accountId) {
  const out = [];
  for (const e of s.entries.values()) {
    if ((s.byEntry.get(e.id) || []).some(pid => s.postings.get(pid)?.account_id === accountId)) out.push(e);
  }
  return out;
}

/**
 * Nombre d'écritures qui figent la devise d'un portefeuille : toutes sauf le solde de départ (qui suit la devise),
 * supprimées comprises (les rétablir mélangerait deux devises).
 * @param {State} s
 * @param {string} walletId
 */
export const currencyLockCount = (s, walletId) => entriesOn(s, walletId).filter(e => e.kind !== 'opening').length;

/**
 * Chronologie d'une écriture (lignes d'historique dans l'ordre).
 * @param {State} s
 * @param {string} entryId
 */
export function historyOf(s, entryId) {
  return [...s.entry_history.values()].filter(h => h.entry_id === entryId).sort((a, b) => a.seq - b.seq)
    .map(h => ({ seq: h.seq, at: h.at, action: h.action, before: h.before ? JSON.parse(h.before) : null, after: h.after ? JSON.parse(h.after) : null }));
}

/** @typedef {TxView & { void: boolean, amended: boolean }} MoveView */
/**
 * Toutes les opérations, annulées comprises (D6 : masquées par défaut, barrées avec le réglage « Afficher les opérations annulées »), avec la marque
 * « corrigée » (modifiée, déplacée ou remise à un état antérieur après sa création).
 * @param {State} s
 * @returns {MoveView[]}
 */
export function moveList(s) {
  const changed = new Set();
  for (const h of s.entry_history.values()) if (h.action === 'amended' || h.action === 'reset') changed.add(h.entry_id);
  /** @type {MoveView[]} */
  const out = [];
  const w = (/** @type {string} */ id) => isWallet(s, id);
  for (const e of s.entries.values()) {
    if (!MOVE_KINDS.includes(e.kind)) continue;
    const mv = linesToMove(e.kind, linesOf(s, e.id), w);
    if (!mv) continue;
    const t = toTx(e, mv);
    if (e.status === 'void') t.planned = e.status_before_void === 'planned';
    out.push({ ...t, void: e.status === 'void', amended: changed.has(e.id) });
  }
  return out;
}

