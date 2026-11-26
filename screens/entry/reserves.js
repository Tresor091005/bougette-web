// Dépense depuis une épargne (D17) : ses réserves à la place des catégories, et « Autre dépense » si le portefeuille le permet.
import { account, category } from '../../core/store.js';
import { buzz, afterSheets, toast } from '../../core/ui.js';
import { icon, catIcon } from '../../core/icons.js';
import { esc, money } from '../../core/format.js';
import { reserveOrder } from '../../domain/entry-rules.js';
import { openCategorySheet } from '../categories.js';
import { canUse, openOfWallet, usableReserves } from './state.js';
import { pickEntryCategory, chooseReserve } from './sheets.js';
import { RES } from '../../domain/words.js';

/**
 * Dépense depuis une épargne (D17) : une ou deux gélules à la place des catégories — « Choisir une réserve » (feuille
 * des réserves de ce portefeuille) et « Autre dépense » si le portefeuille permet les dépenses.
 * @param {import('./state.js').Entry} E @param {HTMLElement} host
 */
export function paintReserves(E, host) {
  const { st } = E;
  const w = account(st.accountId);
  const list = usableReserves(E);
  if (st.reserveId && !list.some(v => v.reserve.id === st.reserveId)) st.reserveId = null;
  host.hidden = false;
  host.setAttribute('aria-label', `Payer ${RES.a}`);
  const v = st.reserveId ? list.find(x => x.reserve.id === st.reserveId) : null;
  // 3 réserves au plus (2026-11-19, avec l'utilisateur) : chacune en ligne, à côté d'« Autre dépense », avec sa part
  // dans la répartition calculée et son mode ; au-delà, la feuille. Une réserve en une fois que l'épargne ne peut pas
  // encore payer entièrement est grisée.
  // l'ordre ne bouge pas quand on en choisit une (2026-11-26, avec l'utilisateur)
  const all = reserveOrder(openOfWallet(E), canUse);
  // une gélule de réserve, la même partout (en ligne, ou choisie depuis la feuille au-delà de 3)
  const chipOf = (/** @type {any} */ x, pick = false) => {
    const r = x.reserve, on = st.reserveId === r.id, ok = canUse(x), rc = r.category ? category(r.category) : null;
    return `<button type="button" class="sc rs-chip${on ? ' on' : ''}${ok ? '' : ' dim'}" data-res="${r.id}"${pick ? ' data-pickres' : ''} aria-pressed="${on}" style="--c:var(--${rc?.color || 'c0'})">${rc ? catIcon(rc.icon) : icon('piggy-bank')}<span>${esc(r.name)}</span>${r.mode === 'once' ? `<span class="rs-once" aria-label="en une fois">${icon('lock-simple')}</span>` : ''}</button>`;
  };
  const pick = all.length && all.length <= 3 ? all.map(x => chipOf(x)).join('')
    // au-delà de 3 (2026-11-19, avec l'utilisateur) : un seul bouton ; la réserve choisie y prend sa gélule (teinte,
    // jauge), un toucher rouvre la feuille
    : all.length ? (v ? chipOf(v, true) : `<button type="button" class="sc more" data-pickres>${icon('piggy-bank')}<span>Choisir ${RES.a}</span>${icon('caret-down')}</button>`) : '';
  const oc = st.other && st.categoryId ? category(st.categoryId) : null;
  // réserve choisie sans catégorie : on la demande d'un toucher (rien ne s'ouvre tout seul)
  const needCat = v && !st.categoryId ? `<button type="button" class="sc need" data-needcat>${icon('squares-four')}<span>Catégorie ?</span></button>` : '';
  const other = w.spendOk ? `<button type="button" class="sc${oc ? ' on' : ' more'}" data-other${oc ? ` style="--c:var(--${oc.color || 'c0'})"` : ''}>${icon('squares-four')}<span>${oc ? `Autre · ${esc(oc.name)}` : 'Autre dépense'}</span></button>` : '';
  host.innerHTML = pick + needCat + other || `<p class="rs-none">${RES.None} dans ${esc(w.name)}, et les autres dépenses n’y sont pas permises (voir sa fiche).</p>`;
  const none = () => { st.reserveId = null; st.categoryId = null; paintReserves(E, host); E.paintAmount(); };
  host.onclick = async e => {
    const t2 = /** @type {HTMLElement} */ (e.target);
    if (t2.closest('[data-needcat]')) {
      buzz(6);
      const r = await pickEntryCategory({ type: 'expense', current: st.categoryId });
      if (r && typeof r === 'string') { st.categoryId = r; paintReserves(E, host); E.paintAmount(); }
      return;
    }
    if (t2.closest('[data-other]')) {
      buzz(6);
      const r = await pickEntryCategory({ type: 'expense', current: st.other ? st.categoryId : null });
      if (!r) return;
      if (typeof r === 'object') {
        // rien de trouvé : on crée la catégorie avec le nom tapé, puis la saisie la choisit
        afterSheets(() => openCategorySheet(null, 'expense', { name: r.create, onSaved: c => {
          st.other = true; st.reserveId = null; st.categoryId = c.id; st.auto = false;
          E.paintCats(); E.paintAmount();
        } }));
        return;
      }
      st.other = true; st.reserveId = null; st.categoryId = r; st.auto = false;
      paintReserves(E, host); E.paintAmount();
      return;
    }
    const rb = /** @type {HTMLElement|null} */ (t2.closest('[data-pickres]') ? null : t2.closest('[data-res]'));
    if (rb) {
      const x = all.find(y => y.reserve.id === rb.dataset.res);
      if (!x) return;
      buzz(6);
      if (st.reserveId === x.reserve.id) return none();
      if (!canUse(x)) { toast(`${x.reserve.name} se paie en une fois : il faut ${money(x.target, { cur: w.currency })} sur ${w.name}.`); return; }
      selectReserve(E, x.reserve.id);
      return;
    }
    if (!t2.closest('[data-pickres]')) return;
    buzz(6);
    const id = await chooseReserve(all, w.currency, st.reserveId); // même ordre : les utilisables d’abord
    if (id === undefined) return;
    // « Aucune » : plus de réserve
    if (id === null) return none();
    if (id) selectReserve(E, id);
  };
}

/**
 * Choisir une réserve utilisable : en une fois, le montant est ce qui est mis de côté (figé) ; en plusieurs fois, le
 * montant déjà tapé reste et le pavé se rallume. La catégorie est celle de la réserve.
 * @param {import('./state.js').Entry} E @param {string} id
 */
function selectReserve(E, id) {
  const { st } = E;
  const sel = usableReserves(E).find(x => x.reserve.id === id);
  if (!sel) return;
  st.reserveId = id;
  st.other = false;
  const amt = sel.reserve.mode === 'once' ? sel.target : st.amount;
  st.amount = amt; E.pad.set(amt);
  st.categoryId = sel.reserve.category && category(sel.reserve.category) && !category(sel.reserve.category).archived ? sel.reserve.category : null;
  E.paintCats(); E.paintAmount();
}
