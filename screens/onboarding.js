// Premier lancement (D10) : un seul écran. L'icône (D12), « Ton argent, au franc près. », « Commencer ».
// Ensuite l'accueil, vide : aucun portefeuille ni budget n'est proposé, l'utilisateur découvre l'app et crée les siens
// (la fiche de création parle d'elle-même). Pas de choix de monnaie ici : c'est le portefeuille qui porte sa devise,
// et la monnaie d'affichage des totaux se règle dans Moi → Monnaie et format.
import { finishOnboarding } from '../core/store.js';
import { logo } from '../core/icons.js';
import { buzz, $ } from '../core/ui.js';

export function render(app, ctx) {
  app.innerHTML = `<div class="screen no-tabs onboarding ob-0"><div class="ob-welcome">
    <div class="ob-illu">${logo()}</div>
    <h1 class="ob-brand">Bougette</h1>
    <p class="ob-lead">Ton argent, au franc près.<br>Sans compte, sans internet.</p>
    <div class="ob-foot"><button class="btn primary" data-go>Commencer</button></div>
  </div></div>`;
  const go = $('[data-go]', app);
  go.onclick = async () => {
    go.disabled = true;
    if (!(await finishOnboarding())) { go.disabled = false; return; }
    buzz(12);
    ctx.go('#/', { replace: true });
  };
}
// Bouton retour Android : un seul écran, on laisse Android quitter l'app.
export const back = () => false;
