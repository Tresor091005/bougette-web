// Projections : l'état lu par l'app, entièrement dérivé des événements par des fonctions pures.
// apply(state, event) met à jour l'état (en remplaçant les lignes, jamais en les modifiant) et note les lignes touchées,
// que la couche de données écrit en SQL dans la même transaction que l'événement.
import { TABLES, TABLE_ORDER, row, pk, badColumn, LATE_COLUMNS, LATE_TABLES } from './schema.js';
import { canonical, sha256hex } from './canonical.js';
import { DUE, RES } from './words.js';
import { byOptions } from './month-start.js';
import { unbalanced, linesToMove, equityId } from './ledger.js';

/** Version des projections : la changer fait reconstruire les tables depuis le journal au démarrage. */
export const PROJECTION_VERSION = 1;

/** @typedef {import('./schema.js').Table} Table */
/** @typedef {import('./events.js').AppliedEvent} AppliedEvent */
/** @typedef {import('./ledger.js').Line} Line */
/** @typedef {Record<string, any>} Row */
/**
 * @typedef {{
 *   accounts: Map<string, Row>, entries: Map<string, Row>, postings: Map<string, Row>, budgets: Map<string, Row>,
 *   settings: Map<string, Row>, entry_history: Map<string, Row>, reserves: Map<string, Row>, schedules: Map<string, Row>,
 *   byEntry: Map<string, string[]>, head: { seq: number, hash: string, at: string }, touched: Set<string>|null
 * }} State
 */

export class ProjectionError extends Error {}

/** @returns {State} */
export function emptyState() {
  return {
    accounts: new Map(), entries: new Map(), postings: new Map(), budgets: new Map(), settings: new Map(), entry_history: new Map(), reserves: new Map(),
    schedules: new Map(), byEntry: new Map(), head: { seq: 0, hash: '', at: '' }, touched: null,
  };
}
/**
 * Copie légère (les lignes sont partagées : elles ne sont jamais modifiées en place), avec suivi des lignes touchées.
 * @param {State} s
 * @returns {State}
 */
export function cloneState(s) {
  return {
    accounts: new Map(s.accounts), entries: new Map(s.entries), postings: new Map(s.postings), budgets: new Map(s.budgets),
    settings: new Map(s.settings), entry_history: new Map(s.entry_history), reserves: new Map(s.reserves), schedules: new Map(s.schedules), byEntry: new Map(s.byEntry), head: { ...s.head }, touched: new Set(),
  };
}

