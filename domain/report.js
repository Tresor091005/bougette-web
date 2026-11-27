// Rapports (2026-11-27, avec l'utilisateur : reproduit de Money Lover) : les lectures pures derrière les écrans de
// src/screens/report.js — entrées et sorties d'une période, totaux par catégorie principale, sous-périodes (semaines,
// mois, années), cumul jour par jour et moyenne des périodes d'avant. Aucune dépendance au DOM, au magasin ni à l'horloge :
// les écrans passent les opérations (moves()), la monnaie, le portefeuille et la fonction qui donne la catégorie
// principale (topOf).
import { daysBetween, shiftDay } from './pace.js';
import { period, shiftWindow, parse, shortDate } from './format.js';

/** @typedef {{ start: string, end: string }} Span  dates « AAAA-MM-JJ », bornes comprises */
/** @typedef {{ cur: string, curOf: (t: any) => string, acc?: string|null, cat?: string|null, top?: (id: string) => string }} Scope
 * cur : la devise comptée (les autres ne s'additionnent pas) ; curOf : la devise d'une opération ; acc : un portefeuille ;
 * cat : une catégorie principale (avec ses sous-catégories) ; top : la catégorie principale d'une catégorie. */

/** Nombre de jours d'une période. @param {Span} s */
export const spanDays = s => daysBetween(s.start, s.end) + 1;

/** Une opération compte-t-elle ? Ni annulée, ni prévue, dans la devise, et dans le portefeuille s'il y en a un. @param {any} t @param {Scope} sc */
export function counted(t, sc) {
  if (t.void || t.planned || sc.curOf(t) !== sc.cur) return false;
  return !sc.acc || t.accountId === sc.acc || t.toAccountId === sc.acc;
}
const inSpan = (/** @type {any} */ t, /** @type {Span} */ s) => t.date >= s.start && t.date <= s.end;
const topOfCat = (/** @type {Scope} */ sc, /** @type {string|null|undefined} */ id) => (id ? (sc.top ? sc.top(id) : id) : null);

/**
 * Entrées, sorties et net d'une période. Un virement n'est ni une entrée ni une sortie (moved : la somme déplacée), sauf
 * avec un portefeuille : ce qui y entre, ce qui en sort (comme le Journal). Avec une catégorie : ses opérations seulement
 * (sous-catégories comprises), jamais de virement.
 * @param {any[]} list @param {Span} span @param {Scope} sc
 */
export function flows(list, span, sc) {
  let inc = 0, out = 0, moved = 0;
  for (const t of list) {
    if (!inSpan(t, span) || !counted(t, sc)) continue;
    if (sc.cat && (t.type === 'transfer' || topOfCat(sc, t.categoryId) !== sc.cat)) continue;
    if (t.type === 'income') inc += t.amount;
    else if (t.type === 'expense') out += t.amount;
    else if (t.type === 'transfer') {
      if (sc.acc) { if (t.toAccountId === sc.acc) inc += t.amount; if (t.accountId === sc.acc) out += t.amount; } else moved += t.amount;
    }
  }
  return { inc, out, net: inc - out, moved };
}

/**
 * La somme des virements d'une période (ce qui change de portefeuille : ni une entrée ni une sortie) ; avec un
 * portefeuille, ceux qui y entrent ou en sortent.
 * @param {any[]} list @param {Span} span @param {Scope} sc
 */
export function transferred(list, span, sc) {
  return list.reduce((s, t) => (t.type === 'transfer' && inSpan(t, span) && counted(t, sc) ? s + t.amount : s), 0);
}

/**
 * Les totaux par catégorie principale d'un type (expense ou income), les plus gros d'abord ; id null : sans catégorie.
 * @param {any[]} list @param {Span} span @param {Scope} sc @param {'expense'|'income'} type
 * @returns {{ rows: { id: string|null, amount: number }[], total: number }}
 */
