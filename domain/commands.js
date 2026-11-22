// Commandes : toute écriture métier passe par ici. decide(état, commande) valide avec les règles du domaine
// et renvoie les événements à enregistrer ; si la validation échoue, une DomainError est levée et rien n'est écrit.
import { CURRENCIES, GROUPS, currencyOf, shortDate, money, stepChoices } from './format.js';
import { KINDS, DEFAULT_CATEGORIES, SETTING_KEYS, initialSettings, UNTRACKED } from './defaults.js';
import { canonical } from './canonical.js';
import { txLines, balanceLines, MOVE_KINDS, linesToMove } from './ledger.js';
import { linesOf, isWallet } from './projection.js';
import { settingsOf, draftOf, walletBalances, moveCount, entriesOn, currencyLockCount } from './queries.js';
import { checkChange, blocksNegative } from './rules.js';
import { isPositiveAmount, MAX_AMOUNT } from './money.js';
import { isCatalogIcon, migratedIcon, FALLBACK_ICON } from './catalog.js';
import { reservesOf } from './reserves.js';
import { budgetsOf, overlaps, meet, lengthOf, currentWindow } from './budgets.js';
import { isMonthStart } from './month-start.js';
import {
  scheduleById, isDateOf, isPending, reserveFor, EVERY, MAX_INTERVAL, datesOf, addDays, doneOf, handledDates, dateAfter, schedulesOf, indexAt, nthDate,
  chainOf, ownCount, continueAt, confirmRange, nextOpenDate, settledIn, nextPending, stopErases
} from './dues.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./projection.js').Row} Row */
/** @typedef {import('./events.js').NewEvent} NewEvent */
/** @typedef {import('./queries.js').Draft} Draft */
/** @typedef {import('./ledger.js').Tx} Tx */
/** @typedef {{ today: string, newId: () => string }} Ctx */
/** @typedef {{ type: string, [k: string]: any }} Command */

export class DomainError extends Error {
  /** @param {string} message @param {string} [code] @param {any} [detail] */
  constructor(message, code = 'invalid', detail = null) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}
/** @param {string} msg @param {string} [code] @param {any} [detail] @returns {never} */
const fail = (msg, code, detail) => { throw new DomainError(msg, code, detail); };

// Refus qui reviennent : une même situation donne toujours le même message.
const M = {
  noWallet: 'Ce portefeuille n’existe pas.',
  noCategory: 'Cette catégorie n’existe pas.',
  noEntry: 'Cette opération n’existe pas.',
  noReserve: 'Cette réserve n’existe pas.',
  noBudget: 'Ce budget n’existe pas.',
  noDue: 'Cette échéance n’existe pas.',
  tooBig: 'Ce montant est trop grand.',
  amount: 'Indique un montant.',
  badDate: 'Date illisible.',
  name: 'Donne-lui un nom.',
  walletName: 'Un portefeuille porte déjà ce nom.',
  to: 'Choisis le portefeuille de destination.',
  sameWallet: 'Choisis deux portefeuilles différents.',
  currency: 'Les deux portefeuilles doivent avoir la même devise.',
  pickCategory: 'Choisis une catégorie.',
  pickExpenseCat: 'Choisis une catégorie de dépenses.',
  closed: 'Cette réserve est close.',
  badBalance: 'Ce solde n’est pas un montant lisible.',
  negative: 'Le solde ne peut pas être négatif.',
  ident: 'L’identifiant ne peut contenir que des lettres, des chiffres, des espaces et . - /',
  icon: 'Choisis une icône parmi celles proposées.',
  sameKind: 'Choisis une catégorie du même type.',
  twoLevels: 'Une sous-catégorie ne peut pas avoir de sous-catégories.',
  settled: 'Cette échéance est déjà réglée.',
  notDateOf: 'Cette date n’est pas une date de cette échéance.',
  notPlanned: 'Cette opération n’est pas prévue.',
  typeFixed: 'Une échéance garde son type : une dépense reste une dépense.',
  catFixed: 'Une échéance garde sa catégorie : pour une autre, modifie l’échéance.',
  times: 'Indique un nombre de fois.',
  dueDate: 'Choisis la date de cette échéance.',
  idTaken: 'Identifiant déjà utilisé.',
  badColor: 'Couleur inconnue.',
  badCurrency: 'Devise inconnue.',
  badWalletKind: 'Type de portefeuille inconnu.',
  badCatKind: 'Type de catégorie inconnu.',
  badKind: 'Type d’opération inconnu.',
  badOrder: 'Ordre invalide.',
};
/** @param {string} name */
const archivedWallet = name => `Le portefeuille ${name} est archivé.`;
/** @param {string} name */
const archivedCat = name => `La catégorie ${name} est archivée.`;
/** @param {string} name */
const openReserves = name => `${name} a des réserves ouvertes : clos-les d’abord.`;
/** Une dépense refusée sur une épargne (D17). @param {string} name */
const savingsNoSpend = name => `${name} est une épargne : on n’y dépense pas. Passe par une réserve, ou active « Permettre les dépenses » dans sa fiche.`;
/** Une catégorie qui n'est pas du type de l'opération. @param {string} kind */
const catOfKind = kind => (kind === 'income' ? 'Choisis une catégorie de revenus.' : M.pickExpenseCat);
/** Une date qui ne peut pas être passée (« La fin », « La première date »…). @param {string} what */
const notPast = what => `${what} ne peut pas être passée.`;

