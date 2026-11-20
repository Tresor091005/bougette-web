// À revoir (D21) : la liste des changements que la synchro a mis de côté, gardée sur ce téléphone pour l'espace ouvert,
// jusqu'à ce que la personne les refasse ou les laisse tomber. Elle se voit en rouge en haut de Moi et dans la cloche.
import { pref } from './store.js';

/** @typedef {import('../data/review.js').ReviewItem} ReviewItem */
const MAX = 100;
/** @type {Set<() => void>} */
const listeners = new Set();
const changed = () => [...listeners].forEach(f => { try { f(); } catch (e) { console.error(e); } });

/** @returns {ReviewItem[]} les plus récents d'abord */
export const reviewItems = () => /** @type {ReviewItem[]} */ (pref('review') || []);
/** @param {() => void} fn */
export function onReview(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Garde les événements mis de côté (un même événement une seule fois). @param {{ event: import('../domain/events.js').StoredEvent, reason: string }[]} skipped */
export function keepSkipped(skipped) {
  if (!skipped.length) return;
  const list = reviewItems();
  const now = new Date().toISOString();
  const fresh = skipped.filter(x => !list.some(i => i.id === x.event.id)).map(x => ({ id: x.event.id, type: x.event.type, payload: x.event.payload, at: x.event.at, reason: x.reason, savedAt: now }));
  if (!fresh.length) return;
  pref('review', [...fresh, ...list].slice(0, MAX));
  changed();
}
/** Retire un élément (refait, ou laissé tombé). @param {string} id */
export function dropReview(id) {
  pref('review', reviewItems().filter(i => i.id !== id));
  changed();
}
