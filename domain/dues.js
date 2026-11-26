// Échéances et opérations programmées (D18, décidé le 2026-11-11) : lectures pures sur l'état projeté.
// Une opération programmée est une règle (« Loyer, 35 000 F, le 1er de chaque mois ») ; une échéance est une de ses
// dates (ou une règle sans répétition, ou une ancienne opération « Prévue »). Les dates sont calculées, jamais stockées :
// une date est faite quand une opération la confirme (entries.schedule_id + due_on, non annulée) ou qu'elle est passée
// (« Passer »). Rien ne s'écrit tout seul. Aucune dépendance au DOM, au stockage ni à l'horloge (« aujourd'hui » est passé).
import { linesOf, isWallet } from './projection.js';
import { linesToMove } from './ledger.js';
import { reserveChain } from './reserves.js';
import { byMonth } from './month-start.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./projection.js').Row} Row */
/**
 * Règle résolue. every : null = une seule fois, sinon l'unité du rythme ; interval : tous les combien (1 = chaque ;
 * « tous les 23 jours » : every 'day', interval 23) ; end : dernière date permise ; times : nombre de fois ; stopped :
 * « Arrêter » (plus de dates à partir de ce jour) ; skips : dates passées ; reserve : la réserve qui paie (dépense) ou que
 * remplit (virement) ; from : la règle d'avant, coupée par une modification ; begins : ses dates ne comptent qu'à partir
 * de ce jour (une règle qui en continue une autre garde le jour d'ancrage et le compte des fois de la première date) ;
 * amounts : les fois au montant changé (date → montant), tenues par la première règle de l'échéance (adjustsOf) ; by : la
 * lecture d'une règle par mois (By ; null : le même quantième).
 * @typedef {{ id: string, kind: 'expense'|'income'|'transfer', amount: number, currency: string, wallet: string, to: string|null,
 *   category: string|null, note: string, start: string, every: Every|null, interval: number, end: string|null, times: number|null,
 *   reserve: string|null, stopped: string|null, skips: string[], from: string|null, begins: string|null, days: number[],
 *   amounts: Record<string, number>, by: By|null }} Schedule
 */
/**
 * La lecture d'une règle par mois d'un seul jour, tirée de sa première date (month-start.js) : 'weekday' « le 2e lundi »,
 * 'lastweekday' « le dernier vendredi », 'lastday' « le dernier jour » ; null : le même quantième, ramené au dernier
 * jour d'un mois plus court (le 31 : chaque dernier jour du mois).
 * @typedef {import('./month-start.js').By} By
 */
/**
 * Unité d'un rythme. 'quarter' et 'half' (« tous les 3 mois », « tous les 6 mois ») sont les rythmes d'avant le rythme
 * libre : encore lus (journaux déjà écrits), une règle résolue les donne en mois (scheduleOf).
 * @typedef {'day'|'week'|'month'|'year'|'quarter'|'half'} Every
 */
/**
 * Échéance à régler : une date d'une règle (schedule) ou une ancienne opération prévue (entry). late : passée sans
 * réponse ; paused : son portefeuille ou sa catégorie est archivé ou supprimé (en pause, une lecture) ; reserve : la
 * réserve ouverte qui la paie (ou qu'elle remplit), en suivant les réserves reconduites ; needsWallet : elle était payée
 * par une réserve qui est close sans suite (la prochaine fois se paie depuis un portefeuille courant, choisi en confirmant).
 * amount : ce qu'elle compte (le montant changé pour cette fois, sinon celui de la règle) ; ruleAmount : celui de la
 * règle ; adjusted : son montant a été changé pour cette fois seulement (2026-11-24).
 * @typedef {{ key: string, schedule: string|null, entry: string|null, date: string, kind: 'expense'|'income'|'transfer',
 *   amount: number, currency: string, wallet: string, to: string|null, category: string|null, note: string,
 *   reserve: string|null, needsWallet: boolean, late: boolean, paused: boolean, ruleAmount: number, adjusted: boolean }} Due
 */

