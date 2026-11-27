// Rapports (2026-11-27, avec l'utilisateur : reproduit de Money Lover ; on enlèvera ou renommera plus tard, avec lui) :
//   #/rapport            Rapport : le solde et le portefeuille, la période, solde au début et à la fin, Revenu net, Par
//                        catégorie (deux anneaux, Entrées | Sorties), Virements
//   #/rapport/net        Vue d'ensemble : le net par sous-période (barres, puis une ligne chacune)
//   #/rapport/detail     Détail des sorties (ou des entrées, ?type=income) : total, moyenne par jour, comparé à la moyenne
//                        des 3 périodes d'avant (la courbe cumulée), Répartition (l'anneau) | Tendance (les barres)
//   #/rapport/categorie  Rapport d'une catégorie : mêmes chiffres, barres par sous-période, liste → Journal filtré
// Même barre d'onglets de période que le Journal (period-bar.js), le calendrier en haut à droite choisit l'échelle. La
// période, le portefeuille, le type et la catégorie vivent dans l'adresse (?acc=&from=&to=&type=&cat=). Une seule devise :
// celle du portefeuille choisi, sinon la principale. Les calculs sont dans src/domain/report.js, les dessins dans
// report-charts.js.
import { settings, moves, account, category, topOf, txCur, balances, totalBalance, otherTotals } from '../core/store.js';
import { money, esc, today, windowOf, windowFor, shortDate, addDays } from '../core/format.js';
import { icon } from '../core/icons.js';
import { buzz, afterSheets, openSheet, seg, wireSeg, chip, splitAmount, fitText, $, $$ } from '../core/ui.js';
import { pickAccount, pickCategory, pickDate } from './pickers.js';
import { topbarHTML, wireBack, sheetHead, rowHTML, sectionHTML } from './parts.js';
import { opsHref } from './transactions.js';
import { UNITS, tabsFor, tabHTML, centerTab, swipePeriods, reportHref, reportState } from './period-bar.js';
import { flows, byCategory, transferred, percents, perDay, previousSpans, compare, subPeriods, spanDays } from '../domain/report.js';
import { donutHTML, barsHTML, curveHTML } from './report-charts.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// ce qui se garde d'un rendu à l'autre : la bascule Répartition | Tendance et la courbe dépliée (l'adresse, elle, garde la période)
const ui = { mode: 'share', curve: false };
if (typeof window !== 'undefined') window.addEventListener('bougette:space', () => Object.assign(ui, { mode: 'share', curve: false }));

// ce que dit « 3 périodes d'avant » selon l'échelle : [au pluriel, pour une seule]
const BEFORE = {
  day: ['jours', 'au jour d’avant'], week: ['semaines', 'à la semaine d’avant'], month: ['mois', 'au mois d’avant'],
  quarter: ['trimestres', 'au trimestre d’avant'], year: ['années', 'à l’année d’avant'], custom: ['périodes', 'à la période d’avant'],
};

/** Filtres lus dans l'adresse ; un portefeuille ou une catégorie disparus sont ignorés. La catégorie est une catégorie principale. */
function readFilters() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const acc = q.get('acc'), cat = q.get('cat'), from = q.get('from'), to = q.get('to'), type = q.get('type');
  const span = !!(from && to && DAY.test(from) && DAY.test(to) && from <= to);
  return {
    acc: acc && account(acc) ? acc : null, cat: cat && category(cat) ? topOf(cat) : null,
    type: type === 'income' ? 'income' : type === 'expense' ? 'expense' : null, from: span ? from : null, to: span ? to : null,
  };
}

/**
 * Le squelette d'un écran de rapport : la barre du haut (retour, titre, calendrier), ce qui précède les onglets (pre), les
 * onglets de période, puis le corps — body(env) rend { html, wire }, redessiné sur place quand env.paint() est appelé.
 * @param {HTMLElement} app @param {any} ctx
 * @param {{ route: string, title: string, back: string, head?: boolean, pre?: (env: any) => string, wirePre?: (env: any) => void, body: (env: any) => { html: string, wire?: (el: HTMLElement) => void } }} o
 */
