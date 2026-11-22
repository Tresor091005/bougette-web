// « Quand ? » d'une échéance (D18 revu le 2026-11-18) : la logique sans écran. Les jours touchés dans le calendrier et leur
// répétition deviennent une règle du domaine { start, days (décalages en jours), every, interval } ; l'app propose la
// répétition d'après les jours ; une phrase en clair dit le résultat.
import { shortDate } from './format.js';
import { nthDate, addDays, addMonthsClamped, datesOf } from './dues.js';

export const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const dt = (/** @type {string} */ s) => new Date(`${s}T12:00:00`);
export const between = (/** @type {string} */ a, /** @type {string} */ b) => Math.round((dt(b).getTime() - dt(a).getTime()) / 864e5);
const monday = (/** @type {string} */ s) => addDays(s, -((dt(s).getDay() + 6) % 7));
export const list = (/** @type {string[]} */ a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} et ${a[a.length - 1]}`);
export const dayNum = (/** @type {string} */ s) => { const n = Number(s.slice(8, 10)); return n === 1 ? '1er' : String(n); };

/** @typedef {{ start: string, days: number[], every: string|null, interval: number }} When */

/** Les dates d'une règle, dans l'ordre (au plus n). @param {When} w @param {number} n */
export function datesOfWhen(w, n) {
  const out = [];
  for (let k = 0; k < n; k++) { const d = nthDate(/** @type {any} */ (w), k); if (!d) break; out.push(d); }
  return out;
}

/**
 * La phrase d'une règle : « Chaque lundi, mardi et vendredi », « Le 5 et le 20 de chaque mois », « Une fois, le 19 nov »,
 * « 5 dates : 23, 24, 27 nov, 1 et 3 déc », « Tous les 23 jours ».
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
    const ds = anchors.map(dayNum);
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
 * @param {string[]} ds (triés) @param {string} rep @param {number} n @returns {{ when?: When, error?: string }}
 */
export function whenOf(ds, rep, n) {
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
  return { when: { start, days, every, interval: every ? n : 1 } };
}


/**
 * Les jours où tombent d'autres échéances (étape 4, 2026-11-18) : un point sous ces jours dans « Quand ? », et leurs noms
 * quand on touche le jour. Date → les règles qui y tombent, de from à to ; sans les règles d'exclude (celle qu'on règle) ni les règles continuées par une
 * autre (leur suite les remplace).
 * @param {any[]} list (Schedule) @param {string[]} exclude @param {string} from @param {string} to
 * @returns {Map<string, any[]>}
 */
export function busyDates(list, exclude, from, to) {
  const skip = new Set([...exclude, ...list.map(x => x.from).filter(Boolean)]);
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const r of list) {
    if (skip.has(r.id)) continue;
    for (const { date } of datesOf(r, from, to)) if (!(r.skips || []).includes(date)) out.set(date, [...(out.get(date) || []), r]);
  }
  return out;
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
