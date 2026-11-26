// La saisie en cours : son état de départ (nouvelle opération, modification, copie, échéance à confirmer, réserve
// utilisée, opération à programmer) et ce qui s'en déduit. Les règles pures sont dans src/domain/entry-rules.js.
// Une seule feuille pour noter et programmer (2026-11-26, avec l'utilisateur) : la date décide. Aujourd'hui ou passée :
// on note (la saisie habituelle, rien de plus). À venir, ou une répétition (st.when) : on programme (planning) et la
// feuille se transforme sur place.
import { account, category, accounts, categories, subcategories, pref, accCur, balances, savingsReport, spendImpact, dueRange, scheduleById } from '../../core/store.js';
import { today } from '../../core/format.js';
import { UNTRACKED } from '../../domain/defaults.js';
import { entryDraft, balanceAfter, entrySig, edited, reserveUsable, clampDate } from '../../domain/entry-rules.js';

/** « Non suivi » : jamais proposé (l'écart d'une vérification n'est pas une habitude). */
export const UNTRACKED_IDS = new Set(Object.values(UNTRACKED));

/**
 * La saisie ouverte : options, état, éléments de la feuille, et les fonctions de dessin que les parties s'appellent.
 * @typedef {{
 *   tx: any, copy: any, due: any, onSaved: (() => void)|null,
 *   editing: boolean, canPlan: boolean, held: boolean, bounds: { min: string|null, max: string }|null,
 *   prePlan: { accountId: string, reserveId: string|null, other: boolean, swapped: string|null }|null,
 *   canFuture: boolean, planAsked: boolean, prefer: string|null, wasPlanning: boolean, onCreated: ((made: any) => void)|null, plan: Record<string, any>|null,
 *   planned: { amount: number, currency: string }|null,
 *   st: any, opType: string, copyFrom: string|null,
 *   s: any, el: HTMLElement, exprEl: HTMLElement, resEl: HTMLElement, sayEl: HTMLElement, goBtn: HTMLButtonElement, goLbl: HTMLElement,
 *   pad: any, padCur: string|null, problem: import('../../domain/entry-rules.js').EntryProblem|null, wasShort: boolean, saving: boolean, checkFrom: number,
 *   shown: string[], shownFor: { type: string, amount: number }|null,
 *   refresh: () => void, paintAmount: (key?: string|null) => void, paintCats: () => void, paintMeta: () => void,
 * }} Entry
 */

/**
 * L'état de départ de la saisie (sans la feuille : openEntry la monte).
 * copy : une opération à refaire (Dupliquer) ; date : la date proposée ; reserveId : la réserve utilisée (D17) ;
 * amount : un montant proposé (sans opération de départ).
 * @returns {Entry}
 */