function screen(app, ctx, { route, title, back, head = false, pre = () => '', wirePre = () => {}, body }) {
  const fl = readFilters();
  const ms = settings().monthStart;
  const w = fl.from ? windowFor(fl.from, fl.to, ms) : windowOf(reportState.unit === 'custom' ? 'month' : reportState.unit, today(), ms);
  if (fl.from) reportState.unit = w.unit;
  const acc = fl.acc ? account(fl.acc) : null;
  const cur = acc ? acc.currency : settings().currency;
  const list = moves();
  // la première opération (toutes) borne la barre d'onglets et « Tout »
  const first = list.reduce((m, x) => (!x.void && x.date < m ? x.date : m), today());
  const span = { start: w.start || first, end: w.end || today() };
  // jusqu'à aujourd'hui pour une période en cours : pas de semaines à venir à zéro
  const shown = span.end > today() && span.start <= today() ? { start: span.start, end: today() } : span;
  const sc = { cur, curOf: txCur, acc: fl.acc, top: topOf };
  const setFilters = (/** @type {any} */ patch) => {
    buzz(6);
    afterSheets(() => {
      const h = reportHref(route, { ...fl, ...patch });
      if (h !== location.hash) history.replaceState(history.state, '', h);
      ctx.refresh();
    });
  };
  const env = { app, fl, w, ms, acc, cur, list, first, span, shown, sc, route, ctx, setFilters, paint: () => {}, setPeriod: (/** @type {any} */ nw) => {} };
  /** Le choix d'une échelle ou de dates : « Tout » n'a pas de dates dans l'adresse (period-bar.js). */
  env.setPeriod = nw => {
    reportState.unit = nw.unit;
    setFilters({ from: nw.start || null, to: nw.end || null });
  };

  app.innerHTML = `<div class="screen rep no-tabs">
    ${topbarHTML({ title, right: `<button type="button" class="iconbtn" data-cal aria-label="Choisir la période">${icon('calendar-blank')}</button>` })}
    ${head ? balanceHTML(env) : ''}${pre(env)}
    <div data-period></div>
    <div data-body></div>
  </div>`;
  wireBack(app, () => ctx.back(back));
  fitText(app, '.topbar .title', 18);
  const perEl = $('[data-period]', app), bodyEl = $('[data-body]', app);

  // les onglets de période, comme le Journal
  const built = tabsFor(w, ms, false, first);
  perEl.innerHTML = `<div class="ops-tabs" role="tablist" aria-label="Période">${built.further ? `<button type="button" class="ops-further" data-further>${icon('caret-left')}Plus loin</button>` : ''}${built.tabs.map(x => tabHTML(x,
    (x.w.start || null) === (w.start || null) && (x.w.end || null) === (w.end || null))).join('')}</div>`;
  const bar = $('.ops-tabs', perEl);
  bar.onclick = e => {
    if (e.target.closest('[data-further]')) { openPeriod(env, addDays(built.tabs[0].w.start, -1)); return; }
    const b = e.target.closest('.ops-tab');
    if (!b) return;
    const nw = built.tabs.find(x => (x.w.start || '') === b.dataset.from && (x.w.end || '') === b.dataset.to)?.w;
    if (nw) env.setPeriod(nw);
  };
  bar.onkeydown = e => {
    const btns = $$('.ops-tab', bar), i = btns.indexOf(document.activeElement);
    const j = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : null;
    if (i < 0 || j === null || !btns[j]) return;
    e.preventDefault();
    btns[j].focus();
    btns[j].click();
  };
  centerTab(bar);
  $('[data-cal]', app).onclick = () => openPeriod(env, null);

  env.paint = () => {
    const r = body(env);
    bodyEl.innerHTML = r.html;
    $$('[data-go]', bodyEl).forEach(b => (b.onclick = () => { buzz(6); ctx.go(b.dataset.go); }));
    fitText(bodyEl, '.rp-big, .rp-mid b, .rp-col b', 11);
    r.wire?.(bodyEl);
  };
  env.paint();
  wirePre(env);
  swipePeriods($('.screen', app), perEl, () => [bodyEl]);
  return null;
}