const COLORS = /^c(10|[0-9])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IDENT = /^[\p{L}\p{N} .\-/]*$/u;
// texte saisi : sans caractères de contrôle, espaces resserrés
/** @param {any} v @param {number} max */
// tronqué par caractère entier (un emoji n'est jamais coupé en deux)
const clean = (v, max) => Array.from(String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
/** @param {string} d */
const validDate = d => DATE.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

/** @param {State} s @param {string} id */
function wallet(s, id) {
  const a = s.accounts.get(id);
  if (!a || a.kind !== 'wallet' || a.deleted_at) fail(M.noWallet, 'not_found');
  return a;
}
/** @param {State} s @param {string} id */
function category(s, id) {
  const a = s.accounts.get(id);
  if (!a || (a.kind !== 'expense' && a.kind !== 'income') || a.deleted_at) fail(M.noCategory, 'not_found');
  return a;
}
/** Sous-catégories non supprimées d'une catégorie. @param {State} s @param {string} id */
const childrenOf = (s, id) => [...s.accounts.values()].filter(a => a.parent_id === id && !a.deleted_at);
// Une catégorie qui change de groupe (« Ranger dans », ou « Non suivi » sortie d'une catégorie archivée) passe en dernier
// de son nouveau groupe : l'ordre est une suite unique par type (principales et sous-catégories mêlées), garder sa place
// d'avant la poserait n'importe où parmi ses nouvelles voisines.
/** @param {State} s @param {string} kind @param {string} id */
const toEnd = (s, kind, id) => {
  const ids = [...s.accounts.values()].filter(a => a.kind === kind && a.id !== id)
    .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(a => a.id);
  return { type: 'category.reordered', payload: { type: kind, ids: [...ids, id] } };
};
/** @param {State} s @param {string} id */
function entry(s, id) {
  const e = s.entries.get(id);
  if (!e) fail(M.noEntry, 'not_found');
  return e;
}
/** @param {State} s @param {string} kind @param {string} name @param {string|null} except */
function nameTaken(s, kind, name, except) {
  const n = name.toLowerCase();
  return [...s.accounts.values()].some(a => a.kind === kind && !a.deleted_at && a.id !== except && a.name.toLowerCase() === n);
}

/**
 * Un nom de catégorie est unique dans son type (dépenses ou revenus), principales et sous-catégories confondues
 * (2026-11-10) : le nom seul suffit partout, sans « Transport › ». Message de refus, ou null si le nom est libre.
 * @param {State} s @param {string} kind @param {string} name @param {string|null} except
 */
function catNameTaken(s, kind, name, except) {
  const n = name.toLowerCase();
  const o = [...s.accounts.values()].find(a => a.kind === kind && !a.deleted_at && !a.archived_at && a.id !== except
    && a.name.toLowerCase() === n);
  if (!o) return null;
  const p = o.parent_id ? s.accounts.get(o.parent_id) : null;
  return p ? `« ${o.name} » existe déjà, dans « ${p.name} ».` : `Une catégorie « ${o.name} » existe déjà.`;
}

/**
 * Message lisible pour un solde qui deviendrait négatif.
 * @param {State} s
 * @param {import('./rules.js').BalanceProblem} chk
 */
function negativeMessage(s, chk) {
  const name = s.accounts.get(chk.accountId)?.name || '?';
  if (chk.kind === 'past') return `Le ${shortDate(chk.date)}, ${name} passerait sous zéro.`;
  if (chk.kind === 'already') return `${name} est déjà dans le négatif.`;
  return `Il n’y a pas assez dans ${name}.`;
}
/** @param {State} s @param {Draft|null} oldD @param {Draft|null} newD */
function guardBalance(s, oldD, newD) {
  const chk = checkChange(s, oldD, newD);
  if (chk) fail(negativeMessage(s, chk), 'negative', chk);
}

/**
 * Réglages d'épargne d'un portefeuille (D17) : genre (épargne, choisi à la création, figé), « Permettre les dépenses », objectif (montant,
 * date facultative) et rôle « Fonds d'urgence » (un seul portefeuille à la fois). Rend les colonnes changées et les
 * événements à émettre avant (le fonds d'urgence retiré à l'ancien porteur).
 * @param {State} s @param {Row|null} w portefeuille existant, ou null à la création
 * @param {Record<string, any>} c @param {Ctx} ctx
 * @returns {{ ch: Record<string, any>, before: NewEvent[] }}
 */
function savingsChanges(s, w, c, ctx) {
  /** @type {Record<string, any>} */
  const ch = {};
  /** @type {NewEvent[]} */
  const before = [];
  const cur = { savings: !!w?.savings, spend_ok: !!w?.spend_ok, goal_amount: w?.goal_amount ?? null, goal_on: w?.goal_on ?? null, emergency: !!w?.emergency };
  // le genre (courant ou épargne) se choisit à la création et ne change plus (2026-11-10, D17)
  if (w && 'savings' in c && !!c.savings !== cur.savings) fail(`${w.name} reste ${cur.savings ? 'une épargne' : 'un portefeuille courant'} : crée un autre portefeuille.`, 'kind_locked');
  const savings = 'savings' in c ? !!c.savings : cur.savings;
  if (savings !== cur.savings) ch.savings = savings;
  if (!savings) {
    if (w && cur.savings && reservesOf(s, { wallet: w.id, open: true }).length) fail(openReserves(w.name), 'reserves');
    // plus une épargne : ses réglages d'épargne partent avec
    if ('spendOk' in c && c.spendOk || 'emergency' in c && c.emergency || c.goal) fail('Ce réglage est réservé aux portefeuilles d’épargne.', 'savings');
    if (cur.spend_ok) ch.spend_ok = false;
    if (cur.emergency) ch.emergency = false;
    if (cur.goal_amount != null) { ch.goal_amount = null; ch.goal_on = null; }
    return { ch, before };
  }
  if ('spendOk' in c && !!c.spendOk !== cur.spend_ok) ch.spend_ok = !!c.spendOk;
  if ('goal' in c) {
    const g = c.goal;
    if (g == null) {
      if (cur.goal_amount != null) { ch.goal_amount = null; ch.goal_on = null; }
    } else {
      if (Number.isSafeInteger(g.amount) && g.amount > MAX_AMOUNT) fail(M.tooBig, 'goal');
      if (!isPositiveAmount(g.amount)) fail('Indique le montant de l’objectif.', 'goal');
      const on = g.on || null;
      if (on !== null && !validDate(on)) fail(M.badDate, 'goal_date');
      if (on !== null && on !== cur.goal_on && on < ctx.today) fail(notPast('La date de l’objectif'), 'goal_date');
      // une épargne a des réserves ou un objectif, pas les deux (2026-11-20, avec l'utilisateur : deux calculs se
      // contredisaient) ; un ancien objectif posé avant ses réserves peut rester tel quel (il n'est plus suivi)
      if (w && (g.amount !== cur.goal_amount || on !== cur.goal_on) && reservesOf(s, { wallet: w.id, open: true }).length) fail(`${w.name} a des réserves : un objectif va dans une autre épargne.`, 'goal_reserves');
      if (g.amount !== cur.goal_amount) ch.goal_amount = g.amount;
      if (on !== cur.goal_on) ch.goal_on = on;
    }
  }
  if ('emergency' in c && !!c.emergency !== cur.emergency) {
    // un seul fonds d'urgence : tant qu'un portefeuille porte ce rôle, aucun autre ne le prend (le retirer d'abord)
    const holder = c.emergency ? [...s.accounts.values()].find(a => a.kind === 'wallet' && a.emergency && !a.deleted_at && a.id !== w?.id) : null;
    if (holder) fail(`${holder.name} est déjà ton fonds d’urgence.`, 'emergency_taken');
    // le fonds d'urgence est de l'argent libre pour les coups durs : pas de réserve dedans (2026-11-10)
    if (c.emergency && w && reservesOf(s, { wallet: w.id, open: true }).length) fail(`${w.name} a des réserves : il ne peut pas être ton fonds d’urgence.`, 'emergency_reserves');
    ch.emergency = !!c.emergency;
  }
  return { ch, before };
}

/**
 * Brouillon d'écriture d'après une opération de l'interface (contrôles de cohérence compris).
 * @param {State} s
 * @param {string} id
 * @param {Tx} tx
 * @param {Ctx} ctx
 * @param {Row|null} old écriture modifiée (les portefeuilles / catégories archivés qu'elle utilisait restent permis)
 * @returns {Draft}
 */
function moveDraft(s, id, tx, ctx, old) {
  if (!MOVE_KINDS.includes(tx.type)) fail(M.badKind);
  if (Number.isSafeInteger(tx.amount) && tx.amount > MAX_AMOUNT) fail(M.tooBig, 'amount');
  if (!isPositiveAmount(tx.amount)) fail(M.amount, 'amount');
  if (!validDate(tx.date)) fail(M.badDate, 'date');
  const oldLines = old ? linesOf(s, old.id) : [];
  const usedBefore = (/** @type {string} */ acc) => oldLines.some(l => l.account === acc);
  const w = wallet(s, tx.accountId);
  if (w.archived_at && !usedBefore(w.id)) fail(archivedWallet(w.name), 'archived');
  if (tx.type === 'transfer') {
    if (!tx.toAccountId) fail(M.to, 'to');
    if (tx.toAccountId === tx.accountId) fail(M.sameWallet, 'same_wallet');
    const t = wallet(s, tx.toAccountId);
    if (t.archived_at && !usedBefore(t.id)) fail(archivedWallet(t.name), 'archived');
    if (t.currency !== w.currency) fail(M.currency, 'currency');
  } else {
    // épargne (D17) : pas de dépense directe, sauf « Permettre les dépenses » (une ancienne dépense reste modifiable)
    // une dépense qui utilise une réserve de ce portefeuille est toujours permise (utiliser une réserve = la dépenser)
    const viaReserve = tx.type === 'expense' && tx.reserve && reservesOf(s).some(r => r.id === tx.reserve && r.wallet === w.id && !r.closed);
    if (tx.type === 'expense' && w.savings && !w.spend_ok && !w.emergency && !usedBefore(w.id) && !viaReserve) fail(savingsNoSpend(w.name), 'savings');
    if (!tx.categoryId) fail(M.pickCategory, 'category');
    const c = category(s, tx.categoryId);
    if (c.kind !== tx.type) fail(catOfKind(tx.type), 'category');
    if (c.archived_at && !usedBefore(c.id)) fail(archivedCat(c.name), 'archived');
  }
  if (!tx.planned && tx.date > ctx.today) fail('Cette date n’est pas encore arrivée : choisis aujourd’hui ou avant.', 'future');
  return { id, kind: tx.type, occurred_on: tx.date, status: tx.planned ? 'planned' : 'posted', note: clean(tx.note, 120), lines: txLines(tx, w.currency) };
}

/**
 * Écriture de solde de départ (non annulée) d'un portefeuille, ou null.
 * @param {State} s
 * @param {string} walletId
 */
function openingOf(s, walletId) {
  for (const e of s.entries.values()) {
    if (e.kind === 'opening' && e.status !== 'void' && linesOf(s, e.id).some(l => l.account === walletId)) return e;
  }
  return null;
}

/**
 * Événements pour fixer le solde de départ d'un portefeuille à `amount`.
 * @param {State} s @param {Row} w @param {number} amount @param {Ctx} ctx
 * @returns {{ events: NewEvent[], oldD: Draft|null, newD: Draft|null }}
 */
function openingEvents(s, w, amount, ctx) {
  const op = openingOf(s, w.id);
  const lines = balanceLines(w.id, amount, w.currency);
  if (op) {
    const oldD = draftOf(s, op);
    if (!amount) return { events: [{ type: 'entry.voided', payload: { id: op.id, reason: 'solde de départ retiré' } }], oldD, newD: null };
    return { events: [{ type: 'entry.amended', payload: { id: op.id, changes: { lines } } }], oldD, newD: { ...oldD, lines } };
  }
  if (!amount) return { events: [], oldD: null, newD: null };
  const id = ctx.newId();
  const newD = { id, kind: 'opening', occurred_on: ctx.today, status: 'posted', note: '', lines };
  return { events: [{ type: 'entry.recorded', payload: { id, kind: 'opening', occurred_on: ctx.today, status: 'posted', note: '', lines } }], oldD: null, newD };
}

/** @param {any} fmt */
function validFmt(fmt) {
  return fmt && typeof fmt === 'object' && fmt.group in GROUPS && [0, 1, 2].includes(fmt.dec) && ['short', 'long', 'code'].includes(fmt.sym) && ['before', 'after'].includes(fmt.pos);
}
/** @type {Record<string, (v: any) => boolean>} */
const SETTING_CHECK = {
  currency: v => CURRENCIES.some(c => c.code === v),
  fmt: validFmt,
  blockNegative: v => typeof v === 'boolean',
  balancesSet: v => typeof v === 'boolean',
  monthStart: v => isMonthStart(v),
  theme: v => ['auto', 'light', 'dark'].includes(v),
  discreet: v => typeof v === 'boolean', // mode discret retiré le 2026-11-21 : gardé lisible (anciens journaux), plus lu
  haptics: v => typeof v === 'boolean',
  onboarded: v => typeof v === 'boolean',
  showVoided: v => typeof v === 'boolean',
  // arrondi des estimations par devise : un des pas proposés pour elle (D0)
  steps: v => !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([code, n]) => CURRENCIES.some(c => c.code === code) && stepChoices(code).includes(/** @type {number} */ (n))),
};

