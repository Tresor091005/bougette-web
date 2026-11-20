// Messages de l'app (cloche de l'accueil, ROADMAP 1b, 2026-11-09) : ce que Bougette a besoin de te dire — un problème
// d'intégrité, une sauvegarde hors du téléphone qui date. Notifications DANS l'app seulement (pas de notification
// Android, étape 5). Un message a une clé : un nouveau message de même clé remplace l'ancien ; « résoudre » une clé le
// retire (le problème a disparu). Rangés dans les préférences d'interface du téléphone, pas dans le journal.
import { pref } from './store.js';

/** @typedef {{ key: string, kind: 'error'|'warn'|'info', title: string, body: string, action?: { label: string, id: string }, at: string, read: boolean }} Message */

const MAX = 20;
/** @type {Set<() => void>} */
const listeners = new Set();
const changed = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

/** @returns {Message[]} les plus récents d'abord */
export const messages = () => /** @type {Message[]} */ (pref('inbox') || []);
export const unread = () => messages().filter(m => !m.read).length;
/** @param {() => void} fn */
export function onInbox(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * Ajoute (ou remplace) un message. every : délai minimal (ms) avant de répéter un message de même clé déjà là.
 * @param {Omit<Message, 'at'|'read'>} m @param {{ every?: number, now?: Date }} [o]
 */
export function notify(m, { every = 0, now = new Date() } = {}) {
  const list = messages();
  const old = list.find(x => x.key === m.key);
  if (old && every && now.getTime() - Date.parse(old.at) < every) return;
  pref('inbox', [{ ...m, at: now.toISOString(), read: false }, ...list.filter(x => x.key !== m.key)].slice(0, MAX));
  changed();
}
/** Retire le message d'une clé (le problème a disparu). @param {string} key */
export function resolve(key) {
  const list = messages();
  if (!list.some(x => x.key === key)) return;
  pref('inbox', list.filter(x => x.key !== key));
  changed();
}
export function markAllRead() {
  const list = messages();
  if (!list.some(x => !x.read)) return;
  pref('inbox', list.map(x => ({ ...x, read: true })));
  changed();
}
