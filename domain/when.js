// « Quand ? » d'une échéance (D18 revu le 2026-11-18) : la logique sans écran. Les jours touchés dans le calendrier et leur
// répétition deviennent une règle du domaine { start, days (décalages en jours), every, interval, by? } ; l'app propose la
// répétition d'après les jours ; une phrase en clair dit le résultat. Un seul jour chaque mois se lit aussi « le 2e
// lundi », « le dernier vendredi », « le dernier jour » (by, 2026-11-25).
import { shortDate } from './format.js';
import { nthDate, addDays, addMonthsClamped, EVERY_MONTHS } from './dues.js';
import { monthSpan, byOptions, weekRank } from './month-start.js';

export const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const dt = (/** @type {string} */ s) => new Date(`${s}T12:00:00`);
export const between = (/** @type {string} */ a, /** @type {string} */ b) => Math.round((dt(b).getTime() - dt(a).getTime()) / 864e5);
const monday = (/** @type {string} */ s) => addDays(s, -((dt(s).getDay() + 6) % 7));
export const list = (/** @type {string[]} */ a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} et ${a[a.length - 1]}`);
export const dayNum = (/** @type {string} */ s) => { const n = Number(s.slice(8, 10)); return n === 1 ? '1er' : String(n); };

/** @typedef {import('./month-start.js').By} By */
/** by : la lecture d'un seul jour chaque mois (absente : le quantième). @typedef {{ start: string, days: number[], every: string|null, interval: number, by?: By|null }} When */

/**
 * Le jour d'une règle par mois d'un seul jour, en mots : « 14 », « 1er », « 2e lundi », « dernier vendredi », « dernier
 * jour » (le 31 sans autre lecture tombe chaque dernier jour du mois : il se dit ainsi ; pas un 31 parmi plusieurs jours,
 * décalé du premier : dayNum).
 * @param {string} d @param {By|null} [by]
 */
export function monthDay(d, by = null) {
  const wd = DAYS[dt(d).getDay()], r = weekRank(d);
  if (by === 'weekday') return `${r === 1 ? '1er' : `${r}e`} ${wd}`;
  if (by === 'lastweekday') return `dernier ${wd}`;
  if (by === 'lastday' || d.slice(8, 10) === '31') return 'dernier jour';
  return dayNum(d);
}

/** Un 31 : son quantième et « le dernier jour » donnent les mêmes dates. @param {string} d */
const is31 = d => d.slice(8, 10) === '31';
/**
 * Les lectures d'un seul jour chaque mois, à choisir dans « Quand ? » : le quantième d'abord (le choix par défaut), puis
 * celles que la date permet (byOptions) ; un 31 n'a qu'un « Le dernier jour » (son quantième).
 * @param {string} d @returns {{ by: By|null, label: string }[]}
 */
export const byChoices = d => [null, ...byOptions(d).filter(b => !(b === 'lastday' && is31(d)))].map(by => ({ by, label: `Le ${monthDay(d, by)}` }));
/** Deux lectures d'une même date qui donnent les mêmes dates (un 31 : le quantième et « le dernier jour »). @param {string} d @param {By|null|undefined} a @param {By|null|undefined} b */
export const sameBy = (d, a, b) => (a || null) === (b || null) || (is31(d) && [a || null, b || null].every(x => x === null || x === 'lastday'));

/** Tous les 28 à 31 jours : ça glisse d'un mois à l'autre (et tous les 30 jours saute un février) ; « Quand ? » propose chaque mois. @param {{ every: string|null, interval?: number }} w */
export const nearlyMonthly = w => w.every === 'day' && (w.interval || 1) >= 28 && (w.interval || 1) <= 31;

/** Les dates d'une règle, dans l'ordre (au plus n). @param {When} w @param {number} n */
export function datesOfWhen(w, n) {
  const out = [];
  for (let k = 0; k < n; k++) { const d = nthDate(/** @type {any} */ (w), k); if (!d) break; out.push(d); }
  return out;
}

/**
 * La phrase d'une règle : « Chaque lundi, mardi et vendredi », « Le 5 et le 20 de chaque mois », « Le 2e lundi de chaque
 * mois », « Tous les 2 mois, le dernier jour », « Une fois, le 19 nov », « 5 dates : 23, 24, 27 nov, 1 et 3 déc »,
 * « Tous les 23 jours ».
 * @param {When} w
 */
export function whenPhrase(w) {
  const n = w.interval || 1;
  const anchors = [w.start, ...(w.days || []).map(x => addDays(w.start, x))];
  if (w.every === 'week') {
    const names = anchors.map(a => DAYS[dt(a).getDay()]);
    return n > 1 ? `Toutes les ${n} semaines, ${list(names.map(x => `le ${x}`))}` : `Chaque ${list(names)}`;
  }
  if (w.every === 'month') {
    const ds = anchors.length === 1 ? [monthDay(w.start, w.by)] : anchors.map(dayNum);
    const les = list(ds.map(x => `le ${x}`));
    return n > 1 ? `Tous les ${n} mois, ${les}` : `${les.charAt(0).toUpperCase()}${les.slice(1)} de chaque mois`;
  }
  if (w.every === 'year') return `${n > 1 ? `Tous les ${n} ans` : 'Chaque année'}, le ${list(anchors.map(a => shortDate(a)))}`;
  if (w.every === 'day') return n > 1 ? `Tous les ${n} jours` : 'Chaque jour';
  if (anchors.length === 1) return `Une fois, le ${shortDate(anchors[0])}`;
  return `${anchors.length} dates : ${list(anchors.map(a => shortDate(a)))}`;
}

/**
 * Les jours d'une règle à montrer touchés dans le calendrier, à partir de from (une règle commencée) : des dates choisies,
 * celles qui restent ; chaque semaine (ou tous les N jours), les dates d'une période depuis la prochaine (vendredi, puis
 * lundi et mardi : le même motif) ; chaque mois ou année, la première période qui vient en entier.
 * @param {When} w @param {string} from
 */
export function selectedOf(w, from) {
  const m = (w.days || []).length + 1;
  const n = w.interval || 1;
  for (let k = 0; k < 100000; k++) {
    const d = nthDate(/** @type {any} */ (w), k);
    if (!d) return [];
    if (d < from) continue;
    if (!w.every) return datesOfWhen(w, m).filter(x => x >= from);
    if (w.every === 'week' || w.every === 'day') {
      const stop = addDays(d, w.every === 'week' ? 7 * n : n);
      const out = [];
      for (let j = k; j < k + m; j++) { const x = nthDate(/** @type {any} */ (w), j); if (x && x < stop) out.push(x); }
      return out;
    }
    const p = Math.ceil(k / m);
    return Array.from({ length: m }, (_, i) => /** @type {string} */ (nthDate(/** @type {any} */ (w), p * m + i)));
  }
  return [];
}

/**
 * Ce que l'app propose d'après les jours touchés (D18 revu) : un jour → une fois ; des jours sur moins d'une semaine →
 * chaque semaine ; le même jour du mois sur plusieurs mois → chaque mois ; les mêmes jours chaque semaine → chaque
 * semaine ; sinon → une fois (des dates choisies).
 * @param {string[]} ds (triés)
 */
export function guessRepeat(ds) {
  if (!ds.length) return null;
  if (ds.length === 1) return 'once';
  if (between(ds[0], ds[ds.length - 1]) < 7) return 'week';
  if (new Set(ds.map(d => d.slice(8))).size === 1) return 'month';
  const weeks = new Map();
  for (const d of ds) { const w = monday(d); weeks.set(w, [...(weeks.get(w) || []), dt(d).getDay()]); }
  const sets = [...weeks.values()].map(a => a.sort().join(','));
  if (weeks.size > 1 && new Set(sets).size === 1) return 'week';
  return 'once';
}

/**
 * Les jours touchés et la répétition → la règle, ou ce qui ne va pas. Pour une répétition, les jours d'un motif qui se
 * répète déjà (les mêmes jours chaque semaine, le même jour chaque mois) se réduisent à la première période.
 * Un seul jour chaque mois (ou tous les N mois) garde la lecture choisie (by), si sa date la permet.
 * @param {string[]} ds (triés) @param {string} rep @param {number} n @param {By|null} [by] @returns {{ when?: When, error?: string }}
 */
export function whenOf(ds, rep, n, by = null) {
  if (!ds.length) return { error: 'Touche au moins un jour.' };
  let pick = ds;
  if (rep === 'week') pick = ds.filter(d => between(ds[0], d) < 7 * n); // une période depuis le premier jour : le motif
  if (rep === 'month' && new Set(ds.map(d => d.slice(8))).size === 1) pick = [ds[0]];
  if (rep === 'year' && new Set(ds.map(d => d.slice(5))).size === 1) pick = [ds[0]];
  const start = pick[0];
  const days = pick.slice(1).map(d => between(start, d));
  const every = rep === 'once' ? null : rep;
  if (every) {
    const next = every === 'week' ? addDays(start, 7 * n) : every === 'day' ? addDays(start, n) : addMonthsClamped(start, (every === 'year' ? 12 : 1) * n);
    if (days.length && addDays(start, days[days.length - 1]) >= next) {
      return { error: every === 'week' ? 'Pour chaque semaine, touche des jours d’une même semaine.' : every === 'month' ? 'Pour chaque mois, touche des jours d’un même mois.' : 'Ces jours sont trop loin les uns des autres pour cette répétition.' };
    }
  }
  const keep = every === 'month' && !days.length && by && byOptions(start).includes(by);
  return { when: { start, days, every, interval: every ? n : 1, ...(keep ? { by } : {}) } };
}

/** Sur combien d'années fallsEachMonth regarde : le calendrier (années bissextiles, jours de la semaine) a fait un tour. */
const EACH_MONTH_YEARS = 28;

/**
 * Une règle tombe-t-elle dans chaque mois de Bougette (2026-11-25, avec l'utilisateur) ? Un mois de Bougette va d'un
 * début de mois (settings.monthStart) au jour d'avant le suivant. Une dépense récurrente qui n'y tombe pas (tous les 2,
 * 3 ou 6 mois, chaque année, tous les N jours ou toutes les N semaines quand un mois peut passer entre deux fois) se
 * prépare dans l'épargne, en dépense prévue. Chaque mois y tombe par définition, « le 2e lundi » ou « le dernier jour »
 * compris (un mois de Bougette réglé sur un jour de la semaine peut sauter une date : ce n'est pas un rythme plus lent) ; une seule fois ou des dates choisies ne
 * sont pas un rythme : true (rien à préparer). Sinon, chaque mois de Bougette depuis celui de la première date, sur
 * 28 ans, doit avoir au moins une date (tous les 30 jours saute un février de temps en temps : il n'y tombe pas).
 * @param {{ start: string, days?: number[], every: string|null, interval?: number, by?: By|null }} w @param {number|string} [monthStart]
 */
export function fallsEachMonth(w, monthStart = 1) {
  if (!w.every) return true;
  const n = w.interval || 1;
  const months = (/** @type {Record<string, number>} */ (EVERY_MONTHS))[w.every] || 0;
  if (months === 1 && n === 1) return true;
  // moins de dates par tour que de mois dans le tour : un mois au moins reste vide
  if (months && (w.days || []).length + 1 < months * n) return false;
  const rule = /** @type {any} */ (w);
  const until = addMonthsClamped(w.start, 12 * EACH_MONTH_YEARS);
  let k = 0;
  let d = nthDate(rule, 0);
  for (let m = monthSpan(w.start, monthStart); m.end <= until; m = monthSpan(addDays(m.end, 1), monthStart)) {
    while (d && d < m.start) d = nthDate(rule, ++k);
    if (!d || d > m.end) return false;
  }
  return true;
}

/**
 * Une dépense programmée laisse-t-elle des mois sans elle (2026-11-26, avec l'utilisateur ; la règle de la question « La
 * préparer ? ») ? Une seule fois au-delà de la fin du mois prochain (la rentrée de septembre, créée en novembre : tout
 * tomberait sur un seul mois) ; ou un rythme qui ne tombe pas dans chaque mois de Bougette (fallsEachMonth : tous les 2, 3
 * ou 6 mois, chaque année, tous les 45 jours…). Plusieurs jours par période (le 1 mars et le 1 sept, chaque année) ou des
 * dates choisies : non (une seule date par période), une dépense prévue n'a qu'une date, elle reste une opération programmée.
 * @param {{ start: string, days?: number[], every: string|null, interval?: number, by?: By|null }} w @param {string} today
 * @param {number|string} [monthStart] settings.monthStart
 */
export function leavesEmptyMonths(w, today, monthStart = 1) {
  if (w.days?.length) return false;
  if (!w.every) return w.start > monthSpan(addDays(monthSpan(today, monthStart).end, 1), monthStart).end;
  return !fallsEachMonth(w, monthStart);
}

/**
 * Une catégorie que l'historique montre mensuelle (le loyer, un abonnement) : notée au moins 3 des 4 derniers mois, au
 * plus 2 fois par mois en moyenne. « Chaque mois » est alors pré-coché pour un seul jour touché.
 * @param {{ date: string, categoryId?: string|null, planned?: boolean }[]} txs @param {string|null} category @param {string} today
 */
export function monthlyHabit(txs, category, today) {
  if (!category) return false;
  const months = [1, 2, 3, 4].map(k => addMonthsClamped(`${today.slice(0, 7)}-01`, -k).slice(0, 7));
  /** @type {Map<string, number>} */
  const per = new Map();
  for (const t of txs) {
    if (t.planned || t.categoryId !== category) continue;
    const m = t.date.slice(0, 7);
    if (months.includes(m)) per.set(m, (per.get(m) || 0) + 1);
  }
  const n = [...per.values()].reduce((a, b) => a + b, 0);
  return per.size >= 3 && n <= 2 * per.size;
}
