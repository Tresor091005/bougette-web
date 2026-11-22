// Journal (D6, revu le 2026-11-08 d'après Money Lover) : une période à la fois.
// En haut : le titre, la loupe (la recherche s'ouvre dessous et parcourt tout le journal) et le filtre (une feuille :
// période Jour · Semaine · Mois · Trimestre · Année · Tout · Personnalisé, regroupement Jours ou Catégories, type,
// catégorie). Puis, centrés, le solde et le portefeuille (« Tous les portefeuilles ⌄ » : toute la page suit le choix) ;
// une barre d'onglets qui défile (« … · Septembre · Le mois dernier · Ce mois-ci · À venir ») ; le résumé Entrées,
// Sorties et leur différence ; la liste par jour (par mois au-delà de deux mois : trimestre, année, tout, personnalisé
// long) ou par catégorie (chaque jour, mois ou catégorie, puis ses opérations en retrait).
// Les opérations annulées sont masquées, sauf réglage « Afficher les opérations annulées » (barrées et grisées).
// Appui → fiche de l'opération (annuler se fait depuis la fiche). Glisser la liste vers la gauche ou la droite
// → période voisine (comme Money Lover) : le geste touche l'onglet d'à côté.
// Filtres et période dans l'adresse (#/operations?acc=…&cat=…&res=…&type=expense&from=AAAA-MM-JJ&to=AAAA-MM-JJ, ou
// &avenir=1 pour l'onglet « À venir », qui garde la période d'où l'on vient) : un montant touché ailleurs (ligne de Budget) ouvre cet écran sur son
// mois, et le retour Android ramène à l'écran d'origine. res : les opérations qui ont utilisé une réserve (ouvert depuis
// son petit menu) ; une pastille sous le portefeuille la nomme, la toucher retire ce filtre.
import {
  settings, moves, account, accounts, category, byDateDesc, txCur, topOf, categoryLabel, allCategories,
  balances, totalBalance, otherTotals, reserveById, dueItems,
} from '../core/store.js';
import { dueRowsHTML, wireDues } from './dues-ui.js';
import { money, esc, today, period, parse, windowOf, shiftWindow, windowFor, tabLabel, dayLabel, shortDate, addDays, yearDate } from '../core/format.js';
import { icon, catIcon } from '../core/icons.js';
import { fitText, buzz, reducedMotion, afterSheets, openSheet, seg, wireSeg, chip, splitAmount, $, $$ } from '../core/ui.js';
import { txRow, wireTxList } from './common.js';
import { pickAccount, pickCategory, pickDate } from './pickers.js';
import { topbarHTML, sheetHead } from './parts.js';

// état gardé d'un rendu à l'autre (filtres et période, eux, vivent dans l'adresse)
// mois montrés à la fois quand la liste va par mois (« Afficher les mois d'avant » en ajoute autant)
const MONTHS = 12;
const f = { q: '', find: false, months: MONTHS, unit: 'month', group: 'day' };
// un autre espace (D19) : sa recherche et sa période repartent de zéro
if (typeof window !== 'undefined') window.addEventListener('bougette:space', () => Object.assign(f, { q: '', find: false, months: MONTHS, unit: 'month', group: 'day' }));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = { expense: 'Dépenses', income: 'Revenus', transfer: 'Virements' };
const UNITS = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout'], ['custom', 'Personnalisé']];
// onglets de période : de la première opération à aujourd'hui, 30 au plus ; au-delà, « Plus loin » propose de changer
// d'échelle (l'échelle ne dit que combien on voit à la fois ; une date précise se choisit avec « Personnalisé »)
const MAX_TABS = 30;
// au-delà de deux mois (trimestre, année, tout, personnalisé long), les opérations se regroupent par mois, pas par jour
const LONG_DAYS = 62;

/**
 * Adresse du Journal filtré.
 * exact : la catégorie seule, sans ses sous-catégories (ce que compte son budget, D13) ; res : une réserve (les
 * opérations qui l'ont utilisée, D17)
 * @param {{ acc?: string|null, cat?: string|null, exact?: boolean|null, res?: string|null, type?: string|null, from?: string|null, to?: string|null, soon?: boolean|null }} filters
 */