export function entryState({ type, tx, copy, accountId, toAccountId, reserveId, due, date, amount = 0, onSaved, plan = null, onCreated = null }) {
  const editing = !!tx;
  // programmer (2026-11-26) : une nouvelle opération seulement (une copie y a droit) ; ni modifier, ni confirmer, ni utiliser une réserve
  const canFuture = !editing && !due && !reserveId;
  if (!canFuture) plan = null;
  // plan : les valeurs de départ d'une opération à programmer (kind, amount, accountId, toAccountId, categoryId, note,
  // start, every, interval, days, by, end, times) ; sans start : on veut programmer, la date n'est pas encore choisie
  const fromPlan = plan ? { type: plan.kind, amount: plan.amount, accountId: plan.accountId, toAccountId: plan.toAccountId, categoryId: plan.categoryId, note: plan.note } : null;
  const planAsked = !!plan && !plan.start;
  /** La règle d'une opération qui se répète (ou a plusieurs jours) ; sinon seule la date compte. @type {import('../../domain/when.js').When|null} */
  const when0 = plan?.start && (plan.every || plan.days?.length)
    ? { start: plan.start, days: plan.days || [], every: plan.every || null, interval: plan.interval || 1, ...(plan.by ? { by: plan.by } : {}) } : null;
  const canPlan = editing && !!tx.planned; // seule une opération déjà prévue garde « Prévu »
  const firstAcc = accounts()[0]?.id;
  const last = account(pref('lastAccount'));
  // un portefeuille archivé depuis ne se reprend pas (on prend celui par défaut)
  const live = id => (id && account(id) && !account(id).archived ? id : null);
  // une échéance à confirmer avec d'autres valeurs (D18) : la saisie préremplie ; « Ajouter » la confirme (date : la
  // sienne si elle est passée, sinon aujourd'hui)
  const fromDue = due ? { type: due.kind, amount: due.amount, accountId: due.needsWallet ? null : due.wallet, toAccountId: due.to, categoryId: due.category, note: due.note } : null;
  const src = tx || copy || fromDue || fromPlan;
  const ref = copy || fromDue || fromPlan;
  // confirmer une échéance (D18, revu le 2026-11-12) : son type et sa catégorie ne se changent pas ici, la date va de la
  // fois d'avant à aujourd'hui (un retard se date du jour où il était dû), un montant loin du prévu se fait confirmer.
  // Les mêmes règles valent pour modifier, depuis le Journal, l'opération qui a confirmé une échéance (linked).
  const linked = editing && tx.schedule ? scheduleById(tx.schedule) : null;
  const held = !!(due || linked);
  const bounds = due ? dueRange(due) : linked ? dueRange({ schedule: linked.id, entry: null, date: /** @type {string} */ (tx.due) }) : null;
  /** Le montant prévu (A7), dans sa devise. */
  const planned = due ? { amount: due.amount, currency: due.currency } : linked ? { amount: linked.amount, currency: linked.currency } : null;
  const st = {
    type: src?.type || type,
    amount: src?.amount || amount || 0,
    accountId: tx?.accountId || live(ref?.accountId) || accountId || (last && !last.archived ? last.id : firstAcc),
    toAccountId: tx?.toAccountId || live(ref?.toAccountId) || toAccountId || null,
    categoryId: tx?.categoryId || (ref?.categoryId && category(ref.categoryId) && !category(ref.categoryId).archived ? ref.categoryId : null),
    date: tx?.date || date || plan?.start || (due ? (due.date < today() ? due.date : today()) : today()),
    note: src?.note || '',
    planned: canPlan,
    auto: false, // catégorie pré-choisie d'après le montant tapé (« proposée ») : un toucher la confirme, une autre la remplace
    actual: 0, // vérification (rond balance) : le montant qu'on a vraiment
    reserveId: reserveId || due?.reserve || null, // réserve utilisée (D17), ou celle qui paie l'échéance (D18)
    other: false, // dépense ordinaire depuis une épargne qui le permet (« Autre dépense »)
    when: when0, // programmer : la règle de « Quand ? » quand elle se répète ou a plusieurs jours (sinon null : la date seule est st.date)
    endMode: plan?.times && when0?.every ? 'times' : plan?.end && when0?.every ? 'date' : 'never', // la fin d'une règle qui se répète
    end: when0?.every ? plan?.end || null : null,
    times: when0?.every ? plan?.times || null : null,
  };
  // une échéance à confirmer : sa date dans ce qui est permis (de la fois d'avant à aujourd'hui) ; une opération déjà
  // notée garde la sienne (seul un changement de date est contrôlé)
  if (due && bounds) st.date = clampDate(st.date, bounds);
  const opType = st.type === 'check' ? 'expense' : st.type; // le type d'opération où l'on revient en quittant la vérification
  if (st.type === 'transfer' && st.toAccountId === st.accountId) st.toAccountId = null;
  const E = /** @type {Entry} */ ({
    tx, copy, due, onSaved, editing, canPlan, held, bounds, planned, st, opType,
    canFuture, planAsked, plan, onCreated, wasPlanning: false, prePlan: null,
    // la répétition pré-cochée dans « Quand ? » pour un seul jour touché : chaque mois quand on veut programmer sans date
    prefer: planAsked ? 'month' : null,
    // une copie (Dupliquer) ou une opération à programmer arrive remplie : elle n'est « à perdre » que si on y a changé quelque chose
    copyFrom: null,
    pad: null, padCur: null, problem: null, wasShort: false, saving: false, checkFrom: 0, shown: [], shownFor: null,
  });
  // le mode de départ posé (portefeuille d'une dépense programmée…) avant de noter ce qui était rempli
  syncMode(E);
  if (copy || plan) E.copyFrom = sigOf(st, opType, planAsked);
  return E;
}

