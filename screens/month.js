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
// « Épargnes » (2026-11-25, avec l'utilisateur : une seule section,
// les dépenses prévues vivent dans une épargne — plus de section « Dépenses prévues » à part ; trois niveaux comme les
// budgets) : ici un résumé, 3 lignes au plus (ce qui a un souci d'abord, puis les plus gros soldes, le fonds d'urgence
// le dernier) — une ligne par épargne comme celles des budgets : son nom, son solde, et une seule chose dessous (ce qui
// manque, sinon ce qu'elle prépare : « Fêtes, Ordinateur et 2 autres ») ; toucher = SA page (#/epargne?w=<id>). Le titre
// ouvre toujours « Toutes les épargnes » : une carte par épargne (solde en grand, barre, la liste simple de ses dépenses
// prévues, ce que disent ses versements ; le fonds d'urgence, ses mois couverts). La page d'une épargne a le détail.
// Invitation « Fonds d'urgence » tant qu'aucun portefeuille ne porte ce rôle ; « Mettre de côté » : maintenant, une fois
// plus tard, chaque mois.
// Ce qui est terminé n'est plus sur Plan (2026-11-12) : en bas de « Toutes les échéances », « Tous les budgets » (les
// catégories qui n'ont plus de budget ; les autres ont leurs budgets terminés sur leur page) et la page de chaque épargne
// (ses réserves terminées). Le titre de chaque section ouvre sa page, toujours (2026-11-13) : plus de + dans les titres
// ni de lien « Toutes les … » en bas ; on crée par le + flottant de ces pages, ou par le + d'une section vide.
// Échéances (D18, 2026-11-11) : l'écran suit le chemin de l'argent — Disponible, Échéances, Budgets, Réserves, Épargne.
// Sous Disponible, une barre découpée de l'argent courant : échéances à payer, restes des budgets, libre (trois lignes
// courtes) ; la section Échéances (dues-ui.js, revue le 2026-11-11) : un résumé comme les autres sections — une ligne
// par échéance avec son étape en cours, les retards et celles du jour toujours (Confirmer, Passer), puis les prochaines
// jusqu'à 3 lignes, « Toutes les échéances » (leur page, comme « Tous les budgets ») ; les fois réglées sont dans
// la page de l'échéance.
// Tout est une lecture (src/domain/budgets.js) ; posé sur le papier, sans cartes (D0).
import {
  settings, budgetReport, savingsAccounts,
  savingsReport, emergencyAccount, pref, categoryBoard, dueItems, schedules,
} from '../core/store.js';
import { duesSectionHTML, wireDues } from './dues-ui.js';
import { DUE, RES } from '../domain/words.js';
import { openReserveSheet, coveredMonths, monthsPct, monthsLabel, reservesRing, openAsideMenu, resTone, savTone, gapText, numDate } from './reserves.js';
import { today, money, esc, approx } from '../core/format.js';
import { dayShort } from './due-page.js';
import { habitsLeft } from '../domain/budgets.js';
import { icon } from '../core/icons.js';
import { buzz, fitText, splitAmount, countUp, menuSheet, afterSheets, $, $$ } from '../core/ui.js';
import { accountPill } from './pickers.js';
import { openBudgetSheet } from './budget-sheet.js';
import { openAccountSheet } from './accounts.js';
import { listHTML, wireCatRows } from './budget-cats.js';
import { titleLink, listPageHTML, wireListPage, rowHTML, sectionHTML, emptyState } from './parts.js';

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
/** Une épargne qui a un souci : une réserve échue ou sans rien de prévu, ou des versements qui ne suffisent pas. @param {{ rep: any }} x */
const savingsBad = x => x.rep.free < 0 || x.rep.versement?.gap > 0 || x.rep.reserves.some((/** @type {any} */ v) => resTone(v) === 'loss' || v.status === 'none' || (v.full && v.day));
/** Les dépenses prévues d'une épargne, par date (en pause : en dernier). @param {any} rep */
const byDue = rep => [...rep.reserves].sort((p, q) => { const dp = p.reserve.due || '9999', dq = q.reserve.due || '9999'; return dp < dq ? -1 : dp > dq ? 1 : 0; });
/** Le genre d'une épargne pour le tri : avec des dépenses prévues, puis avec un objectif, puis sans rien. @param {{ rep: any }} x */
const savKind = x => (x.rep.reserves.length ? 0 : x.rep.goal ? 1 : 2);
/**
 * Les portefeuilles d'épargne actifs : celles qui ont des dépenses prévues, puis un objectif, puis rien (2026-11-25, avec
 * l'utilisateur) ; dans chaque groupe, un souci d'abord, puis les plus gros soldes ; le fonds d'urgence toujours le
 * dernier (2026-11-20). @param {any[]} savings
 */
