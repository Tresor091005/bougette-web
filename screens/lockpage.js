// Moi › Verrouillage (page, ROADMAP étape 2, sécurité, 2026-11-09 ; « code exigé, app libre », 2026-11-21, avec
// l'utilisateur) : choisir le code, le changer (il ne se retire pas : les actions sensibles l'exigent), et, à part,
// verrouiller l'app à l'ouverture. Le téléphone peut aussi attester : rien à régler. Pas de récupération d'un code
// oublié autre que le verrouillage du téléphone : il est dit tel quel.
import { icon } from '../core/icons.js';
import { buzz, toast, switchHTML, $ } from '../core/ui.js';
import { hasCode, lockAtOpen, setLockOpen } from '../core/lock.js';
import { askNewCode, askIdentity } from './lock.js';

export function render(app, { back, refresh }) {
  const code = hasCode(), open = lockAtOpen();
  app.innerHTML = `<div class="screen lock-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Verrouillage</h1></div></div>
    <p class="screen-help">Le code est demandé avant les actions sensibles : Google, export, repartir de zéro, espaces. Sur le téléphone, ton empreinte ou le code du téléphone marchent aussi.</p>

    <section class="section"><div class="group">
      <button class="row" data-code><span class="pill acc">${icon(code ? 'pencil-simple' : 'lock-simple')}</span><div class="main"><div class="t">${code ? 'Changer le code' : 'Choisir un code'}</div><div class="s">${code ? 'Code choisi' : 'Pas encore de code'}</div></div></button>
      <button class="row" data-open><span class="pill acc">${icon('lock-simple')}</span><div class="main"><div class="t">Verrouiller à l’ouverture</div><div class="s">${open ? 'Aussi au retour, après une minute ailleurs' : 'Bougette s’ouvre sans code'}</div></div>${switchHTML(open)}</button>
    </div></section>
    <p class="screen-help">Code oublié ? Le verrouillage du téléphone ouvre Bougette, puis tu choisis un nouveau code.</p>
  </div>`;

  $('[data-back]', app).onclick = () => back('#/reglages');
  $('[data-code]', app).onclick = async () => {
    buzz(6);
    if (!hasCode()) { if (await askNewCode()) refresh(); return; }
    if (await askIdentity('Changer le code')) await askNewCode();
  };
  $('[data-open]', app).onclick = async () => {
    buzz(6);
    if (lockAtOpen()) {
      if (!(await askIdentity('Ne plus verrouiller à l’ouverture'))) return;
      setLockOpen(false);
      toast('Bougette s’ouvre sans code');
      refresh();
      return;
    }
    if (!hasCode() && !(await askNewCode({ title: 'Verrouiller à l’ouverture', intro: 'Choisis d’abord un code' }))) { refresh(); return; }
    setLockOpen(true);
    toast('Code demandé à l’ouverture');
    refresh();
  };
}
