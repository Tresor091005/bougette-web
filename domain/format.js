// Formats : montants (« 35 400 F »), dates en français, périodes mensuelles avec jour de début réglable.

const THIN = ' '; // espace fine insécable : séparateur de milliers
const NBSP = ' '; // espace insécable avant le symbole
const MINUS = '−';

// Devises : toutes les devises ISO 4217 en cours, table figée générée par tools/build-currencies.mjs.
import { CURRENCIES } from './currencies.js';
import { monthSpan } from './month-start.js';
export { CURRENCIES };

// Devise devinée : d'abord le fuseau horaire (fiable même si le téléphone est en « fr-FR » ou « en-US »),
// puis la région de la langue pour les pays africains ; XOF par défaut.
const BY_ZONE = {
  Dakar: 'XOF', Abidjan: 'XOF', Bamako: 'XOF', Ouagadougou: 'XOF', 'Porto-Novo': 'XOF', Lome: 'XOF', Niamey: 'XOF', Bissau: 'XOF',
  Douala: 'XAF', Libreville: 'XAF', Brazzaville: 'XAF', Ndjamena: 'XAF', Bangui: 'XAF', Malabo: 'XAF',
  Conakry: 'GNF', Kinshasa: 'CDF', Lubumbashi: 'CDF', Lagos: 'NGN', Accra: 'GHS', Casablanca: 'MAD',
};
const BY_REGION = {
  SN: 'XOF', CI: 'XOF', ML: 'XOF', BF: 'XOF', BJ: 'XOF', TG: 'XOF', NE: 'XOF', GW: 'XOF',
  CM: 'XAF', GA: 'XAF', CG: 'XAF', TD: 'XAF', CF: 'XAF', GQ: 'XAF',
  GN: 'GNF', CD: 'CDF', NG: 'NGN', GH: 'GHS', MA: 'MAD',
};
/** @returns {string} */
export function detectCurrency() {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  const [area, city] = zone.split('/');
  if (area === 'Africa' && BY_ZONE[city]) return BY_ZONE[city];
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const region = (((nav && nav.languages && nav.languages[0]) || (nav && nav.language) || '').split('-')[1] || '').toUpperCase();
  if (BY_REGION[region]) return BY_REGION[region];
  if (area === 'Europe' && ['Paris', 'Brussels', 'Luxembourg', 'Monaco'].includes(city)) return 'EUR';
  return 'XOF';
}

// Devises courantes, en tête du choix de devise (les autres suivent, par nom, avec une recherche).
export const COMMON = ['XOF', 'XAF', 'EUR', 'USD', 'GNF', 'CDF', 'NGN', 'GHS', 'MAD', 'DZD', 'KES', 'ZAR', 'EGP', 'GBP', 'CAD', 'CHF'];
// Formats des nombres : séparateur des milliers ; le séparateur décimal est l'autre signe (point si les milliers sont en
// virgule). L'interface propose space, dot et comma ; apos reste lisible (anciens journaux).
export const GROUPS = { space: THIN, dot: '.', comma: ',', apos: '’' };
// dec et sym : anciens réglages (décimales affichées, F / FCFA / XOF), encore acceptés dans les journaux mais sans effet :
// les décimales sont celles de la devise du montant, le symbole est celui de la devise (son code si elle n'en a pas).
export const DEFAULT_FMT = { group: 'space', dec: 0, sym: 'short', pos: 'after' };

/** @type {{ currency: string, fmt: typeof DEFAULT_FMT, discreet: boolean, steps: Record<string, number> }} */
let cfg = { currency: 'XOF', fmt: { ...DEFAULT_FMT }, discreet: false, steps: {} };
export function configureFormat(c) { cfg = { ...cfg, ...c, fmt: { ...DEFAULT_FMT, ...(c.fmt || cfg.fmt) }, steps: c.steps || cfg.steps || {} }; }
export const currencyOf = code => CURRENCIES.find(c => c.code === (code || cfg.currency)) || CURRENCIES[0];
export const currency = () => currencyOf(cfg.currency);
export const mainCode = () => cfg.currency;
// Symbole de la devise (« F », « € », « $CA »), ou son code quand elle n'a pas de symbole propre (table : sym = code).
export const symbol = code => currencyOf(code).sym;
export const symFirst = () => cfg.fmt.pos === 'before';
// Décimales de la devise : celles du stockage (plus petite unité), de l'affichage et de la saisie.
export const unitDec = code => currencyOf(code).dec;
export const inputDec = unitDec;

