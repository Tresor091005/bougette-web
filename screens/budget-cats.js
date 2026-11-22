// Budgets par catégorie (revu le 2026-11-10) : Plan en montre une liste simple, les plus importantes d'abord (listHTML) ;
// « Tous les budgets » (#/mois/categories, 2026-11-12) en est le détail : tous les budgets en cours, puis les habitudes
// (ce que la Marge compte). Une ligne par catégorie : avec budget, celui du plus court (un dépassé d'abord), ce qui est
// parti sur ce qu'il prévoit ; sans budget, son dépensé du mois et, si elle a une habitude, la barre hachurée de
// l'habitude (c'est elle qui dit « pas de budget » : plus de gris, 2026-11-12). Famille (2026-11-11, D13 revu) : une principale compte ses
// sous-catégories (sa barre, son dépensé, son habitude) ; une sous-catégorie ne compte qu'elle. Pas de crayon : toucher la ligne ouvre SA page (#/mois/categorie?c=<id>) : ses budgets en cours avec
// leurs barres (plusieurs permis, pas deux de même durée en même temps) et ses budgets terminés. Toucher un budget en
// cours (2026-11-13, une ligne, un geste) demande quoi en faire : le modifier (sa feuille) ou voir ses opérations (le
// Journal sur sa catégorie et sa période en cours : pas de liste à moitié ici, le Journal a tout). Un budget ne compte que l'argent courant (revu le 2026-11-10) : les dépenses payées
// depuis une épargne ou un portefeuille hors du total n'y comptent pas, et une phrase le dit.
import {
  category, categoryLabel, allCategories, categoryBoard, budgetReport, finishedOf, finishedGroups, finishedBudget, transactions, settings, account,
} from '../core/store.js';
import { today, money, num, esc, shortDate, approx, approxUp } from '../core/format.js';
import { icon } from '../core/icons.js';
import { chip, buzz, fitText, menuSheet, afterSheets, fabHTML, $, $$ } from '../core/ui.js';
import { openBudgetSheet } from './budget-sheet.js';
import { opsHref } from './transactions.js';
import { budgetMonth, currentWindow, UNUSUAL, habitsLeft } from '../domain/budgets.js';
import { topbarHTML, wireBack, endedHTML, listPageHTML, wireListPage, sectionHTML, emptyState } from './parts.js';

/** @param {string} id */
export const catHref = id => `#/mois/categorie?c=${encodeURIComponent(id)}`;
/** Une période courte : « du 1 au 31 oct » dans un même mois, sinon « du 13 oct au 11 janv » (à côté de « Reconduire »). @param {string} a @param {string} b */
const period = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `du ${Number(a.slice(8))} au ${shortDate(b)}` : `du ${shortDate(a)} au ${shortDate(b)}`);

/**
 * Une ligne de budget (Plan, « Tous les budgets ») : à droite le reste ou le dépassement, la barre, dessous jusqu'à
 * quand seulement (2026-11-13, avec l'utilisateur : le montant prévu et le déjà dépensé sont dans sa page).
 * @param {any} s @param {{ name?: string, extra?: string }} [o]
 */
function budgetBar(s, { name = '', extra = '' } = {}) {
  const b = s.budget, cur = b.currency, w = s.window;
  const right = s.over ? `<span class="loss">${money(-s.remaining, { cur })} de trop</span>` : `<small>reste</small> ${money(s.remaining, { cur })}`;
  const when = w.start > today() ? `à partir du ${shortDate(w.start)}` : `jusqu’au ${shortDate(w.end)}`;
  const pct = Math.min(100, (s.spent / b.amount) * 100);
  return `<span class="main"><span class="l1"><span class="t">${name}</span><span class="v">${right}</span></span>
    <span class="bar${s.over ? ' over' : ''}"><i style="width:${pct}%"></i></span>
    <span class="l2"><span class="s"><span class="nw">${when}</span>${extra}</span></span></span>`;
}

/**
 * Un budget dans sa page (2026-11-13, avec l'utilisateur) : se lit de haut en bas, comme Disponible — en grand ce qui
 * reste à dépenser (ou le dépassement), la barre, puis une info par ligne : dépensé, encore possible, la période.
 * @param {any} s
 */