export function opsHref({ acc = null, cat = null, exact = null, res = null, type = null, from = null, to = null, soon = null } = {}) {
  const q = new URLSearchParams();
  if (type) q.set('type', type);
  if (acc) q.set('acc', acc);
  if (cat) q.set('cat', cat);
  if (cat && exact) q.set('seule', '1');
  if (res) q.set('res', res);
  if (from && to) { q.set('from', from); q.set('to', to); }
  if (soon) q.set('avenir', '1');
  const s = q.toString();
  return '#/operations' + (s ? '?' + s : '');
}
// Filtres lus dans l'adresse ; un portefeuille, une catégorie ou une réserve disparus sont ignorés.
function readFilters() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const acc = q.get('acc'), cat = q.get('cat'), res = q.get('res'), from = q.get('from'), to = q.get('to'), type = q.get('type');
  const span = !!(from && to && DAY.test(from) && DAY.test(to) && from <= to);
  const c = cat && category(cat) ? cat : null;
  return {
    acc: acc && account(acc) ? acc : null, cat: c, exact: !!c && q.get('seule') === '1', res: res && reserveById(res) ? res : null, type: type && TYPES[type] ? type : null,
    from: span ? from : null, to: span ? to : null, soon: q.get('avenir') === '1',
  };
}
// Période affichée : celle de l'adresse (un onglet, un lien d'un autre écran), sinon celle d'aujourd'hui à l'échelle choisie.
function currentWindow(fl) {
  const ms = settings().monthStart;
  if (fl.from) return windowFor(fl.from, fl.to, ms);
  return windowOf(f.unit === 'custom' ? 'month' : f.unit, today(), ms);
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function filtered(fl, w, searching) {
  // recherche au début des mots (comme la liste des catégories) : « or » trouve Orange, pas Transport ni Carburant ;
  // plusieurs mots : chacun doit commencer un mot. Un montant : ce qui est tapé en est le début (« 800 » ≠ 1 800).
  const words = s => ` ${norm(s).replace(/[^a-z0-9]+/g, ' ').trim()}`;
  const q = norm(f.q.trim());
  const qWords = words(q).trim().split(' ').filter(Boolean);
  const qNum = q.replace(/\s/g, '');
  const showVoided = settings().showVoided;
  // une réserve : les opérations qui l'ont utilisée (celles supprimées depuis comprises, montrées comme les autres annulées)
  const used = fl.res ? new Set(reserveById(fl.res)?.uses || []) : null;
  return moves().filter(t => {
    if (t.void && !showVoided) return false;
    if (fl.acc && t.accountId !== fl.acc && t.toAccountId !== fl.acc) return false;
    // une catégorie montre aussi ses sous-catégories, sauf « seule » (ce que compte son budget)
    if (fl.cat && t.categoryId !== fl.cat && (fl.exact || topOf(t.categoryId) !== fl.cat)) return false;
    if (fl.type && t.type !== fl.type) return false;
    if (used && !used.has(t.id)) return false;
    if (q) {
      const hay = words([t.note, categoryLabel(t.categoryId), account(t.accountId)?.name, account(t.toAccountId)?.name].join(' '));
      const textHit = qWords.length && qWords.every(w => hay.includes(` ${w}`));
      if (!textHit && !(qNum && /^\d+$/.test(qNum) && String(t.amount).startsWith(qNum))) return false;
    }
    // la recherche parcourt tout le journal ; l'onglet « À venir » montre les prévues, les autres onglets leur période
    if (searching) return true;
    const planned = t.planned && !t.void;
    if (fl.soon) return planned;
    if (planned) return false;
    return !w.start || (t.date >= w.start && t.date <= w.end);
  });
}

/**
 * « À venir » (2026-11-13, avec l'utilisateur) : les échéances, une ligne chacune avec sa prochaine fois seulement —
 * on règle une fois à la fois, comme dans Plan (même ligne, mêmes Confirmer et Passer) ; les anciennes opérations
 * prévues y sont des échéances d'une fois. Les filtres portefeuille, catégorie et type s'y appliquent.
 * @param {any} fl
 */
function duesFor(fl) {
  return dueItems().filter(d => (!fl.acc || d.wallet === fl.acc || d.to === fl.acc)
    && (!fl.cat || d.category === fl.cat || (!fl.exact && !!d.category && topOf(d.category) === fl.cat))
    && (!fl.type || d.kind === fl.type) && !fl.res);
}
/** Une échéance comme une opération prévue, pour les totaux. @param {any} d */
const dueAsTx = d => ({ id: d.key, type: d.kind, amount: d.amount, accountId: d.wallet, toAccountId: d.to, categoryId: d.category, date: d.date, planned: true, void: false });

// Entrées et sorties d'une liste dans une devise (les autres devises ne s'additionnent pas ; annulées exclues ; les
// prévues seulement sur l'onglet « À venir » : soon). Avec un portefeuille choisi, ses virements comptent : ce qui
// entre, ce qui sort.
function totals(list, cur, acc = null, soon = false) {
  let inc = 0, out = 0;
  for (const t of list) {
    if (t.void || txCur(t) !== cur || (t.planned && !soon)) continue;
    if (t.type === 'income') inc += t.amount;
    else if (t.type === 'expense') out += t.amount;
    else if (acc && t.type === 'transfer') { if (t.toAccountId === acc) inc += t.amount; if (t.accountId === acc) out += t.amount; }
  }
  return { inc, out, net: inc - out };
}

// En-tête de la période (2026-11-09) : une rangée Entrées · Sorties · Net, petit libellé au-dessus du chiffre.
// Entrées et Sorties se touchent (filtre de type) ; avec un filtre de type, seul ce qui compte reste : « Sorties »
// pour les dépenses, « Entrées » pour les entrées, rien pour les virements (sauf dans un portefeuille : ce qui y entre
// et en sort).
function sumHTML(t, cur, fl, foreign) {
  const note = foreign ? '<p class="ops-note">Sans les opérations dans une autre devise.</p>' : '';
  const cell = (type, label, v, cls) => `<button type="button" class="c${fl.type === type ? ' on' : ''}" data-sumtype="${type}" aria-pressed="${fl.type === type}"><span>${label}</span><b class="${cls}">${v}</b></button>`;
  const inc = cell('income', 'Entrées', money(t.inc, { cur, sign: t.inc > 0 }), t.inc ? 'gain' : '');
  const out = cell('expense', 'Sorties', money(-t.out, { cur }), t.out ? 'loss' : '');
  const net = `<div class="c net"><span>Net</span><b class="${t.net > 0 ? 'gain' : t.net < 0 ? 'loss' : ''}">${money(t.net, { cur, sign: t.net > 0 })}</b></div>`;
  const cells = fl.type === 'expense' ? [out] : fl.type === 'income' ? [inc] : fl.type === 'transfer' ? (fl.acc ? [inc, out, net] : []) : [inc, out, net];
  if (!cells.length) return note;
  return `<div class="ops-sum n${cells.length}">${cells.join('')}${note}</div>`;
}

// Par jour, sur le modèle de « par catégorie » (d'après Money Lover : « 08 · Aujourd'hui · novembre 2026 ») : chaque
// bloc a le numéro du jour en grand à la place de la pastille, « Aujourd'hui », « Hier » ou le jour de la semaine,
// le mois dessous et le total du jour ; puis ses opérations en retrait, plus petites, reliées par un trait.
const fmtWeekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const fmtMonthYear = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
function daysHTML(list, cur, acc, rowOpts) {
  const days = new Map();
  for (const t of list) { if (!days.has(t.date)) days.set(t.date, []); days.get(t.date).push(t); }
  return [...days].map(([d, ts]) => {
    const n = totals(ts, cur, acc, rowOpts.soon).net;
    const rel = dayLabel(d);
    const date = parse(d);
    const name = ['Aujourd’hui', 'Hier', 'Demain'].includes(rel) ? rel : cap(fmtWeekday.format(date));
    return `<section class="catgroup dayblock"><div class="cathead"><span class="daynum" aria-hidden="true">${String(date.getDate()).padStart(2, '0')}</span>
      <div class="main"><div class="t">${name}</div><div class="s">${fmtMonthYear.format(date)}</div></div>
      <span class="tot${n > 0 ? ' gain' : n < 0 ? ' loss' : ''}">${n ? money(n, { sign: n > 0, cur }) : ''}</span></div>
      <div class="group plain-list catitems">${ts.map(t => txRow(t, rowOpts)).join('')}</div></section>`;
  }).join('');
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
/** Un Journal vide : un dessin, la phrase, et ce qui en sort (« Retirer les filtres »). @param {string} text @param {string} action @param {string} ic */
const emptyPeriod = (text, action, ic) => `<div class="empty"><div class="illu">${icon(ic)}</div><p>${text}</p>${action}</div>`;

// Par catégorie (telle que saisie, sous-catégorie comprise) : les plus gros montants d'abord, à égalité dans l'ordre
// choisi des catégories, les virements en dernier. Chaque bloc : la catégorie (pastille, nom, nombre d'opérations,
// total), puis ses opérations en retrait, plus petites, la date en titre.
function byCategoryHTML(list, cur, acc, rowOpts) {
  const order = new Map([...allCategories('expense'), ...allCategories('income')].map((c, i) => [c.id, i]));
  const groups = new Map();
  for (const t of list) {
    const k = t.type === 'transfer' ? '~transfer' : t.categoryId || '~none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const rows = [...groups].map(([k, ts]) => ({ k, ts, n: totals(ts, cur, acc, rowOpts.soon).net, abs: ts.filter(t => !t.void && txCur(t) === cur).reduce((s, t) => s + t.amount, 0) }));
  rows.sort((a, b) => Number(a.k === '~transfer') - Number(b.k === '~transfer') || b.abs - a.abs || (order.get(a.k) ?? 1e9) - (order.get(b.k) ?? 1e9));
  return rows.map(({ k, ts, n, abs }) => {
    const c = k.startsWith('~') ? null : category(k);
    const pill = c ? chip(c) : `<span class="pill acc">${icon(k === '~transfer' ? 'arrows-left-right' : 'tag')}</span>`;
    const name = c ? c.name : k === '~transfer' ? 'Virements' : 'Sans catégorie';
    // les virements ne font ni entrer ni sortir d'argent (tous portefeuilles) : leur total est la somme déplacée
    const moved = k === '~transfer' && !acc ? abs : 0;
    return `<section class="catgroup"><div class="cathead">${pill}<div class="main"><div class="t">${esc(name)}</div>
      <div class="s">${ts.length} opération${ts.length > 1 ? 's' : ''}</div></div><span class="tot${n > 0 ? ' gain' : n < 0 ? ' loss' : moved ? ' quiet' : ''}">${n ? money(n, { sign: n > 0, cur }) : moved ? money(moved, { cur }) : ''}</span></div>
      <div class="group plain-list catitems">${ts.map(t => txRow(t, { ...rowOpts, inGroup: true })).join('')}</div></section>`;
  }).join('');
}

// Par mois (longues périodes, recherche), sur le modèle des jours : l'abréviation du mois en grand, le mois, l'année
// dessous et le total ; puis ses opérations en retrait (la catégorie en titre, la date dessous). MONTHS mois à la
// fois.
const fmtMonthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtMonthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
function monthsHTML(list, cur, acc, rowOpts) {
  const ms = settings().monthStart;
  const months = [];
  for (const t of list) {
    const p = period(t.date, ms);
    let m = months[months.length - 1];
    if (!m || m.p.start !== p.start) { m = { p, ts: [] }; months.push(m); }
    m.ts.push(t);
  }
  const shown = months.slice(0, f.months);
  return shown.map(({ p, ts }) => {
    const n = totals(ts, cur, acc, rowOpts.soon).net;
    // mois décalé (début le 25…) : il porte le nom du mois où il finit, comme une paie
    const named = parse(ms === 1 ? p.start : p.end);
    const abbr = fmtMonthShort.format(named).replace('.', '');
    const title = ms === 1 ? cap(fmtMonthLong.format(named)) : `${shortDate(p.start)} – ${shortDate(p.end)}`;
    return `<section class="catgroup monthblock"><div class="cathead"><span class="daynum mon" aria-hidden="true">${esc(abbr)}</span>
      <div class="main"><div class="t">${esc(title)}</div><div class="s">${named.getFullYear()}</div></div>
      <span class="tot${n > 0 ? ' gain' : n < 0 ? ' loss' : ''}">${n ? money(n, { sign: n > 0, cur }) : ''}</span></div>
      <div class="group plain-list catitems">${ts.map(t => txRow(t, { ...rowOpts, date: true, dateLabel: true })).join('')}</div></section>`;
  }).join('') + (shown.length < months.length ? `<button class="btn secondary more" data-more>Afficher les mois d’avant</button>` : '');
}

// Onglets de période, du plus ancien (à gauche) à aujourd'hui, puis « À venir » s'il y a des opérations prévues. Ils
// remontent jusqu'à la période de la première opération, MAX_TABS au plus (mais toujours jusqu'à la période affichée,
// venue d'un lien) ; further : il reste plus ancien.
function tabsFor(w, ms, hasPlanned, first) {
  const tabs = [];
  let further = false;
  if (w.unit === 'custom') tabs.push({ w, label: w.label });
  else if (w.unit === 'all' || !w.start) tabs.push({ w: windowOf('all'), label: 'Tout' });
  else {
    let cur = windowOf(w.unit, today(), ms);
    tabs.push({ w: cur, label: tabLabel(cur, ms) });
    while ((tabs.length < MAX_TABS && cur.start > first) || cur.start > w.start) {
      cur = shiftWindow(cur, -1, ms);
      tabs.unshift({ w: cur, label: tabLabel(cur, ms) });
    }
    further = cur.start > first;
  }
  if (hasPlanned) tabs.push({ soon: true, label: 'À venir' });
  return { tabs, further };
}
const tabHTML = (x, on) => (x.group
  ? `<button type="button" role="tab" class="ops-tab ops-gap${on ? ' on' : ''}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-gap="${x.group}" aria-label="${esc(x.label)} : aucune opération">${esc(x.label)}</button>`
  : `<button type="button" role="tab" class="ops-tab${on ? ' on' : ''}" aria-selected="${on}" tabindex="${on ? 0 : -1}"${x.soon ? ' data-soon' : ` data-from="${x.w.start || ''}" data-to="${x.w.end || ''}"`}>${esc(x.label)}</button>`);
const fmtGap = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });
/**
 * Les périodes vides qui se suivent (2026-11-19, avec l'utilisateur : un portefeuille qui n'existait pas encore, ou qui ne
 * sert qu'aux grosses occasions, faisait défiler des onglets à 0) tiennent dans un seul onglet « déc. 2024 – mars 2025 » ; la barre part toujours de la première opération. Jamais la période affichée ni celle d'aujourd'hui ; deux
 * vides au moins. Il se choisit comme un autre onglet, sans rien déplier : le corps dit ce qu'il couvre (« Aucune
 * opération du 25 oct 2024 au 27 nov 2025. »). @param {any[]} tabs @param {(w: any) => boolean} empty
 * @param {(w: any) => boolean} keep
 */
function groupEmpty(tabs, empty, keep) {
  const out = [];
  for (let i = 0; i < tabs.length;) {
    const x = tabs[i];
    if (x.soon || x.group || keep(x.w) || !empty(x.w)) { out.push(x); i++; continue; }
    let j = i;
    while (j + 1 < tabs.length && !tabs[j + 1].soon && !keep(tabs[j + 1].w) && empty(tabs[j + 1].w)) j++;
    const key = `${x.w.start}_${tabs[j].w.end}`;
    if (j > i) {
      const a = fmtGap.format(parse(x.w.start)).replace('.', ''), b = fmtGap.format(parse(tabs[j].w.start)).replace('.', '');
      out.push({ group: key, n: j - i + 1, w: { start: x.w.start, end: tabs[j].w.end }, label: a === b ? a : `${a.replace(/ \d{4}$/, a.slice(-4) === b.slice(-4) ? '' : '$&')} – ${b}` });
    } else out.push(...tabs.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

// sens d'arrivée de la liste après un glisser de période (1 : elle entre par la droite, −1 : par la gauche)
let enter = 0;
// Glisser horizontal n'importe où sur l'écran, vide sous la liste compris (pas sur la barre d'onglets, qui défile
// elle-même, ni dans la recherche) : au-delà
// de 72 px (ou un geste vif), l'onglet voisin est touché — vers la gauche la période suivante, vers la droite la
// précédente. Sans voisin, la liste résiste et revient. Rien pendant une recherche (pas d'onglets).
function swipePeriods(scr, perEl, listEl) {
  if (!scr) return;
  let swallow = false;
  // un glisser ne doit pas ouvrir la fiche de l'opération sous le doigt
  scr.addEventListener('click', e => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
  scr.addEventListener('pointerdown', e => {
    const el = /** @type {Element} */ (e.target);
    if (!e.isPrimary || e.button > 0 || el.closest('.ops-tabs, .ops-find, input')) return;
    const on = $('.ops-tab.on', perEl);
    if (!on) return;
    const sib = n => (n && n.classList.contains('ops-tab') ? n : null);
    const prev = sib(on.previousElementSibling), next = sib(on.nextElementSibling);
    const moving = [listEl, $('.ops-sum', perEl)].filter(Boolean);
    const x0 = e.clientX, y0 = e.clientY, t0 = performance.now();
    let mode = '', dx = 0;
    const set = (x, anim = false) => moving.forEach(m => {
      m.style.transition = anim ? 'transform .2s var(--spring)' : 'none';
      m.style.transform = x ? `translateX(${x}px)` : '';
    });
    const move = ev => {
      const mx = ev.clientX - x0, my = ev.clientY - y0;
      if (!mode) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) mode = 'h';
        else if (Math.abs(my) > 10) { done(); return; }
        else return;
      }
      dx = mx;
      set((dx < 0 ? next : prev) ? dx * 0.6 : dx * 0.15);
    };
    const up = () => {
      done();
      if (mode !== 'h') return;
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
      const target = dx < 0 ? next : prev;
      const fast = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.5;
      if (!target || !(Math.abs(dx) > 72 || (fast && Math.abs(dx) > 30))) { set(0, true); return; }
      enter = dx < 0 ? 1 : -1;
      if (reducedMotion()) { target.click(); return; }
      set(dx < 0 ? -72 : 72, true);
      setTimeout(() => target.click(), 90);
    };
    function done() {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

export function render(app, ctx) {
  const fl = readFilters();
  const ms = settings().monthStart;
  const w = currentWindow(fl);
  // longue période : la liste va par mois
  const long = !fl.soon && (!w.start || ['quarter', 'year'].includes(w.unit) || (w.unit === 'custom' && (parse(w.end).getTime() - parse(w.start).getTime()) / 864e5 + 1 > LONG_DAYS));
  f.months = MONTHS;
  // prévues qui passent les filtres (portefeuille, catégorie, type) : l'onglet « À venir » n'existe que s'il y en a
  const hasPlanned = duesFor(fl).length > 0;
  if (fl.soon && !hasPlanned) fl.soon = false;
  const acc = fl.acc ? account(fl.acc) : null;
  const cur = acc ? acc.currency : settings().currency;
  const nFilters = (fl.cat ? 1 : 0) + (fl.type ? 1 : 0);
  const res = fl.res ? reserveById(fl.res) : null;
  // un changement de filtre ou de période remplace l'adresse (pas de page en plus : le retour mène toujours à l'écran
  // d'origine) et redessine sur place : même défilement, sans l'animation d'entrée d'écran (elle part de la transparence
  // et faisait flasher la page à chaque onglet ou glisser)
  const setFilters = patch => {
    buzz(6);
    afterSheets(() => {
      const h = opsHref({ ...fl, ...patch });
      if (h !== location.hash) history.replaceState(history.state, '', h);
      ctx.refresh();
    });
  };

  // solde en tête : le portefeuille choisi, ou le total de la devise principale (les autres devises nommées dessous)
  const bal = acc ? balances()[acc.id] || 0 : totalBalance();
  const others = acc ? [] : otherTotals();
  const several = accounts().length > 1;

  app.innerHTML = `<div class="screen ops">
    ${topbarHTML({ title: 'Journal', back: false, right: `<button type="button" class="iconbtn" data-find aria-label="Rechercher une opération" aria-pressed="${f.find}">${icon('magnifying-glass')}</button>
        <button type="button" class="iconbtn ops-flt${nFilters ? ' on' : ''}" data-flt aria-label="Période et filtres${nFilters ? ` (${nFilters} actif${nFilters > 1 ? 's' : ''})` : ''}">${icon('sliders-horizontal')}</button>` })}
    <div class="search ops-find" data-findbox ${f.find ? '' : 'hidden'}>${icon('magnifying-glass')}<input type="search" data-q placeholder="Note, catégorie, montant…" value="${esc(f.q)}" enterkeyhint="search" autocomplete="off" aria-label="Rechercher une opération"></div>
    <section class="ops-bal">
      <div class="eyebrow">Solde</div>
      <div class="big${bal < 0 ? ' neg' : ''}">${splitAmount(Math.abs(bal), { cur, neg: bal < 0 })}</div>
      ${others.length ? `<div class="sub">et ${others.length} autre${others.length > 1 ? 's' : ''} devise${others.length > 1 ? 's' : ''}</div>` : ''}
      <button type="button" class="ops-wal" data-wal>${acc ? '' : icon('wallet')}<span>${esc(acc ? acc.name : 'Tous les portefeuilles')}</span>${icon('caret-down')}</button>
      ${res ? `<button type="button" class="fchip on ops-res" data-resx aria-label="Retirer le filtre : réserve ${esc(res.name)}">${res.category ? catIcon(category(res.category)?.icon || 'dots-three') : icon('piggy-bank')}<span>${esc(res.name)}</span>${icon('x')}</button>` : ''}
    </section>
    <div data-period></div>
    <div data-list></div>
  </div>`;

  const listEl = $('[data-list]', app), perEl = $('[data-period]', app);
  /** l'onglet regroupé choisi (ses périodes vides), le temps de le regarder @type {string|null} */
  let gapSel = null;
  function paint() {
    const searching = !!f.q.trim();
    const soonDues = fl.soon && !searching ? duesFor(fl) : null;
    const all = soonDues ? soonDues.map(dueAsTx) : filtered(fl, w, searching);
    const list = fl.soon && !searching ? [...all].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) : [...all].sort(byDateDesc);
    const rowOpts = { wallet: several && !acc, acc: fl.acc, soon: fl.soon && !searching };
    let t = totals(list, cur, fl.acc, rowOpts.soon);
    const foreign = list.some(x => !x.void && txCur(x) !== cur);
    /** @type {any} */
    let gap = null;

    // onglets de période et résumé (pas pendant une recherche : elle parcourt tout le journal)
    if (searching) perEl.innerHTML = `<p class="muted ops-count">${list.length} résultat${list.length > 1 ? 's' : ''}, toutes périodes</p>`;
    else {
      // la première opération (toutes, quels que soient les filtres) borne la barre
      const first = moves().reduce((m, x) => (!x.void && x.date < m ? x.date : m), today());
      const built = tabsFor(w, ms, hasPlanned, first), further = built.further;
      const now = windowOf(w.unit, today(), ms);
      const tabs = w.unit === 'custom' || w.unit === 'all' ? built.tabs : groupEmpty(built.tabs,
        x => !filtered(fl, x, false).some(o => !o.void),
        x => (x.start === w.start && x.end === w.end) || x.start === now.start);
      gap = gapSel ? tabs.find(x => x.group === gapSel) || null : null;
      if (!gap) gapSel = null;
      else { list.length = 0; t = totals([], cur, fl.acc, false); }
      perEl.innerHTML = `<div class="ops-tabs" role="tablist" aria-label="Période">${further ? `<button type="button" class="ops-further" data-further>${icon('caret-left')}Plus loin</button>` : ''}${tabs.map(x => tabHTML(x, x.group ? x.group === gapSel : !gap && (x.soon ? fl.soon : !fl.soon && (x.w.start || null) === (w.start || null) && (x.w.end || null) === (w.end || null)))).join('')}</div>
      ${sumHTML(t, cur, fl, foreign)}`;
      const bar = $('.ops-tabs', perEl);
      // un toucher sur un onglet (délégué : les onglets ajoutés en glissant fonctionnent aussi)
      bar.onclick = e => {
        if (e.target.closest('[data-further]')) { openFilters(addDays(tabs.find(x => !x.soon).w.start, -1)); return; }
        const b = e.target.closest('.ops-tab');
        if (!b) return;
        if (b.dataset.gap) { gapSel = b.dataset.gap; buzz(6); paint(); return; }
        gapSel = null;
        if ('soon' in b.dataset) setFilters({ soon: true });
        else setFilters({ soon: null, from: b.dataset.from || null, to: b.dataset.to || null });
      };
      bar.onkeydown = e => {
        const btns = $$('.ops-tab', bar), i = btns.indexOf(document.activeElement);
        const j = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
        if (i < 0 || j === null || !btns[j]) return;
        e.preventDefault();
        btns[j].focus();
        btns[j].click();
      };
      // Entrées / Sorties : un toucher filtre la liste sur ce type (un second toucher retire le filtre)
      $$('[data-sumtype]', perEl).forEach(b => {
        b.onclick = () => setFilters({ type: fl.type === b.dataset.sumtype ? null : b.dataset.sumtype });
      });
      // l'onglet affiché est visible (au bout à droite pour la période en cours) : centré, puis calé sur le début d'un
      // onglet (jamais un bout de mot coupé à gauche), sans jamais le couper à droite. Recalé quand la police arrive ou
      // que la largeur change (2026-11-13 : calé une seule fois, « Ce mois-ci » sortait à droite)
      const on = $('.ops-tab.on', perEl);
      const center = () => {
        if (!on || !on.isConnected) return;
        const kids = /** @type {HTMLElement[]} */ ([...bar.children]);
        const base = kids[0].offsetLeft, starts = kids.map(k => k.offsetLeft - base);
        const left = on.offsetLeft - base, right = left + on.offsetWidth;
        const x = Math.min(left - (bar.clientWidth - on.offsetWidth) / 2, bar.scrollWidth - bar.clientWidth);
        let start = starts.filter(v => v <= x + 1).pop() || 0;
        // calé à gauche, il pourrait couper l'onglet à droite : le premier début qui le laisse entier
        if (right > start + bar.clientWidth) start = starts.find(v => v >= right - bar.clientWidth) ?? left;
        bar.scrollLeft = start;
      };
      center();
      document.fonts?.ready.then(center);
      if (typeof ResizeObserver !== 'undefined' && on) {
        const ro = new ResizeObserver(() => { if (!bar.isConnected) ro.disconnect(); else center(); });
        ro.observe(bar);
      }
    }

    let body;
    if (!list.length) {
      const clearBtn = nFilters || res ? '<button class="btn secondary sm" data-clear>Retirer les filtres</button>' : '';
      if (gap) body = emptyPeriod(`Aucune opération${acc ? ` dans ${esc(acc.name)}` : ''} du ${esc(yearDate(gap.w.start))} au ${esc(yearDate(gap.w.end))}${nFilters || res ? ' avec ces filtres' : ''}.`, '', 'calendar-blank');
      else if (searching) body = emptyPeriod('Aucune opération ne correspond.', '', 'magnifying-glass');
      else if (!moves().some(x => !x.void)) body = emptyPeriod('Pas encore d’opération.', '', 'list-bullets'); // le + du bas suffit
      else body = emptyPeriod(`Aucune opération sur cette période${acc ? ` dans ${esc(acc.name)}` : ''}${nFilters || res ? ' avec ces filtres' : ''}.`, clearBtn, 'calendar-blank');
    } else if (soonDues) body = `<div class="group ops-dues">${dueRowsHTML(soonDues)}</div>`; // les mêmes lignes que Plan, ses styles compris
    else if (searching) body = monthsHTML(list, cur, fl.acc, rowOpts);
    else if (f.group === 'cat') body = byCategoryHTML(list, cur, fl.acc, rowOpts);
    else body = long ? monthsHTML(list, cur, fl.acc, rowOpts) : daysHTML(list, cur, fl.acc, rowOpts);
    listEl.innerHTML = body;
    // l'onglet regroupé se redessine sur place : la poussée du glisser (± 72 px) ne doit pas lui rester
    listEl.style.transition = listEl.style.transform = '';
    if (soonDues) wireDues(listEl, soonDues, ctx);
    fitText(listEl, '.row .amt');
    fitText(app, '.ops-bal .big');
    fitText(perEl, '.ops-sum b', 11);

    const clear = $('[data-clear]', listEl);
    if (clear) clear.onclick = () => setFilters({ cat: null, type: null, res: null });
    const more = $('[data-more]', listEl);
    if (more) more.onclick = () => { f.months += MONTHS; buzz(6); paint(); };
    // arrivée après un glisser : la nouvelle période entre du côté opposé au geste
    if (enter) {
      const d = enter;
      enter = 0;
      if (!reducedMotion()) [listEl, $('.ops-sum', perEl)].filter(Boolean).forEach(el => el.animate(
        [{ transform: `translateX(${d * 56}px)` }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)' }));
    }
  }
  paint();
  swipePeriods($('.screen.ops', app), perEl, listEl);

  // Feuille « Période et filtres » : d'abord ce qu'on voit (période, type, catégorie), puis comment (par jours ou par
  // catégories). Les choix se font dans la feuille ; le bouton dit combien d'opérations on verra et les met en place.
  // further : ouverte depuis « Plus loin » (bout de la barre), la veille du plus ancien onglet ; « Personnalisé »
  // d'emblée, le calendrier « Du » s'ouvre dessus.
  function openFilters(further = null) {
    buzz(6);
    const pick = { unit: w.unit, group: f.group, type: fl.type, cat: fl.cat, from: w.unit === 'custom' ? w.start : null, to: w.unit === 'custom' ? w.end : null };
    if (further) Object.assign(pick, { unit: 'custom', from: null, to: null });
    const DEF = { unit: 'month', group: 'day', type: null, cat: null };
    const s = openSheet(`<div class="flt">
      <div class="e-head">${sheetHead({ title: 'Période et filtres' })}
        <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
      <div class="flt-sec"><div class="eyebrow">Période</div><div class="flt-opts">${UNITS.map(([k, l]) => `<button type="button" class="fchip" data-u="${k}">${l}</button>`).join('')}</div>
        <div class="flt-dates" data-range hidden>
          <button type="button" class="flt-date" data-from><span>Du</span><b data-fromv></b></button>
          <button type="button" class="flt-date" data-to><span>Au</span><b data-tov></b></button></div>
        ${further ? '<p class="flt-hint">Pour remonter plus loin, choisis tes dates ou une période plus longue.</p>' : ''}</div>
      <div class="flt-sec"><div class="eyebrow">Type</div><div class="flt-opts">${[['', 'Tous'], ...Object.entries(TYPES)].map(([k, l]) => `<button type="button" class="fchip" data-t="${k}">${l}</button>`).join('')}</div></div>
      <div class="flt-sec" data-catsec><div class="eyebrow">Catégorie</div><div class="flt-catrow">
        <button type="button" class="row flt-cat" data-cat><span data-catp></span><div class="main"><div class="t" data-catl></div></div>${icon('caret-right')}</button>
        <button type="button" class="iconbtn flt-catx" data-catx aria-label="Retirer la catégorie" hidden>${icon('x')}</button></div></div>
      <div class="flt-sec"><div class="eyebrow">Afficher par</div>${seg([['day', 'Jours'], ['cat', 'Catégories']], pick.group, 'sm flt-group')}</div>
      <div class="flt-acts"><button type="button" class="btn secondary" data-reset>Réinitialiser</button><button type="button" class="btn primary" data-apply></button></div>
    </div>`, { label: 'Période et filtres' });
    const el = s.el;
    const groupSeg = $('.flt-group', el);
    // la période que donnerait la feuille : même échelle, on reste sur la période affichée (et sur « À venir ») ; sinon
    // celle d'aujourd'hui à la nouvelle échelle
    const same = () => pick.unit === w.unit && pick.unit !== 'custom';
    const nextWindow = () => same() ? w : pick.unit === 'custom' ? (pick.from ? windowFor(pick.from, pick.to, ms) : null) : windowOf(pick.unit, today(), ms);
    const nextFilters = () => ({ ...fl, soon: same() ? fl.soon : false, type: pick.type, cat: pick.cat, exact: pick.cat === fl.cat ? fl.exact : false });
    const paintSheet = () => {
      $$('[data-u]', el).forEach(b => { const on = b.dataset.u === pick.unit; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      $$('[data-t]', el).forEach(b => { const on = (b.dataset.t || null) === (pick.type || null); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      $('[data-range]', el).hidden = pick.unit !== 'custom';
      $('[data-fromv]', el).textContent = pick.from ? shortDate(pick.from) : 'Choisir';
      $('[data-tov]', el).textContent = pick.to ? shortDate(pick.to) : 'Choisir';
      // un virement n'a pas de catégorie
      $('[data-catsec]', el).hidden = pick.type === 'transfer';
      const c = pick.cat ? category(pick.cat) : null;
      $('[data-catp]', el).innerHTML = c ? chip(c) : `<span class="pill">${icon('squares-four')}</span>`;
      $('[data-catl]', el).textContent = c ? c.name : 'Toutes les catégories';
      $('[data-catx]', el).hidden = !c;
      $('[data-reset]', el).disabled = pick.unit === DEF.unit && pick.group === DEF.group && !pick.type && !pick.cat;
      // le bouton annonce le résultat
      const nw = nextWindow();
      const n = nw ? filtered(nextFilters(), nw, false).filter(t => !t.void).length : null;
      $('[data-apply]', el).textContent = n === null ? 'Choisir les dates' : n ? `Voir ${n} opération${n > 1 ? 's' : ''}` : 'Voir 0 opération';
    };
    const askFrom = async () => {
      const d = await pickDate({ current: pick.from || further || today(), title: 'Du' });
      if (!d) return false;
      pick.from = d;
      if (!pick.to || pick.to < d) pick.to = d;
      paintSheet();
      return true;
    };
    const askTo = async () => {
      const d = await pickDate({ current: pick.to || pick.from || today(), title: 'Au' });
      if (!d) return;
      if (pick.from && d < pick.from) [pick.from, pick.to] = [d, pick.from]; else pick.to = d;
      if (!pick.from) pick.from = d;
      paintSheet();
    };
    $$('[data-u]', el).forEach(b => (b.onclick = () => {
      pick.unit = b.dataset.u;
      // « Personnalisé » part de la période affichée (aujourd'hui pour « Tout »), à ajuster
      if (pick.unit === 'custom' && !pick.from) { pick.from = w.start && w.start <= today() ? w.start : today(); pick.to = w.start && w.end < today() ? w.end : today(); }
      buzz(6);
      paintSheet();
    }));
    $('[data-from]', el).onclick = askFrom;
    $('[data-to]', el).onclick = askTo;
    $$('[data-t]', el).forEach(b => (b.onclick = () => {
      pick.type = b.dataset.t || null;
      // la catégorie suit le type : retirée pour un virement ou une catégorie de l'autre sens
      const c = pick.cat ? category(pick.cat) : null;
      if (c && pick.type && c.type !== pick.type) pick.cat = null;
      buzz(6);
      paintSheet();
    }));
    wireSeg(groupSeg, v => { pick.group = v; paintSheet(); });
    $('[data-cat]', el).onclick = async () => {
      const type = pick.type === 'expense' || pick.type === 'income' ? pick.type : 'any';
      const id = await pickCategory({ type, current: pick.cat || '*', all: true, title: 'Catégorie' });
      if (id) { pick.cat = id === '*' ? null : id; paintSheet(); }
    };
    $('[data-catx]', el).onclick = () => { pick.cat = null; buzz(6); paintSheet(); };
    $('[data-close]', el).onclick = () => { buzz(6); s.close(); };
    $('[data-reset]', el).onclick = () => {
      Object.assign(pick, DEF, { from: null, to: null });
      $$('button[data-v]', groupSeg).forEach((b, i) => { b.classList.toggle('on', i === 0); b.setAttribute('aria-selected', String(i === 0)); });
      groupSeg.style.setProperty('--i', '0');
      buzz(6);
      paintSheet();
    };
    $('[data-apply]', el).onclick = async () => {
      if (pick.unit === 'custom' && !pick.from && !(await askFrom())) return;
      const nw = nextWindow(), nf = nextFilters();
      f.unit = pick.unit;
      f.group = pick.group;
      s.close();
      setFilters({ soon: nf.soon || null, type: pick.type, cat: pick.cat, exact: nf.exact || null, from: nw.start || null, to: nw.end || null });
    };
    paintSheet();
    if (further) askFrom();
  }

  $('[data-flt]', app).onclick = () => openFilters();
  $('[data-q]', app).addEventListener('input', e => { f.q = e.target.value; paint(); });
  const find = $('[data-find]', app), box = $('[data-findbox]', app);
  find.onclick = () => {
    f.find = !f.find;
    buzz(6);
    box.hidden = !f.find;
    find.setAttribute('aria-pressed', String(f.find));
    if (f.find) $('[data-q]', box).focus();
    else if (f.q) { f.q = ''; $('[data-q]', box).value = ''; paint(); }
  };
  const resx = $('[data-resx]', app);
  if (resx) resx.onclick = () => setFilters({ res: null });
  $('[data-wal]', app).onclick = async () => {
    const id = await pickAccount({ current: fl.acc, all: true, title: 'Portefeuille' });
    if (id) setFilters({ acc: id === '*' ? null : id });
  };
  wireTxList(listEl);
  // en quittant le Journal (vers un autre écran), la recherche se referme : un lien venu de Budget montre sa période
  return () => { if (location.hash.split('?')[0] !== '#/operations') { f.q = ''; f.find = false; } };
}
