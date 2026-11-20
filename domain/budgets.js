// Budgets par répartition (D11 revu) : un budget = une catégorie de dépenses, un montant, une date de début et une date
// de fin (comprises), qui peut se répéter. Tout est une lecture : la période en cours, ce qui y a été dépensé, le reste,
// ce qui est réservé et « Disponible » se recalculent à chaque fois depuis le journal ; rien n'est stocké à part.
// Fonctions pures : aucune dépendance au DOM, au stockage ni à l'horloge (« aujourd'hui » est toujours passé).
// Famille (tranché le 2026-11-11, D13 revu) : un budget sur une catégorie principale compte la principale et toutes
// ses sous-catégories ; un budget sur une sous-catégorie ne compte qu'elle. Les deux peuvent coexister : le budget de la
// sous-catégorie est une part de celui de la principale (une dépense au Marché fait avancer Marché et Alimentation).
import { shiftDay, daysBetween } from './pace.js';
import { monthSpan } from './month-start.js';
import { settingsOf, walletBalances } from './queries.js';
import { UNTRACKED } from './defaults.js';
import { duesOf, drawsCurrent, dueCategories, isCurrent } from './dues.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./projection.js').Row} Row */
/**
 * Budget résolu. legacy : ancien budget mensuel (`budget.set`), lu comme un budget qui se répète chaque mois, à partir
 * du mois de budget (selon le début du mois réglé) où il a été fixé.
 * @typedef {{ id: string, category: string, amount: number, currency: string, start: string, end: string, repeat: boolean, legacy: boolean, from?: string|null }} Budget
 */
/** @typedef {{ start: string, end: string }} Span  dates « AAAA-MM-JJ », bornes comprises */
/**
 * Dépense payée : catégorie exacte, sa catégorie principale (top : elle-même si c'est une principale ; absente, la
 * dépense ne compte que pour sa catégorie exacte), montant entier positif, date, devise.
 * @typedef {{ id: string, categoryId: string, top?: string, amount: number, date: string, cur: string }} Spend
 */