function budgetBlock(s) {
  const b = s.budget, cur = b.currency, w = s.window;
  const pct = Math.min(100, (s.spent / b.amount) * 100);
  const soon = w.start > today();
  return `<span class="main bp">
    <span class="bp-k">${s.over ? 'Dépassé de' : soon ? 'À dépenser' : 'Reste à dépenser'}</span>
    <span class="bp-big${s.over ? ' loss' : ''}">${money(Math.abs(s.remaining), { cur })}</span>
    <span class="bar${s.over ? ' over' : ''}"><i style="width:${pct}%"></i></span>
    <span class="bp-l"><i class="bp-dot"></i>${money(s.spent, { cur })} dépensés</span>
    ${s.over ? '' : `<span class="bp-l"><i class="bp-dot rest"></i>${money(s.remaining, { cur })} encore possibles</span>`}
    <span class="bp-l muted">${money(b.amount, { cur })} ${period(w.start, w.end)}${b.repeat ? ' · se répète' : ''}</span></span>`;
}

/**
 * Le nom seul : il est unique parmi les dépenses (D13). Un ancien journal peut encore avoir deux catégories du même
 * nom : alors le nom complet « Transport › Autre ». @param {string} id
 */
function nameOf(id) {
  const c = category(id);
  if (!c) return categoryLabel(id);
  const n = c.name.toLowerCase();
  const twin = allCategories('expense').some(o => o.id !== id && !o.archived && o.name.toLowerCase() === n);
  return twin ? categoryLabel(id) : c.name;
}

/**
 * Ligne d'une catégorie (Plan, « Tous les budgets ») : avec un budget, sa barre ; sans budget, son dépensé du mois et,
 * avec une habitude, la barre hachurée de l'habitude.
 * @param {any} x élément de categoryBoard
 */
export function catRowHTML(x) {
  const c = category(x.id);
  const name = esc(nameOf(x.id));
  const cls = 'row mrow b-cat';
  if (x.main) {
    const more = x.budgets.length > 1 ? ` · ${x.budgets.length} budgets` : '';
    return `<div class="${cls}" style="--c:var(--${c?.color || 'c0'})">
      <button type="button" class="mrow-go" data-cat-go="${x.id}" aria-label="${esc(categoryLabel(x.id))} : ses budgets et ses opérations">${chip(c)}${budgetBar(x.main, { name, extra: more })}</button>
</div>`;
  }
  // sans budget : son dépensé du mois (« 0 F » pâle s'il n'y a rien). Avec une habitude, la barre de l'habitude : hachurée (pas de budget),
  // un trait à la moyenne, le bout à UNUSUAL × la moyenne — pleine et rouge seulement quand « Plus que d'habitude »
  // s'allume ; dessous, où elle en est par rapport à son habitude
  const cur = settings().currency;
  const right = x.spent ? `${money(x.spent, { cur })} <small>ce mois</small>` : `<span class="zero">${money(0, { cur })}</span>`;
  let s = '';
  if (x.habit) {
    const avg = money(approx(x.average, cur), { cur });
    const say = x.unusual ? `<span class="loss">Plus que d’habitude (${avg} en moyenne)</span>`
      : x.spent > x.average ? `au-dessus de l’habitude (${avg})` : `${avg} d’habitude`;
    const pct = Math.min(100, (x.spent / (x.average * UNUSUAL)) * 100);
    s = `<span class="bar hb${x.unusual ? ' hot' : ''}"><i style="width:${pct}%"></i><b class="tick" style="left:${100 / UNUSUAL}%"></b></span>
      <span class="l2"><span class="s">${say}</span></span>`;
  }
  return `<div class="${cls} b-none">
    <button type="button" class="mrow-go" data-cat-go="${x.id}" aria-label="${esc(categoryLabel(x.id))} : sans budget">${chip(c)}
    <span class="main"><span class="l1"><span class="t">${name}</span><span class="v">${right}</span></span>${s}</span></button></div>`;
}

/**
 * Les habitudes de « Tous les budgets » (2026-11-12) : exactement ce que la Marge compte — chaque catégorie qu'aucun
 * budget ni échéance ne tient et qui a une habitude, pour elle-même (own : une principale sans ses sous-catégories) —,
 * quand il lui reste quelque chose à venir ce mois ; ce qui va le plus partir d'abord.
 * @param {any[]} board
 */
