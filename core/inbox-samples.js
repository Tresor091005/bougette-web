// Tous les messages de la cloche, un exemple de chacun (page Développeur, 2026-11-21, avec l'utilisateur : pour en revoir
// le dessin d'un coup). Les textes reprennent ceux des modules qui les envoient (une variante par ligne), avec des
// valeurs d'exemple et, sur les cartes, des catégories par défaut (domain/defaults.js ; absente de l'espace : l'icône
// du sujet) ; « Choisir » d'une réserve n'a rien de réel derrière. Les clés commencent par « sample- » : rien de réel
// n'est remplacé, et « Retirer les exemples » ne retire qu'eux.
import { messages, resolve, putAll } from './inbox.js';

/** @type {Array<Omit<import('./inbox.js').Message, 'at'|'read'>>} */
const SAMPLES = [
  // copies (core/backup.js)
  { key: 'integrity', kind: 'error', title: 'Tes données ont un souci', body: 'Répare-les : on te dit avant ce qui serait perdu.', action: { label: 'Réparer', id: 'heal' } },
  { key: 'integrity-space', kind: 'error', title: 'Problème dans « Mon espace 2 »', body: 'Ouvre-le pour le réparer.', action: { label: 'Ouvrir', id: 'space:sample' } },
  // synchro Google Drive (core/cloud.js)
  { key: 'sync-skip', kind: 'error', title: '2 changements à revoir', body: 'Un autre appareil les a modifiés en même temps.', action: { label: 'Revoir', id: 'review' } },
  { key: 'sync-auth', kind: 'warn', title: 'Synchro en pause', body: 'Google demande de te reconnecter.', action: { label: 'Reconnecter', id: 'google' } },
  { key: 'sync-invite', kind: 'warn', title: 'Tes données sont seulement sur ce téléphone', body: 'Garde-les sur Google Drive.', action: { label: 'Lier', id: 'google' } },
  { key: 'sync-reset', kind: 'info', title: '« Mon espace » restauré ailleurs', body: 'Cet appareil a suivi. Ce que tu y avais noté est gardé.' },
  { key: 'sync-fork', kind: 'info', title: '« Mon espace » en deux versions', body: 'Ton compte garde les deux, sans les mélanger.' },
  { key: 'sync-spaces', kind: 'info', title: 'Nouvel espace : Famille', body: 'Ouvre-le depuis Moi.' },
  // mise à jour (core/update.js)
  { key: 'update', kind: 'info', title: 'Nouvelle version', body: 'Prête à installer.', action: { label: 'Installer', id: 'update' } },
  // rentrée à répartir (core/assign.js)
  { key: 'assign', kind: 'warn', title: '150 000 F à répartir', body: 'Arrivés le 20 nov.', action: { label: 'Répartir', id: 'assign' } },
  // épargne (core/reserve-alerts.js)
  { key: 'res-ready', kind: 'ok', title: 'Rentrée scolaire est prête', body: 'Tu la dépenses quand ?', action: { label: 'Choisir', id: 'when:sample' } },
  { key: 'res-ready-many', kind: 'ok', title: '4 réserves prêtes', body: 'Choisis quand tu les dépenses.', action: { label: 'Voir', id: 'savings' } },
  { key: 'goal-ok', kind: 'ok', title: 'Objectif atteint', body: 'Fonds d’urgence : 300 000 F.' },
  { key: 'goal-many', kind: 'ok', title: '4 objectifs atteints', body: '' },
];

const PREFIX = 'sample-';
/** Met un exemple de chaque message dans la cloche (non lus). @returns {number} combien */
export function fillSamples() {
  // tous d'un coup, au-delà de la limite de la cloche (20) : l'ordre de la liste reste celui d'ici, les vrais à la suite
  const at = new Date().toISOString();
  putAll([...SAMPLES.map(s => ({ ...s, key: PREFIX + s.key, at, read: false })), ...messages().filter(m => !m.key.startsWith(PREFIX))]);
  return SAMPLES.length;
}
/** Retire les exemples de la cloche (les vrais messages restent). */
export function clearSamples() {
  for (const m of messages()) if (m.key.startsWith(PREFIX)) resolve(m.key);
}
