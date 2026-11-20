// Plan (D11 revu ; l'onglet s'appelait Budget jusqu'au 2026-11-12 : il a une section « Budgets » ; route #/mois) : regarder devant. En tête, « Disponible » (l'argent des portefeuilles
// courant compté dans le total qui n'a pas encore de destination ; jamais l'épargne, D17) et « X restent dans tes budgets,
// sur Y au total » ; plus de ligne « N budgets dépassés »
// (2026-11-13 : la section Budgets les montre déjà en tête, en rouge). La barre de Disponible : échéances à payer, budgets, Disponible ; dessous, une
// soustraction (2026-11-13, visuel A) : ce que tes habitudes sans budget vont encore prendre ce mois (habitsLeft), et au bout « Marge » : Disponible
// moins ces habitudes, une estimation ; toucher la ligne des habitudes ouvre « Tous les budgets », dont le bloc « Tes
// habitudes » en est le détail.
// « Budgets » (revu le 2026-11-10) : une liste simple de catégories de dépenses (budget-cats.js),
// les plus importantes d'abord — ce qui va mal toujours (budget dépassé, dépense inhabituelle sans budget), le reste
// jusqu'à 3 lignes ; « Tous les budgets » ouvre leur détail (tous les budgets, puis les habitudes) ; toucher une catégorie ouvre sa page (budgets, opérations). « Réserves » (D17) : toutes les réserves ouvertes,
// tous portefeuilles d'épargne confondus (barre, si elle sera prête ; toucher = son menu), « Nouvelle réserve ».
// « Épargne » : une ligne par portefeuille d'épargne (solde, objectif, réserves échues ou sans rien de prévu), qui ouvre SA page
// (#/epargne?w=<id>) ; invitation « Fonds d'urgence »
// tant qu'aucun portefeuille ne porte ce rôle ; « Mettre de côté » ouvre la saisie en virement vers l'épargne.
// Ce qui est terminé n'est plus sur Plan (2026-11-12) : en bas de « Toutes les échéances », « Tous les budgets » (les
// catégories qui n'ont plus de budget ; les autres ont leurs budgets terminés sur leur page) et « Toutes les réserves »
// (toutes les épargnes). Le titre de chaque section ouvre sa page, toujours (2026-11-13) : plus de + dans les titres
// ni de lien « Toutes les … » en bas ; on crée par le + flottant de ces pages, ou par le + d'une section vide.
// Échéances (D18, 2026-11-11) : l'écran suit le chemin de l'argent — Disponible, Échéances, Budgets, Réserves, Épargne.
// Sous Disponible, une barre découpée de l'argent courant : échéances à payer, restes des budgets, libre (trois lignes
// courtes) ; la section Échéances (dues-ui.js, revue le 2026-11-11) : un résumé comme les autres sections — une ligne
// par échéance avec son étape en cours, les retards et celles du jour toujours (Confirmer, Passer), puis les prochaines
// jusqu'à 3 lignes, « Toutes les échéances » (leur page, comme « Tous les budgets ») ; les fois réglées sont dans
// la page de l'échéance.
// Tout est une lecture (src/domain/budgets.js) ; posé sur le papier, sans cartes (D0).
import {
  settings, budgetReport, countedAccounts, savingsAccounts,
  savingsReport, emergencyAccount, pref, categoryBoard, dueItems, schedules, closedReserves,
} from '../core/store.js';
import { duesSectionHTML, wireDues } from './dues-ui.js';
import { reserveRowHTML, closedRowHTML, openReserveSheet, coveredMonths, monthsRing, monthsLabel, wireReserveRows, goalRing, reservesRing } from './reserves.js';
import { today, money, esc, approx } from '../core/format.js';
import { habitsLeft } from '../domain/budgets.js';
import { icon } from '../core/icons.js';
import { buzz, fitText, splitAmount, countUp, fabHTML, $, $$ } from '../core/ui.js';
import { accountPill, emptyAddHTML } from './pickers.js';
import { openBudgetSheet } from './budget-sheet.js';
import { openAccountSheet } from './accounts.js';
import { listHTML, wireCatRows } from './budget-cats.js';

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
// Sections courtes (2026-11-10, règle commune le 2026-11-12) : ce qui va mal s'affiche toujours (budget dépassé, réserve
// échue ou qui ne sera pas prête à temps, épargne qui a un souci) ; le reste complète jusqu'à 3 lignes ; « Tous les… » ouvre la page de la
// section (les mêmes lignes, le même ordre) ; les actions restent toujours visibles (le « + » du titre, Mettre de côté).
const MAX_ROWS = 3;
/** Lignes visibles : toutes celles qui vont mal, puis les autres jusqu'à 3. @template T @param {T[]} list (triée) @param {(x: T) => boolean} bad */
function shortList(list, bad) {
  const room = Math.max(0, MAX_ROWS - list.filter(bad).length);
  let others = 0;
  return list.map(x => bad(x) || others++ < room);
}
/**
 * Les réserves ouvertes de tous les portefeuilles d'épargne, ce qui va mal d'abord (échues, rien de prévu, puis celles
 * qui ne seront pas prêtes à temps), puis par échéance (le nom du portefeuille rappelé s'il y en a plusieurs).
 * @param {any[]} savings @param {{ a: any, rep: any }[]} reports
 */
