// Budgets par catégorie (revu le 2026-11-10) : Plan en montre les premières lignes (planRows, domaine) ;
// « Budgets » (#/mois/categories, 2026-11-12, refait le 2026-11-27, avec l'utilisateur) est la page : « Reste dans tes
// budgets », une légende, « Tes budgets » — chaque ligne dit, sur sa barre et dessous, où l'on en est face à d'habitude, au
// même stade de SA période (budgetView : un trait vertical à ce qui était dépensé d'habitude, puis « comme d'habitude »,
// « X de plus que d'habitude à ce stade » ou « sous ton rythme ») —, « Hors budget, à surveiller » (les catégories sans
// budget qui dépassent leur habitude à ce stade), un lien vers le rapport du mois, « Budgets terminés ». Famille
// (2026-11-11, D13 revu) : une principale compte ses sous-catégories (sa barre, son dépensé) ; une sous-catégorie ne compte
// qu'elle. Pas de crayon : toucher la ligne ouvre SA page (#/mois/categorie?c=<id>) : ses budgets en cours avec
// leurs barres (plusieurs permis, pas deux de même durée en même temps) et ses budgets terminés. Toucher un budget en
// cours (2026-11-13, une ligne, un geste) demande quoi en faire : le modifier (sa feuille) ou voir ses opérations (le
// Journal sur sa catégorie et sa période en cours : pas de liste à moitié ici, le Journal a tout). Un budget ne compte que l'argent courant (revu le 2026-11-10) : les dépenses payées
// depuis une épargne ou un portefeuille hors du total n'y comptent pas, et une phrase le dit.
import {
  category, categoryLabel, allCategories, categoryBoard, budgetReport, budgetView, finishedOf, finishedGroups, finishedBudget, transactions, settings, account,
} from '../core/store.js';
import { today, money, num, esc, shortDate, approx, approxUp } from '../core/format.js';
import { icon } from '../core/icons.js';
import { chip, buzz, fitText, menuSheet, afterSheets, fabHTML, $, $$ } from '../core/ui.js';
import { openBudgetSheet } from './budget-sheet.js';
import { opsHref } from './transactions.js';
import { budgetMonth, currentWindow, habitsLeft } from '../domain/budgets.js';
import { topbarHTML, wireBack, endedHTML, listPageHTML, wireListPage, sectionHTML, emptyState } from './parts.js';

/** @param {string} id */
export const catHref = id => `#/mois/categorie?c=${encodeURIComponent(id)}`;
/** Une période courte : « du 1 au 31 oct » dans un même mois, sinon « du 13 oct au 11 janv » (à côté de « Reconduire »). @param {string} a @param {string} b */
const period = (a, b) => (a.slice(0, 7) === b.slice(0, 7) ? `du ${Number(a.slice(8))} au ${shortDate(b)}` : `du ${shortDate(a)} au ${shortDate(b)}`);

/**
 * Une ligne de budget (Plan, « Budgets ») : à droite le reste ou le dépassement, la barre, dessous jusqu'à quand seulement
 * (2026-11-13, avec l'utilisateur : le montant prévu et le déjà dépensé sont dans sa page). Avec un repère (pace, 2026-11-27,
 * avec l'utilisateur) : un trait fin sur la barre à ce qui était dépensé d'habitude à ce stade (borné à la barre), et
 * dessous le verdict puis la période — « comme d'habitude · jusqu'au 30 nov », « X de plus que d'habitude à ce stade » (rouge,
 * seul : il est long), « sous ton rythme · jusqu'au 30 nov » (vert).
 * @param {any} s @param {{ name?: string, extra?: string, pace?: any }} [o]
 */