export function byCategory(list, span, sc, type) {
  const m = new Map();
  let total = 0;
  for (const t of list) {
    if (t.type !== type || !inSpan(t, span) || !counted(t, sc)) continue;
    const id = topOfCat(sc, t.categoryId);
    m.set(id, (m.get(id) || 0) + t.amount);
    total += t.amount;
  }
  const rows = [...m].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount || String(a.id).localeCompare(String(b.id)));
  return { rows, total };
}

/**
 * Des pourcents entiers qui font toujours 100 (plus fort reste) ; tout à zéro si le total est nul.
 * @param {number[]} values
 */
export function percents(values) {
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return values.map(() => 0);
  const raw = values.map(v => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

/**
 * Le total d'un type jour par jour : un montant par jour de la période (le premier jour d'abord).
 * @param {any[]} list @param {Span} span @param {Scope} sc @param {'expense'|'income'} type
 */
export function dailySums(list, span, sc, type) {
  const a = Array(spanDays(span)).fill(0);
  for (const t of list) {
    if (t.type !== type || !inSpan(t, span) || !counted(t, sc)) continue;
    if (sc.cat && topOfCat(sc, t.categoryId) !== sc.cat) continue;
    a[daysBetween(span.start, t.date)] += t.amount;
  }
  return a;
}

/** Le cumul d'une suite (les n premiers jours). @param {number[]} a @param {number} [n] */
export function cumulate(a, n = a.length) {
  const out = [];
  let s = 0;
  for (let i = 0; i < Math.min(n, a.length); i++) out.push((s += a[i]));
  return out;
}

/**
 * Les périodes d'avant, de même échelle, la plus proche d'abord : un mois, une semaine… ; une période libre se décale
 * de sa durée ; « Tout » n'en a pas.
 * @param {{ unit: string, start: string|null, end: string|null }} w @param {number} k @param {number} [ms] le jour de début du mois
 * @returns {Span[]}
 */
export function previousSpans(w, k, ms = 1) {
  if (!w.start || !w.end || w.unit === 'all') return [];
  const out = [];
  if (w.unit === 'custom') {
    const n = spanDays({ start: w.start, end: w.end });
    let end = shiftDay(w.start, -1);
    for (let i = 0; i < k; i++) { const start = shiftDay(end, -(n - 1)); out.push({ start, end }); end = shiftDay(start, -1); }
    return out;
  }
  let cur = /** @type {any} */ (w);
  for (let i = 0; i < k; i++) { cur = shiftWindow(cur, -1, ms); out.push({ start: cur.start, end: cur.end }); }
  return out;
}

/**
 * La moyenne de courbes cumulées, jour par jour sur `length` jours ; une courbe plus courte garde sa dernière valeur
 * (un mois de 28 jours face à un de 31). Arrondie à l'unité.
 * @param {number[][]} curves @param {number} length
 */
export function averageCurve(curves, length) {
  if (!curves.length) return [];
  return Array.from({ length }, (_, i) => Math.round(curves.reduce((s, c) => s + (c.length ? c[Math.min(i, c.length - 1)] : 0), 0) / curves.length));
}

/**
 * La période contre la moyenne des périodes d'avant (« Comparé à la moyenne des 3 mois ») : le cumul jour par jour
 * jusqu'à aujourd'hui, la courbe moyenne sur toute la période, et la moyenne des totaux. Seules comptent les périodes
 * d'avant qui touchent l'historique (finissent après la première opération) ; rien à comparer, ou un seul jour : null.
 * @param {{ list: any[], span: Span, prev: Span[], sc: Scope, type: 'expense'|'income', today: string, first: string }} o
 * @returns {{ n: number, now: number[], avg: number[], avgTotal: number, upto: number }|null}
 */
export function compare({ list, span, prev, sc, type, today, first }) {
  const used = prev.filter(p => p.end >= first);
  const n = spanDays(span);
  if (!used.length || n < 2) return null;
  const upto = today < span.start ? 0 : Math.min(n, daysBetween(span.start, today) + 1);
  const now = cumulate(dailySums(list, span, sc, type), upto);
  const curves = used.map(p => cumulate(dailySums(list, p, sc, type)));
  const avg = averageCurve(curves, n);
  const avgTotal = Math.round(curves.reduce((s, c) => s + (c.length ? c[c.length - 1] : 0), 0) / curves.length);
  return { n: used.length, now, avg, avgTotal, upto };
}

/**
 * La moyenne par jour : le total sur les jours écoulés (jusqu'à aujourd'hui pour une période en cours), au moins un.
 * @param {number} total @param {Span} span @param {string} today
 */
export function perDay(total, span, today) {
  const days = today < span.start ? 1 : Math.max(1, Math.min(spanDays(span), daysBetween(span.start, today) + 1));
  return Math.round(total / days);
}

const wd = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const mon = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const monLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);
const rangeOf = (/** @type {string} */ a, /** @type {string} */ b) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);