export const habitRows = board => board.filter(x => !x.covered && x.own?.habit && x.own.average - x.own.spent > 0)
  .sort((p, q) => (q.own.average - q.own.spent) - (p.own.average - p.own.spent));

/**
 * Une habitude : à droite ce qui va sans doute encore partir ce mois (« à venir X », comme « reste X » pour un budget),
 * la barre hachurée de l'habitude, dessous où elle en est (« 550 F sur 1 333 F d'habitude »).
 * @param {any} x élément de categoryBoard
 */
function habitRowHTML(x) {
  const c = category(x.id), cur = settings().currency, f = x.own;
  const pct = Math.min(100, (f.spent / (f.average * UNUSUAL)) * 100);
  const where = f.spent ? `${money(f.spent, { cur })} sur ${money(approx(f.average, cur), { cur })} d’habitude` : `${money(approx(f.average, cur), { cur })} d’habitude`;
  return `<div class="row mrow b-cat b-none" style="--c:var(--${c?.color || 'c0'})">
    <button type="button" class="mrow-go" data-cat-go="${x.id}" aria-label="${esc(categoryLabel(x.id))} : son habitude">${chip(c)}
    <span class="main"><span class="l1"><span class="t">${esc(nameOf(x.id))}</span><span class="v"><small>à venir</small> ${money(approx(f.average - f.spent, cur), { cur })}</span></span>
    <span class="bar hb"><i style="width:${pct}%"></i><b class="tick" style="left:${100 / UNUSUAL}%"></b></span>
    <span class="l2"><span class="s">${where}</span></span></span></button></div>`;
}

/** Liste simple, dans l'ordre donné, sans retrait : quelques lignes prises n'importe où dans l'arbre. @param {any[]} items */
export const listHTML = items => items.map(x => catRowHTML(x)).join('');

/** La ligne ouvre la page de la catégorie (ses budgets s'y modifient). @param {HTMLElement} root @param {any} ctx */
export function wireCatRows(root, ctx) {
  $$('[data-cat-go]', root).forEach(b => (b.onclick = () => { buzz(6); ctx.go(catHref(b.dataset.catGo)); }));
}

/**
 * Un budget terminé (2026-11-13, avec l'utilisateur : un bouton « Reconduire » sur chaque ligne prenait trop de place) :
 * toute la ligne, un seul geste, qui demande quoi en faire — voir ses opérations (déjà filtrées : sa catégorie, une
 * principale avec ses sous-catégories, ses dates ; le retour revient ici), le reconduire (même montant, même durée à
 * partir d'aujourd'hui, relié à lui ; ni déjà reconduit, ni catégorie archivée) ; depuis « Tous les
 * budgets », aussi la page de sa catégorie, où sont tous ses budgets terminés.
 * @param {HTMLElement} root @param {any} ctx
 */
export function wireDone(root, ctx) {
  $$('[data-done]', root).forEach(btn => (btn.onclick = async () => {
    buzz(6);
    const x = finishedBudget(btn.dataset.done || '');
    if (!x) return;
    const b = x.budget, c = category(b.category);
    const many = 'count' in btn.dataset;
    const items = [
      { key: 'ops', icon: 'list-bullets', label: 'Voir les opérations', note: period(b.start, b.end) },
      ...(x.reconducted || c?.archived ? [] : [{ key: 'again', icon: 'arrows-clockwise', label: 'Reconduire', note: 'Même montant, même durée, à partir d’aujourd’hui' }]),
      ...(many ? [{ key: 'cat', icon: 'caret-right', label: Number(btn.dataset.count) > 1 ? `Ses ${btn.dataset.count} budgets terminés` : 'Voir la catégorie' }] : []),
    ];
    const k = await menuSheet({ title: esc(c?.name || categoryLabel(b.category)), items });
    if (k === 'ops') ctx.go(opsHref({ cat: b.category, exact: !!c?.parent, from: b.start, to: b.end }));
    else if (k === 'again') afterSheets(() => openBudgetSheet({ from: b.id }));
    else if (k === 'cat') ctx.go(catHref(b.category));
  }));
}

