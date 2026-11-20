// Règles de solde négatif et de devise, sur l'état projeté (fonctions pures).
// Le solde d'un portefeuille à une date = écritures payées jusqu'à ce jour ; un solde de départ compte à toutes les dates.
import { isWallet } from './projection.js';
import { settingsOf, draftOf } from './queries.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./queries.js').Draft} Draft */
/** @typedef {{ accountId: string, kind: 'now'|'already'|'past', avail: number, after: number, debit: boolean, date?: string }} BalanceProblem */

const END = '9999-12-31';
/** Date effective : un solde de départ est « avant tout ». @param {Draft} e */
const effDate = e => (e.kind === 'opening' ? '' : e.occurred_on);
/** Identifiants présents. @param {(string|undefined|null)[]} xs @returns {Set<string>} */
const idSet = xs => new Set(/** @type {string[]} */ (xs.filter(Boolean)));
/** @param {Draft} e @param {string} id */
const deltaOf = (e, id) => e.lines.reduce((s, l) => (l.account === id ? s + l.amount : s), 0);

/**
 * Le portefeuille refuse-t-il les soldes négatifs ? (réglage global, sauf exception du portefeuille)
 * @param {State} s
 * @param {string} walletId
 */
export function blocksNegative(s, walletId) {
  const a = s.accounts.get(walletId);
  return !!a && a.kind === 'wallet' && settingsOf(s).blockNegative && !a.allow_negative;
}

/**
 * Brouillons des écritures d'un statut, sauf certaines.
 * @param {State} s
 * @param {string} status
 * @param {Set<string>} except
 * @returns {Draft[]}
 */
function draftsWith(s, status, except) {
  const out = [];
  for (const e of s.entries.values()) if (e.status === status && !except.has(e.id)) out.push(draftOf(s, e));
  return out;
}

/**
 * Soldes de fin de journée aux dates données, pour des mouvements { d, v }.
 * @param {{ d: string, v: number }[]} moves
 * @param {string[]} dates triées
 * @returns {number[]}
 */
function balancesAt(moves, dates) {
  const ms = [...moves].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const out = [];
  let i = 0, b = 0;
  for (const d of dates) {
    while (i < ms.length && ms[i].d <= d) b += ms[i++].v;
    out.push(b);
  }
  return out;
}

/**
 * Remplacer l'écriture `oldD` par `newD` (l'un ou l'autre peut être null : ajout, annulation) rendrait-il un solde négatif ?
 * On compare les soldes de fin de journée avant / après, à chaque date à partir de l'écriture : on bloque seulement
 * si le solde devient négatif ET plus bas qu'avant (un portefeuille déjà négatif peut recevoir, pas envoyer).
 * @param {State} s
 * @param {Draft|null} oldD
 * @param {Draft|null} newD
 * @returns {BalanceProblem|null}
 */
export function checkChange(s, oldD, newD) {
  const pOld = oldD && oldD.status === 'posted' ? oldD : null;
  const pNew = newD && newD.status === 'posted' ? newD : null;
  if (!pOld && !pNew) return null;
  const start = [pOld, pNew].filter(Boolean).map(effDate).sort()[0];
  const base = draftsWith(s, 'posted', idSet([oldD?.id, newD?.id]));
  const ids = new Set([...(pOld?.lines || []), ...(pNew?.lines || [])].map(l => l.account).filter(id => isWallet(s, id)));
  for (const id of ids) {
    if (!blocksNegative(s, id)) continue;
    const baseMoves = base.map(e => ({ d: effDate(e), v: deltaOf(e, id) })).filter(m => m.v);
    const oldMoves = pOld ? [...baseMoves, { d: effDate(pOld), v: deltaOf(pOld, id) }] : baseMoves;
    const newMoves = pNew ? [...baseMoves, { d: effDate(pNew), v: deltaOf(pNew, id) }] : baseMoves;
    const dates = [...new Set([start, ...oldMoves.concat(newMoves).filter(m => m.d >= start).map(m => m.d), END])].sort();
    const bOld = balancesAt(oldMoves, dates), bNew = balancesAt(newMoves, dates), bBase = balancesAt(baseMoves, dates);
    const i = dates.findIndex((_, k) => bNew[k] < 0 && bNew[k] < bOld[k]);
    if (i < 0) continue;
    const last = dates.length - 1;
    const debit = !!pNew && deltaOf(pNew, id) < 0;
    if (bNew[last] < 0 && bNew[last] < bOld[last]) return { accountId: id, kind: bBase[last] < 0 ? 'already' : 'now', avail: bBase[last], after: bNew[last], debit };
    const date = dates[i] || dates.find(d => d) || END;
    return { accountId: id, kind: 'past', date, avail: bBase[i], after: bNew[i], debit };
  }
  return null;
}

/**
 * Une écriture prévue rendra-t-elle le solde négatif à sa date (en comptant les autres prévues d'ici là) ?
 * @param {State} s
 * @param {Draft|null} oldD
 * @param {Draft|null} newD
 * @returns {{ accountId: string, date: string, after: number }|null}
 */
export function plannedWarning(s, oldD, newD) {
  if (!newD || newD.status !== 'planned' || newD.kind === 'income') return null;
  const out = newD.lines.find(l => l.amount < 0 && isWallet(s, l.account));
  if (!out || !blocksNegative(s, out.account)) return null;
  const id = out.account;
  const except = idSet([oldD?.id]);
  const paid = draftsWith(s, 'posted', except);
  const planned = draftsWith(s, 'planned', except).filter(e => e.occurred_on <= newD.occurred_on);
  const after = [...paid, ...planned, newD].reduce((b, e) => b + deltaOf(e, id), 0);
  return after < 0 ? { accountId: id, date: newD.occurred_on, after } : null;
}