const SEP = '\u0000';
/** @param {string} k */
export const splitTouched = k => /** @type {[Table, string]} */ (k.split(SEP));
/** @param {State} s @param {Table} t @param {string} key */
function touch(s, t, key) { if (s.touched) s.touched.add(t + SEP + key); }
/** @param {State} s @param {Table} t @param {Row} data */
function put(s, t, data) {
  const r = row(t, data);
  const bad = badColumn(t, r);
  if (bad) throw new ProjectionError(`${t} : valeur refusée pour ${bad} (${JSON.stringify(r[bad])})`);
  s[t].set(r[pk(t)], r);
  touch(s, t, r[pk(t)]);
}
/** @param {State} s @param {Table} t @param {string} key */
function del(s, t, key) { if (s[t].delete(key)) touch(s, t, key); }
/** @param {State} s @param {Table} t @param {string} key @param {Row} changes */
function patch(s, t, key, changes) {
  const old = s[t].get(key);
  if (!old) throw new ProjectionError(`${t} : ${key} introuvable`);
  put(s, t, { ...old, ...changes });
}
/** @param {Row} a @param {Row} b */
const bySort = (a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** @param {State} s @param {string} id */
export const isWallet = (s, id) => s.accounts.get(id)?.kind === 'wallet';
/**
 * Lignes d'une écriture, dans l'ordre.
 * @param {State} s
 * @param {string} entryId
 * @returns {Line[]}
 */
export function linesOf(s, entryId) {
  return (s.byEntry.get(entryId) || []).flatMap(id => {
    const p = s.postings.get(id);
    return p ? [{ account: p.account_id, amount: p.amount, currency: p.currency }] : [];
  });
}
/** @param {State} s @param {string} entryId @param {Line[]} lines */
function setLines(s, entryId, lines) {
  if (!Array.isArray(lines)) throw new ProjectionError(`Écriture ${entryId} sans lignes`);
  for (const l of lines) {
    if (!l || typeof l.account !== 'string' || typeof l.currency !== 'string' || !l.currency) throw new ProjectionError(`Ligne illisible dans ${entryId}`);
    if (!Number.isSafeInteger(l.amount)) throw new ProjectionError(`Montant non entier dans ${entryId}`);
  }
  checkAccounts(s, entryId, lines);
  const cur = unbalanced(lines);
  if (cur) throw new ProjectionError(`Écriture ${entryId} déséquilibrée en ${cur}`);
  if (lines.length < 2) throw new ProjectionError(`Écriture ${entryId} : au moins deux lignes`);
  const old = s.byEntry.get(entryId) || [];
  const ids = lines.map((_, i) => `${entryId}#${i}`);
  old.filter(id => !ids.includes(id)).forEach(id => del(s, 'postings', id));
  lines.forEach((l, i) => put(s, 'postings', { id: ids[i], entry_id: entryId, account_id: l.account, amount: l.amount, currency: l.currency }));
  s.byEntry.set(entryId, ids);
}
/**
 * Comptes d'une écriture active : existants, non supprimés, et dans leur devise pour les portefeuilles et
 * « Solde initial » (un portefeuille ne mélange jamais deux devises).
 * @param {State} s @param {string} entryId @param {Line[]} lines
 */
function checkAccounts(s, entryId, lines) {
  for (const l of lines) {
    const a = s.accounts.get(l.account);
    if (!a) throw new ProjectionError(`Compte ${l.account} introuvable pour ${entryId}`);
    if (a.deleted_at) throw new ProjectionError(`Compte ${l.account} supprimé : écriture ${entryId} refusée`);
    if ((a.kind === 'wallet' || a.kind === 'equity') && a.currency !== l.currency) throw new ProjectionError(`Écriture ${entryId} en ${l.currency} sur ${l.account} tenu en ${a.currency}`);
  }
}
/** Écritures actives (non annulées) qui touchent un compte. @param {State} s @param {string} accountId */
function liveEntriesOn(s, accountId) {
  const out = [];
  for (const e of s.entries.values()) {
    if (e.status === 'void') continue;
    if ((s.byEntry.get(e.id) || []).some(pid => s.postings.get(pid)?.account_id === accountId)) out.push(e);
  }
  return out;
}
/** @param {State} s @param {string} cur @param {string} at */
function ensureEquity(s, cur, at) {
  const id = equityId(cur);
  if (!s.accounts.has(id)) put(s, 'accounts', { id, kind: 'equity', name: 'Solde initial', currency: cur, identifier: '', sort: 0, allow_negative: 1, created_at: at });
}
/** @param {State} s @param {string} kind */
function nextSort(s, kind) {
  let m = -1;
  for (const a of s.accounts.values()) if (a.kind === kind && a.sort > m) m = a.sort;
  return m + 1;
}
/** @param {State} s @param {string} kind @param {string[]} ids */
function reorder(s, kind, ids) {
  const list = [...s.accounts.values()].filter(a => a.kind === kind).sort(bySort);
  const moved = ids.flatMap(id => list.filter(a => a.id === id));
  const rest = list.filter(a => !ids.includes(a.id));
  [...moved, ...rest].forEach((a, i) => { if (a.sort !== i) put(s, 'accounts', { ...a, sort: i }); });
}

/**
 * Forme lisible d'une écriture, gardée dans l'historique (avant / après).
 * @param {State} s
 * @param {Row} e
 * @param {Line[]} lines
 */
export function entryView(s, e, lines) {
  const base = { kind: e.kind, date: e.occurred_on, status: e.status, note: e.note };
  const mv = linesToMove(e.kind, lines, id => isWallet(s, id));
  if (mv) return { ...base, amount: mv.amount, currency: mv.currency, wallet: mv.accountId, to: mv.toAccountId ?? null, category: mv.categoryId ?? null };
  const w = lines.find(l => isWallet(s, l.account));
  return { ...base, amount: w ? w.amount : 0, currency: w ? w.currency : null, wallet: w ? w.account : null, to: null, category: null };
}
/** @param {State} s @param {AppliedEvent} ev @param {string} entryId @param {string} action @param {any} before @param {any} after */
function history(s, ev, entryId, action, before, after) {
  put(s, 'entry_history', {
    id: `${String(ev.seq).padStart(9, '0')}:${entryId}`, seq: ev.seq, entry_id: entryId, at: ev.at, action,
    before: before ? canonical(before) : null, after: after ? canonical(after) : null,
  });
}
/** @param {State} s @param {string} id */
function entryOrThrow(s, id) {
  const e = s.entries.get(id);
  if (!e) throw new ProjectionError(`Écriture ${id} introuvable`);
  return e;
}
/** @param {State} s @param {string} id @param {string} [kind] */
function accountOrThrow(s, id, kind) {
  const a = s.accounts.get(id);
  if (!a || (kind && a.kind !== kind && !(kind === 'category' && (a.kind === 'expense' || a.kind === 'income')))) throw new ProjectionError(`Compte ${id} introuvable`);
  return a;
}

const WALLET_FIELDS = ['name', 'subtype', 'identifier', 'color', 'allow_negative', 'currency', 'off_total', 'savings', 'spend_ok', 'goal_amount', 'goal_on', 'emergency', 'alloc'];
// drapeaux tardifs : 1, ou NULL quand ils sont éteints (comme un portefeuille d'avant, sans la colonne)
const WALLET_FLAGS = ['off_total', 'savings', 'spend_ok', 'emergency'];
const CATEGORY_FIELDS = ['name', 'icon', 'emoji', 'color'];
/** @param {Record<string, any>} changes @param {string[]} allowed */
function pick(changes, allowed) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of Object.keys(changes || {})) {
    if (!allowed.includes(k)) throw new ProjectionError(`Champ inconnu : ${k}`);
    out[k] = changes[k];
  }
  return out;
}