// Arrondi des estimations (2026-11-12, D0) : ce que l'app estime ou propose (une habitude, la Marge, un rythme à tenir,
// un montant de départ) ne se donne pas au franc près ; les montants réels (opérations, soldes, Disponible, restes des
// budgets) ne s'arrondissent jamais. Le pas vient de la table des devises ; l'utilisateur le change pour sa monnaie
// principale (Moi › Monnaie et format, réglage steps, en plus petite unité).
/** Pas par défaut d'une devise, en plus petite unité. @param {string} [code] */
export const defaultStep = code => { const c = currencyOf(code); return Math.round(c.step * 10 ** c.dec); };
/** Pas en vigueur, en plus petite unité. @param {string} [code] */
export const stepOf = code => cfg.steps[currencyOf(code).code] || defaultStep(code);
/** Les pas qu'on peut choisir pour une devise (en XOF : 25, 50, 100, 500 F). @param {string} [code] */
export const stepChoices = code => { const d = defaultStep(code); return [d / 4, d / 2, d, d * 5].filter(x => Number.isInteger(x) && x >= 1); };
/** Une estimation au pas le plus proche ; jamais zéro pour un montant qui ne l'est pas (30 F → 100 F). @param {number} v @param {string} [code] */
export function approx(v, code) {
  if (!v) return 0;
  const p = stepOf(code), r = Math.round(Math.abs(v) / p) * p || p;
  return v < 0 ? -r : r;
}
/** Pas d'une proposition : 5 pas, ramenés au chiffre rond au-dessus (1, 2 ou 5 × 10ⁿ : 100 → 500, 25 → 200). @param {string} [code] */
export function upStepOf(code) {
  const v = 5 * stepOf(code), m = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].map(k => k * m).find(x => x >= v)) || v;
}
/** Une proposition (valeur de départ, rythme à tenir) : au-dessus, à son pas (en XOF : 4 167 → 4 500 F). @param {number} v @param {string} [code] */
export const approxUp = (v, code) => { const p = upStepOf(code); return v > 0 ? Math.ceil(v / p) * p : 0; };
export const groupSep = () => GROUPS[cfg.fmt.group] || THIN;
export const decSep = () => (cfg.fmt.group === 'comma' ? '.' : ',');

function group(intStr) {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep());
}

// Nombre seul (sans symbole), en unités affichées : 1234567 → « 1 234 567 » (ou « 1.234.567,00 »…).
/** @param {number} amount @param {{ cur?: string, dec?: number }} [opts] */
export function num(amount, { cur = undefined, dec = unitDec(cur) } = {}) {
  const v = Math.abs(Math.round(amount)) / 10 ** unitDec(cur);
  const [i, f] = v.toFixed(dec).split('.');
  const s = group(i) + (dec > 0 ? decSep() + f : '');
  return (amount < 0 && Number(v.toFixed(dec)) !== 0 ? MINUS : '') + s;
}

// Place le symbole avant ou après le nombre ; pre : signe éventuel (« − » ou « + »).
export function withSym(n, cur, pre = '') {
  const s = symbol(cur);
  return symFirst() ? `${pre}${s}${NBSP}${n}` : `${pre}${n}${NBSP}${s}`;
}

// Montant complet. cur : devise (par défaut la monnaie principale) ; sign : forcer le « + » ; hide : suivre le mode discret.
/** @param {number} amount @param {{ cur?: string, sign?: boolean, hide?: boolean, abs?: boolean }} [opts] */
export function money(amount, { cur = undefined, sign = false, hide = true, abs = false } = {}) {
  if (hide && cfg.discreet) return withSym('•••', cur);
  const v = abs ? Math.abs(amount) : amount;
  const pre = v < 0 ? MINUS : sign && v > 0 ? '+' : '';
  return withSym(num(Math.abs(v), { cur }), cur, pre);
}

// Montant « compact » pour les petits espaces : 1,2 M F, 35 k F.
/** @param {number} amount @param {{ cur?: string }} [opts] */
export function moneyShort(amount, { cur = undefined } = {}) {
  if (cfg.discreet) return withSym('•••', cur);
  const v = Math.abs(amount) / 10 ** unitDec(cur);
  const pre = amount < 0 ? MINUS : '';
  if (v >= 999500) return withSym(`${(v / 1e6).toFixed(1).replace(/\.0$/, '').replace('.', decSep())}${NBSP}M`, cur, pre);
  if (v >= 1e4) return withSym(`${Math.round(v / 1e3)}${NBSP}k`, cur, pre);
  return money(amount, { cur });
}

