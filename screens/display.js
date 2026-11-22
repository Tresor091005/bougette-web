// Moi › Affichage (2026-11-20, avec l'utilisateur : une page à part entière, au lieu d'une feuille) : le style (Carnet ou
// Proto, qui règle d'un coup tout le reste), puis chaque réglage à la main — la police du texte, celle des chiffres, les
// coins — et ce qui existait (vibrations, opérations annulées). Tout s'applique au toucher, sans
// Enregistrer ; pour ce téléphone, tous espaces confondus.
import { settings, setSettings, uiStyle, setUiStyle, look, setLook } from '../core/store.js';
import { icon } from '../core/icons.js';
import { buzz, seg, wireSeg, switchHTML, $, $$ } from '../core/ui.js';

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
export function render(app, { back }) {
  const st = settings(), l = look();
  app.innerHTML = `<div class="screen settings no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Affichage</h1></div></div>
    <section class="section"><div class="section-h"><span class="eyebrow">Style</span></div>
      <div class="group plain"><div class="row stack">${seg([['carnet', 'Carnet'], ['proto', 'Proto']], uiStyle(), 'look-style')}</div></div>
      <p class="hint left">Carnet : le style de Bougette. Proto : bleu ardoise et crème. Changer de style remet sa police et ses coins.</p></section>
    <section class="section"><div class="section-h"><span class="eyebrow">Police</span></div>
      <div class="group plain"><div class="row stack"><div class="t">Le texte</div>${seg([['geist', 'Geist'], ['mono', 'Mono']], l.text, 'look-text')}</div>
        <div class="row stack"><div class="t">Les montants</div>${seg([['geist', 'Geist'], ['mono', 'Mono']], l.num, 'look-num')}</div></div>
      <p class="hint left">Mono : chaque caractère a la même largeur.</p></section>
    <section class="section"><div class="section-h"><span class="eyebrow">Coins</span></div>
      <div class="group plain"><div class="row stack">${seg([['round', 'Ronds'], ['square', 'Carrés']], l.radius, 'look-radius')}</div></div></section>
    <section class="section tail"><div class="group plain">
      <button class="row" data-toggle="haptics"><div class="main"><div class="t">Vibrations légères</div></div>${switchHTML(st.haptics)}</button>
      <button class="row" data-toggle="showVoided"><div class="main"><div class="t">Afficher les opérations annulées</div><div class="s wrap">Barrées et grisées, dans le Journal</div></div>${switchHTML(st.showVoided)}</button>
    </div></section>
  </div>`;
  $('[data-back]', app).onclick = () => back('#/reglages');
  wireSeg(/** @type {HTMLElement} */ ($('.look-style', app)), v => { buzz(8); setUiStyle(v === 'proto' ? 'proto' : 'carnet'); });
  wireSeg(/** @type {HTMLElement} */ ($('.look-text', app)), v => { buzz(8); setLook({ text: v }); });
  wireSeg(/** @type {HTMLElement} */ ($('.look-num', app)), v => { buzz(8); setLook({ num: v }); });
  wireSeg(/** @type {HTMLElement} */ ($('.look-radius', app)), v => { buzz(8); setLook({ radius: v }); });
  $$('[data-toggle]', app).forEach(b => (b.onclick = () => {
    const k = /** @type {string} */ (b.dataset.toggle);
    const on = !settings()[k];
    b.querySelector('.switch')?.classList.toggle('on', on);
    setSettings({ [k]: on });
    buzz(8);
  }));
}