const savingsReports = savings => savings.map(a => ({ a, rep: savingsReport(a.id) }))
  .sort((p, q) => Number(p.a.emergency) - Number(q.a.emergency) || savKind(p) - savKind(q) || Number(savingsBad(q)) - Number(savingsBad(p)) || q.rep.balance - p.rep.balance);
/**
 * Une ligne d'épargne dans Plan (2026-11-25, revue le 2026-11-26 avec l'utilisateur) : sa pastille simple (plus d'anneau :
 * il disait le remplissage, pas le retard), son nom, son solde, et dessous un verdict, une seule phrase — sur Plan, une
 * épargne répond à « serai-je prêt à temps ? » ; ce qu'elle prépare est dit aux pages suivantes. Rouge : une date passée
 * ou à utiliser aujourd'hui ; orange : ce qui manque aux versements, sinon celles qui ne seront pas prêtes à temps ;
 * sinon « Dans les temps · Fêtes le 20 déc » (la prochaine dépense prévue datée), son objectif, ou rien de prévu. Le
 * fonds d'urgence : ses mois couverts.
 * @param {{ a: any, rep: any }} x
 */
function savingsRowHTML({ a, rep }) {
  const cur = a.currency;
  const row = (/** @type {string} */ pill, /** @type {string} */ sub) => rowHTML({ attrs: `data-sav="${a.id}"`, pill, title: esc(a.name), sub, subCls: 'wrap',
    end: `<span class="amt">${money(rep.balance, { cur })}</span>` });
  if (a.emergency) return row(accountPill(a), monthsLabel(coveredMonths(a)));
  const late = rep.reserves.filter((/** @type {any} */ v) => resTone(v) === 'loss');
  const due = late.length;
  const next = byDue(rep).find(v => v.reserve.due && v.reserve.due >= today());
  const day = rep.reserves.find((/** @type {any} */ v) => v.full && v.day);
  const names = byDue(rep).map(v => esc(v.reserve.name));
  const gap = rep.versement?.gap;
  const sub = due ? `<span class="loss">${due > 1 ? plural(due, 'date passée', 'dates passées') : `${esc(late[0].reserve.name)} : date passée`}</span>`
    : day ? `<span class="rs-warn">${esc(day.reserve.name)} : à utiliser aujourd’hui</span>`
    : gap > 0 ? `<span class="rs-warn">${gapText(rep.versement, cur, true)}</span>`
    : rep.reserves.some((/** @type {any} */ v) => resTone(v) === 'warn') ? `<span class="rs-warn">${plural(rep.reserves.filter((/** @type {any} */ v) => resTone(v) === 'warn').length, 'pas prête à temps', 'pas prêtes à temps')}</span>`
    : next ? `Dans les temps · ${esc(next.reserve.name)} le ${dayShort(next.reserve.due)}`
    : names.length ? 'Dans les temps'
    : rep.goal ? `${rep.goal.pct} % de l’objectif` : RES.None;
  return row(accountPill(a), sub);
}
/**
 * Les actions de l'épargne, toujours visibles (comme le « + » des autres sections, 2026-11-12) : l'invitation « Fonds
 * d'urgence » tant qu'aucun portefeuille ne porte ce rôle, « Mettre de côté » ; sans épargne, « Mettre ton épargne à part ».
 * @param {any[]} savings
 */
/** aside : « Mettre de côté » (pas dans Toutes les épargnes, 2026-11-20 : on n'y sait pas vers quelle épargne). @param {any[]} savings @param {{ aside?: boolean }} [o] */
function savingsActionsHTML(savings, { aside = true } = {}) {
  if (!savings.length) return `<div class="group">${rowHTML({ attrs: 'data-create-sav', pill: `<span class="pill acc">${icon('piggy-bank')}</span>`,
    title: 'Mettre ton épargne à part', sub: `Un portefeuille pour ton épargne et ${RES.yourMany}` })}</div>`;
  const invite = !emergencyAccount() && !pref('emergencyDismissed');
  // l'invitation suit les épargnes : le même trait qu'entre deux d'entre elles (« Mettre de côté », une action, a le trait plein)
  return `<div class="group plain">${invite ? rowHTML({ cls: 'rule', attrs: 'data-emergency', pill: accountPill({ kind: 'bank', savings: true, emergency: true }),
    title: 'Fonds d’urgence', sub: 'De quoi tenir dans un coup dur : 3 mois de dépenses' }) : ''}
    ${aside ? rowHTML({ cls: 'add-row', attrs: 'data-aside', pill: `<span class="pill">${icon('hand-coins')}</span>`, title: 'Mettre de côté', titleCls: 'b-aside' }) : ''}</div>`;
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
  // Mettre de côté (D17 ; 2026-11-25, avec l'utilisateur : une seule porte, ses trois choix — maintenant, une fois plus
  // tard, chaque mois) vers l'épargne (le fonds d'urgence d'abord, sinon le premier portefeuille d'épargne) ; on ne bloque
  // jamais où va l'argent
  $$('[data-aside]', app).forEach(b => (b.onclick = () => {
    const to = savings.find(a => a.emergency && a.currency === main) || savings.find(a => a.currency === main) || savings[0];
    if (!to) return;
    buzz(6);
    openAsideMenu(to.id, ctx.openEntry);
  }));
}