function openReserves(savings, reports) {
  return reports.flatMap(x => x.rep.reserves.map((/** @type {any} */ v) => ({ v, wallet: savings.length > 1 ? x.a.name : '' })))
    .sort((p, q) => {
      const u = (/** @type {any} */ x) => (x.v.status === 'overdue' ? 0 : x.v.status === 'none' ? 1 : x.v.status === 'short' || x.v.status === 'later' ? 2 : 3);
      return u(p) - u(q) || (p.v.reserve.due < q.v.reserve.due ? -1 : p.v.reserve.due > q.v.reserve.due ? 1 : 0);
    });
}
/** Une épargne qui a un souci : une réserve échue ou sans rien de prévu. @param {{ rep: any }} x */
const savingsBad = x => x.rep.free < 0 || x.rep.reserves.some((/** @type {any} */ v) => v.status === 'overdue' || v.status === 'none');
/**
 * Les portefeuilles d'épargne actifs, ceux qui ont un souci d'abord, puis les plus gros soldes ; le fonds d'urgence
 * toujours le dernier (2026-11-20, avec l'utilisateur). @param {any[]} savings
 */
const savingsReports = savings => savings.map(a => ({ a, rep: savingsReport(a.id) }))
  .sort((p, q) => Number(p.a.emergency) - Number(q.a.emergency) || Number(savingsBad(q)) - Number(savingsBad(p)) || q.rep.balance - p.rep.balance);
/**
 * Une ligne d'épargne (Plan, « Toute l'épargne ») : son solde, son objectif, ses réserves, et seulement le rouge — les
 * échues, « Rien de prévu ». @param {{ a: any, rep: any }} x
 */
function savingsRowHTML({ a, rep }) {
  const due = rep.reserves.filter((/** @type {any} */ v) => v.status === 'overdue').length;
  const none = rep.reserves.some((/** @type {any} */ v) => v.status === 'none');
  if (a.emergency) {
    return `<button type="button" class="row" data-sav="${a.id}">${monthsRing(accountPill(a), coveredMonths(a))}
    <div class="main"><div class="t">${esc(a.name)}</div><div class="s wrap">${monthsLabel(coveredMonths(a))}</div></div>
    <span class="amt">${money(rep.balance, { cur: a.currency })}</span></button>`;
  }
  const sub = [rep.goal ? `${rep.goal.pct} % de l’objectif` : '',
    rep.reserves.length ? `${plural(rep.reserves.length, 'réserve', 'réserves')} · ${reservesRing(rep)?.pct} %` : '', due ? `<span class="loss">${plural(due, 'échue', 'échues')}</span>` : '',
    none ? '<span class="loss">Rien de prévu</span>' : ''].filter(Boolean).join(' · ') || 'Aucune réserve';
  return `<button type="button" class="row" data-sav="${a.id}">${goalRing(accountPill(a), rep.goal || reservesRing(rep))}
    <div class="main"><div class="t">${esc(a.name)}</div><div class="s wrap">${sub}</div></div>
    <span class="amt">${money(rep.balance, { cur: a.currency })}</span></button>`;
}
/**
 * Les actions de l'épargne, toujours visibles (comme le « + » des autres sections, 2026-11-12) : l'invitation « Fonds
 * d'urgence » tant qu'aucun portefeuille ne porte ce rôle, « Mettre de côté » ; sans épargne, « Mettre ton épargne à part ».
 * @param {any[]} savings
 */
