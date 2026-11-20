// Accueil (D3 revu le 2026-11-17, D10) : le fil du mois (« À ce rythme, ton argent tient jusqu'au 26 », un fil de la
// période, un point à aujourd'hui, src/domain/pace.js (runway)), « Mon argent » (les portefeuilles hors du total y sont, marqués, hors du total),
// budgets en cours en bocaux posés sur une étagère (silhouette au trait, eau teintée dedans, texte dessous). Toucher un
// bocal ouvre le Journal filtré sur ce que compte son budget (une principale avec ses sous-catégories, une sous-catégorie
// seule) et sa période. États « premier jour »
// et « sans budget » (tuiles des catégories les plus dépensées). Mouvement (D5) après
// un ajout : bocal qui se tasse puis dont l'eau baisse et clapote,
// vibration de 6 ms à la fin ; le fil glisse jusqu'à son nouveau jour. Rien n'est posé dans une carte : tout est imprimé sur le papier.
import { settings, totalBalance, balances, accounts, countedAccounts, transactions, subcategories, allCategories, budgetReport, category, txCur, summary } from '../core/store.js';
import { period, today, money, esc, parse, shortDate, num, symbol, stepOf } from '../core/format.js';
import { chip, buzz, takeMotion, reducedMotion, dockTip, fitText, gs, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { runway, envelope, pickJars, daysBetween } from '../domain/pace.js';
import { openBudgetSheet } from './budget-sheet.js';
import { opsHref } from './transactions.js';
import { openAccountSheet, openCheckSheet, checkedLabel } from './accounts.js';
import { noWalletsHTML, accountPill } from './pickers.js';
import { unread } from '../core/inbox.js';
import { isMain, currentSpace } from '../core/spaces.js';
import { uiStyle } from '../core/store.js';
import * as proto from './home-proto.js';
import { openInboxSheet } from './backup.js';

const fmtHead = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
// Ce que l'écran montrait au dernier rendu : point de départ du mouvement suivant.
let shown = null;

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const JAR_H = 128; // hauteur d'un bocal (px)
const level = ratio => JAR_H * (0.06 + ratio * 0.78);
// Vague : surface sinusoïdale (amplitude amp, phase ph) au niveau donné, en coordonnées 170 × JAR_H.
function wave(lv, amp = 4, ph = 0) {
  const y = JAR_H - lv;
  let d = `M0 ${(y + Math.sin(ph) * amp).toFixed(2)}`;
  for (let x = 10; x <= 170; x += 10) d += ` L${x} ${(y + Math.sin(ph + x / 27) * amp).toFixed(2)}`;
  return `${d} L170 ${JAR_H} L0 ${JAR_H} Z`;
}
// Jours restants dans le mois de budget, aujourd'hui compris.

export function render(app, { go }) {
  // style Proto (D1, 2026-11-17) : l'accueil en tuiles
  if (uiStyle() === 'proto') { shown = null; proto.render(app, { go }); return; }
  const st = settings();
  const main = st.currency;
  const t = today();
  const p = period(t, st.monthStart);
  const all = transactions();
  const moves = all.filter(x => txCur(x) === main);
  // budgets en cours (D11 revu) : Disponible en tête, leurs restes dans les bocaux
  const report = budgetReport();
  const noBudget = !report.list.length;
  // premier jour : aucune dépense encore (D10)
  const firstDay = !all.some(x => x.type === 'expense' && !x.planned);
  const nAcc = accounts().length;
  // « Mon argent » (D3.5, revu le 2026-11-09) : le total de la devise principale (les autres devises nommées dessous,
  // sans conversion, D10), puis les portefeuilles dans l'ordre rangé (tous jusqu'à 4 ; au-delà, les 3 premiers et « Voir les N » : un
  // bouton qui ne cacherait qu'une ligne prendrait autant de place qu'elle), chacun avec son solde : on voit d'un
  // coup d'œil si les chiffres sont plausibles. Toucher un portefeuille = « Vérifier le solde » (recaler vite) ;
  // toucher le total ou « Voir les N » = Portefeuilles.
  const wallets = accounts();
  const bal = balances();
  const nOther = new Set(countedAccounts().filter(a => a.currency !== main).map(a => a.currency)).size;
  const total = totalBalance();
  // dont épargne (D17) : les portefeuilles d'épargne comptés dans le total, monnaie principale
  const saved = countedAccounts().filter(a => a.savings && a.currency === main).reduce((n, a) => n + (bal[a.id] || 0), 0);
  const discreet = st.discreet;

  // budgets en cours (dans l'ordre choisi des catégories) → bocaux : le reste de chacun sur sa période ; le budget d'une
  // principale compte aussi ses sous-catégories (D13 revu le 2026-11-11)
  const cur = summary(p);
  // plusieurs budgets sur une catégorie (2026-11-10) : un seul bocal, celui qui finit le plus tôt
  const firstEnd = new Map();
  for (const x of report.list) {
    const k = x.budget.category, was = firstEnd.get(k);
    if (!was || x.window.end < was.window.end) firstEnd.set(k, x);
  }
  const env = report.list.filter(x => category(x.budget.category) && firstEnd.get(x.budget.category) === x).map(x => ({
    cat: category(x.budget.category), budget: x.budget.amount, bcur: x.budget.currency, win: x.window, ...envelope(x.budget.amount, x.spent),
  }));
  const jars = /** @type {any[]} */ (pickJars(env, 4)); // env est any[] sous cette config : sans cast, T retombe sur sa borne
  // sans budget : tuiles des catégories principales les plus dépensées ce mois (sous-catégories comprises), sans eau
  // (à montant égal, l'ordre choisi : la liste part des catégories dans cet ordre, le tri est stable)
  const tiles = allCategories('expense').filter(c => !c.parent && cur.byCat[c.id]).map(c => ({ cat: c, spent: cur.byCat[c.id] })).sort((a, b) => b.spent - a.spent).slice(0, 4);

  // le fil du mois (D3, 2026-11-17) : l'argent courant compté moins les échéances à payer d'ici la fin de la période
  // (la lecture de Plan, D11, D18), au rythme des 14 derniers jours
  const run = runway({ base: report.total - report.toPay, moves, today: t, period: p, step: stepOf(main) });
  const at = (/** @type {string} */ d) => Math.max(0, Math.min(100, ((daysBetween(p.start, d) + 0.5) / p.days) * 100));
  const dayOf = (/** @type {string} */ d) => (d.slice(0, 7) === t.slice(0, 7) ? String(Number(d.slice(8))) : shortDate(d));
  const amt = (/** @type {number} */ v) => (discreet ? '•••' : money(v));
  const fil = {
    whole: { lead: 'À ce rythme, ton argent tient', big: 'tout le mois', sub: run.leftover ? `il en restera environ ${amt(run.leftover)} le ${dayOf(p.end)}` : `juste jusqu’au ${dayOf(p.end)}` },
    short: { lead: 'À ce rythme, ton argent tient', big: `jusqu’au ${dayOf(run.until)}`, sub: `${amt(run.cut)} de moins par jour, et tu tiens jusqu’au ${dayOf(p.end)}` },
    empty: { lead: 'Ce mois-ci,', big: 'tout est déjà engagé', sub: report.toPay ? `les échéances d’ici le ${dayOf(p.end)} prennent ce qui reste` : 'il ne reste rien sur tes portefeuilles courants' },
    unknown: { lead: 'Bientôt ici :', big: 'jusqu’où tient ton argent', sub: 'Note tes dépenses, le rythme se calcule tout seul.' },
  }[run.state];
  const now0 = at(t), stop = run.state === 'short' ? at(run.until) : run.state === 'empty' ? now0 : 100;

  app.innerHTML = `<div class="screen home">
    <div class="topbar">
      <div class="brand">${icon('logo')}<div class="d">${esc(cap(fmtHead.format(parse(t))))}<b>${isMain() ? 'Bougette' : esc(currentSpace().name)}</b></div></div>
      <button type="button" class="iconbtn round edge bell" data-inbox aria-label="Notifications${unread() ? ` (${unread()} nouvelle${unread() > 1 ? 's' : ''})` : ''}">${icon('bell')}${unread() ? '<i class="dot" aria-hidden="true"></i>' : ''}</button>
    </div>

    <section class="fil" data-fil="${run.state}">
      <div class="fil-lead">${fil.lead}</div>
      <div class="fil-big">${fil.big}</div>
      <div class="fil-track" aria-hidden="true">
        <i class="done" style="width:${now0}%"></i>
        ${stop > now0 ? `<i class="ahead" data-ahead style="left:${now0}%;width:${stop - now0}%"></i>` : ''}
        ${run.state === 'short' ? `<i class="tick" data-tick style="left:${stop}%"></i>` : ''}
        <span class="now" style="left:${now0}%"></span>
      </div>
      <div class="fil-axis" aria-hidden="true"><span>${dayOf(p.start)}</span>${run.state === 'short' && stop < 90 && stop - now0 > 8 ? `<span class="until" style="left:${stop}%">${dayOf(run.until)}</span>` : ''}<span>${dayOf(p.end)}</span></div>
      <div class="fil-sub">${fil.sub}</div>
    </section>

    ${noBudget && nAcc ? `<div class="fix-budget">
      <span class="pill" style="--c:var(--accent-text)">${icon('target')}</span>
      <div class="main"><b>Crée un budget</b><span>Donne une destination à ton argent.</span></div>
      <button class="btn primary sm" data-fix>Créer</button></div>` : ''}

    ${!nAcc ? noWalletsHTML() : `<section class="money">
      <button class="wal" data-go="#/portefeuilles">
        <span class="l"><b>Mon argent</b>${saved > 0 ? `<small>dont épargne ${gs(money(saved))}</small>` : ''}${nOther ? `<small>et ${nOther} autre${nOther > 1 ? 's' : ''} devise${nOther > 1 ? 's' : ''}</small>` : ''}</span><span class="v"><b class="${total < 0 ? 'loss' : ''}">${gs(money(total))}</b>${icon('caret-right')}</span></button>
      ${wallets.slice(0, wallets.length > 4 ? 3 : 4).map(a => `<button type="button" class="row mw" data-check="${a.id}" aria-label="${esc(a.name)} : vérifier le solde">${accountPill(a, 'sm')}
        <div class="main"><div class="t">${esc(a.name)}</div><div class="s">${a.excluded ? 'Hors du total · ' : ''}${checkedLabel(a.checkedAt)}</div></div>
        <span class="amt${(bal[a.id] || 0) < 0 ? ' loss' : ''}">${gs(money(bal[a.id] || 0, { cur: a.currency }))}</span></button>`).join('')}
      ${wallets.length > 4 ? `<button type="button" class="mw-more" data-go="#/portefeuilles">Voir les ${wallets.length}${icon('caret-right')}</button>` : ''}
    </section>`}

    ${firstDay && noBudget ? `<div class="jar-empty">
        <svg viewBox="0 0 64 80" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="16" y="3" width="32" height="10" rx="4"/><rect x="5" y="13" width="54" height="64" rx="16"/></svg>
        <p>Tes catégories se rempliront<br>avec tes premières dépenses.</p></div>`
      : noBudget ? (tiles.length ? `<div class="section-h"><h2>Catégories</h2><span class="muted">ce mois</span></div>
        <div class="jars">${tiles.map(x => `<button class="jar tile" data-go="${opsHref({ cat: x.cat.id, from: p.start, to: p.end })}" style="--c:var(--${x.cat.color})" aria-label="${esc(x.cat.name)} : voir les opérations">
          <div class="c"><div class="top">${chip(x.cat)}</div><div class="n">${esc(x.cat.name)}${subcategories(x.cat.id, { all: true }).length ? '<small class="inc"> et sous-cat.</small>' : ''}</div>
          <div class="a">${discreet ? '•••' : `${gs(num(x.spent))}<small>${esc(symbol(main))}</small>`}</div></div></button>`).join('')}</div>` : '')
        : jars.length ? `<div class="section-h"><h2>Budgets</h2><button class="link" data-go="#/mois">${jars.length} sur ${env.length}</button></div>
        <div class="jars">${jars.map(j => `<button class="jar${j.left <= 0 ? ' done' : ''}" data-go="${opsHref({ cat: j.cat.id, exact: !!j.cat.parent, from: j.win.start, to: j.win.end })}" data-jar="${j.cat.id}" style="--c:var(--${j.cat.color})" aria-label="${esc(j.cat.name)} : voir les dépenses de son budget">
          ${j.left > 0 ? `<svg class="w" viewBox="0 0 170 ${JAR_H}" preserveAspectRatio="none" aria-hidden="true"><path d="${wave(level(j.ratio), 4, j.cat.id.length)}"/></svg>` : ''}
          ${j.left < 0 ? `<span class="slate">${discreet ? '•••' : `+${gs(money(-j.left, { cur: j.bcur }))}`}</span>` : ''}
          <div class="c"><div class="top">${chip(j.cat, 'disc')}</div>
          <div class="n">${esc(j.cat.name)}</div>
          ${j.left > 0 ? `<div class="a">${discreet ? '•••' : `${gs(num(j.left, { cur: j.bcur }))}<small>${esc(symbol(j.bcur))}</small>`}</div>
          <div class="s">restants sur ${num(j.budget, { cur: j.bcur })}</div>`
          : `<div class="a">Épuisé</div><div class="s">${discreet ? '•••' : money(j.budget, { cur: j.bcur })} dépensés</div>`}</div></button>`).join('')}</div>`
          : ''}
  </div>`;

  $$('[data-go]', app).forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  const fix = $('[data-fix]', app);
  if (fix) fix.onclick = e => { e.stopPropagation(); buzz(8); openBudgetSheet(); };
  $$('[data-check]', app).forEach(b => b.addEventListener('click', () => {
    const a = accounts().find(x => x.id === b.dataset.check);
    if (a) { buzz(6); openCheckSheet(a); }
  }));
  $('[data-inbox]', app).onclick = () => { buzz(6); openInboxSheet(); };
  const nw = $('[data-new-wallet]', app);
  if (nw) nw.onclick = () => { buzz(6); openAccountSheet(null, { savings: false }); };
  // la bulle n'invite à la première dépense qu'une fois un portefeuille créé (sans portefeuille, on ne propose rien)
  dockTip(firstDay && nAcc ? 'Ajoute ta première dépense' : null);
  fitText(app, '.fil-big, .jar .a, .wal .v b, .money .mw .amt', 13);

  // --- mouvement (D5) ---
  const now = { stop, noBudget, jars: Object.fromEntries(jars.map(j => [j.cat.id, j.state === 'over' ? 0 : j.ratio])) };
  const cue = takeMotion();
  const prev = shown;
  shown = now;
  const animate = !!(cue && prev && prev.noBudget === noBudget && !reducedMotion());
  // ≈ 300 ms après la descente de la feuille (coche 320 ms + descente 460 ms)
  const delay = animate ? Math.max(0, cue.at + 1080 - performance.now()) : 0;
  if (!animate) return;
  // le fil glisse de son ancien jour au nouveau (le pointillé et le trait ambre)
  const ahead = $('[data-ahead]', app), tick = $('[data-tick]', app);
  if (prev.stop !== now.stop && (ahead || tick)) {
    const w = ahead ? ahead.style.width : '', l = tick ? tick.style.left : '';
    if (ahead) { ahead.style.transition = 'none'; ahead.style.width = Math.max(0, prev.stop - now0) + '%'; }
    if (tick) { tick.style.transition = 'none'; tick.style.left = prev.stop + '%'; }
    void app.offsetWidth;
    setTimeout(() => { if (ahead) { ahead.style.transition = ''; ahead.style.width = w; } if (tick) { tick.style.transition = ''; tick.style.left = l; } }, delay + 120);
  }
  const id = cue.categoryId;
  if (id && prev.jars[id] !== undefined && now.jars[id] !== undefined && prev.jars[id] !== now.jars[id]) {
    setTimeout(() => slosh($(`[data-jar="${id}"]`, app), level(prev.jars[id]), level(now.jars[id])), delay + 250);
  } else setTimeout(() => buzz(6), delay + 900);
}

// Le bocal se tasse, puis l'eau baisse et clapote avant de se calmer (1,4 s amortie), vibration de 6 ms à la fin.
function slosh(jar, from, to) {
  if (!jar || !jar.isConnected) return;
  const path = $('path', jar);
  jar.classList.add('bump');
  setTimeout(() => jar.classList.remove('bump'), 180);
  const t0 = performance.now(), D = 1400;
  let ph = 0;
  const step = tm => {
    if (!path.isConnected) return;
    const k = Math.min(1, (tm - t0) / D);
    const e = 1 - Math.pow(1 - Math.min(1, k * 1.6), 3);
    const amp = 4 + 7 * Math.exp(-k * 4) * Math.abs(Math.cos(k * 9));
    ph += 0.09;
    path.setAttribute('d', wave(from + (to - from) * e, amp, ph));
    if (k < 1) requestAnimationFrame(step);
    else { path.setAttribute('d', wave(to, 4, ph)); buzz(6); }
  };
  requestAnimationFrame(step);
}
