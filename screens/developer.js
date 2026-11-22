// Moi › Développeur (page cachée, 2026-11-21, avec l'utilisateur) : ouvrir ou recharger l'espace Démo, relancer l'accueil
// guidé, pour les essais ; revenir à une date (et annuler ce retour) ; mettre un exemple de chaque message dans la cloche, pour en revoir le dessin. Elle s'ouvre en touchant sept fois la version dans Moi (pied de page, ou feuille Mises à jour) ;
// une fois ouverte ainsi, elle reste accessible sur ce téléphone (préférence « dev ») et sa ligne apparaît dans Moi.
import { pref } from '../core/store.js';
import { askIdentity } from './lock.js';
import { isDemo, demoSpace, chooseSpace, reopen, DEMO } from '../core/spaces.js';
import { icon } from '../core/icons.js';
import { toast, confirmSheet, $ } from '../core/ui.js';
import { loadDemo, replayOnboarding } from '../core/devtools.js';
import { fillSamples, clearSamples } from '../core/inbox-samples.js';
import { mountGoBack } from './backup.js';

const TAPS = 7;
/** La page Développeur est-elle ouverte sur ce téléphone ? */
export const devUnlocked = () => pref('dev') === true;

/**
 * Sept touchers sur la version ouvrent la page Développeur (comme Android) : à partir du 3e, « Encore N touchers » ; au
 * 7e, la page s'ouvre et reste accessible sur ce téléphone. Plus de deux secondes entre deux touchers : on recommence.
 * @param {HTMLElement} el l'endroit où la version est écrite
 * @param {() => void} [before] juste avant d'ouvrir la page (fermer une feuille)
 */
export function versionTaps(el, before) {
  let n = 0, last = 0;
  el.addEventListener('click', () => {
    const now = Date.now();
    n = now - last > 2000 ? 1 : n + 1;
    last = now;
    if (n < TAPS) { if (n >= 3) toast(TAPS - n === 1 ? 'Encore 1 toucher' : `Encore ${TAPS - n} touchers`); return; }
    n = 0;
    pref('dev', true);
    if (!before) { location.hash = '#/reglages/dev'; return; }
    before(); // la feuille se ferme (retour dans l'historique) : la page s'ouvre ensuite
    setTimeout(() => { location.hash = '#/reglages/dev'; }, 300);
  });
}

export function render(app, { back, go }) {
  app.innerHTML = `<div class="screen dev-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Développeur</h1></div></div>
    <p class="screen-help">Pour faire des essais.</p>

    <section class="section"><div class="section-h"><span class="eyebrow">Essais</span></div><div class="group">
      <button class="row" data-demo><div class="main"><div class="t">${isDemo() ? 'Recharger la démo' : 'Ouvrir l’espace Démo'}</div><div class="s">${isDemo() ? '90 jours d’exemple, dans l’espace Démo seulement' : '90 jours d’exemple, à part de tes données'}</div></div></button>
      <button class="row" data-onb><div class="main"><div class="t">Relancer l’accueil guidé</div><div class="s">Sans effacer les données</div></div></button>
      <button class="row" data-samples><div class="main"><div class="t">Tous les messages dans la cloche</div><div class="s">Un exemple de chacun, pour revoir leur dessin</div></div></button>
      <button class="row" data-clear-samples><div class="main"><div class="t">Retirer les exemples de la cloche</div><div class="s">Les vrais messages restent</div></div></button>
    </div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Revenir en arrière</span></div>
      <div class="group" data-goback></div></section>

  </div>`;

  $('[data-back]', app).onclick = () => back('#/reglages');
  mountGoBack($('[data-goback]', app));
  $('[data-demo]', app).onclick = async () => {
    // D19 : la démo vit dans son espace ; depuis un autre espace, on l'ouvre (l'app s'y rouvre et la remplit)
    if (!isDemo()) {
      const go2 = await confirmSheet({ title: 'Ouvrir l’espace Démo ?', text: 'L’app se rouvre sur un espace à part, rempli de 90 jours d’exemple. Tes données ne changent pas : tu y reviens par la liste des espaces, en haut de Moi.', yes: 'Ouvrir la démo' });
      if (!go2) return;
      demoSpace(); chooseSpace(DEMO); reopen('demo');
      return;
    }
    const ok = await confirmSheet({ title: 'Recharger la démo ?', text: 'L’espace Démo repart de zéro avec 90 jours d’exemple. Aucun autre espace ne change.', yes: 'Recharger' });
    if (!ok) return;
    try { await loadDemo(); toast('Démo chargée'); } catch (e) { console.error(e); toast('Démo impossible : ' + /** @type {Error} */ (e).message); }
  };
  $('[data-samples]', app).onclick = () => { toast(`${fillSamples()} messages dans la cloche`); };
  $('[data-clear-samples]', app).onclick = () => { clearSamples(); toast('Exemples retirés'); };
  $('[data-onb]', app).onclick = async () => { if (!(await askIdentity('Relancer l’accueil guidé'))) return; await replayOnboarding(); go('#/bienvenue', { replace: true }); };
}