/** aside : « Mettre de côté » (pas dans Toute l'épargne, 2026-11-20 : on n'y sait pas vers quelle épargne). @param {any[]} savings @param {{ aside?: boolean }} [o] */
function savingsActionsHTML(savings, { aside = true } = {}) {
  if (!savings.length) return `<div class="group"><button type="button" class="row" data-create-sav><span class="pill acc">${icon('piggy-bank')}</span>
    <div class="main"><div class="t">Mettre ton épargne à part</div><div class="s">Un portefeuille et ses réserves</div></div></button></div>`;
  const invite = !emergencyAccount() && !pref('emergencyDismissed');
  return `<div class="group plain">${invite ? `<button type="button" class="row" data-emergency>${accountPill({ kind: 'bank', savings: true, emergency: true })}
    <div class="main"><div class="t">Fonds d’urgence</div><div class="s">De quoi tenir dans un coup dur : 3 mois de dépenses</div></div></button>` : ''}
    ${aside ? `<button type="button" class="row add-row" data-aside><span class="pill">${icon('hand-coins')}</span><div class="main"><div class="t b-aside">Mettre de côté</div></div></button>` : ''}</div>`;
}
/** Branche les lignes et les actions de l'épargne. @param {HTMLElement} app @param {any} ctx @param {any[]} savings */
function wireSavings(app, ctx, savings) {
  const main = settings().currency;
  // Fonds d'urgence : un genre de portefeuille, créé directement (2026-11-19)
  const em = $('[data-emergency]', app);
  if (em) em.onclick = () => { buzz(6); openAccountSheet(null, { savings: true, emergency: true, name: 'Fonds d’urgence' }); };
  $$('[data-sav]', app).forEach(b => (b.onclick = () => { buzz(6); ctx.go(`#/epargne?w=${encodeURIComponent(b.dataset.sav || '')}`); }));
  const createSav = $('[data-create-sav]', app);
  if (createSav) createSav.onclick = () => { buzz(6); openAccountSheet(null, { savings: true }); };
  // Mettre de côté (D17) : un virement vers l'épargne (le fonds d'urgence d'abord, sinon le premier portefeuille d'épargne) ;
  // on ne bloque jamais où va l'argent
  $$('[data-aside]', app).forEach(b => (b.onclick = () => {
    const to = savings.find(a => a.emergency && a.currency === main) || savings.find(a => a.currency === main) || savings[0];
    if (!to) return;
    buzz(6);
    putAside(ctx.openEntry, to);
  }));
}

