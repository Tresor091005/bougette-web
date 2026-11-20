// Moi › Affichage (2026-11-20, avec l'utilisateur : une page à part entière, au lieu d'une feuille) : le style (Carnet ou
// Proto, qui règle d'un coup tout le reste), puis chaque réglage à la main — la police du texte, celle des chiffres, les
// coins — et ce qui existait (mode discret, vibrations, opérations annulées). Tout s'applique au toucher, sans
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
      <div class="field">${seg([['carnet', 'Carnet'], ['proto', 'Proto']], uiStyle(), 'look-style')}</div>
      <p class="field-note">Carnet : le style de Bougette. Proto : bleu ardoise et crème, accueil en tuiles. Choisir un style remet la police et les coins aux siens.</p></section>
    <section class="section"><div class="section-h"><span class="eyebrow">Police</span></div>
      <div class="field"><span>Le texte</span>${seg([['geist', 'Geist'], ['mono', 'Mono']], l.text, 'look-text')}</div>
      <div class="field"><span>Les montants</span>${seg([['geist', 'Geist'], ['mono', 'Mono']], l.num, 'look-num')}</div>
      <p class="field-note">Mono : Share Tech Mono, des caractères de même largeur.</p></section>
    <section class="section"><div class="section-h"><span class="eyebrow">Coins</span></div>
      <div class="field">${seg([['round', 'Ronds'], ['square', 'Carrés']], l.radius, 'look-radius')}</div></section>
    <section class="section"><div class="group plain">
      <button class="row" data-toggle="discreet"><div class="main"><div class="t">Mode discret</div><div class="s">Masque les montants</div></div>${switchHTML(st.discreet)}</button>
      <button class="row" data-toggle="haptics"><div class="main"><div class="t">Vibrations légères</div></div>${switchHTML(st.haptics)}</button>
      <button class="row" data-toggle="showVoided"><div class="main"><div class="t">Afficher les opérations annulées</div><div class="s wrap">Barrées et grisées dans le Journal, pour retrouver ce qui s’est passé</div></div>${switchHTML(st.showVoided)}</button>
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
