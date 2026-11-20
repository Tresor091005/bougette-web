// Moi › Verrouillage (page, ROADMAP étape 2, sécurité, 2026-11-09) : activer le code, le changer, déverrouiller avec
// désactiver (le téléphone peut aussi attester : rien à régler). Pas de récupération d'un code oublié : il est dit tel quel.
import { icon } from '../core/icons.js';
import { buzz, toast, confirmSheet, switchHTML, $ } from '../core/ui.js';
import { lockEnabled, disableLock } from '../core/lock.js';
import { askNewCode } from './lock.js';

export function render(app, { back, refresh }) {
  const on = lockEnabled();
  app.innerHTML = `<div class="screen lock-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Verrouillage</h1></div></div>
    <p class="screen-help">À l’ouverture, et au retour après une minute ailleurs : le code de Bougette, ou ton téléphone qui confirme que c’est toi (empreinte, code ou schéma).</p>

    <section class="section"><div class="group">
      <button class="row" data-toggle><span class="pill acc">${icon('lock-simple')}</span><div class="main"><div class="t">Verrouiller Bougette</div><div class="s">${on ? 'Code demandé' : 'Désactivé'}</div></div>${switchHTML(on)}</button>
      ${on ? `<button class="row" data-change><span class="pill acc">${icon('pencil-simple')}</span><div class="main"><div class="t">Changer le code</div></div></button>` : ''}
    </div></section>
    <p class="screen-help">Code oublié : le verrouillage de ton téléphone ouvre Bougette, sans rien perdre.</p>
  </div>`;

  $('[data-back]', app).onclick = () => back('#/reglages');
  $('[data-toggle]', app).onclick = async () => {
    buzz(6);
    if (!lockEnabled()) { if (await askNewCode()) refresh(); return; }
    const ok = await confirmSheet({ title: 'Désactiver le verrouillage ?', text: 'Bougette s’ouvrira sans code.', yes: 'Désactiver' });
    if (!ok) return;
    disableLock();
    toast('Verrouillage désactivé');
    refresh();
  };
  const change = $('[data-change]', app);
  if (change) change.onclick = async () => { buzz(6); await askNewCode(); };
}