/** Le solde et le portefeuille, en tête (comme le Journal : ops-bal, data-wal). @param {any} env */
function balanceHTML({ acc, cur }) {
  const bal = acc ? balances()[acc.id] || 0 : totalBalance();
  const others = acc ? [] : otherTotals();
  return `<section class="ops-bal">
      <div class="eyebrow">Solde</div>
      <div class="big${bal < 0 ? ' neg' : ''}">${splitAmount(Math.abs(bal), { cur, neg: bal < 0 })}</div>
      ${others.length ? `<div class="sub">et ${others.length} autre${others.length > 1 ? 's' : ''} devise${others.length > 1 ? 's' : ''}</div>` : ''}
      <button type="button" class="ops-wal" data-wal>${acc ? '' : icon('wallet')}<span>${esc(acc ? acc.name : 'Tous les portefeuilles')}</span>${icon('caret-down')}</button>
    </section>`;
}
/** Branche le choix du portefeuille et ajuste le grand solde. @param {any} env */
function wireWallet(env) {
  fitText(env.app, '.ops-bal .big');
  $('[data-wal]', env.app).onclick = async () => {
    const id = await pickAccount({ current: env.fl.acc, all: true, title: 'Portefeuille' });
    if (id) env.setFilters({ acc: id === '*' ? null : id });
  };
}

/**
 * La feuille de période (le calendrier en haut à droite, comme Money Lover) : Jour, Semaine, Mois, Trimestre, Année, Tout
 * (un toucher et c'est fait), Personnalisé (deux dates, puis Voir). further : ouverte depuis « Plus loin », la veille du
 * plus ancien onglet.
 * @param {any} env @param {string|null} further
 */
function openPeriod(env, further) {
  buzz(6);
  const { w, ms } = env;
  const pick = { from: w.unit === 'custom' ? w.start : null, to: w.unit === 'custom' ? w.end : null, custom: !!further || w.unit === 'custom' };
  const s = openSheet(`<div class="flt">
    <div class="e-head">${sheetHead({ title: 'Période' })}<button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="flt-sec"><div class="flt-opts">${UNITS.map(([k, l]) => `<button type="button" class="fchip${k === w.unit || (k === 'custom' && pick.custom) ? ' on' : ''}" data-u="${k}">${l}</button>`).join('')}</div>
      <div class="flt-dates" data-range ${pick.custom ? '' : 'hidden'}>
        <button type="button" class="flt-date" data-from><span>Du</span><b data-fromv></b></button>
        <button type="button" class="flt-date" data-to><span>Au</span><b data-tov></b></button></div>
      ${further ? '<p class="flt-hint">Pour remonter plus loin, choisis tes dates ou une période plus longue.</p>' : ''}</div>
    <div class="flt-acts" data-acts ${pick.custom ? '' : 'hidden'}><button type="button" class="btn primary" data-apply>Voir</button></div>
  </div>`, { label: 'Période' });
  const el = s.el;
  const paintDates = () => {
    $('[data-fromv]', el).textContent = pick.from ? shortDate(pick.from) : 'Choisir';
    $('[data-tov]', el).textContent = pick.to ? shortDate(pick.to) : 'Choisir';
  };
  const askFrom = async () => {
    const d = await pickDate({ current: pick.from || further || today(), title: 'Du' });
    if (!d) return;
    pick.from = d;
    if (!pick.to || pick.to < d) pick.to = d;
    paintDates();
  };
  const askTo = async () => {
    const d = await pickDate({ current: pick.to || pick.from || today(), title: 'Au' });
    if (!d) return;
    if (pick.from && d < pick.from) [pick.from, pick.to] = [d, pick.from]; else pick.to = d;
    if (!pick.from) pick.from = d;
    paintDates();
  };
  $$('[data-u]', el).forEach(b => (b.onclick = () => {
    const unit = b.dataset.u;
    if (unit === 'custom') {
      // « Personnalisé » part de la période affichée (aujourd'hui pour « Tout »), à ajuster
      pick.custom = true;
      if (!pick.from) { pick.from = w.start && w.start <= today() ? w.start : today(); pick.to = w.start && w.end < today() ? w.end : today(); }
      $$('[data-u]', el).forEach(x => x.classList.toggle('on', x === b));
      $('[data-range]', el).hidden = false;
      $('[data-acts]', el).hidden = false;
      paintDates();
      buzz(6);
      return;
    }
    s.close();
    env.setPeriod(windowOf(unit, today(), ms));
  }));
  $('[data-from]', el).onclick = askFrom;
  $('[data-to]', el).onclick = askTo;
  $('[data-close]', el).onclick = () => { buzz(6); s.close(); };
  $('[data-apply]', el).onclick = async () => {
    if (!pick.from) await askFrom();
    if (!pick.from) return;
    s.close();
    env.setPeriod(windowFor(pick.from, pick.to, ms));
  };
  paintDates();
  if (further) askFrom();
}