/** @type {Record<string, (s: State, ev: AppliedEvent) => void>} */
const HANDLERS = {
  'app.onboarded': s => put(s, 'settings', { key: 'onboarded', value: 'true' }),
  'settings.changed': (s, { data }) => {
    for (const k of Object.keys(data.changes || {})) put(s, 'settings', { key: k, value: canonical(data.changes[k]) });
  },
  'wallet.created': (s, { data, at }) => {
    if (s.accounts.has(data.id)) throw new ProjectionError(`Le compte ${data.id} existe déjà`);
    ensureEquity(s, data.currency, at);
    put(s, 'accounts', {
      id: data.id, kind: 'wallet', subtype: data.subtype, name: data.name, currency: data.currency, identifier: data.identifier || '',
      color: data.color ?? null, sort: nextSort(s, 'wallet'), allow_negative: data.allow_negative ? 1 : 0, created_at: at,
      off_total: data.off_total ? 1 : null, savings: data.savings ? 1 : null, spend_ok: data.spend_ok ? 1 : null,
      goal_amount: data.goal_amount ?? null, goal_on: data.goal_on ?? null, emergency: data.emergency ? 1 : null,
    });
  },
  'wallet.updated': (s, { data, at }) => {
    accountOrThrow(s, data.id, 'wallet');
    const ch = pick(data.changes, WALLET_FIELDS);
    if ('allow_negative' in ch) ch.allow_negative = ch.allow_negative ? 1 : 0;
    // hors du total (D11), épargne, dépenses permises, fonds d'urgence (D17)
    for (const k of WALLET_FLAGS) if (k in ch) ch[k] = ch[k] ? 1 : null;
    if ('goal_amount' in ch) ch.goal_amount = ch.goal_amount ?? null;
    if ('goal_on' in ch) ch.goal_on = ch.goal_on ?? null;
    if ('alloc' in ch) ch.alloc = ch.alloc === 'one' ? 'one' : null;
    if (ch.currency) {
      // seul le solde de départ peut suivre (il est corrigé par l'événement suivant) ; rien d'autre n'est dans l'ancienne devise
      if (liveEntriesOn(s, data.id).some(e => e.kind !== 'opening')) throw new ProjectionError(`Devise de ${data.id} changée alors qu’il a des écritures`);
      ensureEquity(s, ch.currency, at);
    }
    patch(s, 'accounts', data.id, ch);
  },
  'wallet.archived': (s, { data, at }) => { accountOrThrow(s, data.id, 'wallet'); patch(s, 'accounts', data.id, { archived_at: at }); },
  'wallet.restored': (s, { data }) => { accountOrThrow(s, data.id, 'wallet'); patch(s, 'accounts', data.id, { archived_at: null }); },
  'wallet.deleted': (s, { data, at }) => {
    accountOrThrow(s, data.id, 'wallet');
    if (liveEntriesOn(s, data.id).length) throw new ProjectionError(`Portefeuille ${data.id} supprimé alors qu’il a des écritures actives`);
    patch(s, 'accounts', data.id, { deleted_at: at });
  },
  // compensation de l'ancien « Revenir à cet état » (D6, retiré le 2026-11-13 : plus produit, gardé pour relire les
  // journaux qui en ont) : un portefeuille supprimé depuis l'instant choisi redevient visible
  'wallet.undeleted': (s, { data }) => {
    const a = accountOrThrow(s, data.id, 'wallet');
    if (!a.deleted_at) throw new ProjectionError(`Portefeuille ${data.id} non supprimé`);
    patch(s, 'accounts', data.id, { deleted_at: null });
  },
  'wallet.reordered': (s, { data }) => reorder(s, 'wallet', data.ids || []),
  // vérification (D9) : la date de la dernière, avec ou sans écart
  'wallet.checked': (s, { data, at }) => { accountOrThrow(s, data.id, 'wallet'); patch(s, 'accounts', data.id, { checked_at: at }); },
  'category.created': (s, { data, at }) => {
    if (s.accounts.has(data.id)) throw new ProjectionError(`Le compte ${data.id} existe déjà`);
    if (data.type !== 'expense' && data.type !== 'income') throw new ProjectionError('Type de catégorie inconnu');
    // sous-catégorie : parent existant, du même type, lui-même principal (deux niveaux seulement)
    const parent = data.parent ?? null;
    if (parent !== null) {
      const p = s.accounts.get(parent);
      if (!p || p.kind !== data.type || p.parent_id || p.deleted_at) throw new ProjectionError(`Catégorie parente ${parent} invalide`);
    }
    put(s, 'accounts', {
      id: data.id, kind: data.type, name: data.name, identifier: '', icon: data.icon ?? null, emoji: data.emoji ?? null,
      color: data.color ?? null, sort: nextSort(s, data.type), allow_negative: 1, created_at: at, parent_id: parent,
    });
  },
  'category.updated': (s, { data }) => {
    const a = accountOrThrow(s, data.id, 'category');
    const { parent, ...rest } = data.changes || {};
    const ch = pick(rest, CATEGORY_FIELDS);
    // rangée ailleurs : parent principal, du même type, vivant ; jamais une catégorie qui a des sous-catégories
    if (data.changes && 'parent' in data.changes) {
      const to = parent ?? null;
      if (to !== null) {
        const p = s.accounts.get(to);
        if (!p || to === a.id || p.kind !== a.kind || p.parent_id || p.deleted_at) throw new ProjectionError(`Catégorie parente ${to} invalide`);
        if ([...s.accounts.values()].some(x => x.parent_id === a.id && !x.deleted_at)) throw new ProjectionError(`Catégorie ${a.id} : elle a des sous-catégories`);
      }
      ch.parent_id = to;
    }
    patch(s, 'accounts', data.id, ch);
  },
  'category.archived': (s, { data, at }) => { accountOrThrow(s, data.id, 'category'); patch(s, 'accounts', data.id, { archived_at: at }); },
  'category.restored': (s, { data }) => { accountOrThrow(s, data.id, 'category'); patch(s, 'accounts', data.id, { archived_at: null }); },
  'category.deleted': (s, { data, at }) => {
    accountOrThrow(s, data.id, 'category');
    if (liveEntriesOn(s, data.id).length) throw new ProjectionError(`Catégorie ${data.id} supprimée alors qu’elle a des écritures actives`);
    patch(s, 'accounts', data.id, { deleted_at: at });
    // ses budgets partent avec elle (un ancien budget porte l'identifiant de sa catégorie)
    for (const b of [...s.budgets.values()]) if (b.account_id === data.id) del(s, 'budgets', b.id);
  },
  'category.undeleted': (s, { data }) => {
    const a = accountOrThrow(s, data.id, 'category');
    if (!a.deleted_at) throw new ProjectionError(`Catégorie ${data.id} non supprimée`);
    patch(s, 'accounts', data.id, { deleted_at: null });
  },
  'category.reordered': (s, { data }) => reorder(s, data.type, data.ids || []),
  'entry.recorded': (s, ev) => {
    const { data, at } = ev;
    if (s.entries.has(data.id)) throw new ProjectionError(`L’écriture ${data.id} existe déjà`);
    if (!['posted', 'planned'].includes(data.status)) throw new ProjectionError('Statut inconnu');
    // la date d'une opération programmée qu'elle confirme (D18) : sa règle existe, la date se lit
    if (data.schedule != null && (!s.schedules.has(data.schedule) || !DAY.test(data.due))) throw new ProjectionError(`${DUE.One} ${data.schedule} introuvable pour ${data.id}`);
    put(s, 'entries', {
      id: data.id, kind: data.kind, occurred_on: data.occurred_on, status: data.status, note: data.note || '',
      created_at: data.created_at || at, updated_at: at, schedule_id: data.schedule ?? null, due_on: data.schedule != null ? data.due : null,
    });
    setLines(s, data.id, data.lines);
    history(s, ev, data.id, 'recorded', null, entryView(s, entryOrThrow(s, data.id), data.lines));
  },
  'entry.amended': (s, ev) => {
    const { data, at } = ev;
    const e = entryOrThrow(s, data.id);
    if (e.status === 'void') throw new ProjectionError('Écriture annulée : la rétablir avant de la modifier');
    const before = entryView(s, e, linesOf(s, data.id));
    const used0 = reserveUse(s, data.id);
    const ch = pick(data.changes, ['occurred_on', 'status', 'note', 'kind', 'lines']);
    if (ch.status && !['posted', 'planned'].includes(ch.status)) throw new ProjectionError('Statut inconnu');
    const { lines, ...fields } = ch;
    patch(s, 'entries', data.id, { ...fields, updated_at: at });
    if (lines) setLines(s, data.id, lines);
    // dépense sur réserve dont le montant change : la réserve suit la différence (D17)
    if (used0) {
      const now = reserveUse(s, data.id);
      if (now && now.amount !== used0.amount) { unuse(s, data.id, used0.amount, used0.r); reuse(s, data.id, at.slice(0, 10)); }
    }
    history(s, ev, data.id, 'amended', before, entryView(s, entryOrThrow(s, data.id), linesOf(s, data.id)));
  },
  'entry.voided': (s, ev) => {
    const { data, at } = ev;
    const e = entryOrThrow(s, data.id);
    if (e.status === 'void') throw new ProjectionError('Écriture déjà annulée');
    const before = entryView(s, e, linesOf(s, data.id));
    patch(s, 'entries', data.id, { status: 'void', status_before_void: e.status, voided_at: at, void_reason: data.reason || null, updated_at: at });
    // supprimer une dépense sur réserve : comme si elle n'avait pas eu lieu (la réserve revient avec son argent, D17)
    const u = reserveUse(s, data.id);
    if (u) unuse(s, data.id, u.amount, u.r);
    history(s, ev, data.id, 'voided', before, entryView(s, entryOrThrow(s, data.id), linesOf(s, data.id)));
  },
  'entry.restored': (s, ev) => {
    const { data, at } = ev;
    const e = entryOrThrow(s, data.id);
    if (e.status !== 'void') throw new ProjectionError('Écriture non annulée');
    checkAccounts(s, data.id, linesOf(s, data.id));
    const before = entryView(s, e, linesOf(s, data.id));
    patch(s, 'entries', data.id, { status: e.status_before_void || 'posted', status_before_void: null, voided_at: null, void_reason: null, updated_at: at });
    // la rétablir : la réserve est utilisée de nouveau (se referme en une fois)
    if (reserveUse(s, data.id)) reuse(s, data.id, at.slice(0, 10));
    history(s, ev, data.id, 'restored', before, entryView(s, entryOrThrow(s, data.id), linesOf(s, data.id)));
  },
  // compensation de l'ancien « Revenir à cet état » (D6, retiré le 2026-11-13 : plus produit, gardé pour relire les
  // journaux qui en ont) : l'écriture reprend d'un coup sa version d'un instant passé
  // (annulée ou non aujourd'hui) ; ses comptes sont contrôlés comme pour une écriture neuve.
  'entry.reset': (s, ev) => {
    const { data, at } = ev;
    const e = entryOrThrow(s, data.id);
    const to = data.to || {};
    if (!['posted', 'planned'].includes(to.status)) throw new ProjectionError('Statut inconnu');
    const before = entryView(s, e, linesOf(s, data.id));
    patch(s, 'entries', data.id, {
      kind: to.kind, occurred_on: to.occurred_on, status: to.status, note: to.note || '',
      status_before_void: null, voided_at: null, void_reason: null, updated_at: at,
    });
    setLines(s, data.id, to.lines);
    history(s, ev, data.id, 'reset', before, entryView(s, entryOrThrow(s, data.id), linesOf(s, data.id)));
  },
  'budget.set': (s, { data, at }) => {
    if (data.account) accountOrThrow(s, data.account, 'category');
    if (!Number.isSafeInteger(data.amount) || data.amount <= 0) throw new ProjectionError('Budget non entier');
    put(s, 'budgets', { id: data.id, account_id: data.account ?? null, amount: data.amount, currency: data.currency, valid_from: at.slice(0, 10) });
  },
  'budget.cleared': (s, { data }) => del(s, 'budgets', data.id),
  // D11 revu : un budget = une catégorie de dépenses, un montant, un début et une fin (comprises), qui peut se répéter.
  // Les contrôles qui dépendent du jour (fin à venir, un seul budget en cours par catégorie) sont ceux de la commande.
  'budget.created': (s, { data }) => {
    if (s.budgets.has(data.id)) throw new ProjectionError(`Le budget ${data.id} existe déjà`);
    // from : le budget d'avant, reconduit (D11)
    if (data.from != null && !s.budgets.has(data.from)) throw new ProjectionError(`Budget ${data.from} introuvable (reconduit)`);
    putBudget(s, data, data.from ?? null);
  },
  'budget.updated': (s, { data }) => {
    const old = s.budgets.get(data.id);
    if (!old) throw new ProjectionError(`Budget ${data.id} introuvable`);
    putBudget(s, data, old.from_id ?? null);
  },
  // D17 : réserves d'un portefeuille d'épargne. Les contrôles qui dépendent du jour ou du solde sont ceux de la commande.
  'reserve.created': (s, { data, at }) => {
    if (s.reserves.has(data.id)) throw new ProjectionError(`${RES.The} ${data.id} existe déjà`);
    const w = accountOrThrow(s, data.wallet, 'wallet');
    // from : la réserve d'avant, reconduite (D17) ; repeat : anciens journaux seulement (« Se répète » retiré)
    if (data.from != null && !s.reserves.has(data.from)) throw new ProjectionError(`${RES.One} ${data.from} introuvable (reconduit${RES.e})`);
    putReserve(s, { id: data.id, wallet_id: w.id, name: data.name, amount: data.amount, used: 0, currency: w.currency, start_on: data.start, due_on: data.due,
      mode: data.mode, repeats: data.repeat || 0, pinned: null, closed_on: null, created_at: at, from_id: data.from ?? null, uses: null, category_id: data.category ?? null,
      // every, interval : son rythme (2026-11-25 ; absent des anciens journaux), pour proposer la fois suivante ; by : sa
      // lecture par mois (« le 2e lundi », 015), permise par sa date
      every: data.every ?? null, interval: data.every && data.interval > 1 ? data.interval : null, by_day: data.by ?? null });
    if (data.by != null && !byOptions(data.due).includes(data.by)) throw new ProjectionError(`Jour du mois ${RES.ofThe} ${data.id} illisible`);
  },
  'reserve.paused': (s, { data }) => {
    const r = reserveOrThrow(s, data.id);
    if (r.closed_on) throw new ProjectionError(`${RES.One} ${data.id} déjà ${RES.adj('clos', 'close')}`);
    // keep : ce qu'elle avait, qu'elle garde en pause (dans held, que ses utilisations font baisser)
    putReserve(s, { ...r, due_on: '', held: Math.max(0, Math.min(Number(data.keep) || 0, r.amount - r.used)) || null });
  },
  'reserve.updated': (s, { data }) => {
    const r = reserveOrThrow(s, data.id);
    const ch = pick(data.changes, ['name', 'amount', 'due', 'mode', 'repeat', 'pinned', 'category']);
    /** @type {Row} */
    const out = {};
    if ('name' in ch) out.name = ch.name;
    if ('amount' in ch) out.amount = ch.amount;
    if ('due' in ch) out.due_on = ch.due;
    if ('due' in ch && r.due_on === '' && ch.due) out.held = null; // reprise : elle redevient datée, servie à son niveau
    if ('mode' in ch) out.mode = ch.mode;
    if ('repeat' in ch) out.repeats = ch.repeat || 0;
    if ('pinned' in ch) out.pinned = ch.pinned ?? null;
    if ('category' in ch) out.category_id = ch.category ?? null;
    putReserve(s, { ...r, ...out });
  },
  // utilisée : d'un coup, elle se ferme ; petit à petit, ce qui reste à viser baisse (fermée quand tout est utilisé)
  'reserve.used': (s, { data }) => {
    const r = reserveOrThrow(s, data.id);
    if (r.closed_on) throw new ProjectionError(`${RES.One} ${data.id} déjà ${RES.adj('clos', 'close')}`);
    if (!Number.isSafeInteger(data.amount) || data.amount <= 0) throw new ProjectionError('Utilisation non entière');
    const used = r.used + data.amount;
    const done = r.mode === 'once' || used >= r.amount;
    // ce qui était mis de côté pour elle baisse d'autant (fermée : ce qui reste retourne à l'épargne libre)
    const held = done ? null : Math.max(0, (r.held || 0) - data.amount) || null;
    // l'opération qui l'a utilisée (pour dire plus tard si elle a été supprimée)
    const uses = data.entry ? canonical([...(r.uses ? JSON.parse(r.uses) : []), data.entry]) : r.uses;
    putReserve(s, { ...r, uses, held, used: Math.min(used, r.amount), pinned: done || r.pinned == null ? null : Math.min(r.pinned, r.amount - used), closed_on: done ? data.on : null });
  },
  'reserve.closed': (s, { data }) => {
    const r = reserveOrThrow(s, data.id);
    if (r.closed_on) throw new ProjectionError(`${RES.One} ${data.id} déjà ${RES.adj('clos', 'close')}`);
    putReserve(s, { ...r, pinned: null, held: null, closed_on: data.on });
  },
  // répartition (D17, revu) : changes = [{ id, delta }] ; ce qui est mis de côté pour chaque réserve, jamais négatif
  'reserve.allocated': (s, { data }) => {
    for (const c of data.changes || []) {
      const r = reserveOrThrow(s, c.id);
      if (r.closed_on) throw new ProjectionError(`${RES.One} ${c.id} ${RES.adj('clos', 'close')}`);
      if (!Number.isSafeInteger(c.delta)) throw new ProjectionError('Répartition non entière');
      const held = (r.held || 0) + c.delta;
      if (held < 0) throw new ProjectionError(`${RES.One} ${c.id} sous zéro`);
      putReserve(s, { ...r, held: held || null });
    }
  },
  'budget.deleted': (s, { data }) => {
    if (!s.budgets.has(data.id)) throw new ProjectionError(`Budget ${data.id} introuvable`);
    del(s, 'budgets', data.id);
  },
  // D18 : opérations programmées (une échéance seule : every null). Les contrôles qui dépendent du jour, des soldes ou
  // des réserves sont ceux de la commande ; ici, la ligne doit se lire et ses comptes exister.
  'schedule.created': (s, { data, at }) => {
    if (s.schedules.has(data.id)) throw new ProjectionError(`${DUE.The} ${data.id} existe déjà`);
    if (data.from != null && !s.schedules.has(data.from)) throw new ProjectionError(`${DUE.One} ${data.from} introuvable (coupé${DUE.e})`);
    putSchedule(s, {
      id: data.id, kind: data.kind, amount: data.amount, currency: data.currency, wallet_id: data.wallet, to_wallet_id: data.to ?? null,
      category_id: data.category ?? null, note: data.note || '', start_on: data.start, every: data.every ?? null, end_on: data.end ?? null,
      times: data.times ?? null, reserve_id: data.reserve ?? null, stopped_on: null, skips: null, from_id: data.from ?? null, begins_on: data.begins ?? null, created_at: at,
      interval: data.interval ?? null, days: data.days?.length ? canonical(data.days) : null, by_day: data.by ?? null,
    });
  },
  'schedule.updated': (s, { data }) => {
    const r = scheduleOrThrow(s, data.id);
    const ch = pick(data.changes, ['kind', 'amount', 'currency', 'wallet', 'to', 'category', 'note', 'start', 'every', 'interval', 'end', 'times', 'reserve', 'begins', 'days', 'by']);
    /** @type {Row} */
    const out = {};
    const map = { wallet: 'wallet_id', to: 'to_wallet_id', category: 'category_id', start: 'start_on', end: 'end_on', reserve: 'reserve_id', begins: 'begins_on', by: 'by_day' };
    for (const [k, v] of Object.entries(ch)) out[/** @type {Record<string, string>} */ (map)[k] || k] = k === 'days' ? (v?.length ? canonical(v) : null) : v ?? (k === 'note' ? '' : null);
    putSchedule(s, { ...r, ...out });
  },
  'schedule.stopped': (s, { data }) => {
    const r = scheduleOrThrow(s, data.id);
    if (!DAY.test(data.on)) throw new ProjectionError(`Date d’arrêt ${DUE.ofThe} ${data.id} illisible`);
    putSchedule(s, { ...r, stopped_on: data.on });
  },
  // « Passer » une date, ou la rétablir : la liste triée des dates passées
  'schedule.skipped': (s, { data }) => {
    const r = scheduleOrThrow(s, data.id);
    if (!DAY.test(data.on)) throw new ProjectionError(`Date ${DUE.ofThe} ${data.id} illisible`);
    const skips = new Set(r.skips ? JSON.parse(r.skips) : []);
    skips.add(data.on);
    putSchedule(s, { ...r, skips: canonical([...skips].sort()) });
  },
  'schedule.unskipped': (s, { data }) => {
    const r = scheduleOrThrow(s, data.id);
    const skips = (r.skips ? JSON.parse(r.skips) : []).filter((/** @type {string} */ d) => d !== data.on);
    putSchedule(s, { ...r, skips: skips.length ? canonical(skips) : null });
  },
  // un autre montant pour une seule fois (2026-11-24) : gardé sur la règle nommée (la première de l'échéance), par date ;
  // amount null : la fois reprend le montant de la règle. Les contrôles de la fois (à régler, de cette échéance) sont ceux
  // de la commande (une modification efface ceux d'une date qui disparaît ou d'une devise qui change).
  'schedule.adjusted': (s, { data }) => {
    const r = scheduleOrThrow(s, data.id);
    if (!DAY.test(data.on)) throw new ProjectionError(`Date ${DUE.ofThe} ${data.id} illisible`);
    if (data.amount != null && (!Number.isSafeInteger(data.amount) || data.amount <= 0)) throw new ProjectionError(`Montant d’une fois ${DUE.ofThe} ${data.id} illisible`);
    /** @type {Record<string, number>} */
    const m = r.amounts ? JSON.parse(r.amounts) : {};
    if (data.amount == null) delete m[data.on];
    else m[data.on] = data.amount;
    putSchedule(s, { ...r, amounts: Object.keys(m).length ? canonical(m) : null });
  },
  // la règle seulement : ses opérations confirmées restent (elles gardent le lien vers une règle disparue)
  'schedule.deleted': (s, { data }) => { scheduleOrThrow(s, data.id); del(s, 'schedules', data.id); },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Réserve utilisée par une écriture (D17) et le montant sorti de son portefeuille.
 * @param {State} s @param {string} entryId @returns {{ r: Row, amount: number }|null}
 */
function reserveUse(s, entryId) {
  for (const r of s.reserves.values()) {
    if (!r.uses || !JSON.parse(r.uses).includes(entryId)) continue;
    const l = linesOf(s, entryId).find(x => x.account === r.wallet_id);
    return { r, amount: l ? Math.max(0, -l.amount) : 0 };
  }
  return null;
}
/** L'utilisation ne compte plus : la réserve reprend son argent et se rouvre. @param {State} s @param {string} entryId @param {number} amount @param {Row} r */
function unuse(s, entryId, amount, r) {
  if (!amount) return;
  const cur = s.reserves.get(r.id) || r;
  putReserve(s, { ...cur, used: Math.max(0, cur.used - amount), held: (cur.held || 0) + amount, closed_on: null, pinned: null });
}
/** L'utilisation compte de nouveau : la réserve paie (en une fois ou tout utilisé : close). @param {State} s @param {string} entryId @param {string} on */
function reuse(s, entryId, on) {
  const u = reserveUse(s, entryId);
  if (!u || !u.amount) return;
  const r = u.r;
  const used = Math.min(r.amount, r.used + u.amount);
  const done = r.mode === 'once' || used >= r.amount;
  putReserve(s, { ...r, used, held: Math.max(0, (r.held || 0) - u.amount) || null, closed_on: done ? (r.closed_on || on) : null, pinned: null });
}
/** @param {State} s @param {string} id */
function reserveOrThrow(s, id) {
  const r = s.reserves.get(id);
  if (!r) throw new ProjectionError(`${RES.One} ${id} introuvable`);
  return r;
}
/** Ligne complète d'une réserve, contrôlée. @param {State} s @param {Row} r */
function putReserve(s, r) {
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) throw new ProjectionError(`Montant ${RES.ofThe} ${r.id} illisible`);
  if (r.held != null && (!Number.isSafeInteger(r.held) || r.held < 0)) throw new ProjectionError(`Mis de côté ${RES.ofThe} ${r.id} illisible`);
  if (!Number.isSafeInteger(r.used) || r.used < 0 || r.used > r.amount) throw new ProjectionError(`Utilisé ${RES.ofThe} ${r.id} illisible`);
  if (!Number.isSafeInteger(r.repeats) || r.repeats < 0) throw new ProjectionError(`Répétition ${RES.ofThe} ${r.id} illisible`);
  if (r.pinned != null && (!Number.isSafeInteger(r.pinned) || r.pinned < 0)) throw new ProjectionError(`Montant fixé ${RES.ofThe} ${r.id} illisible`);
  // due_on vide : en pause, sans date (D17 revu, 2026-11-23)
  if (!DAY.test(r.start_on) || (r.due_on !== '' && (!DAY.test(r.due_on) || r.start_on > r.due_on))) throw new ProjectionError(`Dates ${RES.ofThe} ${r.id} illisibles`);
  if (r.closed_on != null && !DAY.test(r.closed_on)) throw new ProjectionError(`Date de clôture ${RES.ofThe} ${r.id} illisible`);
  if (r.interval != null && (!r.every || !Number.isSafeInteger(r.interval) || r.interval < 2 || r.interval > 999)) throw new ProjectionError(`Rythme ${RES.ofThe} ${r.id} illisible`);
  if (r.by_day != null && r.every !== 'month') throw new ProjectionError(`Jour du mois ${RES.ofThe} ${r.id} illisible`);
  if (typeof r.name !== 'string' || !r.name) throw new ProjectionError(`Nom ${RES.ofThe} ${r.id} illisible`);
  put(s, 'reserves', r);
}
/** @param {State} s @param {string} id */
function scheduleOrThrow(s, id) {
  const r = s.schedules.get(id);
  if (!r) throw new ProjectionError(`${DUE.One} ${id} introuvable`);
  return r;
}
/** Ligne complète d'une opération programmée, contrôlée (D18). @param {State} s @param {Row} r */
function putSchedule(s, r) {
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) throw new ProjectionError(`Montant ${DUE.ofThe} ${r.id} illisible`);
  if (!DAY.test(r.start_on)) throw new ProjectionError(`Première date ${DUE.ofThe} ${r.id} illisible`);
  if (r.end_on != null && (!DAY.test(r.end_on) || r.end_on < r.start_on)) throw new ProjectionError(`Fin ${DUE.ofThe} ${r.id} illisible`);
  if (r.stopped_on != null && !DAY.test(r.stopped_on)) throw new ProjectionError(`Arrêt ${DUE.ofThe} ${r.id} illisible`);
  if (r.begins_on != null && !DAY.test(r.begins_on)) throw new ProjectionError(`Début ${DUE.ofThe} ${r.id} illisible`);
  if (r.days != null) {
    let d;
    try { d = JSON.parse(r.days); } catch (e) { d = null; }
    if (!Array.isArray(d) || !d.length || d.some((/** @type {any} */ n, /** @type {number} */ i) => !Number.isSafeInteger(n) || n < 1 || (i && n <= d[i - 1]))) throw new ProjectionError(`Jours ${DUE.ofThe} ${r.id} illisibles`);
  }
  if (r.times != null && (!Number.isSafeInteger(r.times) || r.times < 1)) throw new ProjectionError(`Nombre de fois ${DUE.ofThe} ${r.id} illisible`);
  // lue autrement que par son quantième (« le 2e lundi », « le dernier jour ») : une règle par mois d'un seul jour, dont
  // la première date permet cette lecture
  if (r.by_day != null && (!['month', 'quarter', 'half'].includes(r.every) || r.days != null || !byOptions(r.start_on).includes(r.by_day))) throw new ProjectionError(`Jour du mois ${DUE.ofThe} ${r.id} illisible`);
  if (r.amounts != null) {
    let m;
    try { m = JSON.parse(r.amounts); } catch (e) { m = null; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || !Object.keys(m).length
      || Object.entries(m).some(([d, n]) => !DAY.test(d) || !Number.isSafeInteger(n) || /** @type {number} */ (n) <= 0)) throw new ProjectionError(`Montants des fois ${DUE.ofThe} ${r.id} illisibles`);
  }
  // rythme libre : « tous les N » (2 ou plus ; chaque = NULL), seulement pour une règle qui répète
  if (r.interval != null && (!Number.isSafeInteger(r.interval) || r.interval < 2 || r.every == null)) throw new ProjectionError(`Rythme ${DUE.ofThe} ${r.id} illisible`);
  const w = s.accounts.get(r.wallet_id);
  if (!w || w.kind !== 'wallet') throw new ProjectionError(`Portefeuille ${r.wallet_id} introuvable pour ${DUE.the} ${r.id}`);
  if (typeof r.currency !== 'string' || !r.currency) throw new ProjectionError(`Devise ${DUE.ofThe} ${r.id} illisible`);
  if (r.kind === 'transfer') {
    const t = s.accounts.get(r.to_wallet_id);
    if (!t || t.kind !== 'wallet' || r.category_id != null) throw new ProjectionError(`Virement ${r.id} : portefeuille d’arrivée introuvable`);
  } else {
    const c = s.accounts.get(r.category_id);
    if (!c || c.kind !== r.kind || r.to_wallet_id != null) throw new ProjectionError(`${DUE.One} ${r.id} : catégorie introuvable`);
  }
  if (r.reserve_id != null && !s.reserves.has(r.reserve_id)) throw new ProjectionError(`${RES.One} ${r.reserve_id} introuvable pour ${DUE.the} ${r.id}`);
  put(s, 'schedules', r);
}
/** Ligne complète d'un budget à dates (création ou modification). @param {State} s @param {Row} data @param {string|null} from */
function putBudget(s, data, from) {
  const c = s.accounts.get(data.category);
  if (!c || c.kind !== 'expense' || c.deleted_at) throw new ProjectionError(`Catégorie de dépenses ${data.category} introuvable pour le budget ${data.id}`);
  if (!Number.isSafeInteger(data.amount) || data.amount <= 0) throw new ProjectionError('Budget non entier');
  if (!DAY.test(data.start) || !DAY.test(data.end) || data.start > data.end) throw new ProjectionError(`Dates du budget ${data.id} illisibles`);
  if (typeof data.currency !== 'string' || !data.currency) throw new ProjectionError(`Devise du budget ${data.id} illisible`);
  put(s, 'budgets', {
    id: data.id, account_id: data.category, amount: data.amount, currency: data.currency, valid_from: data.start,
    start_on: data.start, end_on: data.end, repeats: data.repeat ? 1 : 0, from_id: from,
  });
}

