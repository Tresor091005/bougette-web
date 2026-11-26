// Début du mois (D11 ; revu le 2026-11-19, avec l'utilisateur : tout le monde n'est pas payé un jour fixe). La règle :
// - un nombre de 1 à 28 : ce jour-là chaque mois (« le 25 ») ;
// - 'w:N:D' : le Nᵉ jour D du mois, N = 1…4 ou L (le dernier), D = 1 (lundi) … 7 (dimanche) : « le 2ᵉ lundi »,
//   « le dernier vendredi » ;
// - 'last' : le dernier jour du mois ; 'work' : le dernier jour ouvré (du lundi au vendredi).
// Un mois va de son début au jour d'avant le début suivant : avec un jour de la semaine, il fait 4 ou 5 semaines.
// Fonctions pures, en dates « AAAA-MM-JJ » (calcul en UTC, sans heure d'été).

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
/** @param {number} y @param {number} m (0 = janvier ; hors bornes : le mois glisse) @param {number} d */
const ymd = (y, m, d) => { const t = new Date(Date.UTC(y, m, d)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
/** Jour de la semaine, 1 = lundi … 7 = dimanche. @param {number} y @param {number} m @param {number} d */
const dow = (y, m, d) => ((new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7) + 1;
const RULE = /^w:([1-4L]):([1-7])$/;

/** Une règle valide ? @param {any} v */
export const isMonthStart = v => (Number.isInteger(v) && v >= 1 && v <= 28) || v === 'last' || v === 'work' || (typeof v === 'string' && RULE.test(v));

/**
 * Le jour où commence le mois m de l'année y, selon la règle.
 * @param {number} y @param {number} m (0 = janvier ; hors bornes : le mois glisse) @param {number|string} rule
 */
export function startOn(y, m, rule) {
  const r = isMonthStart(rule) ? rule : 1;
  if (typeof r === 'number') return ymd(y, m, r);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const ym = new Date(Date.UTC(y, m, 1)), Y = ym.getUTCFullYear(), M = ym.getUTCMonth();
  if (r === 'last') return ymd(Y, M, last);
  if (r === 'work') { let d = last; while (dow(Y, M, d) > 5) d--; return ymd(Y, M, d); }
  const [, n, dd] = /** @type {RegExpExecArray} */ (RULE.exec(r));
  const D = Number(dd);
  if (n === 'L') { let d = last; while (dow(Y, M, d) !== D) d--; return ymd(Y, M, d); }
  const first = 1 + ((D - dow(Y, M, 1) + 7) % 7);
  return ymd(Y, M, first + 7 * (Number(n) - 1));
}

/** Le jour d'avant. @param {string} s */
const dayBefore = s => ymd(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) - 1);

/**
 * Le mois (selon la règle) qui contient une date : de son début au jour d'avant le début suivant.
 * @param {string} date @param {number|string} [rule] @returns {{ start: string, end: string }}
 */
export function monthSpan(date, rule = 1) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1;
  let k = m;
  if (date < startOn(y, k, rule)) k -= 1;
  else if (date >= startOn(y, k + 1, rule)) k += 1; // un début tôt dans le mois suivant (le 1er lundi le 2 : le 1er est encore dans ce mois)
  return { start: startOn(y, k, rule), end: dayBefore(startOn(y, k + 1, rule)) };
}

const RANK = { 1: '1er', 2: '2e', 3: '3e', 4: '4e', L: 'dernier' };
const DAY = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
/** « Le 25 », « Le 1er », « Le 2e lundi », « Le dernier vendredi », « Le dernier jour », « Le dernier jour ouvré ». @param {number|string} rule */
export function monthStartLabel(rule) {
  if (typeof rule === 'number') return rule === 1 ? 'Le 1er' : `Le ${rule}`;
  if (rule === 'last') return 'Le dernier jour';
  if (rule === 'work') return 'Le dernier jour ouvré';
  const x = RULE.exec(String(rule));
  return x ? `Le ${RANK[/** @type {'1'|'2'|'3'|'4'|'L'} */ (x[1])]} ${DAY[Number(x[2])]}` : 'Le 1er';
}

// Les mêmes lectures pour une échéance par mois (2026-11-25, avec l'utilisateur : tontines, associations, église), tirées
// de sa première date : 'weekday' le Nᵉ même jour de la semaine (le lundi 14 : « le 2e lundi » ; N de 1 à 4 : un 5ᵉ
// n'existe pas chaque mois), 'lastweekday' le dernier (« le dernier vendredi »), 'lastday' le dernier jour du mois.
/** @typedef {'weekday'|'lastweekday'|'lastday'} By */
/** Le nombre de jours du mois d'une date. @param {string} d */
const monthLength = d => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
/** Le rang d'une date parmi les mêmes jours de la semaine de son mois (le 14 : 2 ; un 29, 30 ou 31 : 5). @param {string} d */
export const weekRank = d => Math.ceil(Number(d.slice(8, 10)) / 7);
/**
 * Les lectures qu'une date permet : le Nᵉ jour de la semaine jusqu'au 28 ; le dernier jour de la semaine dans les 7
 * derniers jours du mois ; le dernier jour du mois quand c'en est un (un 31 aussi : une règle « le dernier jour » y tombe
 * sept mois sur douze, son quantième y tombe déjà chaque dernier jour du mois). @param {string} d @returns {By[]}
 */
export function byOptions(d) {
  const day = Number(d.slice(8, 10)), len = monthLength(d);
  /** @type {By[]} */
  const out = [];
  if (day <= 28) out.push('weekday');
  if (day > len - 7) out.push('lastweekday');
  if (day === len) out.push('lastday');
  return out;
}
/**
 * La date, n mois après la date d'ancrage (n peut être négatif), lue comme elle (by). @param {string} anchor @param {By} by @param {number} n
 */
export function byMonth(anchor, by, n) {
  const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7)) - 1 + n;
  if (by === 'lastday') return startOn(y, m, 'last');
  const D = dow(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1, Number(anchor.slice(8, 10)));
  return startOn(y, m, `w:${by === 'lastweekday' ? 'L' : Math.min(4, weekRank(anchor))}:${D}`);
}