export function render(app, ctx) {
  const st = settings();
  const main = st.currency;
  const t = today();
  const r = budgetReport();
  const avail = r.available;
  // Épargne (D17) : les portefeuilles d'épargne actifs et leurs réserves
  const savings = savingsAccounts().filter(a => !a.archived);
  const reports = savingsReports(savings);
  const savShown = shortList(reports, savingsBad);
  // toutes les réserves ouvertes, ce qui va mal d'abord ; 3 au plus ici, toutes dans « Toutes les réserves »
  const allRes = openReserves(savings, reports);
  const resShown = shortList(allRes, x => ['overdue', 'none', 'short', 'later'].includes(x.v.status));
  // liste simple, les plus importantes d'abord : ce qui va mal toujours (budgets dépassés, du plus dépassé au moins
  // dépassé, puis dépenses inhabituelles, de la plus forte à la plus faible), puis jusqu'à 3 lignes — les budgets les
  // plus entamés, puis les catégories sans budget qui dépensent le plus ce mois
  const board = categoryBoard();
  const over = x => x.main && x.main.over ? x.main.spent / x.main.budget.amount : 0;
  const problems = board.filter(x => x.problem)
    .sort((p, q) => over(q) - over(p) || (q.average ? q.spent / q.average : 0) - (p.average ? p.spent / p.average : 0));
  const fill = board.filter(x => x.main && !x.problem).sort((p, q) => q.main.spent / q.main.budget.amount - p.main.spent / p.main.budget.amount)
    .concat(board.filter(x => !x.main && !x.problem && x.spent > 0).sort((p, q) => q.spent - p.spent));
  const catItems = [...problems, ...fill.slice(0, Math.max(0, MAX_ROWS - problems.length))];
  // Marge : Disponible moins ce que les habitudes sans budget vont encore prendre ce mois (une estimation)
  // une estimation : arrondie au pas de la devise (D0) ; la Marge suit, Disponible reste exact
  const ahead = approx(habitsLeft(board));
  // échéances (D18) : une ligne par échéance, son étape en cours ; ce qui attend une réponse toujours, puis jusqu'à 3
  const dues = dueItems();
  const duesShown = shortList(dues, d => d.state === 'late' || d.state === 'today');

  app.innerHTML = `<div class="screen month">
    <div class="topbar m-top"><h1 class="title sm">Plan</h1></div>

    <section class="hero b-hero">
      <div class="label">Disponible</div>
      <div class="big${avail < 0 ? ' neg' : ''}">${splitAmount(Math.abs(avail), { key: 'budget-avail', neg: avail < 0 })}</div>
      ${splitHTML(r, ahead)}
    </section>

    ${duesSectionHTML(dues, { shown: duesShown, any: schedules().length > 0 })}

    <section class="section">
      <div class="section-h">${titleLink('Budgets', 'data-all')}</div>
      ${r.list.length ? '' : emptyAddHTML('Donne une destination à ton argent : choisis une catégorie pour lui fixer un budget.', 'data-new', 'Créer un budget')}
      ${catItems.length ? `<div class="group" data-budgets>${listHTML(catItems)}</div>` : ''}
    </section>

    ${savings.some(a => !a.emergency) ? `<section class="section">
      <div class="section-h">${titleLink('Réserves', 'data-all-res')}</div>
      ${allRes.length ? `<div class="group">${allRes.filter((_, i) => resShown[i]).map(x => reserveRowHTML(x.v, { wallet: x.wallet })).join('')}</div>` : emptyAddHTML('Une dépense à venir, obligatoire ou souhaitée, que tu prépares à l’avance : l’assurance, la rentrée, un téléphone.', 'data-newres', 'Nouvelle réserve')}
    </section>` : ''}

    <section class="section">
      <div class="section-h">${titleLink('Épargne', 'data-all-sav')}</div>
      ${reports.length ? `<div class="group">${reports.filter((_, i) => savShown[i]).map(savingsRowHTML).join('')}</div>` : ''}
      ${savingsActionsHTML(savings)}
    </section>


  </div>`;

  $$('[data-new]', app).forEach(b => (b.onclick = () => { buzz(6); openBudgetSheet(); }));
  wireDues(app, dues, ctx);
  wireCatRows(app, ctx);
  const all = $('[data-all]', app);
  if (all) all.onclick = () => { buzz(6); ctx.go('#/mois/categories'); };
  const habits = $('[data-habits]', app);
  if (habits) habits.onclick = () => { buzz(6); ctx.go('#/mois/categories'); };
  wireSavings(app, ctx, savings);
  wireReserveRows(app, ctx.openEntry, ctx.go);
  const newRes = $('[data-newres]', app);
  if (newRes) newRes.onclick = () => { buzz(6); openReserveSheet({ openEntry: ctx.openEntry }); };
  const allRes2 = $('[data-all-res]', app);
  if (allRes2) allRes2.onclick = () => { buzz(6); ctx.go('#/mois/reserves'); };
  const allSav = $('[data-all-sav]', app);
  if (allSav) allSav.onclick = () => { buzz(6); ctx.go('#/mois/epargne'); };
  fitText(app, '.hero .big, .mrow .v', 13);
  countUp(app);
}