const CARD_LINES = 4;

/**
 * La carte d'une épargne dans « Toutes les épargnes » (2026-11-25, avec l'utilisateur) : voir l'en-tête du fichier ; le
 * fonds d'urgence : sa barre des 3 mois, ses mois couverts. Un seul geste : sa page.
 * @param {{ a: any, rep: any }} x
 */
function savingsCardHTML({ a, rep }) {
  const cur = a.currency;
  if (a.emergency) {
    const m = coveredMonths(a);
    return `<div class="row mrow sav-card"><button type="button" class="mrow-go" data-sav="${a.id}" aria-label="${esc(a.name)} : sa page">
      <span class="main bp"><span class="bp-k">${esc(a.name)}</span><span class="bp-big">${money(rep.balance, { cur })}</span>
        <span class="bar"><i style="width:${monthsPct(m)}%"></i></span>
        <span class="bp-l muted">${monthsLabel(m)}</span></span></button></div>`;
  }
  const ring = reservesRing(rep) || rep.goal;
  // par date (en pause : en dernier) ; au-delà de 4, « et N autres »
  const list = byDue(rep);
  const dot = (/** @type {any} */ v) => (resTone(v) ? ` ${resTone(v)}` : '');
  const lines = list.slice(0, CARD_LINES).map(v => `<span class="bp-l sav-l"><i class="bp-dot${dot(v)}"></i><span class="sav-n">${esc(v.reserve.name)}</span>
    <span class="sav-w">${numDate(v.reserve.due)}</span></span>`).join('');
  const more = list.length > CARD_LINES ? `<span class="bp-l muted">et ${plural(list.length - CARD_LINES, `autre ${RES.one}`, `autres ${RES.many}`)}</span>` : '';
  const v = rep.versement;
  // la couleur de la barre : celle de l'épargne (la plus grave de ses dépenses prévues) ; ou l'objectif passé sans être atteint
  const tone = rep.reserves.length ? savTone(rep) : rep.goal && rep.goal.passed && !rep.goal.reached ? 'warn' : '';
  const say = rep.reserves.length && v ? (v.gap > 0 ? `<span class="bp-l rs-warn">${gapText(v, cur, true)}</span>` : v.gap === 0 ? '<span class="bp-l muted">Tes versements suffisent</span>' : '')
    : rep.goal ? `<span class="bp-l muted">Objectif ${money(rep.goal.amount, { cur })}${rep.goal.on ? ` pour le ${dayShort(rep.goal.on)}` : ''}</span>` : `<span class="bp-l muted">${RES.None}</span>`;
  return `<div class="row mrow sav-card"><button type="button" class="mrow-go" data-sav="${a.id}" aria-label="${esc(a.name)} : sa page">
    <span class="main bp"><span class="bp-k">${esc(a.name)}</span>
      <span class="bp-big">${money(rep.balance, { cur })}</span>
      ${ring ? `<span class="bar${tone === 'loss' ? ' over' : tone === 'warn' ? ' warn' : ''}"><i style="width:${Math.max(0, Math.min(100, ring.pct))}%"></i></span>` : ''}
      ${lines}${more}${say}</span></button></div>`;
}
/**
 * La section « Épargnes » de Plan (2026-11-25, avec l'utilisateur) : voir l'en-tête du fichier.
 * @param {{ a: any, rep: any }[]} reports @param {any[]} savings
 */
