// Rythme du mois (D3) : jusqu'où tient l'argent à ce rythme, et les calculs de dates qui vont avec. Fonctions pures : aucune dépendance au DOM, au stockage ni à l'horloge.

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
 * Jusqu'où tient ton argent, à ce rythme (accueil : la tuile « Ton argent tient » et l'anneau, D3).
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
