// Section « Échéances » de l'écran Budget (D18, revue le 2026-11-11) : un résumé, comme les autres sections. Une ligne
// par échéance — une opération récurrente (ses règles successives comprises) ou une ancienne opération prévue — avec son
// étape en cours : la première fois qui reste à régler (on ne parle pas de la suivante tant qu'elle ne l'est pas). En
// retard et du jour toujours, avec Confirmer et Passer (un toucher chacun) ; puis les prochaines, la plus proche
// d'abord, quel que soit le mois, jusqu'à 3 lignes ; le titre « Échéances » ouvre « Toutes les échéances », toujours
// (2026-11-13 : plus de + dans le titre, on y crée par le + flottant). Les fois réglées ne sont pas
// listées : elles sont dans la page de l'échéance, où l'on passe d'une fois à l'autre. Une ligne, un geste (2026-11-12,
// D0) : la toucher ouvre cette page (l'opération pour une ancienne opération prévue), où sont toutes ses actions ; seules
// les actions du moment restent en clair (Confirmer, Passer). Rien ne s'écrit tout seul. « Échéances terminées » (2026-11-12) : en bas de
// Budget, celles qui n'ont plus rien à régler ni à venir, pour les relire (leur page, en lecture seule).
import { account, category, dueItems, endedDues, budgetReport, duesUntil, settings } from '../core/store.js';
import { esc, today, money, period } from '../core/format.js';
import { icon } from '../core/icons.js';
import { chip, buzz, fitText, fabHTML, $, $$ } from '../core/ui.js';
import { accountPill, fillsHTML } from './pickers.js';
import { openDueSheet, dueHref, endedLabel, dueMoney, dueTitle, dayShort, confirmNow, skipNow } from './due-page.js';
import { openOperation } from './history.js';
import { confirmWeekOr } from './week-sheet.js';

/** @typedef {import('../domain/dues.js').DueItem} DueItem */
/** @typedef {import('../domain/dues.js').EndedDue} EndedDue */

/** Ce qu'on dit sous le nom : l'étape en cours. @param {DueItem} d */
function when(d) {
  const rank = d.rank && d.times ? ` · ${d.rank} sur ${d.times}` : '';
  const flags = `${d.paused ? ' · à revoir' : ''}${d.needsWallet ? ' · réserve close' : ''}`;
  if (d.state === 'late') return `<span class="loss">${d.lateCount > 1 ? `${d.lateCount} retards, depuis le ${dayShort(d.date)}` : `En retard · le ${dayShort(d.date)}`}</span>${rank}${flags}`;
  if (d.state === 'today') return `Aujourd’hui${rank}${flags}`;
  return `Le ${dayShort(d.date)}${rank}${flags}`;
}

/** Une ligne : une échéance et son étape en cours. @param {DueItem} d */
function rowHTML(d) {
  const c = d.category ? category(d.category) : null;
  const pill = d.kind === 'transfer' ? accountPill(account(d.to || '') || { kind: 'cash' }, 'sm') : chip(c);
  // Confirmer d'un toucher : du jour ou en retard, pas en pause, et pas quand sa réserve est close (portefeuille à choisir)
  const act = (d.state === 'late' || d.state === 'today') && !d.paused && !d.needsWallet;
  return `<div class="row mrow due-row" data-due="${esc(d.key)}">
    <button type="button" class="mrow-go" data-due-go="${esc(d.key)}" aria-label="${esc(dueTitle(d))}">${pill}
      <span class="main"><span class="l1"><span class="t">${esc(dueTitle(d))}</span><span class="v${d.kind === 'income' ? ' in' : ''}">${dueMoney(d)}</span></span>
        <span class="l2"><span class="s">${when(d)}</span></span>${d.kind === 'transfer' ? fillsHTML(d.reserve) : ''}</span></button>
    ${act ? `<div class="due-acts"><button type="button" class="btn sm due-ok" data-due-ok="${esc(d.key)}">${icon('check')}Confirmer</button>
      <button type="button" class="btn sm due-pass" data-due-skip="${esc(d.key)}">Passer</button></div>` : ''}</div>`;
}

/** Des lignes d'échéances (le Journal, « À venir », 2026-11-13) : la même ligne que Plan. @param {DueItem[]} items */
export const dueRowsHTML = items => items.map(d => rowHTML(d)).join('');

/**
 * La section entière. shown : les lignes montrées (les retards et celles du jour toujours, puis jusqu'à 3) ; les autres
 * sont dans « Toutes les échéances », comme les terminées : son titre l'ouvre, toujours (2026-11-13 ; on y crée par le +
 * flottant) ; any : il existe des échéances (finies ou arrêtées comprises).
 * @param {DueItem[]} items @param {{ shown: boolean[], any: boolean }} o
 */
export function duesSectionHTML(items, { shown, any }) {
  const body = items.length ? `<div class="group">${items.filter((_, i) => shown[i]).map(d => rowHTML(d)).join('')}</div>`
    : `<div class="w-none"><p>${any ? 'Rien à régler pour l’instant' : 'Pas encore d’échéance'}</p><button type="button" class="iconbtn" data-new-due aria-label="Nouvelle échéance">${icon('plus')}</button></div>`;
  return `<section class="section b-dues"><div class="section-h"><h2><button type="button" class="sh-link" data-all-dues>Échéances${icon('caret-right')}</button></h2></div>${body}</section>`;
}

