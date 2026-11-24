// Règles de la saisie (D4, D9, D17, D18) : ce que la feuille de saisie contrôle et dit, sur des données simples. Rien du
// DOM ni du magasin : l'écran passe ce qu'il faut (portefeuilles, réserve, soldes). Les textes sont ceux affichés.
import { MAX_AMOUNT, dividesByZero } from './money.js';
import { money, esc, shortDate } from './format.js';

/** @typedef {{ type: string, amount: number, accountId: string|null, toAccountId?: string|null, categoryId?: string|null, date?: string, planned?: boolean, note?: string, id?: string }} EntryDraft */
/** @typedef {{ name: string, currency: string, archived?: boolean }} WalletLike */
/**
 * Premier problème de la saisie. block : le bouton s'éteint ; short : solde insuffisant (montant en rouge) ; label : ce
 * que dit le bouton à la place du verbe ; link et fix : le lien qui règle le problème (« plan » : marquer « Prévu »,
 * « check » : vérifier le solde de walletId).
 * @typedef {{ block: boolean, text: string, short?: boolean, label?: string, link?: string, fix?: 'plan'|'check', walletId?: string }} EntryProblem
 */

const m = (/** @type {number} */ v, /** @type {string|undefined} */ cur) => money(v, { cur });

/**
 * Effet d'une opération (payée) sur le solde d'un portefeuille.
 * @param {EntryDraft|null|undefined} t @param {string} accId
 */
export function effect(t, accId) {
  if (!t || t.planned || !t.amount) return 0;
  if (t.type === 'transfer') return (t.accountId === accId ? -t.amount : 0) + (t.toAccountId === accId ? t.amount : 0);
  if (t.accountId !== accId) return 0;
  return t.type === 'income' ? t.amount : -t.amount;
}

/**
 * Solde d'un portefeuille après l'opération, en remplaçant sa version enregistrée (before) si on la modifie.
 * @param {number} balance @param {EntryDraft|null} before @param {EntryDraft} draft @param {string} accId
 */
export const balanceAfter = (balance, before, draft, accId) => balance - effect(before, accId) + effect(draft, accId);

/**
 * L'opération telle qu'elle serait enregistrée : un virement a un portefeuille d'arrivée, le reste une catégorie.
 * @param {{ type: string, amount: number, accountId: string|null, toAccountId: string|null, categoryId: string|null, date: string, planned: boolean }} st
 * @returns {EntryDraft}
 */
export const entryDraft = st => ({
  type: st.type, amount: st.amount, accountId: st.accountId, date: st.date, planned: st.planned,
  ...(st.type === 'transfer' ? { toAccountId: st.toAccountId } : { categoryId: st.categoryId }),
});

/**
 * Ce qu'on dit d'un solde qui deviendrait négatif (vérification de checkChange), pour le portefeuille en cause.
 * @param {import('./rules.js').BalanceProblem} chk @param {WalletLike|null|undefined} wallet
 * @param {{ deleting?: boolean }} [o] deleting : l'opération est annulée
 * @returns {{ text: string, sub: string }}
 */
export function balanceMessage(chk, wallet, { deleting = false } = {}) {
  const name = esc(wallet?.name || '?');
  const mm = (/** @type {number} */ v) => m(v, wallet?.currency);
  // rentrée réduite, déplacée ou supprimée : on dit simplement où tomberait le solde
  if (!chk.debit) {
    const when = chk.kind === 'past' ? ` le ${shortDate(/** @type {string} */ (chk.date))}` : '';
    return { text: `${name} passerait à ${mm(chk.after)}${when}.`, sub: 'Le solde ne peut pas passer sous zéro.' };
  }
  if (chk.kind === 'already') return { text: `${name} est déjà à ${mm(chk.avail)}.`, sub: 'Note d’abord l’argent qui y est entré.' };
  if (chk.kind === 'now') return { text: chk.avail > 0 ? `Il ne reste que ${mm(chk.avail)} dans ${name}.` : `Il n’y a plus rien dans ${name}.`, sub: deleting ? 'Le solde ne peut pas passer sous zéro.' : '' };
  return {
    text: `Le ${shortDate(/** @type {string} */ (chk.date))}, ${name} passerait à ${mm(chk.after)}.`,
    sub: `Il ne restait que ${mm(chk.avail)} ce jour-là.`,
  };
}

