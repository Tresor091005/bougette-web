// Programmer, depuis la saisie (2026-11-26, avec l'utilisateur : une seule feuille pour noter et programmer) : la fin
// d'une règle qui se répète (« Sans fin », « Jusqu’au 30 juin », « 12 fois »), le texte sous le montant, et l'enregistrement
// — ce que créait la feuille d'une nouvelle opération programmée (plan-create.js : la question « La préparer ? », la
// jumelle, la création).
import { pref, account } from '../../core/store.js';
import { buzz, shake, reducedMotion, afterSheets } from '../../core/ui.js';
import { RES } from '../../domain/words.js';
import { createPlanned } from '../plan-create.js';
import { dayShort } from '../due-page.js';
import { cur, ruleOf, planCat, planning } from './state.js';
import { chooseTo } from './wallets.js';

/** @typedef {import('./state.js').Entry} Entry */

/** La fin d'une règle qui se répète, en quelques mots. @param {Entry} E */
export const endLabel = E => (E.st.endMode === 'times' ? `${E.st.times} fois` : E.st.endMode === 'date' ? (E.st.end ? `Jusqu’au ${dayShort(E.st.end)}` : 'Jusqu’au …') : 'Sans fin');

/** Sous le montant, à la place de la conséquence sur le solde : rien n'est noté maintenant. @param {Entry} E */
export function planSay(E) {
  const { st } = E;
  return st.type === 'transfer' && account(st.toAccountId)?.savings
    ? `Il remplit ${RES.yourMany}, ${RES.adj('le plus proche', 'la plus proche')} d’abord. Le jour venu, tu confirmes.`
    : 'Rien n’est noté maintenant : le jour venu, tu confirmes.';
}

/**
 * Ce qui manque pour programmer, dans l'ordre de l'écran : 'cat', 'name', 'days' ; '' si rien. Le nom est obligatoire
 * (2026-11-26, avec l'utilisateur) : la note d'une opération est facultative, mais le nom d'une opération programmée la
 * désigne partout (listes, rappels, questions).
 * @param {Entry} E @returns {'cat'|'name'|'days'|''}
 */
export const planMissing = E => (E.st.type !== 'transfer' && !planCat(E) ? 'cat' : !E.st.note.trim() ? 'name' : E.planAsked ? 'days' : '');

/**
 * Entoure la pastille que le bouton réclame (montant tapé, mode programmer) : catégorie, nom ou jours ; sinon aucune.
 * Posé directement sur les éléments : la rangée n'est pas repeinte à chaque chiffre.
 * @param {Entry} E
 */
export function paintAsk(E) {
  const want = E.st.amount && planning(E) ? planMissing(E) : '';
  for (const [k, sel] of /** @type {const} */ ([['cat', '[data-catp]'], ['name', '[data-namep]'], ['days', '[data-datep]']])) {
    const b = E.el.querySelector(sel);
    if (b) b.classList.toggle('ask', want === k);
  }
}

/** Ce qui manque pour programmer, en mots (le bouton l'écrit, éteint), une fois le montant tapé ; '' sinon. @param {Entry} E */
export const planLack = E => ({ cat: 'Choisis une catégorie', name: 'Donne un nom', days: 'Choisis les jours', '': '' })[planMissing(E)];

/**
 * Enregistrer en mode « programmer » : les mêmes données que la feuille d'une opération programmée, puis createPlanned.
 * La feuille descend comme pour une opération ; la nouvelle s'ouvre ensuite (onCreated) une fois les feuilles fermées.
 * @param {Entry} E
 */
export async function savePlan(E) {
  const { st, goBtn, exprEl, sayEl, s } = E;
  if (!st.amount || (E.problem && E.problem.block)) { shake(exprEl); return; }
  // la catégorie, le nom ou les jours manquent : le bouton est éteint et le dit ; par une autre porte (Entrée), il tremble
  if (planMissing(E)) { shake(goBtn); buzz([10, 40, 10]); return; }
  // portefeuille d'arrivée manquant : il se choisit au passage, puis on enregistre aussitôt
  if (st.type === 'transfer' && !st.toAccountId) {
    if (!(await chooseTo(E)) || (E.problem && E.problem.block)) return;
  }
  const categoryId = planCat(E);
  if (st.type !== 'transfer' && !categoryId) return; // déjà refusé plus haut (planMissing)
  const rule = ruleOf(E);
  const every = rule.every || null;
  const times = every && st.endMode === 'times' ? st.times : null;
  if (every && st.endMode === 'times' && !(Number.isInteger(times) && /** @type {number} */ (times) >= 1)) return fail('Indique un nombre de fois.');
  if (every && st.endMode === 'date' && !st.end) return fail('Choisis la dernière date.');
  /** @type {Record<string, any>} */
  const data = {
    kind: st.type, amount: st.amount, accountId: st.accountId, toAccountId: st.type === 'transfer' ? st.toAccountId : null, categoryId,
    note: st.note.trim().slice(0, 40), start: rule.start, every, interval: every ? rule.interval || 1 : 1, days: rule.days || [],
    by: every === 'month' ? rule.by || null : null,
    end: every && st.endMode === 'date' ? st.end : null, times,
  };
  E.saving = true;
  /** @type {Awaited<ReturnType<typeof createPlanned>>|null} */
  let got = null;
  try { got = await createPlanned(data, { cur: cur(E), onError: msg => fail(msg) }); } finally { if (!got?.what) E.saving = false; }
  if (!got?.what) return;
  const { made, later } = got;
  pref('lastAccount', st.accountId);
  // comme une opération : coche dessinée, puis la feuille descend ; ensuite seulement la suite (la nouvelle, une fiche d'épargne)
  goBtn.classList.add('done');
  await new Promise(done => setTimeout(done, reducedMotion() ? 0 : 320));
  s.close();
  afterSheets(() => {
    if (later) later();
    if (made && E.onCreated) { try { E.onCreated(made); } catch (e) { console.error(e); } }
  });

  /** Une erreur d'écriture ou de valeur : dite sous le montant, le bouton tremble. @param {string} msg */
  function fail(msg) {
    sayEl.className = 'e-say err';
    sayEl.textContent = msg;
    shake(goBtn);
    buzz([10, 40, 10]);
  }
}