/**
 * La barre découpée de l'argent courant (D18) : échéances à payer, restes des budgets, Disponible ; une ligne par couleur.
 * Engagé au-delà de l'argent courant : pas de part disponible (Disponible est alors en rouge). Rien sans budget ni échéance.
 * Les habitudes (2026-11-13, avec l'utilisateur : visuel A) ne se dessinent pas dans la barre : elles se lisent en
 * soustraction sous la légende, Disponible − habitudes estimées = Marge.
 * @param {ReturnType<typeof budgetReport>} r
 */
function splitHTML(r, ahead = 0) {
  if (!r.list.length && !r.toPay && !ahead) return '';
  const free = Math.max(0, r.available);
  const sum = r.toPay + r.inBudgets + free || 1;
  const seg = (/** @type {number} */ v, /** @type {string} */ cls) => (v > 0 ? `<i class="${cls}" style="width:${(v / sum) * 100}%"></i>` : '');
  const key = (/** @type {string} */ cls, /** @type {string} */ text) => `<div class="b-key"><i class="${cls}"></i>${text}</div>`;
  const margin = r.available - ahead;
  const tail = ahead
    ? `${key('free', r.available > 0 ? `${money(r.available)} disponibles` : 'Rien de disponible')}
      <button type="button" class="b-calc" data-habits><span>Habitudes estimées${icon('caret-right')}</span><b>${money(-ahead)}</b></button>
      <div class="b-marge"><span>Marge</span><b class="${margin < 0 ? 'loss' : 'gain'}">${margin > 0 ? '+' : ''}${money(margin)}</b><span class="of">sur ${money(r.total)}</span></div>`
    : key('free', `${r.available > 0 ? `${money(r.available)} libres` : 'Rien de libre'}, sur ${money(r.total)}`);
  return `<div class="b-split" aria-hidden="true">${seg(r.toPay, 'due')}${seg(r.inBudgets, 'bud')}${seg(free, 'free')}</div>
    <div class="b-keys">${r.toPay ? key('due', `${money(r.toPay)} d’échéances à payer`) : ''}${r.list.length ? key('bud', `${money(r.inBudgets)} dans tes budgets`) : ''}
      ${tail}</div>`;
}

/**
 * Titre d'une section de Plan (2026-11-13, avec l'utilisateur) : il ouvre sa page (« Toutes les échéances »…), toujours,
 * même avec peu de lignes ; on y crée par le + flottant. Plus de + dans les titres ni de lien « Toutes les … » en bas.
 * @param {string} text @param {string} attr
 */
export const titleLink = (text, attr) => `<h2><button type="button" class="sh-link" ${attr}>${text}${icon('caret-right')}</button></h2>`;

/**
 * « Mettre de côté » (D17) : la saisie s'ouvre en virement vers un portefeuille d'épargne, depuis le premier portefeuille
 * courant compté de la même devise (s'il y en a un ; sinon la saisie le fait choisir).
 * @param {(o: any) => any} openEntry @param {{ id: string, currency: string }} to
 */
export function putAside(openEntry, to) {
  const from = countedAccounts().find(a => !a.savings && a.currency === to.currency);
  openEntry({ type: 'transfer', accountId: from ? from.id : null, toAccountId: to.id });
}

/**
 * « Toutes les réserves » (2026-11-12, comme « Toutes les échéances ») : toutes les réserves ouvertes, les mêmes lignes et
 * le même ordre que Plan (ce qui va mal d'abord, puis par échéance) ; + flottant pour une nouvelle ; en bas,
 * « Réserves terminées » de toutes les épargnes (2026-11-13 : avec peu de réserves en cours, rien d'autre n'y menait
 * sans passer par chaque épargne ; la toucher propose « Reconduire »).
 */