// Identifiant masqué : « •••• 4521 ».
export function maskId(id) {
  const s = String(id || '').replace(/[\s.\-]/g, '');
  if (!s) return '';
  return `••••${NBSP}${s.slice(-4)}`;
}

// --- dates (chaînes ISO « AAAA-MM-JJ », en heure locale) ---
const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
// « Aujourd'hui » : la vraie date, sauf pendant une vue dans le passé (lecture seule) où l'app se place à cette date.
/** @type {string|null} */
let todayOverride = null;
/** @param {string|null} d */
export function setToday(d) { todayOverride = d; }
export const today = () => todayOverride || iso(new Date());
export function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }

const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
const fmtMonthY = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

// « Aujourd'hui », « Hier », « Demain » ou « jeudi 5 novembre ».
export function dayLabel(s) {
  const t = today();
  if (s === t) return 'Aujourd’hui';
  if (s === addDays(t, -1)) return 'Hier';
  if (s === addDays(t, 1)) return 'Demain';
  const d = parse(s);
  const txt = (d.getFullYear() === new Date().getFullYear() ? fmtDay : fmtDayY).format(d);
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
export const shortDate = s => fmtShort.format(parse(s)).replace('.', '');
/** Date complète, toujours avec l'année : « 8 juil. 2027 » (échéances, objectifs, réserves terminées). @param {string} s */
export const yearDate = s => `${shortDate(s)} ${s.slice(0, 4)}`;
export const monthName = d => fmtMonth.format(d);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Période « mensuelle » contenant la date ref, décalée de offset périodes. startDay : la règle du début du mois
// (month-start.js : un jour de 1 à 28 — paie le 25 → mois du 25 au 24 —, « le 2e lundi », « le dernier vendredi »…).
export function period(ref = today(), startDay = 1, offset = 0) {
  let sp = monthSpan(ref, startDay);
  for (let k = 0; k < Math.abs(offset); k++) sp = monthSpan(offset < 0 ? addDays(sp.start, -1) : addDays(sp.end, 1), startDay);
  const prev = monthSpan(addDays(sp.start, -1), startDay);
  const start = parse(sp.start), end = parse(sp.end);
  const label = startDay === 1
    ? cap(start.getFullYear() === new Date().getFullYear() ? fmtMonth.format(start) : fmtMonthY.format(start))
    : `${shortDate(sp.start)} – ${shortDate(sp.end)}`;
  const days = Math.round((end.getTime() - start.getTime()) / 864e5) + 1;
  return { start: sp.start, end: sp.end, label, days, prevLabel: cap(fmtMonth.format(parse(prev.start))) };
}
export const inPeriod = (s, p) => s >= p.start && s <= p.end;

// Fenêtres du Journal (une période à la fois) : jour, semaine (lundi → dimanche), mois (selon le jour de début),
// trimestre, année, ou tout. { unit, start, end, label } ; « tout » n'a ni début ni fin.
/** @typedef {{ unit: string, start: string|null, end: string|null, label: string }} Window */
/** @param {string} unit 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all' @param {string} ref @param {number} [startDay] @returns {Window} */
export function windowOf(unit, ref = today(), startDay = 1) {
  if (unit === 'day') return { unit, start: ref, end: ref, label: rangeLabel(ref, ref) };
  if (unit === 'quarter') {
    const d = parse(ref), y = d.getFullYear(), q = Math.floor(d.getMonth() / 3);
    return { unit, start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)), label: `T${q + 1} ${y}` };
  }
  if (unit === 'week') {
    const dow = (parse(ref).getDay() + 6) % 7;
    const start = addDays(ref, -dow), end = addDays(start, 6);
    return { unit, start, end, label: rangeLabel(start, end) };
  }
  if (unit === 'year') {
    const y = parse(ref).getFullYear();
    return { unit, start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
  }
  if (unit === 'month') {
    const p = period(ref, startDay);
    return { unit, start: p.start, end: p.end, label: p.label };
  }
  return { unit: 'all', start: null, end: null, label: 'Tout' };
}
// Fenêtre d'avant (dir −1) ou d'après (dir 1), de la même taille.
/** @param {Window} w @param {number} dir @param {number} [startDay] @returns {Window} */
export function shiftWindow(w, dir, startDay = 1) {
  if (!w.start || !w.end) return w;
  return windowOf(w.unit, dir < 0 ? addDays(w.start, -1) : addDays(w.end, 1), startDay);
}
// Reconnaît une fenêtre à partir de ses dates (un lien « Novembre » d'un autre écran) ; sinon une période libre.
/** @param {string} from @param {string} to @param {number} [startDay] @returns {Window} */
export function windowFor(from, to, startDay = 1) {
  for (const unit of ['day', 'month', 'week', 'quarter', 'year']) {
    const w = windowOf(unit, from, startDay);
    if (w.start === from && w.end === to) return w;
  }
  return { unit: 'custom', start: from, end: to, label: rangeLabel(from, to) };
}
// Libellé d'onglet (Journal) : la période en cours et celle d'avant se nomment (« Ce mois-ci », « Le mois dernier »,
// « Aujourd'hui », « Hier »…), les autres gardent leur libellé (« Septembre », « T2 2026 »).
const NAMES = {
  day: ['Aujourd’hui', 'Hier'], week: ['Cette semaine', 'La semaine dernière'], month: ['Ce mois-ci', 'Le mois dernier'],
  quarter: ['Ce trimestre', 'Le trimestre dernier'], year: ['Cette année', 'L’année dernière'],
};
/** @param {Window} w @param {number} [startDay] */
export function tabLabel(w, startDay = 1) {
  const names = NAMES[w.unit];
  if (!names || !w.start) return w.label;
  const now = windowOf(w.unit, today(), startDay);
  if (w.start === now.start) return names[0];
  if (w.start === shiftWindow(now, -1, startDay).start) return names[1];
  return w.label;
}
// « 2 nov – 8 nov », avec l'année quand la période n'est pas dans l'année en cours (« 3 nov – 9 nov 2025 »).
function rangeLabel(from, to) {
  const y = parse(today()).getFullYear();
  const yf = parse(from).getFullYear(), yt = parse(to).getFullYear();
  if (from === to) return yf === y ? shortDate(from) : `${shortDate(from)} ${yf}`;
  if (yf === y && yt === y) return `${shortDate(from)} – ${shortDate(to)}`;
  return yf === yt ? `${shortDate(from)} – ${shortDate(to)} ${yt}` : `${shortDate(from)} ${yf} – ${shortDate(to)} ${yt}`;
}
// Jours restants dans la période (aujourd'hui compris).
export function daysLeft(p) {
  const t = today();
  if (t > p.end) return 0;
  if (t < p.start) return p.days;
  return Math.round((parse(p.end).getTime() - parse(t).getTime()) / 864e5) + 1;
}