/**
 * État d'un budget à une date : sa période en cours, dépensé, reste (négatif = dépassement).
 * @typedef {{ budget: Budget, window: Span, spent: number, remaining: number, over: boolean }} BudgetStatus
 */

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
/** @param {number} y @param {number} m mois 0…11 (peut déborder) @param {number} d */
function ymd(y, m, d) {
  const t = new Date(Date.UTC(y, m, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** @param {string} d */
const parts = d => [Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))];

/**
 * Mois de budget qui contient une date, selon la règle du début du mois (month-start.js : un jour de 1 à 28, « le 2e
 * lundi », « le dernier vendredi »…) : de son début au jour d'avant le début suivant.
 * @param {string} date @param {number|string} [monthStart]
 * @returns {Span}
 */
export const budgetMonth = (date, monthStart = 1) => monthSpan(date, monthStart);

/**
 * Fin du mois de budget en cours (raccourci « Fin du mois » de la feuille d'un budget).
 * @param {string} date @param {number} [monthStart]
 */
export const monthEnd = (date, monthStart = 1) => budgetMonth(date, monthStart).end;

/** Même jour, n mois plus tard (le jour de départ ne dépasse pas 28 ici). @param {string} date @param {number} n */
function addMonths(date, n) {
  const [y, m, d] = parts(date);
  return ymd(y, m + n, d);
}

/**
 * Une période d'un mois exactement (du 25 au 24, du 1er au 30…) : sa répétition suit les mois, pas un nombre de jours
 * (un mois de 30 jours suivi d'un mois de 31). Le jour de départ ne dépasse pas 28, comme le début du mois réglable.
 * @param {string} start @param {string} end
 */
export function isMonthly(start, end) {
  return Number(start.slice(8, 10)) <= 28 && end === shiftDay(addMonths(start, 1), -1);
}

/**
 * Période en cours d'un budget à une date, ou null s'il est fini (fin passée, sans répétition). Avant son début, c'est
 * sa première période. Qui se répète : la période suivante commence le lendemain de la fin, de même durée (un mois s'il
 * couvre exactement un mois, sinon le même nombre de jours) ; calculée à la lecture, sans rien enregistrer.
 * @param {{ start: string, end: string, repeat: boolean }} b
 * @param {string} date
 * @returns {Span|null}
 */
export function currentWindow(b, date) {
  if (date <= b.end) return { start: b.start, end: b.end };
  if (!b.repeat) return null;
  if (isMonthly(b.start, b.end)) {
    const [y0, m0] = parts(b.start), [y1, m1] = parts(date);
    let k = (y1 - y0) * 12 + (m1 - m0);
    while (k > 0 && addMonths(b.start, k) > date) k--;
    while (addMonths(b.start, k + 1) <= date) k++;
    const start = addMonths(b.start, k);
    return { start, end: shiftDay(addMonths(b.start, k + 1), -1) };
  }
  const len = daysBetween(b.start, b.end) + 1;
  const k = Math.floor(daysBetween(b.start, date) / len);
  const start = shiftDay(b.start, k * len);
  return { start, end: shiftDay(start, len - 1) };
}

/**
 * Une dépense compte-t-elle pour cette catégorie : la catégorie elle-même, ou sa principale (famille, 2026-11-11).
 * @param {Spend} x @param {string} category
 */
export const inFamily = (x, category) => x.categoryId === category || x.top === category;

/**
 * Dépensé dans une période : les opérations payées de la catégorie du budget — une principale avec ses
 * sous-catégories, une sous-catégorie seule — dans sa devise, entre les deux dates comprises.
 * @param {Spend[]} spends @param {{ category: string, currency: string }} b @param {Span} w
 */
export function spentIn(spends, b, w) {
  let n = 0;
  for (const x of spends) if (inFamily(x, b.category) && x.cur === b.currency && x.date >= w.start && x.date <= w.end) n += x.amount;
  return n;
}

/** Dépensé de la catégorie exacte seule (sans ses sous-catégories). @param {Spend[]} spends @param {{ category: string, currency: string }} b @param {Span} w */
export function ownSpentIn(spends, b, w) {
  let n = 0;
  for (const x of spends) if (x.categoryId === b.category && x.cur === b.currency && x.date >= w.start && x.date <= w.end) n += x.amount;
  return n;
}

/**
 * État d'un budget à une date, ou null s'il est fini.
 * @param {Budget} b @param {Spend[]} spends @param {string} date
 * @returns {BudgetStatus|null}
 */
export function budgetStatus(b, spends, date) {
  const w = currentWindow(b, date);
  if (!w) return null;
  const spent = spentIn(spends, b, w);
  const remaining = b.amount - spent;
  return { budget: b, window: w, spent, remaining, over: remaining < 0 };
}

/**
 * Budgets en cours (ceux qui ne sont pas finis, à venir compris), dans l'ordre reçu.
 * @param {Budget[]} budgets @param {Spend[]} spends @param {string} date
 * @returns {BudgetStatus[]}
 */
export function inProgress(budgets, spends, date) {
  /** @type {BudgetStatus[]} */
  const out = [];
  for (const b of budgets) { const st = budgetStatus(b, spends, date); if (st) out.push(st); }
  return out;
}

/**
 * Réservé : pour chaque budget en cours de cette devise, son montant moins ce qui y a déjà été dépensé, jamais moins
 * de zéro (un dépassement puise dans Disponible). Plusieurs budgets d'une même catégorie dont les périodes se recouvrent
 * (50 000 F ce mois et 100 000 F sur 3 mois, 2026-11-10) ne réservent pas deux fois : ce qu'on peut encore y dépenser
 * sans en dépasser aucun, c'est le plus petit de leurs restes.
 * Famille (2026-11-11) : parentOf donne la principale d'une sous-catégorie. Quand la principale a un budget, il couvre
 * déjà ses sous-catégories : la famille réserve le plus grand de « ce qui reste à la principale » et de « la somme de ce
 * qui reste à ses sous-catégories » (des budgets de sous-catégories plus gros que la principale réservent ce qu'ils
 * promettent ; jamais deux fois le même argent). Sans budget sur la principale, chaque sous-catégorie réserve le sien.
 * Échéances (D18, 2026-11-11) : dues = les échéances à payer qui font sortir de l'argent courant. Réservé = chacune une
 * fois, plus ce qu'on peut encore dépenser librement dans les budgets : chaque budget compte, sur son reste, ce qui y est
 * promis (les échéances qu'il comptera une fois confirmées à leur date : celles de sa catégorie, et de ses
 * sous-catégories pour une principale, dont la date tombe dans sa période) ; puis les règles d'avant (plus petit des
 * restes qui se recouvrent, famille). Confirmer une échéance à sa date retire la même somme de l'argent, de ce qui est
 * promis et du reste des budgets qui la comptent : Disponible ne bouge jamais.
 * @param {BudgetStatus[]} statuses @param {string} cur @param {(id: string) => string|null|undefined} [parentOf]
 * @param {{ kind: string, category: string|null, date: string, amount: number, currency: string }[]} [dues]
 */
export function reserved(statuses, cur, parentOf = () => null, dues = []) {
  const mine = statuses.filter(st => st.budget.currency === cur);
  // ce qui est promis dans chaque budget ; chaque échéance compte une fois dans le total
  /** @type {Map<BudgetStatus, number>} */
  const prom = new Map();
  let promised = 0;
  for (const d of dues) {
    if (d.currency !== cur) continue;
    promised += d.amount;
    if (d.kind !== 'expense' || !d.category) continue;
    for (const st of mine) {
      const c = st.budget.category;
      if ((d.category === c || parentOf(d.category) === c) && st.window.start <= d.date && d.date <= st.window.end) prom.set(st, (prom.get(st) || 0) + d.amount);
    }
  }
  // par famille (une principale et ses sous-catégories ; une catégorie seule est une famille d'une catégorie)
  /** @type {Map<string, BudgetStatus[]>} */
  const byFam = new Map();
  for (const st of mine) {
    const top = parentOf(st.budget.category) || st.budget.category;
    byFam.set(top, [...(byFam.get(top) || []), st]);
  }
  let free = 0;
  for (let [top, group] of byFam) {
    // par paquets de temps : ceux qui recouvrent la période qui finit le plus tôt, puis les suivants (deux périodes qui
    // ne se recouvrent pas s'additionnent) ; dans un paquet, le plus petit reste libre de chaque catégorie, puis la famille
    while (group.length) {
      const end = group.reduce((m, x) => (x.window.end < m ? x.window.end : m), group[0].window.end);
      const pack = group.filter(x => x.window.start <= end);
      /** @type {Map<string, number>} */
      const least = new Map();
      for (const x of pack) least.set(x.budget.category, Math.min(least.get(x.budget.category) ?? Infinity, Math.max(0, x.remaining - (prom.get(x) || 0))));
      const main = least.get(top);
      let subs = 0;
      for (const [id, v] of least) if (id !== top) subs += v;
      free += main === undefined ? subs : Math.max(main, subs);
      group = group.filter(x => x.window.start > end);
    }
  }
  return promised + free;
}

/** Disponible = argent des portefeuilles comptés dans le total − réservé (peut être négatif). @param {number} total @param {number} res */
export const available = (total, res) => total - res;

/** Budgets dépassés. @param {BudgetStatus[]} statuses */
export const overBudgets = statuses => statuses.filter(st => st.over);

/** Même durée : deux budgets d'un mois, ou le même nombre de jours. @param {{ start: string, end: string }} a @param {{ start: string, end: string }} b */
export function sameLength(a, b) {
  const ma = isMonthly(a.start, a.end), mb = isMonthly(b.start, b.end);
  return ma || mb ? ma && mb : daysBetween(a.start, a.end) === daysBetween(b.start, b.end);
}

/**
 * Deux budgets d'une même catégorie sont-ils en double à partir d'aujourd'hui : même durée et périodes qui se
 * recouvrent ? Plusieurs budgets par catégorie sont permis (revu le 2026-11-10 : 50 000 F ce mois et 100 000 F sur
 * 3 mois), pas deux de même durée en même temps. Un budget qui se répète couvre tout depuis son début ; un budget fini
 * ne gêne personne.
 * @param {{ start: string, end: string, repeat: boolean }} a @param {{ start: string, end: string, repeat: boolean }} b @param {string} today
 */
export function overlaps(a, b, today) {
  return sameLength(a, b) && meet(a, b, today);
}

/**
 * Deux budgets couvrent-ils un même jour à partir d'aujourd'hui (quelle que soit leur durée) ? Un budget qui se répète
 * couvre tout depuis son début. @param {{ start: string, end: string, repeat: boolean }} a
 * @param {{ start: string, end: string, repeat: boolean }} b @param {string} today
 */
export function meet(a, b, today) {
  const from = [a.start, b.start, today].sort()[2];
  const ea = a.repeat ? '9999-12-31' : a.end, eb = b.repeat ? '9999-12-31' : b.end;
  return from <= (ea < eb ? ea : eb);
}

/** Durée d'un budget en jours (une période). @param {{ start: string, end: string }} b */
export const lengthOf = b => daysBetween(b.start, b.end) + 1;

// --- lectures sur l'état projeté ---

/**
 * Ligne de la projection → budget résolu, ou null (ancien budget global : il n'y a plus de « budget principal »).
 * @param {Row} r @param {number} monthStart
 * @returns {Budget|null}
 */
export function budgetOfRow(r, monthStart) {
  if (r.start_on) {
    return { id: r.id, category: r.account_id, amount: r.amount, currency: r.currency, start: r.start_on, end: r.end_on, repeat: !!r.repeats, legacy: false, from: r.from_id ?? null };
  }
  if (!r.account_id) return null;
  const w = budgetMonth(r.valid_from, monthStart);
  return { id: r.id, category: r.account_id, amount: r.amount, currency: r.currency, start: w.start, end: w.end, repeat: true, legacy: true };
}

/**
 * Budgets (résolus) dont la catégorie existe encore, dans l'ordre choisi des catégories (D13), puis par début.
 * @param {State} s
 * @returns {Budget[]}
 */
export function budgetsOf(s) {
  const ms = settingsOf(s).monthStart;
  const order = expenseOrder(s);
  const rank = new Map(order.map((id, i) => [id, i]));
  /** @type {Budget[]} */
  const out = [];
  for (const r of s.budgets.values()) {
    const b = budgetOfRow(r, ms);
    const c = b && s.accounts.get(b.category);
    if (b && c && c.kind === 'expense' && !c.deleted_at) out.push(b);
  }
  return out.sort((a, b) => (rank.get(a.category) ?? order.length) - (rank.get(b.category) ?? order.length)
    || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || (a.id < b.id ? -1 : 1));
}

/**
 * Budgets terminés (D11, revu le 2026-11-10) : finis, qui ne se répètent pas, les plus récents d'abord, avec ce qu'ils
 * ont dépensé et s'ils ont déjà été reconduits.
 * @param {State} s @param {string} today @param {number} [max]
 */
export function finishedBudgets(s, today, max = 12) {
  const all = budgetsOf(s);
  const spends = spendsOf(s);
  const next = new Set(all.map(b => b.from).filter(Boolean));
  return all.filter(b => !b.repeat && !b.legacy && b.end < today)
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0)).slice(0, max)
    .map(b => ({ budget: b, spent: spentIn(spends, b, b), reconducted: next.has(b.id) }));
}

