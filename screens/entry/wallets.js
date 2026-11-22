// Le portefeuille en haut de la saisie, comme un destinataire ; pour un virement, les deux portefeuilles et la flèche.
import { account, balances } from '../../core/store.js';
import { buzz, $ } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { esc, money } from '../../core/format.js';
import { pickAccount, accountPill } from '../pickers.js';
import { cur } from './state.js';

/** @typedef {import('./state.js').Entry} Entry */

/** @param {Entry} E */
export function paintFrom(E) {
  const { st, el } = E;
  const a = account(st.accountId);
  const bal = balances();
  // virement (2026-11-10) : logo et nom seulement — ni « De / À » (la flèche et l'ordre disent le sens, le lecteur
  // d'écran les lit), ni chevron (toute la pastille se touche) : le nom a presque deux fois plus de place
  const one = (acc, lbl, attr) => lbl
    ? `<button type="button" class="e-wallet tw" ${attr} aria-label="${lbl} : ${acc ? esc(acc.name) : 'à choisir'}">${acc ? accountPill(acc, 'sm') : `<span class="pill acc sm">${icon('wallet')}</span>`}<b>${esc(acc?.name || 'Choisir')}</b></button>`
    : `<button type="button" class="e-wallet" ${attr}>${acc ? accountPill(acc, 'sm') : `<span class="pill acc sm">${icon('wallet')}</span>`}
      <b>${esc(acc?.name || 'Choisir')}</b>${acc ? `<span class="bal${(bal[acc.id] || 0) < 0 ? ' loss' : ''}">${money(bal[acc.id] || 0, { cur: acc.currency })}</span>` : ''}${icon('caret-down')}</button>`;
  $('[data-from]', el).innerHTML = st.type === 'transfer'
    ? `${one(a, 'De', 'data-acc')}<button type="button" class="e-arrow" data-swap aria-label="Inverser De et À"${st.toAccountId ? '' : ' disabled'}>${icon('arrows-left-right')}</button>${one(account(st.toAccountId), 'À', 'data-to')}`
    : one(a, '', 'data-acc');
  $('[data-acc]', el).onclick = () => chooseFrom(E);
  const to = $('[data-to]', el);
  if (to) to.onclick = () => chooseTo(E);
  // la flèche inverse De et À (comme une traduction) ; la saisie se recalcule (solde, réserves, Dépense permise)
  const swap = $('[data-swap]', el);
  if (swap) swap.onclick = () => {
    if (!st.toAccountId) return;
    [st.accountId, st.toAccountId] = [st.toAccountId, st.accountId];
    st.reserveId = null;
    buzz(8);
    E.refresh();
  };
}

/** @param {Entry} E */
async function chooseFrom(E) {
  const { st, due } = E;
  // une échéance se paie depuis n'importe quel portefeuille de sa devise (D18, revu le 2026-11-12)
  // une dépense d'échéance qu'aucune réserve ne paie : pas d'épargne qui refuse les dépenses (2026-11-13)
  const id = await pickAccount({ current: st.accountId, currency: E.planned ? E.planned.currency : null, title: st.type === 'transfer' ? 'Depuis' : 'Portefeuille', spending: E.held && st.type === 'expense' && !st.reserveId });
  if (!id) return;
  st.accountId = id;
  // revenu sur le portefeuille de la réserve qui paie l'échéance : elle repaie
  st.reserveId = due && due.reserve && id === due.wallet ? due.reserve : null;
  st.other = false;
  const to = account(st.toAccountId);
  if (st.toAccountId === id || (to && to.currency !== account(id).currency)) st.toAccountId = null;
  E.refresh();
}

/** Le portefeuille d'arrivée d'un virement ; dit s'il y en a un. @param {Entry} E */
export async function chooseTo(E) {
  const { st } = E;
  const id = await pickAccount({ current: st.toAccountId, exclude: st.accountId, currency: cur(E), title: 'Vers' });
  if (id) { st.toAccountId = id; paintFrom(E); E.paintAmount(); }
  return !!st.toAccountId;
}
