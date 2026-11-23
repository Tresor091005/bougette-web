// Premier lancement (D10) : un seul écran. L'icône (D12), « Ton argent, au franc près. », « Continuer avec Google » (D21).
// Ensuite l'accueil, vide : aucun portefeuille ni budget n'est proposé, l'utilisateur découvre l'app et crée les siens
// (la fiche de création parle d'elle-même). Pas de choix de monnaie ici : c'est le portefeuille qui porte sa devise,
// et la monnaie d'affichage des totaux se règle dans Moi → Monnaie et format.
import { finishOnboarding } from '../core/store.js';
import { logo } from '../core/icons.js';
import { buzz, toast, confirmSheet, $ } from '../core/ui.js';
import { googleAvailable, account } from '../core/google.js';
import { linkAccount } from '../core/cloud.js';
import { isDemo } from '../core/spaces.js';
import { askIdentity } from './lock.js';

export function render(app, ctx) {
  // Google d'abord (2026-11-23, avec l'utilisateur : l'inverse d'avant) : « Continuer avec Google » lie le compte, retrouve
  // ses données s'il en a, sinon commence à neuf avec la sauvegarde en place ; « Commencer sans compte » reste possible,
  // en lien discret (les données restent sur l'appareil, le compte se lie plus tard dans Moi). Sans Google possible ici
  // (la Démo, un appareil déjà lié, un navigateur sans client), le seul bouton « Commencer ».
  const google = googleAvailable() && !isDemo() && !account();
  app.innerHTML = `<div class="screen no-tabs onboarding ob-0"><div class="ob-welcome">
    <div class="ob-illu">${logo()}</div>
    <h1 class="ob-brand">Bougette</h1>
    <p class="ob-lead">Ton argent, au franc près.<br>Vois où il va, décide où il ira.</p>
    <div class="ob-foot">${google
      ? `<button class="btn primary" data-google>Continuer avec Google</button>
        <button class="link ob-alone" data-go>Commencer sans compte</button>`
      : '<button class="btn primary" data-go>Commencer</button>'}</div>
  </div></div>`;
  const done = async () => {
    if (!(await finishOnboarding())) return false;
    buzz(12);
    ctx.go('#/', { replace: true });
    return true;
  };
  const go = /** @type {HTMLButtonElement} */ ($('[data-go]', app));
  go.onclick = async () => {
    go.disabled = true;
    if (google) {
      const ok = await confirmSheet({ title: 'Commencer sans compte ?', text: 'Tes données resteront seulement sur cet appareil : si tu le perds, elles sont perdues. Tu pourras lier un compte Google plus tard, dans Moi.', yes: 'Commencer sans compte', cancel: 'Retour' });
      if (!ok) { go.disabled = false; return; }
    }
    if (!(await done())) go.disabled = false;
  };
  // le compte lié : un compte qui a déjà des données les ramène (l'espace, encore vierge, prend le sien et l'accueil
  // s'ouvre dessus) ; un compte vide : on commence ici, la sauvegarde est en place. Dans le navigateur : départ vers
  // Google, la suite au retour (bougette:linked).
  const after = async (/** @type {{ ok: boolean, error?: string }} */ r) => {
    if (!location.hash.includes('bienvenue')) return; // ses données sont revenues : l'accueil est déjà là
    if (r.ok) { if (await done()) toast('Compte Google lié'); }
    else if (r.error) toast(`Lié, mais pas encore synchronisé : ${r.error}`);
  };
  if (google) window.addEventListener('bougette:linked', e => after(/** @type {CustomEvent} */ (e).detail || { ok: false }), { once: true });
  const gg = /** @type {HTMLButtonElement|null} */ ($('[data-google]', app));
  if (gg) gg.onclick = async () => {
    buzz(8);
    if (navigator.onLine === false) { toast('Pas de connexion : commence sans compte, tu lieras ton compte plus tard dans Moi.'); return; }
    if (!(await askIdentity('Lier un compte Google'))) return;
    gg.disabled = true;
    try {
      const r = await linkAccount();
      if (r && !r.away) await after(r);
    } catch (e) { toast(/** @type {Error} */ (e).message || 'Liaison impossible.'); }
    gg.disabled = false;
  };
}
// Bouton retour Android : un seul écran, on laisse Android quitter l'app.
export const back = () => false;
