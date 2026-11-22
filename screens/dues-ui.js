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
import { chip, buzz, $, $$ } from '../core/ui.js';
import { accountPill, fillsHTML } from './pickers.js';
import { openDueSheet, dueHref, endedLabel, dueMoney, dueTitle, dayShort } from './due-page.js';
import { openOperation } from './history.js';
import { titleLink, endedHTML, listPageHTML, wireListPage, sectionHTML, emptyState } from './parts.js';

/** @typedef {import('../domain/dues.js').DueItem} DueItem */
/** @typedef {import('../domain/dues.js').EndedDue} EndedDue */

/** Ce qu'on dit sous le nom : l'étape en cours. @param {DueItem} d */
function when(d) {
  const rank = d.rank && d.times ? ` · ${d.rank} sur ${d.times}` : '';
  const flags = `${d.paused ? ' · en pause' : ''}${d.needsWallet ? ' · réserve close' : ''}`;
  if (d.state === 'late') return `<span class="loss">${d.lateCount > 1 ? `${d.lateCount} retards, depuis le ${dayShort(d.date)}` : `En retard · le ${dayShort(d.date)}`}</span>${rank}${flags}`;
  if (d.state === 'today') return `Aujourd’hui${rank}${flags}`;
  return `Le ${dayShort(d.date)}${rank}${flags}`;
}

/** Une ligne : une échéance et son étape en cours. @param {DueItem} d */
function rowHTML(d) {
  const c = d.category ? category(d.category) : null;
  const pill = d.kind === 'transfer' ? accountPill(account(d.to || '') || { kind: 'cash' }, 'sm') : chip(c);
  // pas d'action sur la ligne (2026-11-22, avec l'utilisateur : les gélules prenaient trop de place, un rond ✓ jurait) :
  // la toucher ouvre sa page, où sont Confirmer et Passer
  return `<div class="row mrow due-row" data-due="${esc(d.key)}">
    <button type="button" class="mrow-go" data-due-go="${esc(d.key)}" aria-label="${esc(dueTitle(d))}">${pill}
      <span class="main"><span class="l1"><span class="t">${esc(dueTitle(d))}</span><span class="v${d.kind === 'income' ? ' in' : ''}">${dueMoney(d)}</span></span>
        <span class="l2"><span class="s">${when(d)}</span></span>${d.kind === 'transfer' ? fillsHTML(d.reserve) : ''}</span></button></div>`;
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
    : emptyState(any ? 'Rien à régler pour l’instant' : 'Pas encore d’échéance', { add: ['data-new-due', 'Nouvelle échéance'] });
  return sectionHTML({ cls: 'b-dues', head: titleLink('Échéances', 'data-all-dues'), body });
}

/**
 * « Échéances terminées » (D18, 2026-11-12) : un titre qui s'ouvre (D0), une ligne par échéance qui n'a plus rien à
 * régler ni à venir, les plus récentes d'abord — son nom, ce qui a été réglé, « Finie le … » ou « Arrêtée · dernière fois
 * le … ».
 * Toucher ouvre sa page, en lecture seule. Rien quand il n'y en a pas.
 * @param {EndedDue[]} list
 */
function endedSectionHTML(list) {
  return endedHTML('Échéances terminées', list.map(x => {
    const pill = x.kind === 'transfer' ? accountPill(account(x.to || '') || { kind: 'cash' }, 'sm') : chip(x.category ? category(x.category) : null);
    return `<div class="row mrow"><button type="button" class="mrow-go" data-due-done="${esc(x.head)}" aria-label="${esc(dueTitle(x))} : ses fois">${pill}
        <span class="main"><span class="l1"><span class="t">${esc(dueTitle(x))}</span><span class="v${x.kind === 'income' ? ' in' : ''}">${x.paidCount && !x.mixed ? dueMoney({ kind: x.kind, amount: x.paid, currency: x.currency }) : ''}</span></span>
          <span class="l2"><span class="s">${endedLabel(x)}${x.paidCount ? ` · ${x.paidCount} fois` : ''}</span></span></span></button></div>`;
  }));
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
    const sub = [late ? `<span class="loss">dont ${late} en retard</span>` : '', inflow ? `${money(inflow, { cur })} à recevoir` : ''].filter(Boolean).join(' · ');
    app.innerHTML = listPageHTML({ title: 'Toutes les échéances', fab: 'Nouvelle échéance',
      intro: items.length ? { label: 'Encore à payer ce mois-ci', big: money(rep.toPay, { cur }), sub } : null,
      body: sectionHTML({ cls: 'b-dues', body: items.length ? `<div class="group">${items.map(d => rowHTML(d)).join('')}</div>` : emptyState('Rien à régler pour l’instant') }),
      ended: endedSectionHTML(endedDues()) });
    wireListPage(app, ctx, () => openDueSheet({ openEntry: ctx.openEntry }));
    wireDues(app, items, ctx);
  },
};