/** Unités en mois (le jour et la semaine à part ; 'quarter' et 'half' : les anciens rythmes). */
export const EVERY_MONTHS = { month: 1, quarter: 3, half: 6, year: 12 };
/** Unités d'un rythme (D18, rythme libre : « tous les 23 jours », « toutes les 2 semaines », « tous les 2 mois »). @type {Every[]} */
export const EVERY = ['day', 'week', 'month', 'year'];
/** Tous les combien, au plus. */
export const MAX_INTERVAL = 999;

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
/** @param {string} d @param {number} n */
export function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** Le même jour, n mois plus tard ; le dernier jour d'un mois plus court (le 31 → le 28 ou le 29 février). @param {string} d @param {number} n */
export function addMonthsClamped(d, n) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1, day = Number(d.slice(8, 10));
  const first = new Date(Date.UTC(y, m + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(day, last))}`;
}

/**
 * La k-ième date d'une règle (0 = la première), toujours calculée depuis la première (pas de dérive d'un mois court
 * à l'autre : tous les 2 mois depuis le 31, c'est le 31 ou le dernier jour du mois), ou null au-delà de la seule date
 * d'une échéance seule. Une règle par mois lue autrement (by) : « le 2e lundi », « le dernier vendredi », « le dernier
 * jour » de chacun de ses mois.
 * @param {{ start: string, every: Every|null, interval?: number|null, days?: number[], by?: By|null }} r @param {number} k
 */
export function nthDate(r, k) {
  // plusieurs jours de départ (D18 revu le 2026-11-18) : la première date et ses décalages (days) ; le rang k parcourt
  // les jours d'une période, puis ceux de la suivante (les décalages tiennent dans une période : l'ordre est gardé)
  const offs = r.days || [];
  const m = offs.length + 1;
  if (!r.every) return k < m ? (k ? addDays(r.start, offs[k - 1]) : r.start) : null;
  const p = Math.floor(k / m), i = k % m;
  const n = r.interval || 1;
  const base = r.every === 'day' ? addDays(r.start, n * p) : r.every === 'week' ? addDays(r.start, 7 * n * p)
    : r.by ? byMonth(r.start, r.by, EVERY_MONTHS[r.every] * n * p) : addMonthsClamped(r.start, EVERY_MONTHS[r.every] * n * p);
  return i ? addDays(base, offs[i - 1]) : base;
}

/**
 * Dates d'une règle entre deux dates comprises, chacune avec son rang (0 = la première). Bornée par sa fin, son nombre
 * de fois, son arrêt et son début (begins : les rangs d'avant comptent mais ne sont pas à elle) ; pas par les dates
 * passées (c'est l'affaire de duesOf).
 * @param {{ start: string, every: Every|null, interval?: number|null, end: string|null, times: number|null, stopped: string|null, begins?: string|null }} r
 * @param {string} from @param {string} to
 * @returns {{ date: string, k: number }[]}
 */
export function datesOf(r, from, to) {
  /** @type {{ date: string, k: number }[]} */
  const out = [];
  for (let k = 0; k < 100000; k++) {
    if (r.times != null && k >= r.times) break;
    const date = nthDate(r, k);
    if (date === null || date > to) break;
    if (r.end && date > r.end) break;
    if (r.stopped && date >= r.stopped) break;
    if (date >= from && (!r.begins || date >= r.begins)) out.push({ date, k });
  }
  return out;
}
/** La date est-elle une date de la règle ? @param {Schedule} r @param {string} d */
export const isDateOf = (r, d) => datesOf(r, d, d).length === 1;

/** Les anciens rythmes, en mois. @type {Record<string, number>} */
const OLD_EVERY = { quarter: 3, half: 6 };
/** Ligne de la projection → règle résolue (un ancien rythme, trimestre ou semestre, est donné en mois). @param {Row} r @returns {Schedule} */
export function scheduleOf(r) {
  const old = OLD_EVERY[r.every] || 0;
  return {
    id: r.id, kind: r.kind, amount: r.amount, currency: r.currency, wallet: r.wallet_id, to: r.to_wallet_id ?? null,
    category: r.category_id ?? null, note: r.note || '', start: r.start_on, every: old ? 'month' : r.every ?? null,
    interval: r.every ? (old || 1) * (r.interval ?? 1) : 1, end: r.end_on ?? null,
    times: r.times ?? null, reserve: r.reserve_id ?? null, stopped: r.stopped_on ?? null, skips: r.skips ? JSON.parse(r.skips) : [],
    from: r.from_id ?? null, begins: r.begins_on ?? null, days: r.days ? JSON.parse(r.days) : [], amounts: r.amounts ? JSON.parse(r.amounts) : {},
    by: r.by_day ?? null,
  };
}
/** Toutes les règles, par première date. @param {State} s @returns {Schedule[]} */
export function schedulesOf(s) {
  return [...s.schedules.values()].map(scheduleOf).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || (a.id < b.id ? -1 : 1));
}
/** @param {State} s @param {string} id @returns {Schedule|null} */
export const scheduleById = (s, id) => { const r = s.schedules.get(id); return r ? scheduleOf(r) : null; };

/**
 * Les montants changés pour une seule fois (2026-11-24, avec l'utilisateur), lus pour chaque règle : ils sont gardés sur
 * la première règle de l'échéance, qui ne change pas quand on la modifie (une modification coupe la règle, D18) ; une fois
 * dont la date et la devise restent garde ainsi son montant ; la modification efface ceux d'une date qui disparaît ou
 * d'une devise qui change (withStaleAdjusts, commands.js). Les dates des règles d'une même échéance ne se recouvrent jamais.
 * @param {State} s @returns {Map<string, Record<string, number>>} règle → { date: montant } (absente : aucune)
 */
export function adjustsOf(s) {
  /** @type {Map<string, Record<string, number>>} */
  const out = new Map();
  for (const row of s.schedules.values()) {
    let root = row;
    const seen = new Set([row.id]);
    while (root.from_id && s.schedules.has(root.from_id) && !seen.has(root.from_id)) { root = /** @type {Row} */ (s.schedules.get(root.from_id)); seen.add(root.id); }
    if (root.amounts) out.set(row.id, JSON.parse(root.amounts));
  }
  return out;
}
/** Le montant changé d'une fois, ou null (celui de la règle). @param {State} s @param {Schedule} r @param {string} d */
export function adjustedOn(s, r, d) {
  const root = chainOf(s, r.id)[0];
  const n = root ? root.amounts[d] : undefined;
  return n == null ? null : n;
}

/** Dates confirmées : « règle@date » → l'opération (non annulée) qui la confirme. @param {State} s */
export function doneOf(s) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const e of s.entries.values()) if (e.schedule_id && e.due_on && e.status !== 'void') m.set(`${e.schedule_id}@${e.due_on}`, e.id);
  return m;
}
/** Une date est-elle encore à régler (ni confirmée, ni passée) ? @param {State} s @param {Schedule} r @param {string} d @param {Map<string, string>} [done] */
export const isPending = (s, r, d, done = doneOf(s)) => !r.skips.includes(d) && !done.has(`${r.id}@${d}`);

/** Compte absent, archivé ou supprimé. @param {State} s @param {string|null} id */
const gone = (s, id) => { const a = id ? s.accounts.get(id) : null; return !a || !!a.archived_at || !!a.deleted_at; };
/**
 * En pause (D18) : son portefeuille, son portefeuille d'arrivée ou sa catégorie est archivé ou supprimé. Une lecture :
 * rien n'est écrit, elle reprend si on les désarchive.
 * @param {State} s @param {{ kind: string, wallet: string, to: string|null, category: string|null }} r
 */
export function pausedOf(s, r) {
  if (gone(s, r.wallet)) return true;
  return r.kind === 'transfer' ? gone(s, r.to) : gone(s, r.category);
}

/**
 * La réserve ouverte qui paie (ou que remplit) une règle : la sienne, ou la dernière de ses reconduites (D17) ; null si
 * elles sont toutes closes (à reconduire).
 * @param {State} s @param {Schedule} r
 */
export function reserveFor(s, r) {
  if (!r.reserve) return null;
  const chain = reserveChain(s, r.reserve);
  const i = chain.findIndex(x => x.id === r.reserve);
  for (let j = Math.max(0, i); j < chain.length; j++) if (!chain[j].closed) return chain[j];
  return null;
}

/**
 * Échéances à régler jusqu'à une date (comprise), retards compris, dans l'ordre des dates : les dates des règles (depuis
 * leur première) ni confirmées ni passées, et les anciennes opérations prévues (D18 : des échéances d'une fois).
 * wallet : seulement celles qui touchent ce portefeuille (l'avenir d'une épargne, sans dérouler les autres).
 * @param {State} s @param {string} today @param {string} until @param {string|null} [wallet]
 * @returns {Due[]}
 */
export function duesOf(s, today, until, wallet = null) {
  const done = doneOf(s);
  const adj = adjustsOf(s);
  /** @type {Due[]} */
  const out = [];
  for (const r of schedulesOf(s)) {
    if (wallet && r.wallet !== wallet && r.to !== wallet) continue;
    const paused = pausedOf(s, r);
    const res = r.reserve ? reserveFor(s, r) : null;
    const m = adj.get(r.id) || {};
    for (const { date } of datesOf(r, r.start, until)) {
      if (!isPending(s, r, date, done)) continue;
      out.push({
        key: `${r.id}@${date}`, schedule: r.id, entry: null, date, kind: r.kind, amount: m[date] ?? r.amount, currency: r.currency, wallet: r.wallet,
        to: r.to, category: r.category, note: r.note, reserve: res ? res.id : null, needsWallet: !!r.reserve && !res && r.kind === 'expense',
        late: date < today, paused, ruleAmount: r.amount, adjusted: m[date] != null,
      });
    }
  }
  out.push(...plannedDues(s, today, until).filter(d => !wallet || d.wallet === wallet || d.to === wallet));
  return out.sort(byDate);
}

/** Par date, puis par clé. @param {{ date: string, key: string }} a @param {{ date: string, key: string }} b */
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.key < b.key ? -1 : 1);

/**
 * Anciennes opérations prévues (avant D18) jusqu'à une date : une échéance d'une fois chacune ; Confirmer les marque payées.
 * @param {State} s @param {string} today @param {string} until @returns {Due[]}
 */
function plannedDues(s, today, until) {
  /** @type {Due[]} */
  const out = [];
  for (const e of s.entries.values()) {
    if (e.status !== 'planned' || e.occurred_on > until) continue;
    const mv = linesToMove(e.kind, linesOf(s, e.id), x => isWallet(s, x));
    if (!mv) continue;
    const cur = s.accounts.get(mv.accountId)?.currency || '';
    const paused = pausedOf(s, { kind: e.kind, wallet: mv.accountId, to: mv.toAccountId ?? null, category: mv.categoryId ?? null });
    out.push({
      key: `entry:${e.id}`, schedule: null, entry: e.id, date: e.occurred_on, kind: /** @type {any} */ (e.kind), amount: mv.amount, currency: cur,
      wallet: mv.accountId, to: mv.toAccountId ?? null, category: mv.categoryId ?? null, note: e.note || '', reserve: null, needsWallet: false,
      late: e.occurred_on < today, paused, ruleAmount: mv.amount, adjusted: false,
    });
  }
  return out;
}

/** Un portefeuille d'argent courant : ni épargne, ni « hors du total » (le même argent que Disponible). @param {Row|undefined} a */
export const isCurrent = a => !!a && a.kind === 'wallet' && !a.savings && !a.off_total;

/**
 * Cette échéance fera-t-elle sortir de l'argent courant (D18) ? Oui pour une dépense depuis un portefeuille courant, ou
 * un virement d'un portefeuille courant vers une épargne ou un portefeuille hors du total ; aussi une dépense que payait
 * une réserve désormais close (elle se paiera depuis un portefeuille courant). Non pour une rentrée (jamais comptée
 * d'avance), un virement entre portefeuilles courants, une dépense payée par une réserve, ou une échéance en pause.
 * @param {State} s @param {Due} d
 */
export function drawsCurrent(s, d) {
  if (d.paused || d.kind === 'income') return false;
  const cur = (/** @type {string|null} */ id) => isCurrent(id ? s.accounts.get(id) : undefined);
  if (d.kind === 'expense') return d.needsWallet || (!d.reserve && cur(d.wallet));
  return cur(d.wallet) && !cur(d.to);
}

/**
 * Catégories tenues par une échéance pendant une période (D18 : la Marge ne les compte plus comme une habitude) : les
 * dépenses des règles qui ne sont pas en pause et qui ont une date dans la période (faite, passée ou à régler), et les
 * anciennes dépenses prévues de la période.
 * @param {State} s @param {string} from @param {string} to
 * @returns {Set<string>}
 */
export function dueCategories(s, from, to) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const r of schedulesOf(s)) {
    if (r.kind !== 'expense' || !r.category || pausedOf(s, r)) continue;
    if (datesOf(r, from, to).length) out.add(r.category);
  }
  for (const e of s.entries.values()) {
    if (e.status !== 'planned' || e.kind !== 'expense' || e.occurred_on < from || e.occurred_on > to) continue;
    const mv = linesToMove(e.kind, linesOf(s, e.id), x => isWallet(s, x));
    if (mv?.categoryId) out.add(mv.categoryId);
  }
  return out;
}

/**
 * La première date d'une règle à partir d'un jour qui est encore à régler, avec son rang, ou null (règle finie).
 * @param {State} s @param {Schedule} r @param {string} from
 */
export function nextPending(s, r, from) {
  const done = doneOf(s);
  for (let k = 0; k < 100000; k++) {
    if (r.times != null && k >= r.times) return null;
    const date = nthDate(r, k);
    if (date === null || (r.end && date > r.end) || (r.stopped && date >= r.stopped)) return null;
    if (date >= from && (!r.begins || date >= r.begins) && isPending(s, r, date, done)) return { date, k };
  }
  return null;
}

/**
 * La première date d'une règle strictement après un jour, ou null (règle finie). @param {Schedule} r @param {string} d
 */
export function dateAfter(r, d) {
  for (let k = 0; k < 100000; k++) {
    if (r.times != null && k >= r.times) return null;
    const date = nthDate(r, k);
    if (date === null || (r.end && date > r.end) || (r.stopped && date >= r.stopped)) return null;
    if (date > d && (!r.begins || date >= r.begins)) return date;
  }
  return null;
}
/** Les dates déjà réglées d'une règle (confirmées ou passées), triées. @param {State} s @param {Schedule} r @param {Map<string, string>} [done] */
export function handledDates(s, r, done = doneOf(s)) {
  const out = new Set(r.skips);
  for (const k of done.keys()) if (k.startsWith(`${r.id}@`)) out.add(k.slice(r.id.length + 1));
  return [...out].sort();
}

/**
 * Le rang de la première date d'une règle à partir d'un jour (sans regarder begins : le compte des fois part de la
 * première date) ; le nombre de fois quand il n'y en a plus. @param {Schedule} r @param {string} d
 */
export function indexAt(r, d) {
  for (let k = 0; k < 100000; k++) {
    if (r.times != null && k >= r.times) return r.times;
    const date = nthDate(r, k);
    if (date === null || date >= d) return k;
  }
  return 100000;
}

/**
 * Une fois d'une échéance telle que l'écran la montre (D18) : state 'late' (passée sans réponse), 'today', 'soon' (à
 * venir), 'done' (confirmée : entry, l'opération, son montant et paidOn, sa date), 'skipped' (passée) ; rank / times :
 * « 3 sur 4 », comptés sur toute l'échéance (ses règles successives), quand elle se fait en un nombre de fois ;
 * planned / plannedCur : le montant prévu pour cette fois (celui de sa règle, ou celui changé pour elle) et sa devise (une
 * fois réglée avec un autre montant montre l'écart, revu le 2026-11-12) ; pour une fois réglée, amount et currency sont
 * ceux de son opération.
 * @typedef {Due & { state: 'late'|'today'|'soon'|'done'|'skipped', rank: number|null, times: number|null, paidOn: string|null, planned: number, plannedCur: string }} DueView
 */
/**
 * Une échéance dans la liste de Budget (D18, revu le 2026-11-11) : son étape en cours (DueView) ; head : la règle la
 * plus récente de sa suite, celle qu'on modifie (null pour une ancienne opération prévue) ; lateCount : ses fois en retard.
 * @typedef {DueView & { head: string|null, lateCount: number }} DueItem
 */

/**
 * Les règles d'une même échéance (D18) : une modification coupe une règle et une nouvelle la continue (from) ; pour la
 * personne, c'est la même échéance. De la plus ancienne à la plus récente (la tête, celle qu'on modifie).
 * @param {State} s @param {string} id (une règle de la suite) @returns {Schedule[]}
 */
export function chainOf(s, id) {
  const all = schedulesOf(s);
  const byId = new Map(all.map(r => [r.id, r]));
  /** @type {Map<string, Schedule>} */
  const next = new Map();
  for (const r of all) if (r.from) next.set(r.from, r);
  let first = byId.get(id);
  if (!first) return [];
  const seen = new Set([first.id]);
  while (first.from && byId.has(first.from) && !seen.has(first.from)) { first = /** @type {Schedule} */ (byId.get(first.from)); seen.add(first.id); }
  const out = [first];
  for (let r = next.get(first.id); r && !out.includes(r); r = next.get(r.id)) out.push(r);
  return out;
}
/** La tête d'une échéance : la règle la plus récente de sa suite. @param {State} s @param {string} id */
export const headOf = (s, id) => { const c = chainOf(s, id); return c.length ? c[c.length - 1].id : id; };
/** La racine d'une échéance : sa première règle (elle ne change pas quand on la modifie). @param {State} s @param {string} id */
export const rootOf = (s, id) => { const c = chainOf(s, id); return c.length ? c[0].id : id; };

/**
 * Les dates d'une suite de règles dans l'ordre, chacune avec sa règle, son rang k dans la règle et son rang i dans la
 * suite (1 = la première). Une règle qui en continue une autre ne donne que ses dates à elle (begins). Sans fin pour
 * une règle qui répète sans fin : on s'arrête de lire.
 * @param {Schedule[]} chain @returns {Generator<{ r: Schedule, k: number, date: string, i: number }>}
 */
function* chainDates(chain) {
  let i = 0;
  for (const r of chain) {
    for (let k = 0; k < 100000; k++) {
      if (r.times != null && k >= r.times) break;
      const date = nthDate(r, k);
      if (date === null || (r.end && date > r.end) || (r.stopped && date >= r.stopped)) break;
      if (r.begins && date < r.begins) continue;
      yield { r, k, date, i: ++i };
    }
  }
}
/** Le nombre de fois d'une échéance qui se fait en un nombre de fois (sa tête a times), sinon null. @param {Schedule[]} chain */
function chainTotal(chain) {
  if (chain[chain.length - 1].times == null) return null;
  let n = 0;
  for (const _ of chainDates(chain)) n++;
  return n;
}
/** « En N fois » d'une échéance, compté sur toutes ses règles ; null sans nombre de fois. @param {State} s @param {string} id */
export const timesOf = (s, id) => { const c = chainOf(s, id); return c.length ? chainTotal(c) : null; };
/** Le nombre de dates à elle d'une règle qui a une fin (nombre de fois, date, arrêt ; begins compris). @param {Schedule} r */
export function ownCount(r) {
  let n = 0;
  for (const _ of chainDates([r])) n++;
  return n;
}

/**
 * Où part une règle qui continue une échéance à un nouveau rythme depuis `from` (sa prochaine date) : de `from`, sauf
 * si `from` a été raccourcie (l'ancienne allait par mois ou par ans : le 31 → le 28 février) et que la nouvelle va aussi
 * par mois ou par ans — alors d'une date d'avant, au nouveau rythme, qui a le jour d'ancrage (le 31 reste le 31 là où
 * il existe), et ses dates ne comptent qu'à partir de `from` (begins). Une règle par jours ou par semaines n'a pas de
 * jour d'ancrage : la nouvelle part de `from`. Une règle par mois lue autrement que par son quantième (by, l'ancienne
 * ou la nouvelle) n'est jamais raccourcie : la nouvelle part de `from`.
 * @param {string} anchor (la première date de l'ancienne) @param {string} from @param {Every} every @param {number} interval
 * @param {Every|null} oldEvery (le rythme de l'ancienne) @param {boolean} [by] (l'une ou l'autre a une lecture By)
 * @returns {{ start: string, begins: string|null }}
 */
export function continueAt(anchor, from, every, interval, oldEvery, by = false) {
  const months = /** @type {Record<string, number>} */ (EVERY_MONTHS)[every];
  const shortened = !!(oldEvery && /** @type {Record<string, number>} */ (EVERY_MONTHS)[oldEvery]) && from.slice(8) !== anchor.slice(8);
  if (!months || !shortened || by) return { start: from, begins: null };
  const step = months * (interval || 1);
  for (let j = 1; j <= 48; j++) {
    const at = addMonthsClamped(`${from.slice(0, 8)}01`, -step * j);
    const start = `${at.slice(0, 8)}${anchor.slice(8)}`;
    if (addMonthsClamped(start, 0) === start) return { start, begins: from };
  }
  return { start: from, begins: null };
}

/**
 * Une date d'une règle telle que l'écran la montre.
 * @param {State} s @param {Schedule} r @param {string} date @param {string} today @param {Map<string, string>} done
 * @param {{ paused: boolean, res: { id: string }|null, amounts: Record<string, number> }} c (amounts : les montants changés, adjustsOf)
 * @param {number|null} rank @param {number|null} times
 * @returns {DueView}
 */
function viewOf(s, r, date, today, done, c, rank, times) {
  const eid = done.get(`${r.id}@${date}`) || null;
  const skipped = r.skips.includes(date);
  const a = c.amounts[date];
  const planned = a ?? r.amount;
  let amount = planned, currency = r.currency, paidOn = null;
  if (eid) {
    const e = s.entries.get(eid);
    const mv = e ? linesToMove(e.kind, linesOf(s, e.id), x => isWallet(s, x)) : null;
    if (mv) { amount = mv.amount; currency = s.accounts.get(mv.accountId)?.currency || r.currency; }
    paidOn = e?.occurred_on || null;
  }
  return {
    key: `${r.id}@${date}`, schedule: r.id, entry: eid, date, kind: r.kind, amount, currency, planned, plannedCur: r.currency, wallet: r.wallet, to: r.to,
    category: r.category, note: r.note, reserve: c.res ? c.res.id : null, needsWallet: !!r.reserve && !c.res && r.kind === 'expense',
    late: !eid && !skipped && date < today, paused: c.paused,
    state: eid ? 'done' : skipped ? 'skipped' : date < today ? 'late' : date === today ? 'today' : 'soon', rank, times, paidOn,
    ruleAmount: r.amount, adjusted: a != null,
  };
}
/** @param {State} s @param {Schedule} r @param {Map<string, Record<string, number>>} adj */
const contextOf = (s, r, adj) => ({ paused: pausedOf(s, r), res: r.reserve ? reserveFor(s, r) : null, amounts: adj.get(r.id) || {} });

/**
 * Les échéances à régler, une ligne chacune (D18, revu le 2026-11-11) : une opération programmée (ses règles
 * successives comprises) ou une ancienne opération prévue, avec son étape en cours — la première fois qui reste à
 * régler : on ne parle pas de la suivante tant qu'elle ne l'est pas. Celles qui n'ont plus rien à régler n'y sont pas.
 * Retards d'abord (les plus anciens), puis le jour, puis par date, quel que soit le mois.
 * @param {State} s @param {string} today @returns {DueItem[]}
 */
export function dueItems(s, today) {
  const done = doneOf(s);
  const all = schedulesOf(s);
  const continued = new Set(all.map(r => r.from).filter(Boolean));
  const adj = adjustsOf(s);
  /** @type {DueItem[]} */
  const out = [];
  for (const head of all) {
    if (continued.has(head.id)) continue;
    const chain = chainOf(s, head.id);
    let first = null, late = 0;
    for (const x of chainDates(chain)) {
      if (!isPending(s, x.r, x.date, done)) continue;
      if (!first) first = x;
      if (x.date < today) late++;
      else break;
    }
    if (!first) continue;
    const total = chainTotal(chain);
    out.push({ ...viewOf(s, first.r, first.date, today, done, contextOf(s, first.r, adj), total != null ? first.i : null, total), head: head.id, lateCount: late });
  }
  for (const d of plannedDues(s, today, '9999-12-31')) {
    out.push({ ...d, state: d.date < today ? 'late' : d.date === today ? 'today' : 'soon', rank: null, times: null, paidOn: null, planned: d.amount, plannedCur: d.currency, head: null, lateCount: d.date < today ? 1 : 0 });
  }
  return out.sort(byDate);
}

/**
 * Les dates permises pour confirmer une fois (D18, revu le 2026-11-12) : au plus tard aujourd'hui, et pas avant la date
 * de la fois d'avant de son échéance (la chronologie tient ; une fois d'avant encore à venir, payée d'avance, borne à
 * aujourd'hui) ; la première, pas avant le jour où l'échéance a été créée. Une ancienne opération prévue : pas avant le
 * jour où elle a été notée. Un retard se date donc du jour où il était dû.
 * @param {State} s @param {string} today @param {{ schedule: string|null, entry: string|null, date: string }} d
 * @returns {{ min: string|null, max: string }}
 */
export function confirmRange(s, today, d) {
  const cap = (/** @type {string|null} */ x) => (x && x > today ? today : x || null);
  // le jour de création (une date UTC) ne passe jamais après la fois elle-même : elle se date toujours de son jour
  const created = (/** @type {any} */ at) => { const c = at ? String(at).slice(0, 10) : null; return c && c < d.date ? c : d.date; };
  if (!d.schedule) return { min: cap(created(d.entry ? s.entries.get(d.entry)?.created_at : null)), max: today };
  const chain = chainOf(s, d.schedule);
  if (!chain.length) return { min: null, max: today };
  let prev = null;
  for (const x of chainDates(chain)) {
    if (x.date >= d.date) break;
    prev = x.date;
  }
  return { min: cap(prev || created(s.schedules.get(chain[0].id)?.created_at)), max: today };
}
/**
 * La prochaine fois d'une échéance : la première encore à régler à partir d'aujourd'hui (la seule qui se confirme
 * d'avance ; les retards, dans n'importe quel ordre), ou null. @param {State} s @param {string} id @param {string} today
 */
export function nextOpenDate(s, id, today) {
  const done = doneOf(s);
  for (const x of chainDates(chainOf(s, id))) if (x.date >= today && isPending(s, x.r, x.date, done)) return x.date;
  return null;
}
/** Une fois de cette échéance est-elle déjà réglée (confirmée ou passée) ? Son type ne change plus. @param {State} s @param {string} id */
export function settledIn(s, id) {
  const done = doneOf(s);
  return chainOf(s, id).some(r => handledDates(s, r, done).length > 0);
}

/**
 * Arrêter l'effacerait-il (2026-11-13, D18) ? Oui quand rien n'y est réglé (ni confirmé, ni passé) et qu'aucune date
 * n'est en retard : elle n'a pas d'histoire à garder (créée par erreur, ou pas encore commencée).
 * @param {State} s @param {string} id @param {string} today
 */
export function stopErases(s, id, today) {
  if (settledIn(s, id)) return false;
  const done = doneOf(s);
  return !chainOf(s, id).some(r => datesOf(r, r.start, addDays(today, -1)).some(o => isPending(s, r, o.date, done)));
}

/**
 * Les fois d'une échéance (D18, revu le 2026-11-11), pour passer de l'une à l'autre comme les périodes du Journal :
 * les dates de toutes ses règles dans l'ordre, chacune avec son état. past : au plus ce nombre de fois d'avant
 * aujourd'hui (les retards toujours) ; ahead : ce nombre de fois après aujourd'hui.
 * @param {State} s @param {string} today @param {string} id (une règle de la suite) @param {{ past?: number, ahead?: number }} [o]
 * @returns {DueView[]}
 */
export function occurrencesOf(s, today, id, { past = 24, ahead = 6 } = {}) {
  const chain = chainOf(s, id);
  if (!chain.length) return [];
  const done = doneOf(s);
  const total = chainTotal(chain);
  const adj = adjustsOf(s);
  const ctx = new Map(chain.map(r => [r.id, contextOf(s, r, adj)]));
  /** @type {DueView[]} */
  const out = [];
  let after = 0;
  for (const x of chainDates(chain)) {
    if (x.date > today && ++after > ahead) break;
    out.push(viewOf(s, x.r, x.date, today, done, /** @type {any} */ (ctx.get(x.r.id)), total != null ? x.i : null, total));
  }
  const cut = out.filter(v => v.date < today).length - past;
  return out.filter((v, j) => v.date >= today || j >= cut || v.state === 'late');
}

/**
 * Une échéance terminée (D18, 2026-11-12) : plus rien à régler ni à venir — finie (ses dates sont toutes réglées) ou
 * arrêtée sans retard. head : sa règle la plus récente (sa page) ; last : sa dernière date (réglée), null si elle n'en a
 * jamais eu ; endedOn : last, sinon le jour de sa coupe (pour les ranger) ; paidCount / paid : ses fois confirmées et leur
 * total dans sa devise ; mixed : une fois payée dans une autre devise (pas de total) ; skipped : ses fois passées.
 * @typedef {{ head: string, kind: 'expense'|'income'|'transfer', note: string, category: string|null, to: string|null,
 *   wallet: string, currency: string, last: string|null, endedOn: string, stopped: boolean, paidCount: number, paid: number,
 *   mixed: boolean, skipped: number }} EndedDue
 */
/**
 * Les échéances terminées, les plus récentes d'abord (« Échéances terminées » de Budget, en lecture seule) : leurs
 * règles successives lues ensemble. Une règle qui répète sans fin n'en fait jamais partie.
 * @param {State} s @param {string} today @returns {EndedDue[]}
 */
export function endedDues(s, today) {
  const done = doneOf(s);
  const all = schedulesOf(s);
  const continued = new Set(all.map(r => r.from).filter(Boolean));
  const none = { paused: false, res: null, amounts: {} };
  /** @type {EndedDue[]} */
  const out = [];
  for (const head of all) {
    if (continued.has(head.id)) continue;
    if (head.every && head.times == null && !head.end && !head.stopped) continue;
    let open = false, last = null, paidCount = 0, paid = 0, skipped = 0, mixed = false;
    for (const x of chainDates(chainOf(s, head.id))) {
      if (isPending(s, x.r, x.date, done)) { open = true; break; }
      last = x.date;
      if (x.r.skips.includes(x.date)) { skipped++; continue; }
      const v = viewOf(s, x.r, x.date, today, done, none, null, null);
      paidCount++;
      if (v.currency === head.currency) paid += v.amount;
      else mixed = true;
    }
    if (open || (!last && !head.stopped)) continue;
    out.push({ head: head.id, kind: head.kind, note: head.note, category: head.category, to: head.to, wallet: head.wallet,
      currency: head.currency, last, endedOn: /** @type {string} */ (last || head.stopped), stopped: !!head.stopped, paidCount, paid, mixed, skipped });
  }
  return out.sort((a, b) => (a.endedOn < b.endedOn ? 1 : a.endedOn > b.endedOn ? -1 : 0) || (a.head < b.head ? -1 : 1));
}

/**
 * La première date d'un rythme qui tombe aujourd'hui ou après, au même jour d'ancrage (le 31 reste le 31, le lundi reste
 * le lundi) ; sans regarder sa fin, son nombre de fois ni son arrêt. Une échéance d'une fois : aujourd'hui.
 * @param {{ start: string, every: Every|null, interval?: number|null, by?: By|null }} r @param {string} today
 */
export function firstDateFrom(r, today) {
  if (!r.every || r.start >= today) return r.every ? r.start : today;
  for (let k = 1; k < 1000000; k++) {
    const d = /** @type {string} */ (nthDate(r, k));
    if (d >= today) return d;
  }
  return today;
}

/**
 * Reconduire une échéance terminée (D18, 2026-11-13) : les valeurs de départ d'une nouvelle échéance, indépendante, prises
 * de sa règle la plus récente — type, nom, montant, catégorie, portefeuilles, rythme ; première date : la première de
 * ce rythme à partir d'aujourd'hui (firstDateFrom), et après sa dernière date quand elle a été réglée d'avance (last) ;
 * pas de fin.
 * @param {Schedule} r @param {string} today @param {string|null} [last]
 */
export function renewalOf(r, today, last = null) {
  const from = r.every && last && last >= today ? addDays(last, 1) : today;
  return {
    kind: r.kind, amount: r.amount, accountId: r.wallet, toAccountId: r.kind === 'transfer' ? r.to : null,
    categoryId: r.kind === 'transfer' ? null : r.category, note: r.note, start: firstDateFrom(r, from),
    every: r.every, interval: r.every ? r.interval : 1, ...(r.every && r.by ? { by: r.by } : {}),
  };
}

/** Combien de fois à venir on compare au plus, une à une, entre deux échéances qui ne finissent jamais. */
const TWIN_LOOK = 60;
/**
 * Ce qui reste d'une règle à partir d'un jour, pour la comparer à une autre : ses premières dates (chacune « à régler »
 * ou non), son nombre de dates et sa dernière (null : elle ne finit jamais).
 * @param {State} s @param {Schedule} r @param {string} from @param {Map<string, string>} done
 */
function aheadOf(s, r, from, done) {
  const endless = !!r.every && r.times == null && !r.end && !r.stopped;
  /** @type {string[]} */
  const first = [];
  let n = 0, last = null;
  for (const x of chainDates([r])) {
    if (x.date < from) continue;
    if (endless && n >= TWIN_LOOK) break;
    if (n < TWIN_LOOK) first.push(`${x.date}${isPending(s, r, x.date, done) ? '' : '+'}`);
    n++;
    last = x.date;
  }
  return endless ? `${first.join(',')}|…` : `${first.join(',')}|${n}|${last}`;
}

/**
 * Les jumelles d'une échéance (D18, « Regrouper », décidé le 2026-11-20 avec l'utilisateur) : les autres échéances en
 * cours (têtes de leur suite, ni arrêtées, ni en pause, avec encore une date à régler, aucune avant une date réglée
 * d'avance) qui coïncident exactement avec
 * elle — même type, même portefeuille de départ, même destination (le portefeuille d'arrivée d'un virement ; la
 * catégorie d'une dépense ou d'une rentrée, sous-catégorie comprise ; pour une dépense, la même réserve qui la paie),
 * même devise, même calendrier (mêmes jours de départ, même rythme, même écart : les mêmes dates à partir d'aujourd'hui,
 * réglées d'avance aux mêmes) et même fin (les mêmes dernières dates, ou aucune). Le montant et le nom ne comptent pas.
 * Pour un virement, la réserve qu'il remplissait (une ancienne collecte) ne compte pas : regroupées, elles versent pour
 * toute l'épargne. Les plus anciennes d'abord (la première créée), sans elle-même.
 * @param {State} s @param {string} id (une règle de l'échéance) @param {string} today @returns {Schedule[]}
 */
export function twinsOf(s, id, today) {
  const head = scheduleById(s, headOf(s, id));
  const done = doneOf(s);
  // en cours : une date encore à régler à partir d'aujourd'hui, et aucune avant une date déjà réglée d'avance (Modifier
  // coupe après la dernière réglée, Arrêter à la première à régler : entre les deux, un montant se perdrait)
  // ni une fois à régler au montant changé (regroupée, elle ne prendrait pas la somme : un montant se perdrait)
  const adj = adjustsOf(s);
  const live = (/** @type {Schedule|null} */ r) => {
    if (!r || r.stopped || pausedOf(s, r)) return false;
    const m = adj.get(r.id);
    if (m && Object.keys(m).some(d => d >= today && isDateOf(r, d) && isPending(s, r, d, done))) return false;
    const next = nextPending(s, r, today);
    const ahead = handledDates(s, r, done).filter(d => d >= today).pop();
    return !!next && (!ahead || next.date > ahead);
  };
  if (!head || !live(head)) return [];
  const all = schedulesOf(s);
  const continued = new Set(all.map(r => r.from).filter(Boolean));
  const same = (/** @type {Schedule} */ a, /** @type {Schedule} */ b) => a.kind === b.kind && a.wallet === b.wallet && a.currency === b.currency
    && (a.kind === 'transfer' ? a.to === b.to : a.category === b.category) && (a.kind !== 'expense' || (a.reserve ?? null) === (b.reserve ?? null))
    && (a.every ?? null) === (b.every ?? null) && (a.every ? a.interval : 1) === (b.every ? b.interval : 1)
    && JSON.stringify(a.days || []) === JSON.stringify(b.days || []) && (a.by ?? null) === (b.by ?? null);
  const mine = aheadOf(s, head, today, done);
  return all.filter(r => r.id !== head.id && !continued.has(r.id) && live(r) && same(head, r) && aheadOf(s, r, today, done) === mine)
    .sort((a, b) => bornOf(s, a.id).localeCompare(bornOf(s, b.id)) || (a.id < b.id ? -1 : 1));
}
/** Le jour où une échéance a été créée (sa première règle). @param {State} s @param {string} id */
const bornOf = (s, id) => String(s.schedules.get(rootOf(s, id))?.created_at || '');

/**
 * Ce que regrouper changerait (D18, 2026-11-20) : des échéances jumelles (twinsOf) deviennent une seule, la plus ancienne
 * (son nom reste), qui prend la somme des montants à partir de la prochaine fois (une modification, D18) ; un virement
 * qui ne remplit pas une même réserve pour toutes ne remplit plus de réserve (il verse pour toute l'épargne). Les autres
 * s'arrêtent : leurs retards restent à régler. null : pas de jumelle.
 * @param {State} s @param {string} id @param {string} today
 * @returns {{ keep: Schedule, others: Schedule[], amount: number, changes: Record<string, any> }|null}
 */
export function mergeOf(s, id, today) {
  const twins = twinsOf(s, id, today);
  const head = scheduleById(s, headOf(s, id));
  if (!twins.length || !head) return null;
  const group = [head, ...twins].sort((a, b) => bornOf(s, a.id).localeCompare(bornOf(s, b.id)) || (a.id < b.id ? -1 : 1));
  const [keep, ...others] = group;
  const changes = mergeChanges(keep, others);
  return { keep, others, amount: changes.amount, changes };
}
/**
 * La modification de l'échéance gardée quand d'autres s'y ajoutent (Regrouper, ou « Ajouter au montant de … ? » à la
 * création) : la somme des montants ; un virement qui ne remplit pas la même réserve pour toutes n'en remplit plus.
 * @param {Schedule} keep @param {{ amount: number, reserve?: string|null }[]} added @returns {Record<string, any>}
 */
export function mergeChanges(keep, added) {
  /** @type {Record<string, any>} */
  const changes = { amount: added.reduce((n, x) => n + x.amount, keep.amount) };
  if (keep.kind === 'transfer' && keep.reserve && added.some(x => (x.reserve ?? null) !== keep.reserve)) changes.reserve = null;
  return changes;
}