/**
 * Premier problème de la saisie, dans l'ordre où on le dit : calcul absurde (division par zéro, résultat négatif, montant
 * hors limite), portefeuille à choisir, réserve dépassée, virement (même portefeuille, deux devises), date à venir, solde
 * insuffisant, puis l'avertissement d'une opération prévue (qui n'éteint pas le bouton). Les contrôles de solde ne
 * se calculent qu'une fois les autres passés.
 * @param {{
 *   expr?: string, amount: number, type: string, accountId: string|null, toAccountId?: string|null,
 *   wallet: WalletLike|null|undefined, toWallet?: WalletLike|null, reserve?: { name: string, target: number }|null,
 *   planned: boolean, date: string, today: string, canPlan?: boolean, cur?: string,
 *   balance?: () => { chk: import('./rules.js').BalanceProblem, wallet: WalletLike|null|undefined }|null,
 *   warning?: () => { wallet: WalletLike|null|undefined, after: number, date: string }|null,
 * }} o
 *   expr : le calcul tapé ; reserve : la réserve utilisée (ce qu'elle vise encore) ; canPlan : « Prévu » est proposé ;
 *   balance : le solde qui deviendrait négatif ; warning : le solde négatif à la date d'une opération prévue ; cur : la
 *   devise de la saisie
 * @returns {EntryProblem|null}
 */
export function entryProblem(o) {
  const { amount, wallet: a } = o;
  if (dividesByZero(o.expr || '')) return { block: true, text: 'Division par zéro.' };
  if (!amount) return null;
  if (amount < 0) return { block: true, text: 'Le résultat est négatif.' };
  if (amount > MAX_AMOUNT) return { block: true, text: 'Ce montant est trop grand.' };
  if (!a) return { block: true, text: 'Choisis un portefeuille.' };
  // une réserve paie ce qu'on veut (revu le 2026-11-19), mais pas plus que ce qu'elle vise encore : au-delà, ce n'est
  // plus elle (une autre dépense) ; sinon seul le solde de l'épargne limite, comme toute dépense
  if (o.reserve && amount > o.reserve.target) return { block: true, label: `Au plus ${m(o.reserve.target, a.currency)} pour ${esc(o.reserve.name)}`, text: '' };
  if (o.type === 'transfer' && o.toAccountId) {
    if (o.toAccountId === o.accountId) return { block: true, text: 'Choisis deux portefeuilles différents.' };
    if (o.toWallet && o.toWallet.currency !== a.currency) return { block: true, text: 'Pas de virement entre deux devises.' };
  }
  if (!o.planned && o.date > o.today) {
    return o.canPlan
      ? { block: true, text: 'Cette date est dans le futur.', link: 'Marquer « Prévu »', fix: 'plan' }
      : { block: true, text: 'Cette date est dans le futur.' };
  }
  const bad = o.balance?.();
  if (bad) {
    const { chk, wallet: acc } = bad;
    // si l'app se trompe de solde, on le vérifie sans quitter la saisie (D9) ; le négatif reste refusé. Pas de lien
    // quand vérifier n'y peut rien : solde passé (opération antidatée) ou portefeuille archivé
    const can = chk.kind !== 'past' && acc && !acc.archived;
    return {
      block: true, short: true, text: balanceMessage(chk, acc).text,
      ...(can ? { link: `Vérifier le solde de ${esc(acc.name)}`, fix: 'check', walletId: chk.accountId } : {}),
    };
  }
  const w = o.warning?.();
  if (w) return { block: false, text: `${esc(w.wallet?.name)} passera à ${m(w.after, o.cur)} le ${shortDate(w.date)}.` };
  return null;
}

/**
 * Conséquence (D4) : « Il restera 22 900 F dans Espèces », « Espèces passera à … », ou ce que fait une opération prévue.
 * @param {{ amount: number, wallet: WalletLike|null|undefined, type: string, planned: boolean, date: string, today: string, after: number }} o
 *   after : le solde du portefeuille après l'opération
 */
export function consequence({ amount, wallet: a, type, planned, date, today, after }) {
  if (!amount || !a) return '';
  if (planned) return `Prévu ${date === today ? 'aujourd’hui' : `le ${shortDate(date)}`} : ne touche pas encore ${esc(a.name)}`;
  if (type === 'income') return `${esc(a.name)} passera à <b>${m(after, a.currency)}</b>`;
  return `Il restera <b>${m(after, a.currency)}</b> dans ${esc(a.name)}`;
}

