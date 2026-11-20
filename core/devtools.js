// Outils de développement (section Développeur) : démo par commandes, export / import exact du journal (JSON Lines),
// empreinte d'état, reconstruction des projections, contrôles d'intégrité.
// Tout passe par la session de données (src/data/session.js) ; rien n'écrit dans la base en direct.
import { session, setSettings, migrateIcons, refuseNegatives } from './store.js';
import { today } from './format.js';
export { canonical } from '../domain/canonical.js';

export const stateHash = () => session.stateHash();
export const exportText = () => session.exportJournal();
// Remplace toutes les données par celles du journal, après vérification de la chaîne et de l'empreinte d'état.
// Les icônes d'un journal ancien sont ensuite migrées (D7) par une commande, visible dans le journal.
export async function importText(text) { const { hash } = await session.importJournal(text); await migrateIcons(); await refuseNegatives(); return hash; }
export const rebuild = () => session.rebuild();
export const verify = () => session.verify();
export async function storageInfo() {
  const info = await session.info();
  const s = session.present;
  let tx = 0;
  for (const e of s.entries.values()) if (e.status !== 'void' && ['expense', 'income', 'transfer'].includes(e.kind)) tx++;
  const accounts = [...s.accounts.values()].filter(a => a.kind === 'wallet' && !a.deleted_at).length;
  const categories = [...s.accounts.values()].filter(a => (a.kind === 'expense' || a.kind === 'income') && !a.deleted_at).length;
  return { ...info, tx, accounts, categories };
}
// La démo de 90 jours (déterministe), produite par les commandes dans un journal neuf. Renvoie le nombre d'événements.
export const loadDemo = (day = today()) => session.loadDemo(day);
// Relancer l'accueil guidé sans effacer les données.
export const replayOnboarding = () => setSettings({ onboarded: false });
