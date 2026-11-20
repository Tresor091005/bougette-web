// À revoir (D21, 2026-11-20, avec l'utilisateur) : ce que la synchro a mis de côté (un changement fait sur ce téléphone qui
// ne s'appliquait plus après ceux d'un autre appareil), dit en clair : ce que c'était, pourquoi ça n'est pas passé, et pour
// une opération, de quoi la refaire. Partie pure (l'état de l'app et l'événement) ; la liste vit dans src/core/review.js.
import { linesToMove } from '../domain/ledger.js';

/** @typedef {{ id: string, type: string, payload: string, at: string, reason: string, savedAt: string }} ReviewItem */
/** @typedef {import('../domain/projection.js').State} State */

const KIND = { expense: 'Dépense', income: 'Entrée', transfer: 'Virement' };
const MONTHS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
/** @param {string} iso */
const day = iso => { const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number); return y ? `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}` : ''; };

/**
 * @param {ReviewItem} item
 * @param {State} s l'état de l'app maintenant
 * @param {(minor: number, cur: string) => string} money
 * @returns {{ title: string, sub: string, why: string, redo: { type: string, amount: number, accountId: string|null, toAccountId: string|null, categoryId: string|null, note: string, date: string }|null }}
 */
export function describeReview(item, s, money) {
  /** @type {any} */
  let p = {};
  try { p = JSON.parse(item.payload); } catch (e) { /* illisible */ }
  /** @type {Map<string, any>} */
  const accounts = /** @type {any} */ (s).accounts || new Map();
  const acc = (/** @type {string} */ id) => accounts.get(id) || null;
  const nameOf = (/** @type {string} */ id) => acc(id)?.name || 'un portefeuille disparu';
  const gone = (/** @type {string} */ id) => !acc(id) || !!acc(id).deleted_at;
  const goneWhy = (/** @type {string[]} */ ids) => {
    const g = ids.filter(Boolean).find(gone);
    return g ? `« ${acc(g)?.name || 'Ce portefeuille'} » a été supprimé sur un autre appareil.` : 'Un autre appareil avait déjà changé la même chose.';
  };

  if (item.type === 'entry.recorded' && KIND[/** @type {keyof typeof KIND} */ (p.kind)]) {
    const mv = linesToMove(p.kind, p.lines || [], id => (acc(id)?.kind ?? 'wallet') === 'wallet');
    if (mv) {
      const wallet = mv.accountId, other = mv.type === 'transfer' ? mv.toAccountId : mv.categoryId;
      const title = `${KIND[/** @type {keyof typeof KIND} */ (mv.type)]} ${money(mv.amount, mv.currency)}${p.note ? ` · ${p.note}` : ''}`;
      const where = mv.type === 'transfer' ? `${nameOf(wallet)} → ${nameOf(/** @type {string} */ (other))}` : `${nameOf(wallet)} · ${acc(/** @type {string} */ (other))?.name || 'catégorie disparue'}`;
      return {
        title, sub: `${where} · ${day(p.occurred_on)}`, why: goneWhy([wallet, /** @type {string} */ (other)]),
        redo: { type: mv.type, amount: mv.amount, accountId: gone(wallet) ? null : wallet, toAccountId: mv.type === 'transfer' && !gone(/** @type {string} */ (other)) ? /** @type {string} */ (other) : null, categoryId: mv.type !== 'transfer' && !gone(/** @type {string} */ (other)) ? /** @type {string} */ (other) : null, note: p.note || '', date: String(p.occurred_on || '').slice(0, 10) },
      };
    }
  }
  const what = {
    'entry.amended': 'Une opération modifiée', 'entry.voided': 'Une opération supprimée', 'entry.restored': 'Une opération rétablie',
    'wallet.created': 'Un portefeuille créé', 'wallet.updated': 'Un portefeuille modifié', 'wallet.deleted': 'Un portefeuille supprimé',
    'wallet.archived': 'Un portefeuille archivé', 'category.created': 'Une catégorie créée', 'category.updated': 'Une catégorie modifiée',
    'category.deleted': 'Une catégorie supprimée', 'budget.created': 'Un budget créé', 'budget.updated': 'Un budget modifié',
    'reserve.created': 'Une réserve créée', 'reserve.updated': 'Une réserve modifiée', 'reserve.used': 'Une réserve utilisée',
    'schedule.created': 'Une échéance créée', 'schedule.updated': 'Une échéance modifiée', 'settings.changed': 'Un réglage changé',
  }[item.type] || 'Un changement';
  const name = typeof p.name === 'string' ? ` · ${p.name}` : typeof p.note === 'string' && p.note ? ` · ${p.note}` : '';
  const ids = [p.id, p.wallet, p.account_id, p.category, p.entry].filter(x => typeof x === 'string');
  const why = item.type.startsWith('wallet.') || item.type.startsWith('category.') || item.type.startsWith('entry.')
    ? (ids.some(id => !accounts.has(id) && !(/** @type {any} */ (s).entries?.has?.(id))) ? 'Il a été supprimé sur un autre appareil.' : 'Un autre appareil avait déjà changé la même chose.')
    : 'Un autre appareil avait déjà changé la même chose.';
  return { title: what + name, sub: `Fait ici ${day(item.at)}`, why, redo: null };
}