/**
 * Budgets terminés, une ligne par catégorie (D11, revu le 2026-11-12 : un budget refait chaque mois en ferait douze par
 * an) : combien, et le plus récent (ce qu'il a dépensé, reconduit ou non) ; la catégorie dont le dernier a fini le plus
 * tard d'abord. Seulement les catégories qui n'ont plus de budget (fini sans être reconduit, ou catégorie archivée ;
 * revu le 2026-11-13 : avec peu de budgets en cours, rien d'autre n'y menait) ; une catégorie qui a encore un budget,
 * en cours ou à venir, a son historique sur sa page, que sa ligne ouvre déjà. Tous comptent (pas de coupe).
 * @param {State} s @param {string} today
 * @returns {{ category: string, count: number, last: ReturnType<typeof finishedBudgets>[number] }[]}
 */
export function finishedGroups(s, today) {
  /** @type {Map<string, { category: string, count: number, last: ReturnType<typeof finishedBudgets>[number] }>} */
  const by = new Map();
  const live = new Set(budgetsOf(s).filter(b => b.repeat || b.end >= today).map(b => b.category));
  for (const x of finishedBudgets(s, today, Infinity)) {
    if (!s.accounts.get(x.budget.category)?.archived_at && live.has(x.budget.category)) continue;
    const g = by.get(x.budget.category);
    if (g) g.count++;
    else by.set(x.budget.category, { category: x.budget.category, count: 1, last: x });
  }
  return [...by.values()];
}