/**
 * Applique un événement à l'état (en place). Lève ProjectionError si l'événement est incohérent.
 * @param {State} s
 * @param {AppliedEvent} ev
 */
export function apply(s, ev) {
  const h = HANDLERS[ev.type];
  if (!h) throw new ProjectionError('Type d’événement inconnu : ' + ev.type);
  h(s, ev);
  s.head = { ...s.head, seq: ev.seq, at: ev.at };
}

/**
 * Rejoue des événements depuis un état vide.
 * @param {AppliedEvent[]} events
 * @returns {State}
 */
export function replay(events) {
  const s = emptyState();
  for (const ev of events) apply(s, ev);
  return s;
}

/**
 * Lignes de toutes les projections, triées par clé primaire.
 * @param {State} s
 * @returns {Record<Table, Row[]>}
 */
export function stateRows(s) {
  /** @type {Record<string, Row[]>} */
  const out = {};
  for (const t of TABLE_ORDER) {
    const key = pk(t);
    out[t] = [...s[t].values()].map(r => row(t, r)).sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
  }
  return /** @type {Record<Table, Row[]>} */ (out);
}
/**
 * Empreinte d'état : SHA-256 de la sérialisation canonique et triée des projections.
 * @param {State} s
 */
export function stateHash(s) {
  const rows = stateRows(s);
  // colonnes ajoutées après coup : omises quand elles sont NULL (empreintes des anciens journaux inchangées)
  for (const [t, cols] of Object.entries(LATE_COLUMNS)) {
    rows[/** @type {Table} */ (t)] = rows[/** @type {Table} */ (t)].map(r => {
      const out = { ...r };
      for (const c of cols) if (out[c] === null) delete out[c];
      return out;
    });
  }
  for (const t of LATE_TABLES) if (!rows[t].length) delete rows[t];
  return sha256hex(canonical(rows));
}

/**
 * État à partir des lignes lues en base (au démarrage).
 * @param {Partial<Record<Table, Row[]>>} tables
 * @returns {State}
 */
export function stateFromRows(tables) {
  const s = emptyState();
  for (const t of TABLE_ORDER) for (const r of tables[t] || []) s[t].set(r[pk(t)], row(t, r));
  /** @type {Map<string, string[]>} */
  const by = new Map();
  for (const p of s.postings.values()) {
    const ids = by.get(p.entry_id) || [];
    ids.push(p.id);
    by.set(p.entry_id, ids);
  }
  const n = (/** @type {string} */ id) => Number(id.slice(id.lastIndexOf('#') + 1));
  for (const [k, ids] of by) by.set(k, ids.sort((a, b) => n(a) - n(b)));
  s.byEntry = by;
  return s;
}

export { TABLES };
