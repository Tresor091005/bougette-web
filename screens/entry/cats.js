// Catégorie (D14) : une rangée de gélules — la catégorie choisie, puis les 3 plus probables (heure, jour, montant tapé,
// habitudes : src/domain/suggest.js), puis « Toutes ». Trois, pas six (2026-11-26, avec l'utilisateur : à six, « Toutes »
// sortait de l'écran et on l'oubliait ; la rangée suit de toute façon le montant tapé), et moins encore si leurs noms
// sont longs : « Toutes » se voit toujours en entier, sans faire défiler. Les suggestions vont droit à la sous-catégorie
// (« Zem », pas « Transport » puis « Zem »). Un toucher choisit, un 2e toucher sur la même retire le choix. Tant que
// rien n'est choisi, la rangée suit le montant tapé ; une fois choisi, elle ne bouge plus.
import { account, category, categoryLabel, transactions } from '../../core/store.js';
import { buzz, afterSheets, $, $$ } from '../../core/ui.js';
import { icon, catIcon } from '../../core/icons.js';
import { today, esc } from '../../core/format.js';
import { suggestCategories } from '../../domain/suggest.js';
import { openCategorySheet } from '../categories.js';
import { checking, savingsSpend, openOfWallet, validIds, planning, planCat } from './state.js';
import { paintReserves } from './reserves.js';
import { pickEntryCategory, editNote } from './sheets.js';
import { paintAsk } from './plan.js';
import { RES } from '../../domain/words.js';

/** Une gélule de catégorie. @param {import('./state.js').Entry} E @param {any} c @param {boolean} on */
const sc = (E, c, on) => `<button type="button" class="sc${on ? ' on' : ''}${on && E.st.auto ? ' auto' : ''}" data-cat="${c.id}" role="radio" aria-checked="${on}" aria-label="${esc(categoryLabel(c.id))}${on && E.st.auto ? ' (proposée)' : ''}" style="--c:var(--${c.color || 'c0'})">${catIcon(c.icon)}<span>${esc(c.name)}</span></button>`;

/**
 * La gélule de la catégorie choisie se remplit : la part de son budget (ou de son habitude) avec cette dépense.
 * @param {import('./state.js').Entry} E @param {any} x l'effet sur la catégorie (impact), ou null
 */
export function paintImpact(E, x) {
  const { st, el } = E;
  $$('[data-cats] .sc', el).forEach(b => { b.classList.remove('gauge', 'over', 'habit'); b.style.removeProperty('--p'); });
  // une réserve choisie (2026-11-19, comme la catégorie et son budget) : sa gélule va jusqu'à ce qu'elle vise encore ;
  // un trait blanc marque sa part (ce qui est de côté pour elle, placé automatiquement), ce qu'on tape la remplit ;
  // seul ce qu'elle vise est une limite (au-delà, refusé)
  const rb = savingsSpend(E) && st.reserveId ? $(`[data-cats] .rs-chip.on[data-res="${st.reserveId}"]`, el) : null;
  const rv = rb ? openOfWallet(E).find(v => v.reserve.id === st.reserveId) : null;
  if (rb && rv && rv.target > 0) {
    rb.classList.add('gauge');
    rb.classList.toggle('over', st.amount > rv.target);
    rb.style.setProperty('--p', String(Math.min(100, Math.round((st.amount * 100) / rv.target))));
  }
  const b = x && $(`[data-cats] .sc.on[data-cat="${st.categoryId}"]`, el);
  if (!b) return;
  b.classList.add('gauge');
  b.classList.toggle('over', x.over);
  b.classList.toggle('habit', x.kind === 'habit');
  b.style.setProperty('--p', String(Math.round(x.ratio * 100)));
}