function budgetBar(s, { name = '', extra = '', pace = null } = {}) {
  const b = s.budget, cur = b.currency, w = s.window;
  const right = s.over ? `<span class="loss">${money(-s.remaining, { cur })} de trop</span>` : `<small>reste</small> ${money(s.remaining, { cur })}`;
  const when = w.start > today() ? `à partir du ${shortDate(w.start)}` : `jusqu’au ${shortDate(w.end)}`;
  const pct = Math.min(100, (s.spent / b.amount) * 100);
  const tick = pace ? `<b class="tick" style="left:${Math.min(100, Math.max(0, (pace.usual / b.amount) * 100))}%"></b>` : '';
  const say = !pace ? '' : pace.verdict === 'above' ? `<span class="loss">${money(approx(pace.diff, cur), { cur })} de plus que d’habitude à ce stade</span>`
    : pace.verdict === 'below' ? '<span class="gain">sous ton rythme</span>' : 'comme d’habitude';
  const line = pace && pace.verdict === 'above' ? say : `${say ? `${say} · ` : ''}<span class="nw">${when}</span>`;
  return `<span class="main"><span class="l1"><span class="t">${name}</span><span class="v">${right}</span></span>
    <span class="bar${s.over ? ' over' : ''}${pace ? ' pace' : ''}"><i style="width:${pct}%"></i>${tick}</span>
    <span class="l2"><span class="s">${line}${extra}</span></span></span>`;
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
 * Ligne d'un budget (Plan, « Budgets ») : sa barre, ce qui reste ou le trop, son repère d'habitude, jusqu'à quand.
 * @param {any} r ligne de budgetView (rows) : x, élément de categoryBoard avec un budget, et pace
 */
export function catRowHTML(r) {
  const x = r.x, c = category(x.id);
  const more = x.budgets.length > 1 ? ` · ${x.budgets.length} budgets` : '';
  return `<div class="row mrow b-cat" style="--c:var(--${c?.color || 'c0'})">
      <button type="button" class="mrow-go" data-cat-go="${x.id}" aria-label="${esc(categoryLabel(x.id))} : ses budgets et ses opérations">${chip(c)}${budgetBar(x.main, { name: esc(nameOf(x.id)), extra: more, pace: r.pace })}</button>
</div>`;
}

/**
 * Une catégorie « à surveiller » (2026-11-27, avec l'utilisateur) : sans budget, elle dépense plus que d'habitude à ce
 * stade du mois — son nom, son dépensé du mois, et l'écart en rouge.
 * @param {any} w ligne de budgetView (watch)
 */
export function watchRowHTML(w) {
  const c = category(w.id), cur = settings().currency;
  return `<div class="row mrow b-cat b-none" style="--c:var(--${c?.color || 'c0'})">
    <button type="button" class="mrow-go" data-cat-go="${w.id}" aria-label="${esc(categoryLabel(w.id))} : plus que d’habitude">${chip(c)}
    <span class="main"><span class="l1"><span class="t">${esc(nameOf(w.id))}</span><span class="v">${money(w.spent, { cur })} <small>ce mois</small></span></span>
    <span class="l2"><span class="s"><span class="loss">${money(approx(w.pace.diff, cur), { cur })} de plus que d’habitude à ce stade</span></span></span></span></button></div>`;
}

/** Une ligne de planRows. @param {any} l */
export const planRowHTML = l => (l.kind === 'watch' ? watchRowHTML(l) : catRowHTML(l));

/**
 * La ligne ouvre la page de la catégorie (ses budgets s'y modifient).
 * @param {HTMLElement} root @param {any} ctx
 */
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
 * « Budgets » (2026-11-12, avec l'utilisateur ; refait le 2026-11-27, avec l'utilisateur) : le détail de Plan. En tête,
 * « Reste dans tes budgets » et ce qui ira sans doute dans tes habitudes, puis une légende (un trait : « d'habitude, à ce
 * stade de la période »). « Tes budgets » : une ligne par budget (budgetView), les dépassés d'abord puis les plus entamés,
 * chacune avec son repère d'habitude sur SA période quand le journal en a assez (budgetPace). « Hors budget, à surveiller » :
 * seulement les catégories sans budget ni échéance qui dépassent leur habitude à ce stade du mois ; absente sinon. Un lien
 * vers le rapport du mois. En bas, « Budgets terminés » : une ligne par catégorie sans budget en cours ni à venir (ou
 * archivée), absente d'ici comme de Plan, le seul chemin vers sa page (« 11 terminés · jusqu'au 31 oct » ; un seul : ce
 * qu'il a dépensé et sa période). Rien d'autre : les dépenses d'une fois et l'arbre vivent ailleurs (Moi › Catégories, le
 * Journal par catégorie).
 */
export const allScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const V = budgetView();
    const r = budgetReport();
    const board = categoryBoard();
    const cur = settings().currency;
    const ahead = approx(habitsLeft(board), cur);
    const done = finishedGroups();
    const intro = V.rows.length ? { label: 'Reste dans tes budgets', big: money(r.inBudgets, { cur }), sub: ahead ? `${money(ahead, { cur })} iront sans doute dans tes habitudes` : '' }
      : ahead ? { label: 'Iront sans doute dans tes habitudes', big: money(ahead, { cur }) } : null;
    const legend = V.rows.some(x => x.pace) ? sectionHTML({ body: '<p class="b-legend"><i class="b-k"></i>d’habitude, à ce stade de la période</p>' }) : '';
    const report = sectionHTML({ body: '<button type="button" class="link b-report" data-report>Voir le rapport du mois</button>' });
    const body = V.rows.length || V.watch.length ? `${legend}
      ${V.rows.length ? sectionHTML({ title: 'Tes budgets', body: `<div class="group" data-lines>${V.rows.map(catRowHTML).join('')}</div>` }) : ''}
      ${V.watch.length ? sectionHTML({ title: 'Hors budget, à surveiller', body: `<div class="group" data-watch>${V.watch.map(watchRowHTML).join('')}</div>` }) : ''}
      ${report}`
      : `${emptyState('Pas encore de budget', { add: ['data-new', 'Créer un budget'] })}${report}`;
    app.innerHTML = listPageHTML({ title: 'Budgets', intro, fab: 'Créer un budget', body,
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
    const rep = $('[data-report]', app);
    if (rep) rep.onclick = () => { buzz(6); ctx.go('#/rapport/detail?type=expense'); };
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
      ${topbarHTML({ title: `<span class="bc-name">${esc(nameOf(id))}</span>`, cls: 'bc-title', attrs: `title="${esc(categoryLabel(id))}"` })}

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