/** Ce qu'on a rempli, pour savoir si quelque chose a changé depuis l'ouverture (le temps choisi compte aussi). @param {any} st @param {string} opType @param {boolean} asked */
const sigOf = (st, opType, asked) => JSON.stringify([entrySig(st, opType), st.when, st.endMode, st.end, st.times, asked]);

/** @param {Entry} E */
export const checking = E => E.st.type === 'check';
/** La devise de la saisie : celle du portefeuille. @param {Entry} E */
export const cur = E => accCur(E.st.accountId);
/** Opération telle qu'elle serait enregistrée (pour les contrôles). @param {Entry} E @returns {any} */
export const candidate = E => ({ id: E.tx?.id, ...entryDraft(E.st) });
/** Solde d'un portefeuille après l'opération (en remplaçant sa version enregistrée si on modifie). @param {Entry} E @param {string} accId */
export const after = (E, accId) => balanceAfter(balances()[accId] || 0, E.tx, candidate(E), accId);

// Saisie en cours qu'un geste accidentel ferait perdre (fond touché, glissé, Retour) : un montant tapé, ou, pour une
// opération qu'on modifie, un changement ; en vérification, un montant différent de celui proposé (ou un montant tapé avant). La croix ferme
// toujours sans demander ; l'enregistrement aussi.
/** @param {Entry} E */
const started = E => (E.copy || E.plan ? sigOf(E.st, E.opType, E.planAsked) !== E.copyFrom : !!E.st.amount || !!E.st.when);
/** @param {Entry} E */
export function dirty(E) {
  const { st, pad } = E;
  if (E.saving) return false;
  // (en vérification, l'opération commencée avant est gardée pour le retour : elle compte aussi)
  if (checking(E)) return st.actual !== E.checkFrom || !!(pad && pad.hasOp()) || started(E);
  if (!E.editing) return started(E) || !!(pad && (E.copy || E.plan ? pad.hasOp() : pad.expr()));
  return edited(E.tx, candidate(E), st.note);
}

// suggestions et modèles : jamais « Non suivi » (l'écart d'une vérification n'est pas une habitude ; elle reste dans « Toutes »)
/** @param {string} type @returns {string[]} */
export const validIds = type => categories(type).filter(c => !UNTRACKED_IDS.has(c.id)).flatMap(c => [c.id, ...subcategories(c.id).map(x => x.id)]);

// Dépense depuis une épargne (D17) : nouvelle opération seulement (une dépense qu'on modifie garde sa catégorie)
/** @param {Entry} E */
export const savingsSpend = E => !E.editing && E.st.type === 'expense' && !!account(E.st.accountId)?.savings;
/** En une fois : seulement remplie (on paie tout) ; en plusieurs fois : dès qu'il y a de l'argent. @param {any} v */
export const canUse = v => reserveUsable(v, savingsReport(v.reserve.wallet).balance);
/** Toutes les réserves ouvertes de ce portefeuille (avec ou sans argent mis de côté). @param {Entry} E @returns {any[]} */
export const openOfWallet = E => (account(E.st.accountId)?.savings ? savingsReport(E.st.accountId).reserves : []);
/** Réserves ouvertes de ce portefeuille qui ont de l'argent mis de côté, avec ce qui l'est. @param {Entry} E @returns {any[]} */
export const usableReserves = E => (account(E.st.accountId)?.savings ? savingsReport(E.st.accountId).reserves.filter(canUse) : []);
// pavé éteint : rien de choisi encore (réserve ou autre dépense), ou réserve en une fois (montant = ce qui est de côté)
/** @param {Entry} E */
export const padLocked = E => !planning(E) && savingsSpend(E) && (E.st.reserveId ? usableReserves(E).find(v => v.reserve.id === E.st.reserveId)?.reserve.mode === 'once' : !(E.st.other && E.st.categoryId));
/** L'effet de la dépense sur le budget (ou l'habitude) de la catégorie choisie, ou null. @param {Entry} E */
export const impact = E => (E.st.type !== 'expense' || E.st.planned || checking(E) || savingsSpend(E) || planning(E) || !E.st.categoryId ? null
  : spendImpact({ categoryId: E.st.categoryId, accountId: E.st.accountId, amount: E.st.amount, date: E.st.date, except: E.editing ? E.tx.id : null }));