/** @type {Record<string, (s: State, c: Command, ctx: Ctx) => NewEvent[]>} */
const DECIDERS = {
  // Premier lancement : réglages et catégories par défaut. Aucun portefeuille : l'utilisateur crée les siens (D10).
  // (les catégories sont des comptes du grand livre : s.accounts n'est jamais vide après un setup)
  setup(s, { currency }) {
    if (s.accounts.size) fail('Bougette est déjà prête.');
    const cur = SETTING_CHECK.currency(currency) ? currency : 'XOF';
    const { onboarded, ...changes } = initialSettings(cur);
    return [
      { type: 'settings.changed', payload: { changes } },
      ...DEFAULT_CATEGORIES.map(c => ({ type: 'category.created', payload: { id: c.id, type: c.type, name: c.name, icon: c.icon, emoji: null, color: c.color, ...(c.parent ? { parent: c.parent } : {}) } })),
    ];
  },

  'settings.change'(s, { changes }) {
    const cur = settingsOf(s);
    /** @type {Record<string, any>} */
    const out = {};
    /** @type {NewEvent[]} */
    const events = [];
    for (const k of Object.keys(changes || {})) {
      if (!SETTING_KEYS.includes(k)) fail(`Réglage inconnu : ${k}`);
      const v = changes[k];
      if (!SETTING_CHECK[k](v)) fail(`Valeur invalide pour ${k}`);
      if (canonical(v) === canonical(/** @type {any} */ (cur)[k])) continue;
      if (k === 'onboarded' && v === true) events.push({ type: 'app.onboarded', payload: {} });
      else out[k] = v;
    }
    if (Object.keys(out).length) events.unshift({ type: 'settings.changed', payload: { changes: out } });
    return events;
  },

  'wallet.create'(s, c, ctx) {
    const name = clean(c.name, 28);
    if (!name) fail(M.name, 'name');
    if (nameTaken(s, 'wallet', name, null)) fail(M.walletName, 'name');
    const subtype = KINDS.includes(c.subtype) ? c.subtype : fail(M.badWalletKind);
    const currency = SETTING_CHECK.currency(c.currency) ? c.currency : fail(M.badCurrency);
    const identifier = subtype === 'cash' ? '' : clean(c.identifier, 34);
    if (!IDENT.test(identifier)) fail(M.ident, 'ident');
    if (c.color != null && !COLORS.test(c.color)) fail(M.badColor);
    const balance = c.balance || 0;
    if (!Number.isSafeInteger(balance)) fail(M.badBalance, 'balance');
    if (balance < 0 && settingsOf(s).blockNegative && !c.allow_negative) fail(M.negative, 'negative');
    const id = c.id || ctx.newId();
    if (s.accounts.has(id)) fail(M.idTaken);
    // hors du total (D11), épargne (D17) : champs écrits seulement quand ils sont posés (un portefeuille ordinaire garde
    // l'événement d'avant)
    const sv = savingsChanges(s, null, c, ctx);
    const extra = Object.fromEntries(Object.entries(sv.ch).filter(([, v]) => v !== false && v !== null));
    /** @type {NewEvent[]} */
    const events = [...sv.before, { type: 'wallet.created', payload: { id, name, subtype, currency, identifier, color: c.color ?? null, allow_negative: !!c.allow_negative, ...(c.excluded ? { off_total: true } : {}), ...extra } }];
    if (balance) {
      events.push({ type: 'entry.recorded', payload: { id: ctx.newId(), kind: 'opening', occurred_on: ctx.today, status: 'posted', note: '', lines: balanceLines(id, balance, currency) } });
      if (!settingsOf(s).balancesSet) events.push({ type: 'settings.changed', payload: { changes: { balancesSet: true } } });
    }
    return events;
  },

  'wallet.update'(s, { id, changes = {} }, ctx) {
    const w = wallet(s, id);
    /** @type {Record<string, any>} */
    const ch = {};
    /** @type {NewEvent[]} */
    const events = [];
    if ('name' in changes) {
      const name = clean(changes.name, 28);
      if (!name) fail(M.name, 'name');
      if (nameTaken(s, 'wallet', name, id)) fail(M.walletName, 'name');
      if (name !== w.name) ch.name = name;
    }
    const subtype = 'kind' in changes ? changes.kind : changes.subtype;
    if (subtype !== undefined) {
      if (!KINDS.includes(subtype)) fail(M.badWalletKind);
      if (subtype !== w.subtype) ch.subtype = subtype;
    }
    const identIn = 'ident' in changes ? changes.ident : changes.identifier;
    if (identIn !== undefined || ch.subtype === 'cash') {
      const identifier = (ch.subtype || w.subtype) === 'cash' ? '' : clean(identIn ?? w.identifier, 34);
      if (!IDENT.test(identifier)) fail(M.ident, 'ident');
      if (identifier !== (w.identifier || '')) ch.identifier = identifier;
    }
    if ('color' in changes) {
      const color = changes.color || null;
      if (color != null && !COLORS.test(color)) fail(M.badColor);
      if (color !== w.color) ch.color = color;
    }
    const allow = 'allowNegative' in changes ? changes.allowNegative : changes.allow_negative;
    if (allow !== undefined && !!allow !== !!w.allow_negative) ch.allow_negative = !!allow;
    // « Compter dans le total » (D11) : excluded = hors du total
    if ('excluded' in changes && !!changes.excluded !== !!w.off_total) ch.off_total = !!changes.excluded;
    const sv = savingsChanges(s, w, changes, ctx);
    Object.assign(ch, sv.ch);
    events.push(...sv.before);
    if (changes.currency !== undefined && changes.currency !== w.currency) {
      if (!SETTING_CHECK.currency(changes.currency)) fail(M.badCurrency);
      // la devise ne change plus dès qu'une écriture autre que le solde de départ le touche, même supprimée
      // (ses montants changeraient de valeur, et la rétablir mélangerait deux devises)
      if (currencyLockCount(s, id)) fail('Ce portefeuille a des opérations : sa devise ne change plus.', 'currency_locked');
      // ni sous une échéance (D18) : ses montants sont dans l'ancienne devise
      if (schedulesOf(s).some(x => x.wallet === id || x.to === id)) fail('Des échéances utilisent ce portefeuille : sa devise ne change pas.', 'currency_locked');
      ch.currency = changes.currency;
    }
    if (Object.keys(ch).length) events.push({ type: 'wallet.updated', payload: { id, changes: ch } });
    if (ch.currency) {
      // le solde de départ garde le même nombre affiché (5 000 F → 5 000,00 €), arrondi si la nouvelle devise a moins
      // de décimales
      const op = openingOf(s, id);
      const amount = op ? linesOf(s, op.id).find(l => l.account === id)?.amount || 0 : 0;
      const scaled = Math.round(amount * 10 ** (currencyOf(ch.currency).dec - currencyOf(w.currency).dec));
      if (op) events.push({ type: 'entry.amended', payload: { id: op.id, changes: { lines: balanceLines(id, scaled, ch.currency) } } });
    }
    if ('archived' in changes && !!changes.archived !== !!w.archived_at) {
      if (changes.archived && reservesOf(s, { wallet: id, open: true }).length) fail(openReserves(w.name), 'reserves');
      events.push({ type: changes.archived ? 'wallet.archived' : 'wallet.restored', payload: { id } });
    }
    return events;
  },

  'wallet.reorder'(s, { ids }) {
    if (!Array.isArray(ids)) fail(M.badOrder);
    ids.forEach(id => wallet(s, id));
    return [{ type: 'wallet.reordered', payload: { ids } }];
  },

  // Sans opération seulement. Son solde de départ et ses corrections sont annulés d'abord : le montant quitte
  // les totaux par une écriture visible dans le journal, pas en silence.
  'wallet.delete'(s, { id }) {
    const w = wallet(s, id);
    if (moveCount(s, id)) fail(`${w.name} a des opérations : archive-le plutôt.`, 'used');
    if (reservesOf(s, { wallet: id, open: true }).length) fail(openReserves(w.name), 'reserves');
    const live = entriesOn(s, id).filter(e => e.status !== 'void');
    return [
      ...live.map(e => ({ type: 'entry.voided', payload: { id: e.id, reason: 'portefeuille supprimé' } })),
      { type: 'wallet.deleted', payload: { id } },
    ];
  },

  // Solde de départ : écriture opening contre « Solde initial ».
  'wallet.setOpening'(s, { id, amount }, ctx) {
    const w = wallet(s, id);
    if (!Number.isSafeInteger(amount)) fail(M.badBalance);
    if (Math.abs(amount) > MAX_AMOUNT) fail('Ce solde est trop grand.');
    const { events, oldD, newD } = openingEvents(s, w, amount, ctx);
    guardBalance(s, oldD, newD);
    return events;
  },

  // Vérifier un portefeuille (D9) : actual = ce qu'il y a vraiment dessus. Sans autre opération que son solde de départ,
  // c'est ce solde qui est corrigé (une erreur à la création n'est pas un écart). Sinon, l'écart avec le solde de l'app
  // devient une opération ordinaire de catégorie « Non suivi » (dépense si l'argent manque, entrée s'il y en a plus),
  // datée du jour, modifiable ensuite comme toute opération ; la catégorie se crée la première fois, se rétablit si elle
  // a été archivée ou supprimée, et redevient principale si sa catégorie parente n'est plus active. Avec ou sans écart,
  // la vérification est notée (date de la dernière).
  'wallet.check'(s, { id, actual }, ctx) {
    const w = wallet(s, id);
    if (w.archived_at) fail(archivedWallet(w.name));
    if (!Number.isSafeInteger(actual)) fail(M.badBalance, 'balance');
    const current = walletBalances(s)[id] || 0;
    /** @type {NewEvent[]} */
    const events = [];
    const others = [...s.entries.values()].some(e => e.status !== 'void' && e.kind !== 'opening' && linesOf(s, e.id).some(l => l.account === id));
    if (actual !== current && !others) {
      if (actual < 0 && blocksNegative(s, id)) fail(M.negative, 'negative');
      const op = openingOf(s, id);
      const opening = op ? linesOf(s, op.id).find(l => l.account === id)?.amount || 0 : 0;
      const r = openingEvents(s, w, opening + actual - current, ctx);
      guardBalance(s, r.oldD, r.newD);
      events.push(...r.events);
    } else if (actual !== current) {
      if (actual < 0 && blocksNegative(s, id)) fail(M.negative, 'negative');
      const type = actual < current ? 'expense' : 'income';
      const cid = UNTRACKED[type];
      const c = s.accounts.get(cid);
      if (!c) events.push({ type: 'category.created', payload: { id: cid, type, name: 'Non suivi', icon: 'question', emoji: null, color: 'c0' } });
      else {
        if (c.kind !== type) fail('Catégorie « Non suivi » illisible.');
        if (c.deleted_at) events.push({ type: 'category.undeleted', payload: { id: cid } });
        if (c.archived_at) events.push({ type: 'category.restored', payload: { id: cid } });
        const p = c.parent_id ? s.accounts.get(c.parent_id) : null;
        if (p && (p.deleted_at || p.archived_at)) events.push({ type: 'category.updated', payload: { id: cid, changes: { parent: null } } }, toEnd(s, type, cid));
      }
      const eid = ctx.newId();
      const tx = { type, amount: Math.abs(actual - current), accountId: id, categoryId: cid, date: ctx.today, note: 'Écart constaté en vérifiant le solde', planned: false };
      const d = { id: eid, kind: type, occurred_on: ctx.today, status: 'posted', note: tx.note, lines: txLines(tx, w.currency) };
      guardBalance(s, null, d);
      events.push({ type: 'entry.recorded', payload: { id: eid, kind: d.kind, occurred_on: d.occurred_on, status: d.status, note: d.note, lines: d.lines } });
    }
    events.push({ type: 'wallet.checked', payload: { id } });
    return events;
  },

  // catType : « expense » ou « income » (le champ type désigne la commande elle-même)
  'category.create'(s, c, ctx) {
    if (c.catType !== 'expense' && c.catType !== 'income') fail(M.badCatKind);
    const name = clean(c.name, 28);
    if (!name) fail(M.name, 'name');
    if (c.color != null && !COLORS.test(c.color)) fail(M.badColor);
    if (c.emoji) fail(M.icon, 'icon');
    const icon = c.icon || FALLBACK_ICON;
    if (!isCatalogIcon(icon)) fail(M.icon, 'icon');
    // sous-catégorie : dans une catégorie principale du même type, encore active (deux niveaux seulement) ;
    // elle prend la teinte de sa catégorie
    let parent = null;
    if (c.parent) {
      parent = category(s, c.parent);
      if (parent.kind !== c.catType) fail(M.sameKind);
      if (parent.parent_id) fail(M.twoLevels);
      if (parent.archived_at) fail(archivedCat(parent.name));
    }
    const id = c.id || ctx.newId();
    if (s.accounts.has(id)) fail(M.idTaken);
    const taken = catNameTaken(s, c.catType, name, null);
    if (taken) fail(taken, 'name');
    const color = parent ? parent.color : c.color || 'c1';
    return [{ type: 'category.created', payload: { id, type: c.catType, name, icon, emoji: null, color, ...(parent ? { parent: parent.id } : {}) } }];
  },

  'category.update'(s, { id, changes = {} }) {
    const c = category(s, id);
    /** @type {Record<string, any>} */
    const ch = {};
    if ('name' in changes) {
      const name = clean(changes.name, 28);
      if (!name) fail(M.name, 'name');
      if (name !== c.name) ch.name = name;
    }
    for (const k of ['icon', 'emoji', 'color']) {
      if (!(k in changes)) continue;
      const v = changes[k] || null;
      if (k === 'color' && v != null && !COLORS.test(v)) fail(M.badColor);
      if (k === 'icon' && !isCatalogIcon(v)) fail(M.icon, 'icon');
      // un emoji peut seulement être retiré (D7 : plus d'emoji)
      if (k === 'emoji' && v != null) fail(M.icon, 'icon');
      if (v !== (c[k] ?? null)) ch[k] = v;
    }
    // choisir une icône remplace l'emoji d'avant
    if (ch.icon && c.emoji && !('emoji' in ch)) ch.emoji = null;
    // ranger ailleurs (fiche unique) : parent = une catégorie principale du même type, ou null (devient principale).
    // Deux niveaux seulement : une catégorie qui a des sous-catégories reste principale. Son budget la suit (devenue
    // sous-catégorie, il ne compte plus qu'elle ; ses dépenses comptent aussi dans le budget de sa nouvelle principale).
    // Une sous-catégorie prend la teinte de sa catégorie.
    if ('parent' in changes && (changes.parent || null) !== (c.parent_id || null)) {
      const to = changes.parent || null;
      if (to) {
        if (to === id) fail('Une catégorie ne peut pas se ranger dans elle-même.');
        const p = category(s, to);
        if (p.kind !== c.kind) fail(M.sameKind);
        if (p.parent_id) fail(M.twoLevels);
        if (p.archived_at) fail(archivedCat(p.name));
        if ([...s.accounts.values()].some(a => a.parent_id === id && !a.deleted_at)) fail(`« ${c.name} » a des sous-catégories : elle reste une catégorie principale.`);
        if (p.color !== (ch.color ?? c.color)) ch.color = p.color;
      }
      ch.parent = to;
    }
    // nom en double dans le type, après renommage ou en sortant des archives
    const restore = 'archived' in changes && !changes.archived && !!c.archived_at;
    if ('name' in ch || restore) {
      const taken = catNameTaken(s, c.kind, ch.name ?? c.name, id);
      if (taken) fail(taken, 'name');
    }
    /** @type {NewEvent[]} */
    const events = [];
    if (Object.keys(ch).length) events.push({ type: 'category.updated', payload: { id, changes: ch } });
    if ('parent' in ch) events.push(toEnd(s, c.kind, id));
    if ('archived' in changes && !!changes.archived !== !!c.archived_at) events.push({ type: changes.archived ? 'category.archived' : 'category.restored', payload: { id } });
    return events;
  },

  // Migration D7 (au démarrage) : chaque emoji, ou ancienne icône hors catalogue, devient l'icône Phosphor la plus
  // proche (sinon dots-three). Rien d'autre ne change. Idempotente : une fois faite, elle ne produit plus d'événement.
  'category.migrateIcons'(s) {
    /** @type {NewEvent[]} */
    const events = [];
    for (const a of [...s.accounts.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
      if ((a.kind !== 'expense' && a.kind !== 'income') || a.deleted_at) continue;
      if (!a.emoji && isCatalogIcon(a.icon)) continue;
      /** @type {Record<string, any>} */
      const changes = {};
      const icon = migratedIcon(a);
      if (icon !== a.icon) changes.icon = icon;
      if (a.emoji) changes.emoji = null;
      events.push({ type: 'category.updated', payload: { id: a.id, changes } });
    }
    return events;
  },

  'category.reorder'(s, { catType, ids }) {
    if (catType !== 'expense' && catType !== 'income') fail(M.badCatKind);
    if (!Array.isArray(ids)) fail(M.badOrder);
    ids.forEach(id => { if (category(s, id).kind !== catType) fail('Catégorie d’un autre type.'); });
    return [{ type: 'category.reordered', payload: { type: catType, ids } }];
  },

  // Supprimer : seulement une catégorie sans sous-catégorie ni opération ; sinon on l'archive (le journal reste entier,
  // aucune opération n'est déplacée).
  'category.delete'(s, { id }) {
    const c = category(s, id);
    if (childrenOf(s, id).length) fail('Cette catégorie a des sous-catégories : supprime-les ou archive-la.', 'children');
    if (moveCount(s, id)) fail('Cette catégorie a des opérations : archive-la plutôt.', 'used');
    // une échéance s'y tient (D18) : supprimée, elle ne pourrait plus se confirmer (sa catégorie est figée)
    const held = schedulesOf(s).find(r => r.category === id);
    if (held) fail(`L’échéance « ${held.note || c.name} » utilise cette catégorie : archive la catégorie, ou supprime l’échéance.`, 'due');
    return [{ type: 'category.deleted', payload: { id } }];
  },

  'entry.record'(s, { id, tx, created_at = null }, ctx) {
    const eid = id || ctx.newId();
    if (s.entries.has(eid)) fail(M.idTaken);
    // tx.reserve (D17) : une dépense depuis un portefeuille d'épargne qui utilise cette réserve
    if (tx.reserve != null) {
      const r = reservesOf(s).find(x => x.id === tx.reserve) || fail(M.noReserve, 'not_found');
      if (r.closed) fail(M.closed, 'closed');
      if (tx.type !== 'expense' || r.wallet !== tx.accountId || tx.planned) fail('Une réserve s’utilise par une dépense depuis son épargne.', 'reserve');
      // revu le 2026-11-19 (avec l'utilisateur : chacun fait ce qu'il veut de son argent) : une réserve paie ce qu'on veut,
      // la seule limite est le solde de l'épargne ; la répartition (calculée) se refait d'elle-même. En une fois : seulement
      // quand l'épargne a de quoi la payer entièrement
      const need = r.amount - r.used;
      const rw = s.accounts.get(r.wallet);
      if (r.mode === 'once' && (walletBalances(s)[r.wallet] || 0) < need) fail(`${r.name} se paie en une fois : il faut ${money(need, { cur: rw?.currency })} dans ${rw?.name || 'son épargne'}.`, 'reserve_not_full');
      // pas plus que ce qu'elle vise encore (au-delà, ce n'est plus cette réserve)
      if (Number.isSafeInteger(tx.amount) && tx.amount > need) fail(`Au plus ${money(need, { cur: rw?.currency })} pour ${r.name}.`, 'reserve_over');
    }
    const d = moveDraft(s, eid, tx, ctx, null);
    guardBalance(s, null, d);
    /** @type {Record<string, any>} */
    const payload = { id: eid, kind: d.kind, occurred_on: d.occurred_on, status: d.status, note: d.note, lines: d.lines };
    if (created_at) payload.created_at = created_at;
    /** @type {NewEvent[]} */
    const events = [{ type: 'entry.recorded', payload }];
    if (tx.reserve != null) events.push({ type: 'reserve.used', payload: { id: tx.reserve, amount: tx.amount, on: ctx.today, entry: eid } });
    return events;
  },

  'entry.amend'(s, { id, tx }, ctx) {
    const e = entry(s, id);
    if (e.status === 'void') fail('Cette opération a été supprimée.', 'void');
    if (!MOVE_KINDS.includes(e.kind)) fail('Cette opération ne se modifie pas ici.');
    const oldD = draftOf(s, e);
    // l'opération d'une échéance (D18, revu le 2026-11-12) : les règles de Confirmer valent aussi en la modifiant depuis
    // le Journal — ni son type ni sa catégorie ne changent, une nouvelle date reste entre la fois d'avant et aujourd'hui
    const rule = e.schedule_id ? scheduleById(s, e.schedule_id) : null;
    if (rule) {
      if (tx.type != null && tx.type !== e.kind) fail(M.typeFixed, 'type');
      if (tx.planned) fail('Une échéance réglée ne redevient pas prévue.', 'planned');
      const old = linesToMove(e.kind, oldD.lines, x => isWallet(s, x));
      const was = old?.categoryId ?? null;
      if (e.kind !== 'transfer' && (tx.categoryId ?? null) !== was) fail(M.catFixed, 'category');
      sameCurrency(s, tx.accountId, old?.accountId ?? rule.wallet, rule.currency);
      if (tx.date != null && tx.date !== e.occurred_on) confirmDate(tx.date, confirmRange(s, ctx.today, { schedule: rule.id, entry: null, date: e.due_on }));
    }
    const d = moveDraft(s, id, tx, ctx, e);
    guardBalance(s, oldD, d);
    /** @type {Record<string, any>} */
    const changes = {};
    if (d.kind !== e.kind) changes.kind = d.kind;
    if (d.occurred_on !== e.occurred_on) changes.occurred_on = d.occurred_on;
    if (d.status !== e.status) changes.status = d.status;
    if (d.note !== (e.note || '')) changes.note = d.note;
    if (canonical(d.lines) !== canonical(oldD.lines)) changes.lines = d.lines;
    return Object.keys(changes).length ? [{ type: 'entry.amended', payload: { id, changes } }] : [];
  },

  // « Supprimer » = annuler : l'écriture disparaît des listes mais reste dans le journal et l'historique.
  'entry.void'(s, { id, reason = null }) {
    const e = entry(s, id);
    if (e.status === 'void') return [];
    guardBalance(s, draftOf(s, e), null);
    return [{ type: 'entry.voided', payload: { id, reason: reason ? clean(reason, 80) : null } }];
  },

  'entry.restore'(s, { id }) {
    const e = entry(s, id);
    if (e.status !== 'void') return [];
    // la date d'une échéance qu'elle confirmait, réglée depuis par une autre opération (D18) : pas deux fois
    if (e.schedule_id && e.due_on && [...s.entries.values()].some(x => x.id !== id && x.status !== 'void' && x.schedule_id === e.schedule_id && x.due_on === e.due_on)) {
      fail('Cette échéance a déjà été réglée par une autre opération.', 'done');
    }
    const d = draftOf(s, e);
    const back = { ...d, status: e.status_before_void || 'posted' };
    for (const l of d.lines) {
      const a = s.accounts.get(l.account);
      if (!a) fail('Un portefeuille ou une catégorie de cette opération n’existe plus.', 'not_found');
      if (a.kind === 'wallet') {
        const w = wallet(s, l.account);
        if (w.currency !== l.currency) fail(`${w.name} est passé en ${w.currency} : cette opération en ${l.currency} ne peut pas revenir.`, 'currency');
      } else if (a.kind === 'expense' || a.kind === 'income') {
        if (a.deleted_at) fail(`La catégorie ${a.name} a été supprimée : cette opération ne peut pas revenir.`, 'not_found');
      }
    }
    if (e.kind === 'opening' && d.lines.some(l => isWallet(s, l.account) && openingOf(s, l.account))) fail('Ce portefeuille a déjà un solde de départ.', 'opening');
    guardBalance(s, null, back);
    return [{ type: 'entry.restored', payload: { id } }];
  },

  // Budgets (D11 revu) : une catégorie de dépenses, un montant (monnaie principale), un début et une fin comprises, qui
  // peut se répéter. La fin est aujourd'hui ou plus tard ; un seul budget en cours par catégorie à la fois (répétitions
  // comprises). Il compte les opérations de sa catégorie ; une principale, aussi celles de ses sous-catégories (D13,
  // revu le 2026-11-11).
  'budget.create'(s, c, ctx) {
    const id = c.id || ctx.newId();
    if (s.budgets.has(id)) fail(M.idTaken);
    const b = budgetForm(s, { category: c.category, amount: c.amount, start: c.start ?? ctx.today, end: c.end, repeat: !!c.repeat }, ctx, null);
    // from : le budget terminé qu'on reconduit (D11)
    if (c.from != null && !s.budgets.has(c.from)) fail(M.noBudget, 'from');
    return [{ type: 'budget.created', payload: { id, category: b.category, amount: b.amount, currency: settingsOf(s).currency, start: b.start, end: b.end, repeat: b.repeat, ...(c.from ? { from: c.from } : {}) } }];
  },

  // changes : amount, end, repeat (ce qui n'y est pas reste). La catégorie et le début ne changent pas (2026-11-13) :
  // pour une autre catégorie ou un autre début, un autre budget ; changes peut les redonner tels quels. Un ancien budget
  // mensuel prend les dates de sa période en cours.
  'budget.update'(s, { id, changes = {} }, ctx) {
    const cur = budgetsOf(s).find(b => b.id === id) || fail(M.noBudget, 'not_found');
    // un budget qui se répète repart de sa période en cours (même durée : rien ne change pour la suite)
    const w = (cur.repeat && currentWindow(cur, ctx.today)) || cur;
    if ('category' in changes && changes.category !== cur.category) fail('La catégorie d’un budget ne change pas : crée un autre budget.', 'category');
    if ('start' in changes && changes.start !== w.start && changes.start !== cur.start) fail('Le début d’un budget ne change pas : crée un autre budget.', 'start');
    const next = { category: cur.category, amount: cur.amount, start: w.start, end: w.end, repeat: cur.repeat };
    for (const k of /** @type {const} */ (['amount', 'end', 'repeat'])) if (k in changes) /** @type {any} */ (next)[k] = changes[k];
    const b = budgetForm(s, { ...next, repeat: !!next.repeat }, ctx, cur);
    if (!cur.legacy && b.category === cur.category && b.amount === cur.amount && b.start === cur.start && b.end === cur.end && b.repeat === cur.repeat) return [];
    return [{ type: 'budget.updated', payload: { id, category: b.category, amount: b.amount, currency: cur.currency, start: b.start, end: b.end, repeat: b.repeat } }];
  },

  // le budget seulement, jamais ses opérations
  'budget.delete'(s, { id }) {
    budgetsOf(s).find(b => b.id === id) || fail(M.noBudget, 'not_found');
    return [{ type: 'budget.deleted', payload: { id } }];
  },

  // --- réserves (D17) : charges préparées à l'avance, dans un portefeuille d'épargne ---
  // c : wallet, name, amount, due, mode ('once' | 'gradual'), from (la réserve terminée qu'on reconduit, D17)
  'reserve.create'(s, c, ctx) {
    const w = wallet(s, c.wallet);
    if (!w.savings) fail('Une réserve se crée dans une épargne.', 'savings');
    if (w.emergency) fail(`${w.name} est ton fonds d’urgence : pas de réserve dedans.`, 'emergency');
    if (w.archived_at) fail(archivedWallet(w.name), 'archived');
    // des réserves ou un objectif, pas les deux (2026-11-20, avec l'utilisateur) : la première réserve d'une épargne qui a
    // un objectif le retire, une fois l'utilisateur prévenu (dropGoal) ; sans cet accord, refusée
    const dropGoal = w.goal_amount != null && !reservesOf(s, { wallet: w.id, open: true }).length;
    if (dropGoal && !c.dropGoal) fail(`${w.name} a un objectif : une réserve le retire.`, 'goal');
    const id = c.id || ctx.newId();
    if (s.reserves.has(id)) fail(M.idTaken);
    const r = reserveFields(c, ctx, null, s);
    if (c.from != null && !reservesOf(s).some(x => x.id === c.from && x.closed)) fail('On ne reconduit qu’une réserve terminée.', 'from');
    return [...(dropGoal ? [{ type: 'wallet.updated', payload: { id: w.id, changes: { goal_amount: null, goal_on: null } } }] : []),
      { type: 'reserve.created', payload: { id, wallet: w.id, name: r.name, amount: r.amount, start: ctx.today, due: r.due, mode: r.mode, ...(c.from ? { from: c.from } : {}), ...(r.category ? { category: r.category } : {}) } }];
  },

  // changes : name, amount, due (Repousser), mode, category (« Montant fixé » retiré : la répartition est enregistrée)
  'reserve.update'(s, { id, changes = {} }, ctx) {
    const r = openReserve(s, id);
    /** @type {Record<string, any>} */
    const ch = {};
    const f = reserveFields({ name: r.name, amount: r.amount, due: r.due, mode: r.mode, category: r.category, ...changes }, ctx, r, s);
    if (f.name !== r.name) ch.name = f.name;
    if (f.amount !== r.amount) ch.amount = f.amount;
    if (f.due !== r.due) ch.due = f.due;
    if (f.mode !== r.mode) ch.mode = f.mode;
    if (f.category !== r.category) ch.category = f.category;
    return Object.keys(ch).length ? [{ type: 'reserve.updated', payload: { id, changes: ch } }] : [];
  },

  // « Réduire au montant atteint » : le montant visé devient ce qui est mis de côté (saved, calculé par l'écran)
  'reserve.reduce'(s, { id, to }, ctx) {
    const r = openReserve(s, id);
    if (!Number.isSafeInteger(to) || to <= 0) fail('Rien n’est encore mis de côté pour elle : clos-la plutôt.', 'amount');
    if (to + r.used >= r.amount) return [];
    return DECIDERS['reserve.update'](s, /** @type {any} */ ({ id, changes: { amount: to + r.used } }), ctx);
  },

  // utilisée, avec l'opération qui fait sortir l'argent (entry : son identifiant) ; d'un coup : close
  'reserve.use'(s, { id, amount, entry = null }, ctx) {
    openReserve(s, id);
    if (!isPositiveAmount(amount)) fail(M.amount, 'amount');
    if (entry != null && !s.entries.has(entry)) fail(M.noEntry, 'not_found');
    return [{ type: 'reserve.used', payload: { id, amount, on: ctx.today, ...(entry ? { entry } : {}) } }];
  },


  // Clore : ce qui était dessus retourne aux autres
  'reserve.close'(s, { id }, ctx) {
    openReserve(s, id);
    return [{ type: 'reserve.closed', payload: { id, on: ctx.today } }];
  },

  // --- échéances et opérations récurrentes (D18) : une règle ; ses dates sont calculées ; rien ne s'écrit tout seul ---
  // c : kind ('expense', 'income', 'transfer'), amount, accountId, toAccountId, categoryId, note, start, every ('day', 'week',
  // 'month', 'year' ou null), interval (tous les combien, 1 par défaut), end, times, reserve
  'due.create'(s, c, ctx) {
    const id = c.id || ctx.newId();
    if (s.schedules.has(id)) fail(M.idTaken);
    const f = scheduleFields(s, c, ctx, null);
    return [{ type: 'schedule.created', payload: { id, ...f } }];
  },

  // Modifier agit à partir d'aujourd'hui, jamais sur le passé (D18).
  // - Une échéance seule : c'est elle qu'on déplace ou qu'on change (en retard comprise), tant qu'elle n'est pas réglée.
  // - Une règle qui répète, sans date passée ni réglée : elle change en place.
  // - Sinon elle est coupée au point P : aujourd'hui, ou la date qui suit (à son rythme) la dernière déjà réglée (payée
  //   d'avance, passée) ; elle s'arrête en P (jamais plus tard qu'un arrêt déjà posé) et une nouvelle règle la continue,
  //   reliée (from). Même rythme : la nouvelle garde le jour d'ancrage (begins = P : le 31 reste le 31). Nouveau rythme :
  //   elle part de la prochaine date (celle que la feuille montrait), le jour d'ancrage gardé (continueAt). Nouvelle
  //   première date : au plus tôt P. Les retards gardent leurs valeurs d'avant.
  // - Le nombre de fois (changes.times) est celui de toute l'échéance, ses règles successives comprises (« en 12 fois ») :
  //   chaque règle en garde sa part. Une suite ne revient jamais avant sa coupe (avant, c'est la règle d'avant).
  'due.update'(s, { id, changes = {} }, ctx) {
    const r = scheduleById(s, id) || fail(M.noDue, 'not_found');
    // une règle déjà continuée par une autre, ou arrêtée : ses retards se règlent un par un ; on modifie la plus récente
    if (schedulesOf(s).some(x => x.from === id)) fail('Cette échéance a été modifiée depuis : modifie la version la plus récente.', 'continued');
    if (r.stopped) fail('Cette échéance est arrêtée : ses retards se règlent un par un (Confirmer ou Passer).', 'stopped');
    const merged = { kind: r.kind, amount: r.amount, accountId: r.wallet, toAccountId: r.to, categoryId: r.category, note: r.note,
      start: r.start, every: r.every, interval: r.interval, end: r.end, times: r.times, reserve: r.reserve, days: r.days, ...changes };
    // une unité sans intervalle : chaque (comme avant le rythme libre)
    if ('every' in changes && !('interval' in changes)) merged.interval = 1;
    const ended = () => fail('Cette échéance est finie : il n’y a plus de date à modifier.', 'ended');
    const notBefore = (/** @type {string} */ d) => fail(`Choisis une première date à partir du ${shortDate(d)} : avant, c’est déjà réglé.`, 'start');
    const [every, interval] = rhythmOf(merged.every, merged.interval);
    const reshaped = every !== r.every || (every ? interval : 1) !== (r.every ? r.interval : 1);
    // le nombre de fois voulu pour toute l'échéance (undefined : inchangé ; null : sans fin), et les fois des règles d'avant
    const total = 'times' in changes ? changes.times ?? null : undefined;
    if (total != null && (!Number.isSafeInteger(total) || total < 1 || total > 999)) fail(M.times, 'times');
    const prior = chainOf(s, id).slice(0, -1).reduce((n, x) => n + ownCount(x), 0);
    /** Les fois qui restent à cette règle-ci : le total voulu moins celles d'avant ; sinon ce qui lui restait. @param {number} before @param {number|null} left */
    const ownLeft = (before, left) => {
      const n = total !== undefined ? (total === null ? null : total - before) : left;
      if (n !== null && n < 1) total !== undefined ? fail(`Il y a déjà eu ${before} fois : choisis plus de ${before}.`, 'times') : ended();
      return n;
    };
    /** Son nombre de fois à elle, compté depuis son ancrage (begins : les rangs d'avant comptent). @param {number|null} n @param {string} start @param {string|null} begins */
    const perRule = (n, start, begins) => (!every || n === null ? null
      : n + (begins ? indexAt(/** @type {any} */ ({ start, every, interval, times: null }), begins) : 0));
    /** Le rang d'une date dans la grille de cette règle (sans son nombre de fois ni sa fin). @param {string} d */
    const gridAt = d => indexAt(/** @type {any} */ ({ ...r, times: null }), d);
    const done = doneOf(s);
    const handled = handledDates(s, r, done);
    // le type ne change plus dès qu'une fois est réglée (D18, revu le 2026-11-12) : pour un autre, une autre échéance
    if ('kind' in changes && changes.kind !== r.kind && settledIn(s, id)) fail('Une date est déjà réglée : le type ne change plus. Pour un autre type, crée une autre échéance.', 'kind');
    const inPlace = () => {
      // une suite (from) ne revient pas avant sa coupe : ce qui est avant appartient à la règle d'avant
      const floor = r.begins || (r.from ? scheduleById(s, r.from)?.stopped ?? null : null);
      if ('start' in changes && floor && validDate(changes.start) && changes.start < floor) notBefore(floor);
      let start = merged.start, begins = r.begins;
      const k0 = r.begins ? gridAt(r.begins) : 0;
      if (r.begins && ('start' in changes || reshaped)) {
        // nouvel ancrage : la date choisie, sinon sa première date à elle (au nouveau rythme, le jour d'ancrage gardé)
        if ('start' in changes) { start = changes.start; begins = null; }
        else {
          const own = nthDate(r, k0);
          if (!own) ended();
          if (!every) fail(M.dueDate, 'start');
          ({ start, begins } = continueAt(r.start, /** @type {string} */ (own), /** @type {any} */ (every), interval, r.every));
        }
      }
      const times = perRule(ownLeft(prior, r.times == null ? null : r.times - k0), start, begins);
      const f = scheduleFields(s, { ...merged, start, times }, ctx, r, { anchored: !!begins });
      // il lui reste au moins une date
      if (!dateAfter({ ...r, ...f, interval: f.interval || 1, begins, skips: [] }, addDays(begins || f.start, -1))) ended();
      /** @type {Record<string, any>} */
      const ch = {};
      const now = { kind: r.kind, amount: r.amount, currency: r.currency, wallet: r.wallet, to: r.to, category: r.category, note: r.note,
        start: r.start, every: r.every, interval: r.every && r.interval > 1 ? r.interval : null, end: r.end, times: r.times, reserve: r.reserve };
      for (const k of /** @type {(keyof typeof now)[]} */ (Object.keys(now))) if ((f[k] ?? null) !== (now[k] ?? null)) ch[k] = f[k] ?? null;
      if (JSON.stringify(f.days || []) !== JSON.stringify(r.days || [])) ch.days = f.days || null;
      // le rythme s'écrit en entier (unité et intervalle) : un ancien « tous les 3 mois » ne se lit plus comme tel
      if ('every' in ch || 'interval' in ch) { ch.every = f.every; ch.interval = f.interval; }
      if ((begins ?? null) !== (r.begins ?? null)) ch.begins = begins;
      return Object.keys(ch).length ? [{ type: 'schedule.updated', payload: { id, changes: ch } }] : [];
    };
    if (!r.every) {
      if (handled.length) fail('Cette échéance est déjà réglée : modifie l’opération dans le Journal.', 'done');
      return inPlace();
    }
    const past = datesOf(r, r.start, addDays(ctx.today, -1)).length > 0;
    if (!past && !handled.length) return inPlace();
    // le point de coupe
    const last = handled.filter(d => d >= ctx.today).pop();
    const P = last ? dateAfter(r, last) || addDays(last, 1) : ctx.today;
    /** @type {import('./events.js').NewEvent[]} */
    const events = [];
    if (!r.stopped || r.stopped > P) events.push({ type: 'schedule.stopped', payload: { id, on: P } });
    let start = r.start, begins = /** @type {string|null} */ (P);
    if ('start' in changes) {
      if (!validDate(changes.start) || changes.start < P) notBefore(P);
      start = changes.start;
      begins = null;
    } else if (!every) fail(M.dueDate, 'start');
    // les fois d'avant la coupe : celles des règles d'avant et les siennes avant P (des dates qui ont existé : sa fin et
    // son nombre de fois comptent) ; celles qui lui restaient
    const k0 = r.begins ? gridAt(r.begins) : 0;
    const ownBefore = datesOf(r, r.start, addDays(P, -1)).length;
    const left = ownLeft(prior + ownBefore, r.times == null ? null : r.times - k0 - ownBefore);
    if (!('start' in changes) && reshaped) {
      // un nouveau rythme part de la prochaine date de sa grille (celle que la page montrait ; au-delà de sa fin si on
      // la prolonge), le jour d'ancrage gardé
      const from = nthDate(r, gridAt(P));
      if (!from) ended();
      ({ start, begins } = continueAt(r.start, /** @type {string} */ (from), /** @type {any} */ (every), interval, r.every));
    }
    const f = scheduleFields(s, { ...merged, start, times: perRule(left, start, begins) }, ctx, begins ? r : null, { anchored: !!begins });
    if (begins && !dateAfter({ ...r, ...f, every: f.every, interval: f.interval || 1, begins, stopped: null, skips: [], id: '' }, addDays(begins, -1))) ended();
    events.push({ type: 'schedule.created', payload: { id: ctx.newId(), ...f, ...(begins ? { begins } : {}), from: id } });
    return events;
  },

  // Arrêter : plus de dates à partir d'aujourd'hui ; les retards restent à régler ; les opérations confirmées restent
  // Arrêter : plus de dates à régler à partir d'aujourd'hui ; les retards restent à régler. Ce qui est déjà réglé —
  // aujourd'hui, ou la prochaine payée d'avance — reste dans l'échéance : la coupe vient à la première date encore à
  // régler (2026-11-12, comme une modification coupe après ce qui est réglé). Un arrêt posé ne bouge plus.
  // Un seul geste (2026-11-13, avec l'utilisateur) : sans rien de réglé ni de retard, Arrêter l'efface (rien à garder).
  'due.stop'(s, { id }, ctx) {
    const r = scheduleById(s, id) || fail(M.noDue, 'not_found');
    if (r.stopped) return [];
    if (stopErases(s, id, ctx.today)) return chainOf(s, id).reverse().map(x => ({ type: 'schedule.deleted', payload: { id: x.id } }));
    const next = nextPending(s, r, ctx.today);
    return next ? [{ type: 'schedule.stopped', payload: { id, on: next.date } }] : [];
  },

  // Supprimer : l'échéance entière — ses règles successives (une modification la coupe en deux), avec leurs dates à venir
  // ou en retard ; jamais ses opérations confirmées (elles redeviennent des opérations comme les autres)
  'due.delete'(s, { id }) {
    scheduleById(s, id) || fail(M.noDue, 'not_found');
    return chainOf(s, id).reverse().map(r => ({ type: 'schedule.deleted', payload: { id: r.id } }));
  },

  // Passer une date (elle ne compte pas cette fois) ; une ancienne opération prévue passée est annulée
  'due.skip'(s, { id = null, on = null, entry: eid = null }) {
    if (eid) {
      const e = entry(s, eid);
      if (e.status !== 'planned') fail(M.notPlanned, 'not_planned');
      return [{ type: 'entry.voided', payload: { id: eid, reason: 'passée' } }];
    }
    const r = scheduleById(s, id) || fail(M.noDue, 'not_found');
    if (!validDate(on) || !isDateOf(r, on)) fail(M.notDateOf, 'date');
    if (!isPending(s, r, on)) fail(M.settled, 'done');
    return [{ type: 'schedule.skipped', payload: { id, on } }];
  },

  // Rétablir une date passée par erreur
  'due.unskip'(s, { id, on }) {
    const r = scheduleById(s, id) || fail(M.noDue, 'not_found');
    if (!r.skips.includes(on)) return [];
    return [{ type: 'schedule.unskipped', payload: { id, on } }];
  },

  // Confirmer (D18) : l'opération est enregistrée, préremplie par la règle (tx : ce qu'on a changé avant de confirmer).
  // Date proposée : celle de l'échéance si elle est passée (on a souvent payé à temps sans le noter), sinon aujourd'hui ;
  // c'est la date de l'opération qui décide du budget où elle compte. Une dépense payée par une réserve passe par la
  // réserve (règles de « Utiliser », D17) ; un virement qui remplit une réserve y met l'argent (ce qui y tient). Une
  // ancienne opération prévue est marquée payée : pas de deuxième opération.
  'due.confirm'(s, { id = null, on = null, entry: eid = null, tx = {} }, ctx) {
    if (eid) {
      const e = entry(s, eid);
      if (e.status !== 'planned') fail(M.notPlanned, 'not_planned');
      const d = draftOf(s, e);
      const mv = linesToMove(e.kind, d.lines, x => isWallet(s, x)) || fail('Cette opération ne se lit pas.');
      fixedFields(tx, e.kind, mv.categoryId ?? null);
      sameCurrency(s, tx.accountId, mv.accountId);
      const range = confirmRange(s, ctx.today, { schedule: null, entry: eid, date: e.occurred_on });
      const base = { type: e.kind, amount: mv.amount, accountId: mv.accountId, toAccountId: mv.toAccountId, categoryId: mv.categoryId, note: e.note || '',
        date: clampDate(e.occurred_on < ctx.today ? e.occurred_on : ctx.today, range) };
      confirmDate(tx.date ?? base.date, range);
      return DECIDERS['entry.amend'](s, { type: 'entry.amend', id: eid, tx: { ...base, ...tx, planned: false } }, ctx);
    }
    const r = scheduleById(s, id) || fail(M.noDue, 'not_found');
    if (!validDate(on) || !isDateOf(r, on)) fail(M.notDateOf, 'date');
    if (!isPending(s, r, on)) fail(M.settled, 'done');
    // une à la fois (D18, revu le 2026-11-12) : d'avance, seulement la prochaine ; les retards, dans n'importe quel ordre
    if (on > ctx.today) {
      const next = nextOpenDate(s, r.id, ctx.today);
      if (next !== on) fail(`Une à la fois : confirme d’abord celle du ${shortDate(/** @type {string} */ (next))}.`, 'order');
    }
    fixedFields(tx, r.kind, r.category);
    sameCurrency(s, tx.accountId, r.wallet, r.currency);
    if (s.accounts.get(r.wallet)?.currency !== r.currency && !tx.amount) fail('Ce portefeuille a changé de devise : indique le montant.', 'currency');
    const range = confirmRange(s, ctx.today, { schedule: r.id, entry: null, date: on });
    /** @type {Record<string, any>} */
    const base = { type: r.kind, amount: r.amount, accountId: r.wallet, toAccountId: r.to, categoryId: r.category, note: r.note,
      date: clampDate(on < ctx.today ? on : ctx.today, range) };
    confirmDate(tx.date ?? base.date, range);
    const res = r.reserve ? reserveFor(s, r) : null;
    if (r.kind === 'expense' && r.reserve) {
      const overridden = tx.accountId && tx.accountId !== r.wallet;
      if (res && !overridden) base.reserve = res.id, base.accountId = res.wallet;
      else if (!overridden) fail('Sa réserve est close : reconduis-la, ou choisis un portefeuille courant.', 'reserve_closed');
    }
    const draft = { ...base, ...tx, planned: false };
    if (tx.accountId && tx.accountId !== base.accountId) delete draft.reserve;
    const eidNew = ctx.newId();
    const events = DECIDERS['entry.record'](s, { type: 'entry.record', id: eidNew, tx: draft }, ctx);
    events[0].payload.schedule = r.id;
    events[0].payload.due = on;
    return events;
  },
};

/**
 * Une échéance se confirme avec son type et sa catégorie, sous-catégorie comprise (D18, revu le 2026-11-12) : une
 * dépense reste une dépense ; une autre catégorie se change dans l'échéance.
 * @param {Record<string, any>} tx @param {string} kind @param {string|null} category
 */
function fixedFields(tx, kind, category) {
  if (tx.type != null && tx.type !== kind) fail(M.typeFixed, 'type');
  if (kind !== 'transfer' && tx.categoryId != null && tx.categoryId !== category) fail(M.catFixed, 'category');
}
/**
 * Payer une échéance depuis un autre portefeuille que celui prévu (prévu MoMo, payé en espèces) : permis, mais seulement
 * dans sa devise (D18, revu le 2026-11-12). from : le portefeuille prévu ; cur : la devise de l'échéance (sinon celle du
 * portefeuille prévu).
 * @param {State} s @param {any} accountId @param {string} from @param {string} [cur]
 */
function sameCurrency(s, accountId, from, cur) {
  if (!accountId || accountId === from) return;
  const want = cur || s.accounts.get(from)?.currency;
  if (want && s.accounts.get(accountId)?.currency !== want) fail('Choisis un portefeuille dans la devise de l’échéance.', 'currency');
}
/** La date d'une confirmation dans ce qui est permis (confirmRange). @param {any} d @param {{ min: string|null, max: string }} range */
function confirmDate(d, { min, max }) {
  if (!validDate(d)) fail('Choisis la date.', 'date');
  if (d > max) fail('Une échéance se confirme au plus tard aujourd’hui.', 'date');
  if (min && d < min) fail(`Choisis une date à partir du ${shortDate(min)} : les dates de l’échéance se règlent dans l’ordre.`, 'date');
}
/** @param {string} d @param {{ min: string|null, max: string }} range */
const clampDate = (d, { min, max }) => (d > max ? max : min && d < min ? min : d);

/** Un rythme comme la règle le garde : un ancien trimestre ou semestre en mois, chaque = 1. @param {any} every @param {any} interval @returns {[string|null, number]} */
function rhythmOf(every, interval) {
  const n = Number.isSafeInteger(interval) ? interval : 1;
  const old = /** @type {Record<string, number>} */ ({ quarter: 3, half: 6 })[every] || 0;
  if (old) return ['month', old * n];
  return every ? [every, n] : [null, 1];
}

/**
 * Champs validés d'une opération récurrente (D18). cur : la règle modifiée (sa première date passée reste permise, ses
 * comptes archivés depuis aussi). anchored : la première date n'est qu'un ancrage (ses dates ne comptent qu'à partir de
 * begins), elle peut être passée.
 * @param {State} s @param {Record<string, any>} c @param {Ctx} ctx @param {import('./dues.js').Schedule|null} cur @param {{ anchored?: boolean }} [o]
 */
function scheduleFields(s, c, ctx, cur, { anchored = false } = {}) {
  const kind = c.kind;
  if (!['expense', 'income', 'transfer'].includes(kind)) fail(M.badKind);
  if (Number.isSafeInteger(c.amount) && c.amount > MAX_AMOUNT) fail(M.tooBig, 'amount');
  if (!isPositiveAmount(c.amount)) fail(M.amount, 'amount');
  const w = wallet(s, c.accountId);
  if (w.archived_at && w.id !== cur?.wallet) fail(archivedWallet(w.name), 'archived');
  let to = null, cat = null, reserve = null;
  if (kind === 'transfer') {
    if (!c.toAccountId) fail(M.to, 'to');
    if (c.toAccountId === c.accountId) fail(M.sameWallet, 'same_wallet');
    const t = wallet(s, c.toAccountId);
    if (t.archived_at && t.id !== cur?.to) fail(archivedWallet(t.name), 'archived');
    if (t.currency !== w.currency) fail(M.currency, 'currency');
    to = t.id;
  } else {
    if (!c.categoryId) fail(M.pickCategory, 'category');
    const k = category(s, c.categoryId);
    if (k.kind !== kind) fail(catOfKind(kind), 'category');
    if (k.archived_at && k.id !== cur?.category) fail(archivedCat(k.name), 'archived');
    cat = k.id;
  }
  if (c.reserve) {
    // la réserve qui paie une dépense (depuis son épargne), ou que remplit un virement (vers son épargne) ; jamais une rentrée
    const r = reservesOf(s).find(x => x.id === c.reserve) || fail(M.noReserve, 'not_found');
    if (r.closed && r.id !== cur?.reserve) fail(M.closed, 'closed');
    if (kind === 'income') fail('Un revenu ne passe pas par une réserve.', 'reserve');
    if (kind === 'expense' && r.wallet !== w.id) fail('Une réserve paie depuis son épargne : choisis ce portefeuille.', 'reserve');
    if (kind === 'transfer' && r.wallet !== to) fail('Une réserve se remplit par un virement vers son épargne.', 'reserve');
    reserve = r.id;
  } else if (kind === 'expense' && w.savings && !w.spend_ok && !w.emergency) {
    fail(savingsNoSpend(w.name), 'savings');
  }
  if (!validDate(c.start)) fail('Choisis la première date.', 'start');
  if (c.start < ctx.today && c.start !== cur?.start && !anchored) fail(notPast('La première date'), 'start');
  // rythme : une unité et tous les combien ; un ancien rythme (« quarter », « half ») devient des mois
  const old = /** @type {Record<string, number>} */ ({ quarter: 3, half: 6 })[c.every] || 0;
  const every = old ? 'month' : c.every ?? null;
  if (every !== null && !EVERY.includes(every)) fail('Répétition inconnue.', 'every');
  const n = c.interval ?? 1;
  if (every !== null && (!Number.isSafeInteger(n) || n < 1 || n > MAX_INTERVAL)) fail('Indique tous les combien (un nombre entier).', 'interval');
  const interval = every ? (old || 1) * n : 1;
  // les autres jours de départ (D18 revu le 2026-11-18) : des décalages en jours depuis la première date ; avec une
  // répétition, ils tiennent dans sa première période (lundi, mardi, vendredi de la même semaine)
  const raw = c.days ?? [];
  if (!Array.isArray(raw) || raw.some((/** @type {any} */ x) => !Number.isSafeInteger(x) || x < 1 || x > 3660)) fail('Les jours choisis sont illisibles.', 'days');
  const days = [...new Set(/** @type {number[]} */ (raw))].sort((a, b) => a - b);
  if (days.length > 62) fail('Choisis au plus 63 jours.', 'days');
  if (every && days.length && addDays(c.start, days[days.length - 1]) >= /** @type {string} */ (nthDate({ start: c.start, every, interval }, 1))) fail('Choisis des jours dans une même période (une semaine, un mois…).', 'days');
  const end = c.end ?? null, times = c.times ?? null;
  if (end !== null && times !== null) fail('Une fin : une date ou un nombre de fois, pas les deux.', 'end');
  if (end !== null && (!validDate(end) || end < c.start)) fail('La fin ne peut pas venir avant la première date.', 'end');
  if (times !== null && (!Number.isSafeInteger(times) || times < 1 || (times > 999 && !anchored))) fail(M.times, 'times');
  return { kind, amount: c.amount, currency: w.currency, wallet: w.id, to, category: cat, note: clean(c.note, 120), start: c.start,
    every, interval: every && interval > 1 ? interval : null, end: every ? end : null, times: every ? times : null, reserve,
    ...(days.length ? { days } : {}) };
}

/** @param {State} s @param {string} id */
function openReserve(s, id) {
  const r = reservesOf(s).find(x => x.id === id) || fail(M.noReserve, 'not_found');
  if (r.closed) fail(M.closed, 'closed');
  return r;
}
/**
 * Champs validés d'une réserve (category : la catégorie de dépenses quand on l'utilise, facultative).
 * @param {Record<string, any>} c @param {Ctx} ctx @param {import('./reserves.js').Reserve|null} cur @param {State} s
 */
function reserveFields(c, ctx, cur, s) {
  const name = clean(c.name, 28);
  if (!name) fail(M.name, 'name');
  if (Number.isSafeInteger(c.amount) && c.amount > MAX_AMOUNT) fail(M.tooBig, 'amount');
  if (!isPositiveAmount(c.amount)) fail('Indique le montant visé.', 'amount');
  if (cur && c.amount <= cur.used) fail('Le montant visé doit dépasser ce qui a déjà été utilisé.', 'amount');
  if (!validDate(c.due)) fail('Choisis la date d’échéance.', 'due');
  if (c.due !== cur?.due && c.due < ctx.today) fail(notPast('L’échéance'), 'due');
  if (c.due < (cur?.start ?? ctx.today)) fail('L’échéance ne peut pas venir avant le début.', 'due');
  const mode = c.mode === 'gradual' ? 'gradual' : c.mode === 'once' || c.mode == null ? 'once' : fail('Mode inconnu.');
  let cat = c.category || null;
  // la catégorie de la dépense est obligatoire (revu le 2026-11-10 : sans elle, chaque utilisation la redemandait)
  // (une ancienne réserve sans catégorie reste modifiable — Repousser… — et la demande à l'utilisation)
  if (!cat && (!cur || 'category' in c && cur.category)) fail('Choisis la catégorie de la dépense.', 'category');
  if (cat) {
    const k = category(s, cat);
    if (k.kind !== 'expense') fail(M.pickExpenseCat, 'category');
    if (k.archived_at && cat !== cur?.category) fail(archivedCat(k.name), 'archived');
  }
  return { name, amount: c.amount, due: c.due, mode, category: cat };
}

/**
 * Budget validé (création ou modification).
 * @param {State} s
 * @param {{ category: any, amount: any, start: any, end: any, repeat: boolean }} b
 * @param {Ctx} ctx
 * @param {import('./budgets.js').Budget|null} cur budget modifié (sa catégorie archivée depuis reste permise)
 */
function budgetForm(s, b, ctx, cur) {
  if (!b.category) fail(M.pickCategory, 'category');
  const c = category(s, b.category);
  if (c.kind !== 'expense') fail(M.pickExpenseCat, 'category');
  if (c.archived_at && (!cur || cur.category !== c.id)) fail(archivedCat(c.name), 'archived');
  if (Number.isSafeInteger(b.amount) && b.amount > MAX_AMOUNT) fail(M.tooBig, 'amount');
  if (!isPositiveAmount(b.amount)) fail(M.amount, 'amount');
  if (!validDate(b.start) || !validDate(b.end)) fail(M.badDate, 'date');
  if (b.end < ctx.today) fail(notPast('La fin'), 'end');
  if (b.start > b.end) fail('La fin ne peut pas venir avant le début.', 'date');
  const other = budgetsOf(s).find(x => x.category === c.id && x.id !== cur?.id && overlaps(x, b, ctx.today));
  if (other) fail(`${c.name} a déjà un budget de même durée sur ces dates.`, 'overlap', { id: other.id });
  // deux budgets qui se chevauchent : le plus court ne dépasse pas le plus long (égal permis ; même devise seulement)
  const code = cur ? cur.currency : settingsOf(s).currency, len = lengthOf(b);
  for (const x of budgetsOf(s)) {
    if (x.category !== c.id || x.id === cur?.id || x.currency !== code || !meet(x, b, ctx.today)) continue;
    const xl = lengthOf(x);
    const what = `${c.name} a ${money(x.amount, { cur: x.currency })} du ${shortDate(x.start)} au ${shortDate(x.end)}`;
    // à cheval (2026-11-13, avec l'utilisateur) : un nouveau budget qui commence pendant un autre et va plus loin n'est pas
    // « dedans » — c'est presque toujours remplacer l'actuel ou le faire suivre ; la feuille propose les deux (code partial)
    const astride = !cur && !x.repeat && x.start <= b.start && b.end > x.end;
    if (astride && ((len < xl && b.amount > x.amount) || (len > xl && b.amount < x.amount))) {
      fail(`${c.name} a déjà ${money(x.amount, { cur: x.currency })} jusqu’au ${shortDate(x.end)}.`, 'partial', { id: x.id, end: x.end });
    }
    if (len < xl && b.amount > x.amount) fail(`Un budget plus court ne peut pas dépasser le plus long : ${what}.`, 'amount', { id: x.id });
    if (len > xl && b.amount < x.amount) fail(`Un budget plus long ne peut pas être plus petit que le plus court : ${what}.`, 'amount', { id: x.id });
  }
  return { category: c.id, amount: b.amount, start: b.start, end: b.end, repeat: b.repeat };
}

/**
 * Valide une commande et renvoie les événements à enregistrer.
 * @param {State} s
 * @param {Command} cmd
 * @param {Ctx} ctx
 * @returns {NewEvent[]}
 */
export function decide(s, cmd, ctx) {
  const d = DECIDERS[cmd.type];
  if (!d) fail('Commande inconnue : ' + cmd.type);
  return d(s, cmd, ctx);
}

/**
 * Aperçu sans rien écrire : la commande passerait-elle ? Renvoie null ou l'erreur.
 * @param {State} s @param {Command} cmd @param {Ctx} ctx
 * @returns {DomainError|null}
 */
export function preview(s, cmd, ctx) {
  try { decide(s, cmd, ctx); return null; } catch (e) { if (e instanceof DomainError) return e; throw e; }
}

export { currencyOf };