function savingsSectionHTML(reports, savings) {
  const plain = reports.filter(x => !x.a.emergency);
  // une seule épargne, rien de prévu ni d'objectif : on invite à préparer une dépense
  const empty = plain.length === 1 && !plain[0].rep.reserves.length && !plain[0].rep.goal
    ? emptyState('Prépare à l’avance une dépense à venir : l’assurance, la rentrée, un téléphone.', { add: [`data-newres="${plain[0].a.id}"`, RES.New] }) : '';
  const rows = empty ? reports.filter(x => x.a.emergency) : reports;
  const shown = shortList(rows, savingsBad);
  return `${empty}${rows.length ? `<div class="group">${rows.filter((_, i) => shown[i]).map(x => savingsRowHTML(x)).join('')}</div>` : ''}${savingsActionsHTML(savings)}`;
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
    <div class="topbar m-top"><h1 class="title">Plan</h1></div>

    <section class="hero b-hero">
      <div class="label">Disponible</div>
      <div class="big${avail < 0 ? ' neg' : ''}">${splitAmount(Math.abs(avail), { key: 'budget-avail', neg: avail < 0 })}</div>
      ${splitHTML(r, ahead)}
    </section>

    ${duesSectionHTML(dues, { shown: duesShown, any: schedules().length > 0 })}

    ${sectionHTML({ head: titleLink('Budgets', 'data-all'), body: `
      ${r.list.length ? '' : emptyState('Fixe un montant pour une catégorie : il ne compte plus dans Disponible.', { add: ['data-new', 'Créer un budget'] })}
      ${catItems.length ? `<div class="group" data-budgets>${listHTML(catItems)}</div>` : ''}` })}

    ${sectionHTML({ head: titleLink('Épargnes', 'data-all-sav'), body: savingsSectionHTML(reports, savings) })}


  </div>`;

  $$('[data-new]', app).forEach(b => (b.onclick = () => { buzz(6); openBudgetSheet(); }));
  wireDues(app, dues, ctx);
  wireCatRows(app, ctx);
  const all = $('[data-all]', app);
  if (all) all.onclick = () => { buzz(6); ctx.go('#/mois/categories'); };
  const habits = $('[data-habits]', app);
  if (habits) habits.onclick = () => { buzz(6); ctx.go('#/mois/categories'); };
  wireSavings(app, ctx, savings);
  $$('[data-newres]', app).forEach(b => (b.onclick = () => { buzz(6); openReserveSheet({ wallet: b.dataset.newres || null, openEntry: ctx.openEntry }); }));
  // le titre : « Toutes les épargnes », toujours (comme « Tous les budgets »)
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
    : key('free', `${r.available > 0 ? `${money(r.available)} disponibles` : 'Rien de disponible'}, sur ${money(r.total)}`);
  return `<div class="b-split" aria-hidden="true">${seg(r.toPay, 'due')}${seg(r.inBudgets, 'bud')}${seg(free, 'free')}</div>
    <div class="b-keys">${r.toPay ? key('due', `${money(r.toPay)} ${DUE.ofMany} à payer`) : ''}${r.list.length ? key('bud', `${money(r.inBudgets)} dans tes budgets`) : ''}
      ${tail}</div>`;
}

/**
 * « Toutes les épargnes » (2026-11-12 ; ses cartes le 2026-11-25) : tous les portefeuilles d'épargne, une carte chacun, le même
 * ordre que Plan (un souci d'abord, puis les plus gros soldes, le fonds d'urgence le dernier), leur total en tête ; « Fonds d'urgence » et « Mettre de côté » toujours là.
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
    // le + (2026-11-26, avec l'utilisateur) : avec une épargne qui peut porter une dépense prévue (ni fonds d'urgence, ni
    // archivée), il propose les deux ; sinon il crée une épargne, comme avant
    const canPlan = savings.some(a => !a.emergency);
    app.innerHTML = listPageHTML({ title: 'Épargnes', fab: canPlan ? `Ajouter une épargne ou ${RES.a}` : 'Nouveau portefeuille d’épargne',
      intro: reports.length ? { label: 'Mis de côté en tout', big: money(total),
        sub: [split.held ? `${money(split.held)} pour ${RES.yourMany}` : '', split.free ? `${money(split.free)} d’épargne libre` : '', others ? `et ${plural(others, 'autre devise', 'autres devises')}` : ''].filter(Boolean).join(' · ') } : null,
      body: sectionHTML({ body: `${reports.length ? `<div class="group">${reports.map(x => savingsCardHTML(x)).join('')}</div>` : ''}
        ${savingsActionsHTML(savings, { aside: false })}` }) });
    wireListPage(app, ctx, async () => {
      if (!canPlan) return void openAccountSheet(null, { savings: true });
      const k = await menuSheet({ title: 'Ajouter', items: [
        { key: 'saving', icon: 'piggy-bank', label: 'Nouvelle épargne' },
        { key: 'plan', icon: 'calendar-blank', label: 'Prévoir une dépense' },
      ] });
      if (k === 'saving') afterSheets(() => openAccountSheet(null, { savings: true }));
      else if (k === 'plan') afterSheets(() => openReserveSheet({ openEntry: ctx.openEntry }));
    });
    wireSavings(app, ctx, savings);
  },
};
