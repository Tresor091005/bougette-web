// À revoir (D21, 2026-11-20, avec l'utilisateur) : les changements faits sur ce téléphone que la synchro n'a pas pu garder
// (un autre appareil avait supprimé ou changé la même chose). Chacun dit ce que c'était et pourquoi ; une opération se
// refait en un toucher (la saisie préremplie, à sa date : on choisit un autre portefeuille), le reste se laisse tomber.
// En rouge : rien ne doit se perdre sans que la personne le sache.
import { icon } from '../core/icons.js';
import { buzz, toast, $, $$ } from '../core/ui.js';
import { esc, money } from '../core/format.js';
import { session } from '../core/store.js';
import { reviewItems, dropReview, onReview } from '../core/review.js';
import { describeReview } from '../data/review.js';
import { openEntry } from './entry.js';

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
export function render(app, { back }) {
  const items = reviewItems();
  const views = items.map(it => ({ it, v: describeReview(it, session.state, (a, cur) => money(a, { cur })) }));
  app.innerHTML = `<div class="screen settings no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">À revoir</h1></div></div>
    ${views.length ? `<p class="rv-lead">${views.length === 1 ? 'Ce changement fait sur ce téléphone n’a pas été gardé' : 'Ces changements faits sur ce téléphone n’ont pas été gardés'}. Un autre appareil avait déjà supprimé ou changé la même chose. Refais ce qui compte, laisse tomber le reste.</p>
    <section class="section"><div class="rv-list">
      ${views.map(({ it, v }) => `<div class="rv-item">
        <div class="rv-t">${esc(v.title)}</div>
        <div class="rv-s">${esc(v.sub)}</div>
        <div class="rv-why">${icon('warning')}<span>${esc(v.why)}</span></div>
        <div class="rv-acts">
          ${v.redo ? `<button class="btn primary sm" data-redo="${esc(it.id)}">Refaire</button><button class="btn ghost sm" data-drop="${esc(it.id)}">Laisser tomber</button>`
            : `<button class="btn secondary sm" data-drop="${esc(it.id)}">Compris</button>`}
        </div>
      </div>`).join('')}
    </div></section>`
    : `<p class="rv-lead">Rien à revoir.</p>`}
  </div>`;
  $('[data-back]', app).onclick = () => back('#/reglages');
  $$('[data-drop]', app).forEach(b => (b.onclick = () => { buzz(8); dropReview(/** @type {string} */ (b.dataset.drop)); }));
  $$('[data-redo]', app).forEach(b => (b.onclick = () => {
    const found = views.find(x => x.it.id === b.dataset.redo);
    if (!found || !found.v.redo) return;
    const r = found.v.redo;
    buzz(8);
    openEntry({
      type: r.type, accountId: r.accountId, toAccountId: r.toAccountId, date: r.date,
      copy: { type: r.type, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId, note: r.note },
      onSaved: () => { dropReview(found.it.id); toast('Opération refaite'); },
    });
  }));
  stop();
  stop = onReview(() => { if (document.body.contains(app) && location.hash.startsWith('#/a-revoir')) render(app, { back }); else stop(); });
}
let stop = () => {};
