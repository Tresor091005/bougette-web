// Lectures de l'écran Budget : dates relatives des opérations prévues (« Dans 2 jours », section « À venir »).
// Fonctions pures.
import { daysBetween } from './pace.js';

/**
 * Date relative d'une opération prévue (« À venir ») : « Aujourd'hui », « Demain », « Dans 5 jours »,
 * « Hier », « En retard de 3 jours » ; au-delà de 13 jours, null (afficher la date).
 * @param {string} date @param {string} today
 */
export function relativeDay(date, today) {
  const n = daysBetween(today, date);
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Demain';
  if (n === -1) return 'Hier';
  if (n > 1 && n <= 13) return `Dans ${n} jours`;
  if (n < -1 && n >= -13) return `En retard de ${-n} jours`;
  return null;
}