// Montant brut pour un champ de saisie : 12500 → « 12500 », 1250 (EUR) → « 12,5 » (avec le bon signe décimal).
export function fromMinorPlain(a, cur) {
  const d = unitDec(cur);
  const s = (Math.abs(a) / 10 ** d).toFixed(d);
  return (a < 0 ? '-' : '') + (d ? s.replace(/\.?0+$/, '').replace('.', decSep()) : s);
}
// Lit un montant tapé librement (« 12 500 », « 12.500,50 », « -3500 ») ; renvoie un nombre en unités affichées, ou null.
function parseMajor(str) {
  let s = String(str ?? '').trim().replace(/[\s\u00A0\u202F'’]/g, '').replace(/^[−–]/, '-');
  if (!s) return 0;
  const neg = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let dec = '';
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    // un seul signe : décimal si c'est le signe décimal réglé, ou s'il est suivi de 1-2 chiffres une seule fois
    if (sep === decSep() && parts.length === 2 && parts[1].length !== 3) dec = sep;
    else if (parts.length === 2 && parts[1].length <= 2) dec = sep;
  }
  const grp = dec === '.' ? ',' : dec === ',' ? '.' : null;
  let clean = grp ? s.split(grp).join('') : dec ? s : s.replace(/[.,]/g, '');
  if (dec) clean = clean.replace(dec, '.');
  const v = parseFloat(clean);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}
// Montant tapé → entier en plus petite unité de la devise, ou null s'il est illisible.
export function parseAmount(str, cur) {
  const v = parseMajor(str);
  return v === null ? null : Math.round(v * 10 ** unitDec(cur));
}
// Le montant tapé a-t-il plus de décimales que la devise n'en a (« 12,50 » pour le FCFA) ?
export function tooPrecise(str, cur) {
  const v = parseMajor(str);
  if (v === null) return false;
  const x = v * 10 ** unitDec(cur);
  return Math.abs(x - Math.round(x)) > 1e-6;
}

export function ordinal(n) { return n === 1 ? '1er' : String(n); }

// Échappement HTML des textes saisis.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
