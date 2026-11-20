// Grand livre en partie double : une écriture = des lignes dont la somme vaut zéro, par devise.
// Dépense : portefeuille −a, catégorie +a. Revenu : portefeuille +a, catégorie −a. Virement : source −a, destination +a.
// Solde de départ (opening) et correction (adjustment) : portefeuille ±a contre « Solde initial » (capitaux propres).

/** @typedef {{ account: string, amount: number, currency: string }} Line */
/** @typedef {{ id?: string, type: string, amount: number, accountId: string, toAccountId?: string|null, categoryId?: string|null, date: string, note?: string, planned?: boolean, reserve?: string|null }} Tx */

/** Compte de capitaux propres « Solde initial » d'une devise. @param {string} cur */
export const equityId = cur => `equity:${cur}`;
export const MOVE_KINDS = ['expense', 'income', 'transfer'];

/**
 * Lignes d'une opération (forme de l'interface).
 * @param {Tx} tx
 * @param {string} cur devise du portefeuille
 * @returns {Line[]}
 */
export function txLines(tx, cur) {
  const a = tx.amount;
  if (tx.type === 'expense') return [{ account: tx.accountId, amount: -a, currency: cur }, { account: String(tx.categoryId), amount: a, currency: cur }];
  if (tx.type === 'income') return [{ account: tx.accountId, amount: a, currency: cur }, { account: String(tx.categoryId), amount: -a, currency: cur }];
  if (tx.type === 'transfer') return [{ account: tx.accountId, amount: -a, currency: cur }, { account: String(tx.toAccountId), amount: a, currency: cur }];
  throw new Error('Type d’opération inconnu : ' + tx.type);
}

/**
 * Lignes d'un solde de départ ou d'une correction.
 * @param {string} walletId
 * @param {number} delta
 * @param {string} cur
 * @returns {Line[]}
 */
export const balanceLines = (walletId, delta, cur) => [{ account: walletId, amount: delta, currency: cur }, { account: equityId(cur), amount: -delta, currency: cur }];

/**
 * Somme nulle par devise ? Renvoie la première devise déséquilibrée, ou null.
 * @param {Line[]} lines
 * @returns {string|null}
 */
export function unbalanced(lines) {
  /** @type {Map<string, number>} */
  const sums = new Map();
  for (const l of lines) sums.set(l.currency, (sums.get(l.currency) || 0) + l.amount);
  for (const [cur, s] of sums) if (s !== 0) return cur;
  return null;
}

/**
 * Variation de chaque portefeuille dans des lignes.
 * @param {Line[]} lines
 * @param {(id: string) => boolean} isWallet
 * @returns {Map<string, number>}
 */
export function walletDeltas(lines, isWallet) {
  const m = new Map();
  for (const l of lines) if (isWallet(l.account)) m.set(l.account, (m.get(l.account) || 0) + l.amount);
  return m;
}

/**
 * Forme « interface » d'une écriture d'après ses lignes, ou null pour un solde de départ / une correction.
 * @param {string} kind
 * @param {Line[]} lines
 * @param {(id: string) => boolean} isWallet
 */
export function linesToMove(kind, lines, isWallet) {
  if (!MOVE_KINDS.includes(kind) || lines.length !== 2) return null;
  const [x, y] = lines;
  if (kind === 'transfer') {
    const from = x.amount < 0 ? x : y, to = x.amount < 0 ? y : x;
    return { type: kind, amount: to.amount, accountId: from.account, toAccountId: to.account, currency: x.currency };
  }
  const w = isWallet(x.account) ? x : y, c = w === x ? y : x;
  return { type: kind, amount: Math.abs(w.amount), accountId: w.account, categoryId: c.account, currency: w.currency };
}