// ---------- morceaux communs ----------
const cls = (/** @type {number} */ v) => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
/** La pastille d'une catégorie principale (ou « Sans catégorie »). @param {string|null} id */
const pillOf = id => (id ? chip(category(id)) : `<span class="pill acc">${icon('tag')}</span>`);
const nameOf = (/** @type {string|null} */ id) => (id ? category(id)?.name || 'Sans catégorie' : 'Sans catégorie');
/** Une opération dans une autre devise est-elle dans la période ? (la note « Sans les opérations dans une autre devise ») @param {any} env */
const hasForeign = ({ list, span, fl, cur }) => list.some((/** @type {any} */ t) => !t.void && !t.planned && t.date >= span.start && t.date <= span.end
  && txCur(t) !== cur && (!fl.acc || t.accountId === fl.acc || t.toAccountId === fl.acc));
const foreignNote = (/** @type {any} */ env) => (hasForeign(env) ? '<p class="ops-note rp-note">Sans les opérations dans une autre devise.</p>' : '');
/** Le Journal sur une période (et ce qu'il faut garder du filtre). @param {any} env @param {{ from?: string, to?: string, type?: string|null, cat?: string|null }} p */
const opsTo = (env, p) => opsHref({ acc: env.fl.acc, from: p.from || env.span.start, to: p.to || env.span.end, type: p.type || null, cat: p.cat || null });
/** Les parts de l'anneau d'un type. @param {any} env @param {'expense'|'income'} type */
function partsOf(env, type) {
  const { rows, total } = byCategory(env.list, env.span, env.sc, type);
  return {
    total,
    parts: rows.map(r => { const c = r.id ? category(r.id) : null; return { id: r.id, amount: r.amount, tint: c?.color || 'c0', name: nameOf(r.id), cat: c }; }),
  };
}
/** Une ligne de sous-période, qui ouvre le Journal sur elle. */
const subRow = (/** @type {string} */ label, /** @type {string} */ amount, /** @type {string} */ href, /** @type {string} */ tone) => rowHTML({
  cls: 'rp-subrow', attrs: `data-go="${esc(href)}"`, title: esc(label), end: `<span class="end"><span class="amt ${tone}">${amount}</span>${icon('caret-right')}</span>` });

