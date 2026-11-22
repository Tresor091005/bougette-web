// Outils de la page Développeur (cachée : sept touchers sur la version dans Moi) : la démo par commandes, l'accueil guidé.
// Tout passe par la session de données (src/data/session.js) ; rien n'écrit dans la base en direct.
import { session, setSettings } from './store.js';
import { today } from './format.js';

// La démo de 90 jours (déterministe), produite par les commandes dans un journal neuf. Renvoie le nombre d'événements.
export const loadDemo = (day = today()) => session.loadDemo(day);
// Relancer l'accueil guidé sans effacer les données.
export const replayOnboarding = () => setSettings({ onboarded: false });