/**
 * Programmer ? (2026-11-26) : une nouvelle opération dont la date est à venir, ou qui se répète, ou dont on vient de dire
 * qu'on veut la programmer (date pas encore choisie). Sinon on note : la saisie habituelle. @param {Entry} E
 */
export const planning = E => E.canFuture && !checking(E) && (E.planAsked || !!E.st.when || E.st.date > today());
/** La règle de « Quand ? » telle qu'elle serait programmée : celle qui se répète, ou la date seule. @param {Entry} E @returns {import('../../domain/when.js').When} */
export const ruleOf = E => E.st.when || { start: E.st.date, days: [], every: null, interval: 1 };

/**
 * Le mode a changé ? À appeler à chaque refresh, avant de dessiner. On entre dans « programmer » : « Prévu », la réserve et
 * « Autre dépense » n'ont plus de sens ; une dépense ne se programme pas depuis une épargne (le portefeuille passe au
 * premier courant, hors épargne). On en sort : la règle et la fin s'effacent (la date, la catégorie, le montant et la note
 * restent). La vérification d'un solde (rond balance) ne change rien : le mode d'avant revient avec elle. @param {Entry} E
 */
export function syncMode(E) {
  const { st } = E;
  if (checking(E)) return;
  const now = planning(E);
  if (now && !E.wasPlanning) {
    // ce qu'on quitte, pour le retrouver en revenant à « noter » (la feuille revient telle qu'elle était)
    E.prePlan = { accountId: st.accountId, reserveId: st.reserveId, other: st.other, swapped: null };
    st.planned = false; st.reserveId = null; st.other = false;
  }
  if (!now && E.wasPlanning) {
    st.when = null; st.endMode = 'never'; st.end = null; st.times = null;
    const p = E.prePlan;
    // le portefeuille remplacé d'office revient (s'il n'a pas été changé depuis), avec sa réserve ou son « Autre dépense »
    if (p?.swapped && st.accountId === p.swapped && account(p.accountId) && !account(p.accountId).archived) st.accountId = p.accountId;
    if (p && st.accountId === p.accountId) { st.reserveId = p.reserveId; st.other = p.other; }
    E.prePlan = null;
  }
  // une dépense ne se programme pas depuis une épargne qui ne permet pas les dépenses (la règle de l'ancienne feuille) :
  // le portefeuille passe au premier courant de la même devise (le montant garde son sens) ; s'il n'y en a pas, il reste
  const a = account(st.accountId);
  if (now && st.type === 'expense' && a?.savings && !a.spendOk) {
    const w = accounts().find(x => !x.savings && !x.archived && x.currency === a.currency);
    if (w) {
      if (E.prePlan && !E.prePlan.swapped) E.prePlan.swapped = w.id;
      st.accountId = w.id;
      if (st.toAccountId === w.id) st.toAccountId = null;
    }
  }
  E.wasPlanning = now;
}
/** La catégorie choisie pour programmer : une catégorie seulement proposée (st.auto) n'en est pas une, un virement n'en a pas. @param {Entry} E */
export const planCat = E => (E.st.type === 'transfer' || E.st.auto ? null : E.st.categoryId);
