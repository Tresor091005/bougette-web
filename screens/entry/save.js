// Enregistrer (le bouton du bas) : la vérification d'un solde, ou l'opération (ajoutée, modifiée, échéance confirmée, ou
// programmée : plan.js),
// puis ce qui suit (répartir une rentrée, donner une destination à l'argent mis de côté).
import { addTx, updateTx, confirmDue, account, pref, checkWallet, available, settings } from '../../core/store.js';
import { buzz, shake, reducedMotion, afterSheets, confirmSheet } from '../../core/ui.js';
import { money } from '../../core/format.js';
import { farFromPlanned, entryDraft } from '../../domain/entry-rules.js';
import { openAccountSheet } from '../accounts.js';
import { openIncomeSheet } from '../budget-sheet.js';
import { assigned } from '../../core/assign.js';
import { checking, cur, savingsSpend, usableReserves, planning } from './state.js';
import { savePlan } from './plan.js';
import { chooseTo } from './wallets.js';

/** @param {import('./state.js').Entry} E @param {(o: any) => any} openEntry pour la feuille d'une rentrée (« Mettre de côté ») */
export async function save(E, openEntry) {
  const { st, pad, goBtn, exprEl, s, tx, due, editing, planned } = E;
  if (E.saving) return;
  if (pad.hasOp()) pad.resolve();
  // vérification (rond balance) : elle est notée (avec ou sans écart), puis la feuille descend
  if (checking(E)) {
    const a = account(st.accountId);
    if (!a) return;
    E.saving = true;
    if (!(await checkWallet(a.id, st.actual))) { E.saving = false; return; }
    buzz(12);
    goBtn.classList.add('done');
    setTimeout(() => s.close(), reducedMotion() ? 0 : 320);
    return;
  }
  // une opération à venir ou qui se répète : on la programme (plan.js)
  if (planning(E)) return savePlan(E);
  if (!st.amount || (E.problem && E.problem.block)) { shake(exprEl); return; }
  // portefeuille d'arrivée manquant : il se choisit au passage, puis on enregistre aussitôt
  if (st.type === 'transfer' && !st.toAccountId) {
    if (!(await chooseTo(E)) || (E.problem && E.problem.block)) return;
  }
  if (st.type !== 'transfer' && !st.categoryId) return; // le bouton est éteint tant qu'il manque la catégorie
  if (farFromPlanned(st.amount, cur(E), planned, editing ? tx.amount : null)) {
    const said = money(st.amount, { cur: cur(E) });
    const yes = await confirmSheet({ title: `${said} au lieu de ${money(planned.amount, { cur: planned.currency })} ?`, text: 'Loin du montant prévu : faute de frappe ?', yes: `Oui, ${said}`, cancel: 'Corriger' });
    if (!yes) return;
    await new Promise(done => afterSheets(done));
  }
  E.saving = true;
  /** @type {any} */
  const data = { ...entryDraft(st), note: st.note.trim() };
  pref('lastAccount', st.accountId);
  // D5 : bouton tassé, coche dessinée (260 ms), vibration 12 ms, puis la feuille descend (460 ms)
  buzz(12);
  goBtn.classList.add('done');
  // la confirmation, c'est ce mouvement (pas de bandeau) ; un refus d'écriture s'affiche par le message d'erreur du magasin
  if (savingsSpend(E) && st.reserveId && usableReserves(E).some(v => v.reserve.id === st.reserveId)) data.reserve = st.reserveId;
  const write = editing ? updateTx(tx.id, data) : due ? confirmDue(due, data) : addTx(data);
  const closeIn = reducedMotion() ? 0 : 320;
  setTimeout(() => s.close(), closeIn);
  const done = await write;
  if (done && E.onSaved) { try { E.onSaved(); } catch (e) { console.error(e); } }
  // de l'argent mis de côté (virement vers un portefeuille d'épargne, D17) donne une destination à l'argent arrivé
  if (done && data.type === 'transfer' && account(data.toAccountId)?.savings) {
    assigned();
  }
  // une rentrée notée (pas une modification) propose de la répartir (D11) ; seulement si elle change Disponible
  // (portefeuille compté dans le total, monnaie principale), une fois la saisie redescendue
  const w = account(data.accountId);
  if (done && !editing && data.type === 'income' && w && !w.excluded && !w.savings && w.currency === settings().currency) {
    setTimeout(() => afterSheets(() => openIncomeSheet({
      amount: data.amount, cur: w.currency, available: available(), walletId: w.id, openEntry, openAccountSheet,
    })), closeIn + (reducedMotion() ? 0 : 520));
  }
}
