// Premier lancement (D10) : un seul écran. L'icône (D12), « Ton argent, au franc près. », « Commencer ».
// Ensuite l'accueil, vide : aucun portefeuille ni budget n'est proposé, l'utilisateur découvre l'app et crée les siens
// (la fiche de création parle d'elle-même). Pas de choix de monnaie ici : c'est le portefeuille qui porte sa devise,
// et la monnaie d'affichage des totaux se règle dans Moi → Monnaie et format.
import { finishOnboarding } from '../core/store.js';
import { logo } from '../core/icons.js';
import { buzz, toast, $ } from '../core/ui.js';
import { googleAvailable } from '../core/google.js';
import { linkAccount } from '../core/cloud.js';
import { isDemo } from '../core/spaces.js';
import { askIdentity } from './lock.js';

export function render(app, ctx) {
  app.innerHTML = `<div class="screen no-tabs onboarding ob-0"><div class="ob-welcome">
    <div class="ob-illu">${logo()}</div>
    <h1 class="ob-brand">Bougette</h1>
    <p class="ob-lead">Ton argent, au franc près.<br>Vois où il va, décide où il ira.</p>
    <div class="ob-foot"><button class="btn primary" data-go>Commencer</button>
      ${googleAvailable() && !isDemo() ? '<button class="btn ghost ob-restore" data-google>J’ai déjà mes données sur Google</button>' : ''}</div>
  </div></div>`;
  const go = $('[data-go]', app);
  go.onclick = async () => {
    go.disabled = true;
    if (!(await finishOnboarding())) { go.disabled = false; return; }
    buzz(12);
    ctx.go('#/', { replace: true });
  };
  // Retrouver ses données (D21, 2026-11-20) : lier le compte Google ; le premier espace, encore vierge, prend celui du
  // compte, et l'accueil s'ouvre dessus (dans le navigateur : départ vers Google, la suite au retour)
  const gg = $('[data-google]', app);
  if (gg) gg.onclick = async () => {
    buzz(8);
    if (!(await askIdentity('Lier un compte Google'))) return;
    gg.disabled = true;
    try {
      const r = await linkAccount();
      if (r && !r.away && !r.ok) toast(`Lié, mais pas encore synchronisé : ${r.error}`);
      else if (r && r.ok && location.hash.includes('bienvenue')) toast('Ce compte est vide. Commence ici : tes données iront dans ton Drive.');
    } catch (e) { toast(/** @type {Error} */ (e).message || 'Liaison impossible.'); }
    gg.disabled = false;
  };
}
// Bouton retour Android : un seul écran, on laisse Android quitter l'app.
export const back = () => false;