/**
 * Catégories de dépenses dans l'ordre choisi : chaque principale suivie de ses sous-catégories (comme les listes).
 * @param {State} s
 * @returns {string[]}
 */
export function expenseOrder(s) {
  /** @param {Row} a @param {Row} b */
  const bySort = (a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const cats = [...s.accounts.values()].filter(a => a.kind === 'expense' && !a.deleted_at).sort(bySort);
  return cats.filter(a => !a.parent_id).flatMap(p => [p.id, ...cats.filter(c => c.parent_id === p.id).map(c => c.id)]);
}

/** Un portefeuille d'argent courant : ni épargne, ni « hors du total » (le même argent que Disponible ; défini avec les échéances). */
export { isCurrent };

/**
 * Dépenses payées (les prévues et les annulées ne comptent pas), par catégorie exacte, **payées depuis l'argent
 * courant** (revu le 2026-11-10) : un budget découpe le même argent que Disponible. Une dépense payée depuis une
 * épargne (sur une réserve ou sur l'épargne libre) ou depuis un portefeuille hors du total ne compte dans aucun budget :
 * elle était prévue ailleurs (la réserve est son enveloppe), et la compter ferait « exploser » le budget de sa
 * catégorie et monter Disponible à tort (le reste du budget baisse alors que l'argent courant ne bouge pas).
 * @param {State} s
 * @returns {Spend[]}
 */
export function spendsOf(s) {
  /** @type {Spend[]} */
  const out = [];
  for (const e of s.entries.values()) {
    if (e.status !== 'posted' || e.kind !== 'expense') continue;
    const lines = /** @type {Row[]} */ ((s.byEntry.get(e.id) || []).map(pid => s.postings.get(pid)).filter(Boolean));
    const from = lines.map(p => s.accounts.get(p.account_id)).find(a => a?.kind === 'wallet');
    if (!isCurrent(from)) continue;
    for (const p of lines) {
      const c = s.accounts.get(p.account_id);
      if (c?.kind === 'expense') out.push({ id: e.id, categoryId: p.account_id, top: c.parent_id || p.account_id, amount: p.amount, date: e.occurred_on, cur: p.currency });
    }
  }
  return out;
}

/**
 * Argent courant des portefeuilles comptés dans le total (actifs, ni archivés, ni « hors du total », ni épargne : D17,
 * l'épargne n'est jamais dans Disponible) dans une devise.
 * @param {State} s @param {string} cur
 */
export function countedTotal(s, cur) {
  const bal = walletBalances(s);
  let n = 0;
  for (const a of s.accounts.values()) {
    if (a.kind === 'wallet' && !a.deleted_at && !a.archived_at && !a.off_total && !a.savings && a.currency === cur) n += bal[a.id] || 0;
  }
  return n;
}

/** La principale d'une catégorie de dépenses (null pour une principale). @param {State} s */
export const parentOfIn = s => (/** @type {string} */ id) => s.accounts.get(id)?.parent_id || null;

/**
 * Tout ce que montrent l'écran Budget et l'accueil, à une date : budgets en cours, réservé, total des portefeuilles
 * comptés (« X restent dans tes budgets, sur Y au total »), Disponible, dépassés (monnaie principale pour les totaux).
 * Échéances (D18) : dues, celles à payer jusqu'à la fin du mois de budget (retards compris) qui font sortir de l'argent
 * courant ; toPay, leur total ; inBudgets, le reste de Réservé (ce qui reste dans les budgets, échéances à part) ;
 * Disponible = total − Réservé.
 * @param {State} s @param {string} today
 */
export function budgetReport(s, today) {
  const st = settingsOf(s);
  const cur = st.currency;
  const list = inProgress(budgetsOf(s), spendsOf(s), today);
  const month = budgetMonth(today, st.monthStart);
  const dues = duesOf(s, today, month.end).filter(d => d.currency === cur && drawsCurrent(s, d));
  // un budget qui commence après ce mois ne retient rien encore (2026-11-13) : il se paiera avec l'argent de ses mois,
  // comme une échéance ne compte que jusqu'à la fin du mois ; il reste dans la liste (« à partir du … »)
  const res = reserved(list.filter(x => x.window.start <= month.end), cur, parentOfIn(s), dues);
  const total = countedTotal(s, cur);
  const toPay = dues.reduce((n, d) => n + d.amount, 0);
  return { cur, list, reserved: res, total, available: available(total, res), over: overBudgets(list), dues, toPay, inBudgets: res - toPay };
}

/** « Plus que d'habitude » : une dépense du mois au-delà de cette fois sa moyenne (bout de la barre de l'habitude). */
export const UNUSUAL = 1.5;

/**
 * Budgets par catégorie (revu le 2026-11-10 : l'écran Budget suit l'arbre des catégories) : chaque catégorie de dépenses
 * dans l'ordre rangé (principale puis ses sous-catégories), sauf « Non suivi » et les archivées sans budget en cours.
 * - budgets : ses budgets en cours, le plus court d'abord ; main : celui qu'on montre, une seule ligne par catégorie
 *   (un dépassé d'abord, le plus court s'ils le sont tous les deux, sinon le plus court) ;
 * - spent : dépensé ce mois de budget (une principale avec ses sous-catégories, comme son budget ; monnaie principale,
 *   argent courant seulement) ; average : moyenne par mois des 3 mois d'avant, sur les mois que l'historique couvre (un
 *   journal commencé il y a 6 semaines ne divise pas par 3) ; habit, unusual : sur ces mêmes chiffres de famille ;
 * - own : les mêmes chiffres pour la catégorie exacte seule (une principale sans ses sous-catégories ; ce que la
 *   catégorie a elle-même, pour les totaux sans double compte et la Marge) ; covered : quelque chose la tient — un budget
 *   en cours (le sien, ou celui de sa principale : byParent), ou une échéance du mois (due, D18) ;
 * - habit : elle a une habitude — des dépenses dans au moins 2 des 3 mois d'avant (un historique trop court ne dit
 *   rien) ; sans budget, l'écran Budget montre alors la barre de l'habitude (trait = moyenne, bout = UNUSUAL × moyenne) ;
 * - unusual : sans budget, avec une habitude, elle dépense déjà nettement plus ce mois (plus de UNUSUAL × sa moyenne) ;
 * - problem : un budget dépassé, ou unusual (toujours montré sur l'écran Budget).
 * @param {State} s @param {string} today
 */
export function categoryBoard(s, today) {
  const st = settingsOf(s);
  const cur = st.currency;
  const spends = spendsOf(s);
  const list = inProgress(budgetsOf(s), spends, today);
  const month = budgetMonth(today, st.monthStart);
  // les 3 mois de budget d'avant : combien chaque catégorie y a dépensé, et dans combien de ces mois
  const months = [];
  for (let m = budgetMonth(shiftDay(month.start, -1), st.monthStart); months.length < 3; m = budgetMonth(shiftDay(m.start, -1), st.monthStart)) months.push(m);
  const first = spends.reduce((d, x) => (x.cur === cur && x.date < d ? x.date : d), '9999-12-31');
  const covered = months.filter(m => m.end >= first).length;
  // par catégorie exacte (own) et par famille (une principale reçoit aussi ce de ses sous-catégories)
  /** @type {Map<string, Set<number>>} */
  const seen = new Map(), seenOwn = new Map();
  /** @type {Map<string, number>} */
  const sum = new Map(), sumOwn = new Map();
  const add = (/** @type {Map<string, Set<number>>} */ sn, /** @type {Map<string, number>} */ sm, /** @type {string} */ k, /** @type {number} */ i, /** @type {number} */ a) => {
    sn.set(k, (sn.get(k) || new Set()).add(i));
    sm.set(k, (sm.get(k) || 0) + a);
  };
  for (const x of spends) {
    if (x.cur !== cur) continue;
    const i = months.findIndex(m => x.date >= m.start && x.date <= m.end);
    if (i < 0) continue;
    add(seenOwn, sumOwn, x.categoryId, i, x.amount);
    add(seen, sum, x.categoryId, i, x.amount);
    if (x.top && x.top !== x.categoryId) add(seen, sum, x.top, i, x.amount);
  }
  /** @typedef {{ spent: number, average: number, habit: boolean }} Figures */
  /** @type {{ id: string, parent: string|null, budgets: BudgetStatus[], main: BudgetStatus|null, spent: number, average: number, habit: boolean, unusual: boolean, problem: boolean, own: Figures, covered: boolean, byParent: boolean, due: boolean }[]} */
  const out = [];
  // couverte : un budget commencé, dans la monnaie principale (un budget à venir ou d'une autre devise ne couvre rien)
  const budgeted = new Set(list.filter(x => x.budget.currency === cur && x.window.start <= today).map(x => x.budget.category));
  // tenues par une échéance du mois (D18) : ni habitude dans la Marge, ni « Plus que d'habitude »
  const dueCats = dueCategories(s, month.start, month.end);
  for (const id of expenseOrder(s)) {
    if (id === UNTRACKED.expense) continue;
    const a = /** @type {Row} */ (s.accounts.get(id));
    // le plus court d'abord : c'est lui qui a un problème le premier (il ne dépasse jamais le plus long)
    const budgets = list.filter(x => x.budget.category === id)
      .sort((p, q) => lengthOf(p.window) - lengthOf(q.window) || (p.window.end < q.window.end ? -1 : p.window.end > q.window.end ? 1 : 0));
    if (a.archived_at && !budgets.length) continue;
    const spent = spentIn(spends, { category: id, currency: cur }, month);
    const average = covered ? Math.round((sum.get(id) || 0) / covered) : 0;
    const habit = average > 0 && (seen.get(id)?.size || 0) >= 2;
    const ownAvg = covered ? Math.round((sumOwn.get(id) || 0) / covered) : 0;
    const own = { spent: ownSpentIn(spends, { category: id, currency: cur }, month), average: ownAvg, habit: ownAvg > 0 && (seenOwn.get(id)?.size || 0) >= 2 };
    const byParent = !!a.parent_id && budgeted.has(a.parent_id), due = dueCats.has(id);
    const isCovered = budgets.length > 0 || byParent || due;
    // « Plus que d'habitude » : seulement hors de tout budget (une sous-catégorie dans le budget de sa principale non)
    const unusual = !isCovered && habit && spent > average * UNUSUAL;
    out.push({ id, parent: a.parent_id || null, budgets, main: budgets.find(x => x.over) || budgets[0] || null, spent, average, habit, unusual,
      problem: unusual || budgets.some(x => x.over), own, covered: isCovered, byParent, due });
  }
  return out;
}

/**
 * Ce que tes habitudes vont encore prendre ce mois (2026-11-10, « Marge » = Disponible moins ça) : pour chaque catégorie
 * qu'aucun budget en cours ne couvre (ni le sien, ni celui de sa principale) et qui a une habitude, sa moyenne moins ce
 * qu'elle a déjà dépensé ce mois, jamais moins de zéro (ce qui dépasse l'habitude est déjà sorti de Disponible). Chaque
 * catégorie compte pour elle-même (own : une principale sans ses sous-catégories), jamais deux fois. Sans habitude,
 * rien : on ne peut pas la deviner. Une estimation, pas un fait.
 * @param {{ covered?: boolean, budgets: unknown[], own?: { habit: boolean, average: number, spent: number }, habit: boolean, average: number, spent: number }[]} board
 */
export const habitsLeft = board => board.reduce((n, x) => {
  const f = x.own || x;
  return n + (!(x.covered ?? x.budgets.length > 0) && f.habit ? Math.max(0, f.average - f.spent) : 0);
}, 0);

/**
 * Budgets de sous-catégories plus gros que celui de leur principale (2026-11-11 : on prévient, on ne refuse pas). Pour
 * chaque budget en cours d'une principale, la somme des budgets en cours de ses sous-catégories de même durée qui
 * couvrent un même jour (des durées différentes ne se comparent pas). La première principale concernée par cette
 * catégorie (elle-même ou sa principale), ou null.
 * @param {State} s @param {string} today @param {string} categoryId
 * @returns {{ main: Budget, subs: number }|null}
 */
export function subsOver(s, today, categoryId) {
  const top = s.accounts.get(categoryId)?.parent_id || categoryId;
  const all = budgetsOf(s).filter(b => currentWindow(b, today));
  for (const m of all.filter(b => b.category === top)) {
    const subs = all.filter(b => b.category !== top && s.accounts.get(b.category)?.parent_id === top && b.currency === m.currency && sameLength(b, m) && meet(b, m, today))
      .reduce((n, b) => n + b.amount, 0);
    if (subs > m.amount) return { main: m, subs };
  }
  return null;
}

/**
 * Ce que fait une dépense qu'on saisit (2026-11-11, D4) : sur le budget le plus court de sa catégorie qui couvre sa date
 * (celui que montre Plan), sinon sur celui de sa principale (famille, 2026-11-11), sinon, à défaut de budget, sur son
 * habitude du mois, ou à défaut sur celle de sa principale (sa famille, 2026-11-12 : le même ordre que les budgets ;
 * name dit alors la principale) — le bout de la barre de l'habitude,
 * UNUSUAL × la moyenne). ratio : la part remplie après elle (0..1, plafonnée) ; over : elle fait dépasser (ou allume
 * « Plus que d'habitude ») ; by : de combien on dépasse alors. null : rien à dire (pas d'argent courant, autre devise,
 * ni budget ni habitude, ou une habitude hors du mois en cours). except : l'opération qu'on modifie (son ancien montant
 * ne compte plus). Montant 0 : où en est la catégorie avant la dépense. @param {State} s @param {string} today
 * @param {{ categoryId: string, accountId: string, amount: number, date: string, except?: string|null }} d
 * @returns {{ kind: 'budget'|'habit', ratio: number, over: boolean, by: number, name: string }|null}
 */
export function spendImpact(s, today, { categoryId, accountId, amount, date, except = null }) {
  const a = s.accounts.get(accountId);
  if (!isCurrent(a) || !categoryId || !(amount >= 0)) return null;
  const cur = /** @type {Row} */ (a).currency;
  const spends = spendsOf(s).filter(x => x.id !== except);
  const parent = s.accounts.get(categoryId)?.parent_id;
  const name = /** @type {Row} */ (s.accounts.get(categoryId))?.name || '';
  const mine = coveringBudget(s, categoryId, cur, date);
  if (mine) {
    const { b, w } = mine;
    const spent = spentIn(spends, b, w) + amount;
    const bname = /** @type {Row} */ (s.accounts.get(b.category))?.name || name;
    return { kind: 'budget', ratio: Math.min(1, spent / b.amount), over: spent > b.amount, by: Math.max(0, spent - b.amount), name: bname };
  }
  const st = settingsOf(s);
  const month = budgetMonth(today, st.monthStart);
  if (cur !== st.currency || date < month.start || date > month.end) return null;
  const board = categoryBoard(s, today);
  const x = board.find(y => y.id === categoryId);
  if (!x || x.budgets.length) return null;
  // son habitude, sinon celle de sa principale (sa famille), comme pour les budgets
  const p = !x.habit && parent ? board.find(y => y.id === parent) : null;
  const h = x.habit ? x : p && !p.budgets.length && p.habit ? p : null;
  if (!h) return null;
  const limit = h.average * UNUSUAL;
  const spent = spentIn(spends, { category: h.id, currency: cur }, month) + amount;
  const hname = h === x ? name : /** @type {Row} */ (s.accounts.get(h.id))?.name || name;
  return { kind: 'habit', ratio: Math.min(1, spent / limit), over: spent > limit, by: Math.max(0, spent - limit), name: hname };
}

/**
 * Le budget où compte une dépense à une date (2026-11-13) : le plus court de sa catégorie en cours à cette date, sinon
 * celui de sa principale — le même que la jauge de la saisie (spendImpact). @param {State} s @param {string} categoryId
 * @param {string} cur @param {string} date @returns {{ b: Budget, w: Span }|null}
 */
export function coveringBudget(s, categoryId, cur, date) {
  const covering = (/** @type {string} */ cat) => budgetsOf(s).filter(b => b.category === cat && b.currency === cur)
    .map(b => { const w = currentWindow(b, date); return w && w.start <= date && date <= w.end ? { b, w } : null; })
    .filter(x => !!x)
    .sort((p, q) => lengthOf(/** @type {any} */ (p).w) - lengthOf(/** @type {any} */ (q).w));
  const parent = s.accounts.get(categoryId)?.parent_id;
  let mine = covering(categoryId);
  if (!mine.length && parent) mine = covering(parent);
  return /** @type {{ b: Budget, w: Span }|null} */ (mine[0] || null);
}