export const allReservesScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const savings = savingsAccounts().filter(a => !a.archived);
    const list = openReserves(savings, savingsReports(savings));
    const closed = closedReserves(); // les plus récemment terminées d'abord
    // l'intro (2026-11-20, avec l'utilisateur) : ce qui manque encore à toutes les réserves, et combien ne seront pas prêtes
    const main = settings().currency;
    const mine = list.filter(x => x.v.reserve.currency === main);
    const missing = mine.reduce((n, x) => n + Math.max(0, x.v.target - x.v.saved), 0);
    const bad = list.filter(x => ['overdue', 'none', 'short', 'later'].includes(x.v.status)).length;
    app.innerHTML = `<div class="screen month no-tabs has-fab">
      <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
        <h1 class="title sm">Toutes les réserves</h1></div></div>
      ${list.length ? `<section class="hero b-hero b-all"><div class="label">Encore à mettre de côté</div><div class="big">${money(missing, { cur: main })}</div>
        <div class="b-res">pour ${plural(list.length, 'réserve', 'réserves')} · ${bad ? `<span class="rs-warn">${bad > 1 ? `${bad} pas prêtes à temps` : '1 pas prête à temps'}</span>` : list.length > 1 ? 'toutes prêtes à temps' : 'prête à temps'}</div></section>` : ''}
      <section class="section">${list.length ? `<div class="group">${list.map(x => reserveRowHTML(x.v, { wallet: x.wallet })).join('')}</div>`
        : '<div class="w-none"><p>Aucune réserve en cours</p></div>'}</section>
      ${closed.length ? `<details class="section b-done"><summary>Réserves terminées <span class="muted">${closed.length}</span></summary>
        <div class="group">${closed.map(closedRowHTML).join('')}</div></details>` : ''}
    </div>${fabHTML('Nouvelle réserve')}`;
    $('[data-back]', app).onclick = () => ctx.back('#/mois');
    wireReserveRows(app, ctx.openEntry, ctx.go);
    const add = $('[data-add]', app);
    if (add) add.onclick = () => { buzz(6); openReserveSheet({ openEntry: ctx.openEntry }); };
    fitText(app, '.mrow .v', 13);
  },
};

/**
 * « Toute l'épargne » (2026-11-12) : tous les portefeuilles d'épargne, les mêmes lignes et le même ordre que Plan (un
 * souci d'abord, puis les plus gros soldes), leur total en tête ; « Fonds d'urgence » et « Mettre de côté » toujours là.
 */
export const allSavingsScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const main = settings().currency;
    const savings = savingsAccounts().filter(a => !a.archived);
    const reports = savingsReports(savings);
    const total = reports.filter(x => x.a.currency === main).reduce((n, x) => n + x.rep.balance, 0);
    const others = new Set(reports.filter(x => x.a.currency !== main).map(x => x.a.currency)).size;
    // l'intro (revue le 2026-11-20, avec l'utilisateur : « Ton épargne » répétait le titre) : comment ce total se répartit
    const split = reports.filter(x => x.a.currency === main).reduce((n, x) => ({ held: n.held + (x.rep.held || 0), free: n.free + Math.max(0, x.rep.balance - (x.rep.held || 0)) }), { held: 0, free: 0 });
    app.innerHTML = `<div class="screen month no-tabs has-fab">
      <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
        <h1 class="title sm">Toute l’épargne</h1></div></div>
      ${reports.length ? `<section class="hero b-hero b-all"><div class="label">Mis de côté en tout</div><div class="big">${money(total)}</div>
        <div class="b-res">${[split.held ? `${money(split.held)} pour tes réserves` : '', split.free ? `${money(split.free)} d’épargne libre` : '', others ? `et ${plural(others, 'autre devise', 'autres devises')}` : ''].filter(Boolean).join(' · ')}</div></section>` : ''}
      <section class="section">${reports.length ? `<div class="group">${reports.map(savingsRowHTML).join('')}</div>` : ''}
        ${savingsActionsHTML(savings, { aside: false })}</section>
    </div>${fabHTML('Nouveau portefeuille d’épargne')}`;
    $('[data-back]', app).onclick = () => ctx.back('#/mois');
    wireSavings(app, ctx, savings);
    const add = $('[data-add]', app);
    if (add) add.onclick = () => { buzz(6); openAccountSheet(null, { savings: true }); };
    fitText(app, '.hero .big', 13);
  },
};
