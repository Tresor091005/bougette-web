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

/**
 * Ce mois face à d'habitude (2026-11-23, avec l'utilisateur : l'anneau « F / jour » se lisait comme ce qu'on a le droit
 * de dépenser ; comme Money Lover, on compare plutôt ce qui est dépensé depuis le début de la période à ce qui l'était
 * d'habitude au même jour). D'habitude : la moyenne des périodes d'avant (previous, la plus récente d'abord) que
 * l'historique couvre en entier (la première dépense notée au plus tard leur premier jour) ; le même rang de jour,
 * ramené au dernier jour d'une période plus courte. Les dépenses comptées : toutes celles notées, échéances comprises,
 * sans les prévues.
 * now, usual : dépensé ce mois-ci jusqu'à aujourd'hui, et d'habitude au même jour ; pct : l'écart en % (null sans
 * habitude ou d'habitude rien) ; months : combien de périodes font l'habitude ; curveNow (jusqu'à aujourd'hui) et
 * curveUsual (toute la période) : le cumul jour après jour, pour la courbe.
 * @param {{ moves: Move[], today: string, current: Period, previous: Period[] }} o
 * @returns {{ now: number, usual: number, pct: number|null, months: number, day: number, curveNow: number[], curveUsual: number[] }}
 */
export function habitPace({ moves, today, current, previous }) {
  const spends = moves.filter(m => m.type === 'expense' && !m.planned && m.date <= today);
  const first = spends.reduce((d, m) => (m.date < d ? m.date : d), today);
  /** le cumul jour après jour d'une période (jusqu'à `upTo` compris) @param {Period} p @param {string} upTo */
  const cumul = (p, upTo) => {
    const out = Array(p.days).fill(0);
    for (const m of spends) if (m.date >= p.start && m.date <= p.end && m.date <= upTo) out[daysBetween(p.start, m.date)] += m.amount;
    for (let i = 1; i < out.length; i++) out[i] += out[i - 1];
    return out;
  };
  const day = Math.max(0, Math.min(current.days - 1, daysBetween(current.start, today)));
  const nowAll = cumul(current, today);
  const curveNow = nowAll.slice(0, day + 1);
  const used = previous.filter(p => first <= p.start).map(p => cumul(p, p.end));
  const curveUsual = Array.from({ length: current.days }, (_, i) =>
    used.length ? Math.round(used.reduce((n, c) => n + c[Math.min(i, c.length - 1)], 0) / used.length) : 0);
  const now = curveNow[day] || 0, usual = curveUsual[day] || 0;
  return { now, usual, pct: used.length && usual > 0 ? Math.round((now / usual - 1) * 100) : null, months: used.length, day, curveNow, curveUsual };
}