/**
 * Un dépassement de budget (ou « Plus que d'habitude ») : la seule phrase en plus, et seulement alors ; '' sinon.
 * @param {{ over: boolean, kind: string, name: string, by: number }|null|undefined} x l'effet sur la catégorie (spendImpact)
 * @param {string} cur
 */
export const overText = (x, cur) => (x && x.over ? (x.kind === 'budget' ? `${esc(x.name)} : ${m(x.by, cur)} de trop` : `${esc(x.name)} : plus que d’habitude`) : '');

/**
 * Le verbe du bouton : ce qui sera fait.
 * @param {{ editing: boolean, due: boolean, planned: boolean, type: string, reserve: boolean }} o reserve : une réserve est utilisée
 */
export const goVerb = ({ editing, due, planned, type, reserve }) => (editing ? 'Enregistrer' : due ? 'Confirmer' : planned ? 'Prévoir' : type === 'transfer' ? 'Virer' : reserve ? 'Utiliser' : 'Ajouter');

/**
 * Ce qui se compare pour savoir si une saisie a changé (une copie arrive remplie : seul un changement compte).
 * @param {{ type: string, amount: number, accountId: string|null, toAccountId: string|null, categoryId: string|null, note: string, date: string }} st
 * @param {string} opType le type d'opération (en vérification, celui où l'on revient)
 */
export const entrySig = (st, opType) => JSON.stringify([st.type === 'check' ? opType : st.type, st.amount, st.accountId, st.toAccountId, st.categoryId, st.note, st.date]);

/**
 * Une opération qu'on modifie a-t-elle changé ?
 * @param {EntryDraft} tx l'opération enregistrée @param {EntryDraft} draft telle qu'elle serait enregistrée (entryDraft)
 * @param {string} note la note tapée
 */
export const edited = (tx, draft, note) => draft.amount !== tx.amount || draft.type !== tx.type || draft.accountId !== tx.accountId || draft.date !== tx.date || note !== (tx.note || '')
  || (draft.type === 'transfer' ? draft.toAccountId !== (tx.toAccountId || null) : draft.categoryId !== (tx.categoryId || null)) || !!draft.planned !== !!tx.planned;

/**
 * Une échéance confirmée avec un montant loin du prévu (plus de moitié d'écart) : peut-être une faute de frappe, à faire
 * confirmer. Une opération déjà notée : seulement si on change son montant (before).
 * @param {number} amount @param {string} cur @param {{ amount: number, currency: string }|null} planned
 * @param {number|null} [before] le montant enregistré, si on modifie
 */
export const farFromPlanned = (amount, cur, planned, before = null) => !!planned && planned.amount > 0 && cur === planned.currency
  && (before == null || amount !== before) && Math.abs(amount - planned.amount) > planned.amount / 2;

/**
 * Une réserve utilisable (revu le 2026-11-19) : en plusieurs fois, toujours ; en une fois, si l'épargne peut la payer
 * entièrement.
 * @param {{ reserve: { mode: string }, target: number }} v @param {number} balance le solde de l'épargne
 */
export const reserveUsable = (v, balance) => v.reserve.mode !== 'once' || balance >= v.target;

/**
 * Les réserves dans l'ordre de la saisie : la choisie en tête (comme la catégorie choisie), puis celles qu'on peut
 * utiliser (par échéance), les grisées à la fin (2026-11-19 : une grisée en tête, c'était le premier toucher qui ne
 * marchait pas).
 * @template {{ reserve: { id: string, due: string|null } }} V
 * @param {V[]} list @param {string|null} chosen @param {(v: V) => boolean} usable
 * @returns {V[]}
 */
export const reserveOrder = (list, chosen, usable) => [...list].sort((x, y) => Number(y.reserve.id === chosen) - Number(x.reserve.id === chosen)
  || Number(!usable(x)) - Number(!usable(y)) || ((x.reserve.due || '9999-12-31') < (y.reserve.due || '9999-12-31') ? -1 : (x.reserve.due || '9999-12-31') > (y.reserve.due || '9999-12-31') ? 1 : 0));

/**
 * Une date ramenée dans ce qui est permis pour une échéance (de la fois d'avant à aujourd'hui).
 * @param {string} date @param {{ min: string|null, max: string }} bounds
 */
export const clampDate = (date, bounds) => (bounds.min && date < bounds.min ? bounds.min : date > bounds.max ? bounds.max : date);