/**
 * « Échéances terminées » (D18, 2026-11-12) : un titre qui s'ouvre (D0), une ligne par échéance qui n'a plus rien à
 * régler ni à venir, les plus récentes d'abord — son nom, ce qui a été réglé, « Finie le … » ou « Arrêtée · dernière fois
 * le … ».
 * Toucher ouvre sa page, en lecture seule. Rien quand il n'y en a pas.
 * @param {EndedDue[]} list
 */
export function endedSectionHTML(list) {
  if (!list.length) return '';
  return `<details class="section b-done"><summary>Échéances terminées <span class="muted">${list.length}</span></summary>
    <div class="group">${list.map(x => {
      const pill = x.kind === 'transfer' ? accountPill(account(x.to || '') || { kind: 'cash' }, 'sm') : chip(x.category ? category(x.category) : null);
      return `<div class="row mrow"><button type="button" class="mrow-go" data-due-done="${esc(x.head)}" aria-label="${esc(dueTitle(x))} : ses fois">${pill}
        <span class="main"><span class="l1"><span class="t">${esc(dueTitle(x))}</span><span class="v${x.kind === 'income' ? ' in' : ''}">${x.paidCount && !x.mixed ? dueMoney({ kind: x.kind, amount: x.paid, currency: x.currency }) : ''}</span></span>
          <span class="l2"><span class="s">${endedLabel(x)}${x.paidCount ? ` · ${x.paidCount} fois` : ''}</span></span></span></button></div>`;
    }).join('')}</div></details>`;
}

/** Branche la section. @param {HTMLElement} root @param {DueItem[]} items @param {any} ctx */
export function wireDues(root, items, ctx) {
  const byKey = new Map(items.map(d => [d.key, d]));
  $$('[data-new-due]', root).forEach(b => (b.onclick = () => { buzz(6); openDueSheet({ openEntry: ctx.openEntry }); }));
  // toucher la ligne : la page de l'échéance, sur son étape en cours (une ancienne opération prévue : sa fiche) ;
  // une terminée : sa page, en lecture seule
  $$('[data-due-go]', root).forEach(b => (b.onclick = () => {
    const d = byKey.get(b.dataset.dueGo || '');
    if (!d) return;
    buzz(6);
    if (!d.schedule && d.entry) return openOperation(d.entry);
    if (d.schedule) ctx.go(dueHref(d.head || d.schedule, d.date));
  }));
  $$('[data-due-done]', root).forEach(b => (b.onclick = () => { buzz(6); ctx.go(dueHref(b.dataset.dueDone || '')); }));
  $$('[data-all-dues]', root).forEach(b => (b.onclick = () => { buzz(6); ctx.go('#/mois/echeances'); }));
  $$('[data-due-ok]', root).forEach(b => (b.onclick = () => { const d = byKey.get(b.dataset.dueOk || ''); if (d) { buzz(6); confirmWeekOr(d, () => confirmNow(d, ctx.openEntry)); } }));
  $$('[data-due-skip]', root).forEach(b => (b.onclick = () => { const d = byKey.get(b.dataset.dueSkip || ''); if (d) skipNow(d); }));
}

/**
 * « Toutes les échéances » (D18, 2026-11-12, comme « Tous les budgets » pour les budgets) : une ligne par échéance qui
 * reste à régler, dans le même ordre et avec les mêmes actions que dans Plan ; toucher une ligne ouvre sa page. En bas,
 * « Échéances terminées » (en lecture seule).
 */
export const allDuesScreen = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const items = dueItems();
    // l'intro (2026-11-20, avec l'utilisateur, comme « Tous les budgets ») : ce qui reste à payer ce mois-ci, les retards,
    // ce qui rentre en face
    const rep = budgetReport(), cur = rep.cur;
    const late = items.filter(d => d.state === 'late').length;
    const end = period(today(), settings().monthStart).end;
    const inflow = duesUntil(end).filter(d => d.kind === 'income' && !d.paused && d.currency === cur).reduce((n, d) => n + d.amount, 0);
    const sub = [late ? `<span class="loss">dont ${late} en retard</span>` : '', inflow ? `${money(inflow, { cur })} qui rentrent` : ''].filter(Boolean).join(' · ');
    app.innerHTML = `<div class="screen month no-tabs has-fab">
      <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
        <h1 class="title sm">Toutes les échéances</h1></div></div>
      ${items.length ? `<section class="hero b-hero b-all"><div class="label">Encore à payer ce mois-ci</div><div class="big">${money(rep.toPay, { cur })}</div>
        ${sub ? `<div class="b-res">${sub}</div>` : ''}</section>` : ''}
      <section class="section b-dues">${items.length ? `<div class="group">${items.map(d => rowHTML(d)).join('')}</div>`
        : '<div class="w-none"><p>Rien à régler pour l’instant</p></div>'}</section>
      ${endedSectionHTML(endedDues())}
    </div>${fabHTML('Nouvelle échéance')}`;
    $('[data-back]', app).onclick = () => ctx.back('#/mois');
    wireDues(app, items, ctx);
    const add = $('[data-add]', app);
    if (add) add.onclick = () => { buzz(6); openDueSheet({ openEntry: ctx.openEntry }); };
    fitText(app, '.mrow .v', 13);
  },
};