/**
 * « Tous les budgets » (2026-11-12, avec l'utilisateur ; avant : « Toutes les catégories », l'arbre entier) : le détail
 * de Plan en deux blocs. Tes budgets : tous les budgets en cours, la même ligne que dans Plan, ce qui dépasse en tête,
 * puis les plus entamés. Tes habitudes : ce que la Marge compte (habitRows). En tête, « Reste dans tes budgets » et ce
 * qui ira sans doute dans tes habitudes (sans budget : ce chiffre seul). Rien d'autre : les catégories sans rien, les
 * dépenses d'une fois et l'arbre vivent ailleurs (Moi › Catégories, le Journal par catégorie). En bas, « Budgets
 * terminés » : une ligne par catégorie sans budget en cours ni à venir (ou archivée), absente d'ici comme de Plan, le
 * seul chemin vers sa page (« 11 terminés · jusqu'au 31 oct » ; un seul : ce qu'il a dépensé et sa période).
 */
export const allScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const board = categoryBoard();
    const r = budgetReport();
    const over = (/** @type {any} */ x) => (x.main.over ? x.main.spent / x.main.budget.amount : 0);
    const used = (/** @type {any} */ x) => x.main.spent / x.main.budget.amount;
    const buds = board.filter(x => x.main).sort((p, q) => over(q) - over(p) || used(q) - used(p));
    const habits = habitRows(board);
    const ahead = approx(habitsLeft(board));
    const done = finishedGroups();
    const intro = buds.length ? { label: 'Reste dans tes budgets', big: money(r.inBudgets), sub: ahead ? `${money(ahead)} iront sans doute dans tes habitudes` : '' }
      : ahead ? { label: 'Iront sans doute dans tes habitudes', big: money(ahead) } : null;
    app.innerHTML = listPageHTML({ title: 'Tous les budgets', intro, fab: 'Créer un budget',
      body: `${sectionHTML({ title: 'Tes budgets', body: `
        ${buds.length ? `<div class="group">${buds.map(x => catRowHTML(x)).join('')}</div>` : emptyState('Pas encore de budget', { add: ['data-new', 'Créer un budget'] })}` })}
      ${habits.length ? sectionHTML({ title: 'Tes habitudes', body: `
        <div class="group">${habits.map(habitRowHTML).join('')}</div>` }) : ''}`,
      ended: endedHTML('Budgets terminés', done.map(g => {
        const x = g.last, b = x.budget, c = category(g.category), cur = b.currency;
        return `<div class="row mrow" style="--c:var(--${c?.color || 'c0'})">
            <button type="button" class="mrow-go" data-done="${b.id}" data-count="${g.count}" aria-label="${esc(categoryLabel(g.category))} : son dernier budget terminé">${chip(c)}
            <span class="main"><span class="l1"><span class="t">${esc(c?.name || categoryLabel(g.category))}</span>${g.count > 1 ? '' : `<span class="v">${num(x.spent, { cur })} <small>/ ${money(b.amount, { cur })}</small></span>`}</span>
              <span class="l2"><span class="s">${g.count > 1 ? `${g.count} terminés · jusqu’au ${shortDate(b.end)}` : period(b.start, b.end)}${x.reconducted ? ' · reconduit' : ''}</span></span></span></button>
          </div>`;
      })) });
    wireListPage(app, ctx, () => openBudgetSheet());
    wireCatRows(app, ctx);
    wireDone(app, ctx);
  },
};