/** « Total » et « Moyenne par jour ». @param {any} env @param {number} total @param {'expense'|'income'} type */
function figuresHTML(env, total, type) {
  const tone = type === 'income' ? 'gain' : 'loss';
  return `<div class="rp-figs"><div><span class="eyebrow">Total</span><b class="rp-big ${tone}">${esc(money(total, { cur: env.cur }))}</b></div>
    <div><span class="eyebrow">Moyenne par jour</span><b class="rp-big ${tone}">${esc(money(perDay(total, env.span, today()), { cur: env.cur }))}</b></div></div>`;
}
/** « Comparé à la moyenne des 3 mois », avec Afficher/Masquer la courbe cumulée. @param {any} env @param {'expense'|'income'} type @param {string|null} cat */
function compareHTML(env, type, cat) {
  const { w, ms, span } = env;
  if (!w.start) return '';
  const c = compare({ list: env.list, span, prev: previousSpans(w, 3, ms), sc: { ...env.sc, cat }, type, today: today(), first: env.first });
  if (!c) return '';
  const [many, one] = BEFORE[w.unit] || BEFORE.custom;
  const head = c.n > 1 ? `Comparé à la moyenne des ${c.n} ${many}` : `Comparé ${one}`;
  let curve = '';
  if (ui.curve && c.upto > 0) {
    const day = addDays(span.start, c.upto - 1);
    curve = `<div class="rp-curvebox">${curveHTML({ now: c.now, avg: c.avg, n: spanDays(span), start: shortDate(span.start), end: shortDate(span.end), at: day === today() ? 'aujourd’hui' : shortDate(day) })}
      <div class="rp-legend"><span><i class="rp-k now"></i>Cette période, au ${esc(shortDate(day))}<b>${esc(money(c.now[c.upto - 1] || 0, { cur: env.cur }))}</b></span>
        <span><i class="rp-k avg"></i>Moyenne, au ${esc(shortDate(day))}<b>${esc(money(c.avg[c.upto - 1] || 0, { cur: env.cur }))}</b></span></div></div>`;
  }
  return `<div class="rp-cmp"><div class="rp-cmpt"><span class="eyebrow">${esc(head)}</span><b class="rp-avg">${esc(money(c.avgTotal, { cur: env.cur }))}</b></div>
    <button type="button" class="fchip" data-curve aria-pressed="${ui.curve}">${icon(ui.curve ? 'eye-slash' : 'eye')}${ui.curve ? 'Masquer' : 'Afficher'}</button></div>${curve}`;
}
/** Branche Afficher/Masquer la courbe. @param {any} env @param {HTMLElement} el */
function wireCompare(env, el) {
  const b = $('[data-curve]', el);
  if (b) b.onclick = () => { ui.curve = !ui.curve; buzz(6); env.paint(); };
}
/** Les barres par sous-période (une seule série de ce type), puis la liste des sous-périodes. @param {any} env @param {'expense'|'income'} type @param {string|null} cat */
function trendHTML(env, type, cat) {
  const subs = subPeriods(env.shown, env.ms);
  const rows = subs.map(s => { const f = flows(env.list, s, { ...env.sc, cat }); return { s, v: type === 'income' ? f.inc : f.out }; });
  const tone = type === 'income' ? 'gain' : 'loss';
  return `${barsHTML(rows.map(r => ({ short: r.s.short, up: r.v })), { cur: env.cur, upCls: tone })}
    <div class="group plain-list rp-list">${rows.map(r => subRow(r.s.label, esc(money(r.v, { cur: env.cur })), opsTo(env, { from: r.s.start, to: r.s.end, type, cat }), tone === 'gain' ? 'in' : 'out')).join('')}</div>`;
}