/** @param {import('./state.js').Entry} E */
export function paintCats(E) {
  const { st, el } = E;
  const host = $('[data-cats]', el);
  host.setAttribute('aria-label', 'Catégorie');
  host.setAttribute('role', 'radiogroup');
  host.classList.remove('list', 'e-plan');
  // programmer : plus de suggestions, deux pastilles (la catégorie, le nom)
  if (planning(E)) return paintPlan(E, host);
  if (st.type === 'transfer' && !checking(E)) { E.shownFor = null; host.hidden = true; return; }
  // une échéance se confirme dans sa catégorie (et son opération la garde) : on la voit, on ne la change pas ici (on
  // modifie l'échéance). Payée depuis une épargne sans sa réserve : une dépense ordinaire si ce portefeuille le permet,
  // sinon on le dit
  if (E.held) {
    E.shownFor = null;
    host.hidden = false;
    const w = account(st.accountId);
    st.other = savingsSpend(E) && !st.reserveId && !!w?.spendOk;
    const c = category(st.categoryId || '');
    host.innerHTML = (c ? sc(E, c, true).replace('<button type="button" class="sc', '<button type="button" aria-disabled="true" class="sc fixed') : '')
      + (savingsSpend(E) && !st.reserveId && !st.other ? `<p class="rs-none">${esc(w?.name || '')} ne permet que ${RES.itsMany} : choisis un autre portefeuille.</p>` : '');
    host.onclick = null;
    return;
  }
  if (savingsSpend(E)) { E.shownFor = null; return paintReserves(E, host); }
  host.hidden = checking(E);
  if (host.hidden) return;
  const typeChanged = !E.shownFor || E.shownFor.type !== st.type;
  if (typeChanged || ((!st.categoryId || st.auto) && E.shownFor.amount !== st.amount)) {
    E.shown = suggestCategories(transactions(), { type: st.type, today: today(), hour: new Date().getHours(), amount: st.amount, valid: validIds(st.type), limit: 3 });
    E.shownFor = { type: st.type, amount: st.amount };
    host.scrollLeft = 0;
  }
  const ids = st.categoryId && !E.shown.includes(st.categoryId) ? [st.categoryId, ...E.shown] : E.shown;
  host.innerHTML = ids.map(id => category(id)).filter(Boolean).map(c => sc(E, c, c.id === st.categoryId)).join('')
    + `<button type="button" class="sc more" data-all>${icon('squares-four')}<span>Toutes</span></button>`;
  // « Toutes » reste à l'écran (2026-11-26, avec l'utilisateur : poussée dehors par des noms longs, on l'oubliait) : une
  // suggestion qui la ferait sortir part, la dernière d'abord ; la catégorie choisie reste toujours
  const more = /** @type {HTMLElement} */ ($('[data-all]', host));
  const edge = host.getBoundingClientRect().right - parseFloat(getComputedStyle(host).paddingRight || '0');
  for (const chip of [...$$('[data-cat]:not(.on)', host)].reverse()) {
    if (more.getBoundingClientRect().right <= edge) break;
    host.removeChild(chip);
  }
  host.onclick = async e => {
    const b = e.target.closest('[data-cat], [data-all]');
    if (!b) return;
    buzz(6);
    // la proposée touchée : confirmée (elle reste) ; sinon un 2e toucher retire le choix
    if (b.dataset.cat) { st.categoryId = st.categoryId === b.dataset.cat && !st.auto ? null : b.dataset.cat; st.auto = false; }
    else if (!(await chooseFromAll(E))) return;
    paintCats(E); E.paintAmount();
  };
}

/** « Toutes » : la liste des catégories ; une catégorie choisie (ou créée en passant) devient celle de la saisie. Dit si une est choisie, ici même. @param {import('./state.js').Entry} E */
async function chooseFromAll(E) {
  const { st } = E;
  const r = await pickEntryCategory({ type: st.type, current: st.categoryId });
  if (!r) return false;
  if (typeof r === 'object') {
    // rien de trouvé : on crée la catégorie avec le nom tapé, puis la saisie la choisit
    const type = st.type;
    afterSheets(() => openCategorySheet(null, type, { name: r.create, onSaved: c => {
      if (st.type !== type) return;
      st.categoryId = c.id; st.auto = false; E.shownFor = null;
      paintCats(E); E.paintAmount();
    } }));
    return false;
  }
  st.categoryId = r;
  st.auto = false;
  return true;
}

/**
 * Programmer (2026-11-26, avec l'utilisateur : une seule feuille pour noter et programmer) : à la place des suggestions, la
 * catégorie choisie (sans suggestion d'office ; absente d'un virement) et le nom de l'opération.
 * @param {import('./state.js').Entry} E @param {HTMLElement} host
 */
function paintPlan(E, host) {
  const { st } = E;
  E.shownFor = null; // revenue à noter, la rangée se recompose d'après le montant
  host.hidden = false;
  host.classList.add('e-plan');
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Catégorie et nom');
  const c = planCat(E) ? category(/** @type {string} */ (planCat(E))) : null;
  // la catégorie choisie garde sa couleur (la même gélule qu'en mode noter) ; la rangée commence à la gouttière (2026-11-26, avec l'utilisateur)
  host.innerHTML = (st.type === 'transfer' ? '' : c
    ? `<button type="button" class="sc on" data-catp style="--c:var(--${c.color || 'c0'})" aria-label="Catégorie : ${esc(c.name)}, changer">${catIcon(c.icon)}<span>${esc(c.name)}</span></button>`
    : `<button type="button" class="sc more" data-catp>${icon('squares-four')}<span>Catégorie</span></button>`)
    + `<button type="button" class="mp${st.note ? ' set' : ''}" data-namep>${icon('text-align-left')}<span>${esc(st.note || 'Nom')}</span></button>`;
  paintAsk(E);
  host.onclick = async e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-catp], [data-namep]'));
    if (!b) return;
    buzz(6);
    if (b.matches('[data-catp]')) { if (!(await chooseFromAll(E))) return; }
    else {
      const v = await editNote(st.note, { title: 'Nom', placeholder: 'Ex. Loyer, Canal Box', max: 40 });
      if (v == null) return;
      st.note = v;
    }
    paintCats(E); E.paintAmount();
  };
}