/** Page d'une catégorie : ses budgets en cours, ses budgets terminés. */
export const categoryScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const id = new URLSearchParams(location.hash.split('?')[1] || '').get('c') || '';
    const c = category(id);
    const x = categoryBoard().find(y => y.id === id);
    if (!c || c.type !== 'expense') { ctx.back('#/mois'); return; }
    const st = settings();
    const t = today();
    const budgets = x ? x.budgets : [];
    // la période : celle du budget montré, sinon le mois de budget en cours
    const w = x && x.main ? x.main.window : budgetMonth(t, st.monthStart);
    // une principale : ses opérations et celles de ses sous-catégories (comme son budget, 2026-11-11)
    const family = new Set([id, ...allCategories('expense').filter(o => o.parent === id).map(o => o.id)]);
    // dans le budget : l'argent courant seulement (ni épargne ni hors du total), comme Disponible ; le reste, une phrase le dit
    const counted = o => { const a = account(o.accountId); return !!a && !a.savings && !a.excluded; };
    const aside = budgets.length ? transactions().filter(o => o.type === 'expense' && family.has(o.categoryId) && !o.planned && !o.void
      && o.date >= w.start && o.date <= w.end && !counted(o)).reduce((n, o) => n + o.amount, 0) : 0;
    const done = finishedOf(id);
    const suggest = x && x.average ? approxUp(x.average, st.currency) : 0;
    const cur = st.currency;

    app.innerHTML = `<div class="screen month bc no-tabs${budgets.length ? ' has-fab' : ''}">
      ${topbarHTML({ title: `${chip(c)}<span class="bc-name">${esc(nameOf(id))}</span>`, cls: 'bc-title', attrs: `title="${esc(categoryLabel(id))}"` })}

      ${sectionHTML({ title: 'Budgets', body: `
        ${budgets.length ? `<div class="group">${budgets.map(s => `<div class="row mrow" style="--c:var(--${c.color || 'c0'})">
            <button type="button" class="mrow-go" data-bud="${s.budget.id}" aria-label="Ce budget : le modifier ou voir ses opérations">${budgetBlock(s)}${icon('caret-right')}</button></div>`).join('')}</div>`
          : emptyState(x && x.byParent ? `Elle compte dans le budget de ${esc(category(c.parent)?.name || '')}.`
            : x && x.average ? `Tu y dépenses ${money(approx(x.average, cur), { cur })} par mois en moyenne.` : 'Pas encore de budget', { add: ['data-new', 'Créer un budget'] })}
        ${aside ? `<p class="muted b-note">${money(aside, { cur })} payés depuis l’épargne ou un portefeuille hors du total ne comptent pas dans ce budget.</p>` : ''}` })}

      ${endedHTML('Budgets terminés', done.map(d => {
        const b = d.budget, bcur = b.currency;
        return `<div class="row mrow">
            <button type="button" class="mrow-go" data-done="${b.id}" aria-label="Budget du ${shortDate(b.start)} au ${shortDate(b.end)}">
            <span class="main"><span class="l1"><span class="t">${period(b.start, b.end)}</span><span class="v">${num(d.spent, { cur: bcur })} <small>/ ${money(b.amount, { cur: bcur })}</small></span></span>
              ${d.reconducted ? '<span class="l2"><span class="s">reconduit</span></span>' : ''}</span></button></div>`;
      }))}
    </div>${budgets.length ? fabHTML('Créer un budget') : ''}`;

    wireBack(app, () => ctx.back('#/mois'));
    $$('[data-new], [data-add]', app).forEach(b => (b.onclick = () => { buzz(6); openBudgetSheet({ category: id, amount: budgets.length ? 0 : suggest, fixed: true }); }));
    // un budget en cours : le modifier ou voir ses opérations (sa période en cours)
    $$('[data-bud]', app).forEach(btn => (btn.onclick = async () => {
      buzz(6);
      const b = budgets.find(y => y.budget.id === btn.dataset.bud)?.budget;
      if (!b) return;
      const p = currentWindow(b, t) || { start: b.start, end: b.end };
      const ops = () => ctx.go(opsHref({ cat: b.category, exact: !!category(b.category)?.parent, from: p.start, to: p.end }));
      const k = await menuSheet({ title: esc(c.name), items: [
        { key: 'edit', icon: 'pencil-simple', label: 'Modifier', note: 'Montant, fin, répétition' },
        { key: 'ops', icon: 'list-bullets', label: 'Voir les opérations', note: period(p.start, p.end) },
      ] });
      if (k === 'edit') afterSheets(() => openBudgetSheet({ id: b.id }));
      else if (k === 'ops') ops();
    }));
    wireDone(app, ctx);
    fitText(app, '.mrow .v', 13);
    fitText(app, '.bc-name', 18); // le nom seul (unique, D13) ; trop long même à 18 px : coupé par « … »
  },
};