// ---------- #/rapport ----------
function mainBody(env) {
  const { list, span, sc, cur, acc } = env;
  const t = flows(list, span, sc);
  const bal = (/** @type {string} */ d) => (acc ? balances(d)[acc.id] || 0 : totalBalance(d, cur));
  const line = (/** @type {string} */ label, /** @type {number} */ v) => `<div class="rp-line"><span>${label}</span><b>${esc(money(v, { cur }))}</b></div>`;
  const max = Math.max(t.inc, t.out, 1);
  const bar = (/** @type {string} */ label, /** @type {number} */ v, /** @type {string} */ tone, /** @type {string} */ text) => `<div class="rp-hb"><div class="rp-hl"><span>${label}</span><b class="${tone}">${esc(text)}</b></div>
    <div class="rp-track"><i class="${tone}" style="width:${v ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></i></div></div>`;
  const col = (/** @type {'income'|'expense'} */ type) => {
    const { parts, total } = partsOf(env, type);
    return `<button type="button" class="rp-col" data-go="${esc(reportHref('detail', { ...env.fl, type }))}" data-col="${type}"><span class="rp-ch"><span>${type === 'income' ? 'Entrées' : 'Sorties'}</span>${icon('caret-right')}</span>
      <b class="${type === 'income' ? 'gain' : 'loss'}">${esc(money(total, { cur }))}</b>${donutHTML(parts, { cur })}</button>`;
  };
  const moved = transferred(list, span, sc);
  const html = `${sectionHTML({ cls: 'rp-first', body: `${line('Solde au début', bal(addDays(span.start, -1)))}${line('Solde à la fin', bal(span.end))}` })}
    ${sectionHTML({ title: 'Revenu net', body: `<button type="button" class="rp-tap" data-go="${esc(reportHref('net', env.fl))}" data-net>
      <div class="big s${t.net < 0 ? ' neg' : ''} rp-big">${splitAmount(Math.abs(t.net), { cur, neg: t.net < 0 })}</div>
      ${bar('Entrées', t.inc, 'gain', money(t.inc, { cur, sign: t.inc > 0 }))}${bar('Sorties', t.out, 'loss', money(-t.out, { cur }))}
      <span class="rp-more">Vue d’ensemble${icon('caret-right')}</span></button>` })}
    ${sectionHTML({ title: 'Par catégorie', body: `<div class="rp-cols">${col('income')}${col('expense')}</div>` })}
    ${sectionHTML({ cls: 'rp-xfer', body: `<div class="group plain-list">${rowHTML({ pill: '<span class="pill acc">' + icon('arrows-left-right') + '</span>', title: 'Virements',
      attrs: `data-go="${esc(opsTo(env, { type: 'transfer' }))}" data-xfer`, end: `<span class="end"><span class="amt">${esc(money(moved, { cur }))}</span>${icon('caret-right')}</span>` })}</div>` })}
    ${foreignNote(env)}`;
  return { html };
}

// ---------- #/rapport/net ----------
function netBody(env) {
  const { list, span, sc, cur } = env;
  const t = flows(list, span, sc);
  const rows = subPeriods(env.shown, env.ms).map(s => ({ s, ...flows(list, s, sc) }));
  const html = `<section class="section rp-first"><div class="eyebrow">Revenu net</div>
      <div class="big s${t.net < 0 ? ' neg' : ''} rp-big">${splitAmount(Math.abs(t.net), { cur, neg: t.net < 0 })}</div>
      ${barsHTML(rows.map(r => ({ short: r.s.short, up: r.inc, down: r.out })), { cur })}</section>
    <div class="group plain-list rp-list">${rows.map(r => rowHTML({ cls: 'rp-net', attrs: `data-go="${esc(opsTo(env, { from: r.s.start, to: r.s.end }))}"`, title: esc(r.s.label),
      end: `<span class="end"><span class="rp-three"><span>Entrées <b class="gain">${esc(money(r.inc, { cur }))}</b></span><span>Sorties <b class="loss">${esc(money(r.out, { cur }))}</b></span>
        <span>Net <b class="${cls(r.net)}">${esc(money(r.net, { cur, sign: r.net > 0 }))}</b></span></span>${icon('caret-right')}</span>` })).join('')}</div>${foreignNote(env)}`;
  return { html };
}