/**
 * Les sous-périodes d'une période, pour les barres et les listes : des jours jusqu'à une semaine, des semaines (lundi →
 * dimanche, coupées aux bords de la période) jusqu'à deux mois, des mois jusqu'à environ deux ans, puis des années.
 * label : pour une liste (« 2 nov – 8 nov », « Novembre 2026 ») ; short : sous une barre (« 02/11 », « nov. », « 2026 »).
 * @param {Span} span @param {number} [ms] le jour de début du mois
 * @returns {{ start: string, end: string, label: string, short: string }[]}
 */
export function subPeriods(span, ms = 1) {
  const n = spanDays(span);
  const out = [];
  const clip = (/** @type {string} */ a, /** @type {string} */ b) => ({ start: a < span.start ? span.start : a, end: b > span.end ? span.end : b });
  if (n > 800) {
    for (let y = parse(span.start).getFullYear(); y <= parse(span.end).getFullYear(); y++) {
      const c = clip(`${y}-01-01`, `${y}-12-31`);
      out.push({ ...c, label: String(y), short: String(y) });
    }
  } else if (n > 62) {
    for (let ref = span.start; ref <= span.end;) {
      const p = period(ref, ms);
      const c = clip(p.start, p.end);
      const named = parse(ms === 1 ? p.start : p.end);
      const whole = c.start === p.start && c.end === p.end;
      out.push({ ...c, label: whole ? (ms === 1 ? cap(monLong.format(named)) : rangeOf(c.start, c.end)) : rangeOf(c.start, c.end), short: mon.format(named) });
      ref = shiftDay(p.end, 1);
    }
  } else if (n > 7) {
    const dow = (/** @type {string} */ d) => (parse(d).getDay() + 6) % 7;
    for (let a = shiftDay(span.start, -dow(span.start)); a <= span.end; a = shiftDay(a, 7)) {
      const c = clip(a, shiftDay(a, 6));
      const d = parse(c.start);
      out.push({ ...c, label: rangeOf(c.start, c.end), short: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` });
    }
  } else {
    for (let d = span.start; d <= span.end; d = shiftDay(d, 1)) out.push({ start: d, end: d, label: cap(wd.format(parse(d)).replace('.', '')) + ' ' + shortDate(d), short: wd.format(parse(d)).replace('.', '') });
  }
  return out;
}

/**
 * L'axe d'un graphique en barres : un pas rond tel que le plus haut tienne en 3 pas, puis ce qui monte (hi) et ce qui
 * descend (lo) en multiples du pas ; jamais 0 des deux côtés.
 * @param {number} maxUp le plus haut vers le haut @param {number} maxDown le plus haut vers le bas
 */
export function axisFor(maxUp, maxDown) {
  const m = Math.max(maxUp, maxDown);
  if (m <= 0) return { step: 1, hi: 1, lo: 0 };
  const raw = m / 3, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(k => k * p).find(s => s >= raw) || 10 * p;
  return { step, hi: Math.ceil(maxUp / step) * step, lo: Math.ceil(maxDown / step) * step };
}
