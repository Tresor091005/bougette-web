// Rythme du mois (accueil, D3 / D10) : le fil du mois (jusqu'où tient l'argent), dépenses jour par jour, bocaux des budgets,
// ordre d'usage des catégories (saisie, D4). Fonctions pures : aucune dépendance au DOM, au stockage ni à l'horloge.

/** @typedef {{ start: string, end: string, days: number }} Period  dates « AAAA-MM-JJ », bornes comprises */
/** @typedef {{ type: string, amount: number, date: string, planned?: boolean, categoryId?: string|null, cur?: string, schedule?: string|null }} Move */

const DAY = 864e5;
/** @param {string} d */
const utc = d => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
/** Nombre de jours de a à b (b − a). @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY);
/** @param {string} d @param {number} n */
export function shiftDay(d, n) {
  const t = new Date(utc(d) + n * DAY);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
/** Jours de la période, dans l'ordre. @param {Period} p */
export function periodDays(p) {
  const out = [];
  for (let d = p.start; d <= p.end; d = shiftDay(d, 1)) out.push(d);
  return out;
}
/** Jours restants dans la période, aujourd'hui compris (0 si elle est finie, tous si elle n'a pas commencé). @param {Period} p @param {string} today */
export function daysLeftIn(p, today) {
  if (today > p.end) return 0;
  if (today < p.start) return p.days;
  return daysBetween(today, p.end) + 1;
}

/**
 * Chiffres de l'accueil pour la période en cours : dépensé, prévues restantes, jours restants, barres jour par jour.
 * moves : opérations de la monnaie principale (déjà filtrées).
 * @param {{ moves: Move[], period: Period, today: string }} o
 */
export function monthPace({ moves, period, today }) {
  const days = periodDays(period);
  /** @type {Record<string, number>} */
  const perDay = Object.fromEntries(days.map(d => [d, 0]));
  let spent = 0, plannedLeft = 0;
  for (const m of moves) {
    if (m.type !== 'expense' || m.date < period.start || m.date > period.end) continue;
    if (m.planned) { plannedLeft += m.amount; continue; }
    spent += m.amount;
    perDay[m.date] += m.amount;
  }
  const daysLeft = daysLeftIn(period, today);
  const elapsed = period.days - daysLeft + (daysLeft && today >= period.start ? 1 : 0);
  return {
    spent, plannedLeft, daysLeft, elapsed,
    spentToday: perDay[today] || 0,
    bars: days.map(d => ({ date: d, amount: perDay[d], when: d < today ? 'past' : d === today ? 'today' : 'future' })),
  };
}

/**
 * Le fil du mois (accueil, D3 revu le 2026-11-17) : à ce rythme, jusqu'où tient ton argent.
 * base : l'argent courant compté moins les échéances à payer d'ici la fin de la période (elles sont déjà promises).
 * Le rythme : les dépenses des `window` derniers jours, aujourd'hui compris (moins si l'historique est plus court),
 * sans les prévues ni celles d'une échéance (déjà retirées de base : jamais deux fois), divisées par ces jours.
 * États : 'empty' (rien ne reste), 'unknown' (aucune dépense récente : pas de rythme), 'whole' (tient toute la période,
 * leftover : ce qui restera, arrondi au pas en dessous), 'short' (until : le dernier jour couvert ; cut : de combien
 * baisser par jour pour tenir jusqu'au bout, arrondi au pas au-dessus). ratio : part de la période restante couverte (0…1).
 * @param {{ base: number, moves: Move[], today: string, period: Period, window?: number, step?: number }} o
 */
export function runway({ base, moves, today, period, window = 14, step = 1 }) {
  const daysLeft = Math.max(1, daysLeftIn(period, today));
  const spends = moves.filter(m => m.type === 'expense' && !m.planned && !m.schedule && m.date <= today);
  let from = shiftDay(today, -(window - 1));
  const first = spends.reduce((d, m) => (m.date < d ? m.date : d), today);
  if (first > from) from = first;
  const days = daysBetween(from, today) + 1;
  const sum = spends.filter(m => m.date >= from).reduce((n, m) => n + m.amount, 0);
  const rate = sum / days;
  const out = { state: /** @type {'empty'|'unknown'|'whole'|'short'} */ ('unknown'), rate, daysLeft, until: today, ratio: 0, leftover: 0, cut: 0 };
  if (base <= 0) return { ...out, state: 'empty' };
  if (!sum) return { ...out, state: 'unknown', ratio: 1 };
  const covered = base / rate;
  const until = shiftDay(today, Math.floor(covered));
  const ratio = Math.min(1, covered / daysLeft);
  if (until >= period.end) return { ...out, state: 'whole', until: period.end, ratio, leftover: Math.max(0, Math.floor((base - rate * daysLeft) / step) * step) };
  return { ...out, state: 'short', until, ratio, cut: Math.max(step, Math.ceil((rate - base / daysLeft) / step) * step) };
}

/** Seuil d'un bocal « bas » : moins de 35 % restants. */
export const LOW = 0.35;
/**
 * Bocal d'un budget : reste, part restante (niveau de l'eau, 0…1), état.
 * @param {number} budget @param {number} spent
 * @returns {{ left: number, ratio: number, pct: number, state: 'ok'|'low'|'over' }}
 */
export function envelope(budget, spent) {
  const left = budget - spent;
  const ratio = budget > 0 ? Math.max(0, Math.min(1, left / budget)) : 0;
  const state = left < 0 ? 'over' : ratio < LOW ? 'low' : 'ok';
  return { left, ratio, pct: Math.round(ratio * 100), state };
}
/**
 * Bocaux affichés : au plus n, les plus urgents (part restante la plus faible), dans l'ordre d'origine.
 * @template {{ ratio: number, left: number }} T
 * @param {T[]} list
 * @param {number} [n]
 * @returns {T[]}
 */
export function pickJars(list, n = 4) {
  if (list.length <= n) return list.slice();
  const idx = list.map((_, i) => i).sort((a, b) => list[a].ratio - list[b].ratio || list[a].left - list[b].left || a - b);
  const keep = new Set(idx.slice(0, n));
  return list.filter((_, i) => keep.has(i));
}


/**
 * Ton rythme comparé à tes 3 derniers mois (accueil, 2026-11-18, avec l'utilisateur) : ce que tu as dépensé depuis le début
 * de la période, face à ce que tu dépensais d'habitude au même jour des périodes d'avant (la moyenne des 3 dernières :
 * un mois exceptionnel ne fausse pas tout). Les périodes d'avant ta première dépense ne comptent pas. null sans au moins
 * une période d'avant.
 * @param {{ moves: Move[], today: string, period: Period, before: Period[] }} o (before : les périodes d'avant, la plus récente d'abord)
 * @returns {{ now: number, usual: number, months: number, ratio: number|null }|null}
 */
export function usualPace({ moves, today, period, before }) {
  const exp = moves.filter(m => m.type === 'expense' && !m.planned);
  if (!exp.length) return null;
  const first = exp.reduce((a, m) => (m.date < a ? m.date : a), exp[0].date);
  const d = daysBetween(period.start, today);
  const sum = (/** @type {string} */ a, /** @type {string} */ b) => exp.reduce((n, m) => n + (m.date >= a && m.date <= b ? m.amount : 0), 0);
  const past = before.slice(0, 3).filter(q => first <= shiftDay(q.start, 3)).map(q => {
    const cut = shiftDay(q.start, d);
    return sum(q.start, cut < q.end ? cut : q.end);
  });
  if (!past.length) return null;
  const usual = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
  const now = sum(period.start, today);
  return { now, usual, months: past.length, ratio: usual > 0 ? now / usual : null };
}