// ---------- #/rapport/detail ----------
function detailBody(env) {
  const type = env.fl.type === 'income' ? 'income' : 'expense';
  const { parts, total } = partsOf(env, type);
  const pct = percents(parts.map(p => p.amount));
  const tone = type === 'income' ? 'in' : 'out';
  const none = `<p class="muted rp-none">Aucune ${type === 'income' ? 'entrée' : 'sortie'} sur cette période.</p>`;
  const share = `${donutHTML(parts, { big: true, total, cur: env.cur })}${total ? '' : none}
    <div class="group plain-list rp-list">${parts.map((p, i) => rowHTML({ cls: 'rp-cat', attrs: p.id ? `data-go="${esc(reportHref('categorie', { ...env.fl, type: null, cat: p.id }))}" data-cat="${esc(p.id)}"` : 'data-cat=""', tag: p.id ? 'button' : 'div',
      pill: pillOf(p.id), title: esc(p.name), sub: `${pct[i]} %`, end: `<span class="end"><span class="amt ${tone}">${esc(money(p.amount, { cur: env.cur }))}</span>${p.id ? icon('caret-right') : ''}</span>` })).join('')}</div>`;
  const html = `${figuresHTML(env, total, type)}${compareHTML(env, type, null)}
    <div class="rp-seg">${seg([['share', 'Répartition'], ['trend', 'Tendance']], ui.mode, 'rp-mode')}</div>
    <div data-mode>${ui.mode === 'trend' ? trendHTML(env, type, null) : share}</div>${foreignNote(env)}`;
  return {
    html,
    wire(el) {
      wireCompare(env, el);
      wireSeg($('.rp-mode', el), v => { ui.mode = v; env.paint(); });
    },
  };
}

// ---------- #/rapport/categorie ----------
function categoryBody(env) {
  const cat = env.fl.cat, c = cat ? category(cat) : null;
  if (!c) return { html: '<p class="muted rp-none">Choisis une catégorie pour voir son rapport.</p>' };
  const type = c.type === 'income' ? 'income' : 'expense';
  const total = flows(env.list, env.span, { ...env.sc, cat })[type === 'income' ? 'inc' : 'out'];
  return { html: `${figuresHTML(env, total, type)}${compareHTML(env, type, cat)}<div class="rp-trend">${trendHTML(env, type, cat)}</div>${foreignNote(env)}`, wire: el => wireCompare(env, el) };
}
/** La catégorie en haut, en gélule : un toucher ouvre le choix. @param {any} env */
const catPre = env => {
  const c = env.fl.cat ? category(env.fl.cat) : null;
  return `<div class="rp-pick"><button type="button" class="rp-catpick" data-pickcat>${c ? chip(c, 'sm') : `<span class="pill sm acc">${icon('squares-four')}</span>`}<span>${esc(c ? c.name : 'Choisir une catégorie')}</span>${icon('caret-down')}</button></div>`;
};

// ---------- les écrans ----------
// le Journal ouvert d'un rapport garde son retour : go() empile, back() revient
export function render(app, ctx) {
  return screen(app, ctx, { route: '', title: 'Rapport', back: '#/', head: true, body: mainBody, wirePre: wireWallet });
}
export const netScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render: (app, ctx) => screen(app, ctx, { route: 'net', title: 'Vue d’ensemble', back: '#/rapport', body: netBody }),
};
export const detailScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render: (app, ctx) => screen(app, ctx, { route: 'detail', title: readFilters().type === 'income' ? 'Détail des entrées' : 'Détail des sorties', back: '#/rapport', body: detailBody }),
};
export const categoryScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render: (app, ctx) => screen(app, ctx, { route: 'categorie', title: 'Rapport d’une catégorie', back: '#/rapport', pre: catPre, body: categoryBody,
    wirePre: env => {
      $('[data-pickcat]', env.app).onclick = async () => {
        const id = await pickCategory({ type: 'any', current: env.fl.cat, title: 'Catégorie' });
        if (id && id !== '*') env.setFilters({ cat: topOf(id) });
      };
    } }),
};
