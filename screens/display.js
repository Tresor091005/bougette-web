// Moi › Affichage (2026-11-20, avec l'utilisateur : une page à part entière, au lieu d'une feuille) : le style (Carnet ou
// Proto, qui règle d'un coup tout le reste), puis chaque réglage à la main — la police du texte, celle des chiffres, les
// coins — et ce qui existait (vibrations, opérations annulées). Tout s'applique au toucher, sans
// Enregistrer ; pour ce téléphone, tous espaces confondus.
import { settings, setSettings, uiStyle, setUiStyle, look, setLook } from '../core/store.js';
import { buzz, seg, wireSeg, switchHTML, $, $$ } from '../core/ui.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML } from './parts.js';

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
export function render(app, { back }) {
  const st = settings(), l = look();
  app.innerHTML = `<div class="screen settings no-tabs">
    ${topbarHTML({ title: 'Affichage' })}
    ${sectionHTML({ title: 'Style', body: `
      <div class="group plain"><div class="row stack">${seg([['carnet', 'Carnet'], ['proto', 'Proto']], uiStyle(), 'look-style')}</div></div>
      <p class="hint left">Carnet : le style de Bougette. Proto : bleu ardoise et crème. Changer de style remet ses coins.</p>` })}
    ${sectionHTML({ title: 'Coins', body: `
      <div class="group plain"><div class="row stack">${seg([['round', 'Ronds'], ['square', 'Carrés']], l.radius, 'look-radius')}</div></div>` })}
    ${sectionHTML({ cls: 'tail', body: `<div class="group plain">
      ${rowHTML({ attrs: 'data-toggle="haptics"', title: 'Vibrations légères', end: switchHTML(st.haptics) })}
      ${rowHTML({ attrs: 'data-toggle="showVoided"', title: 'Afficher les opérations annulées', sub: 'Barrées et grisées, dans le Journal', subCls: 'wrap', end: switchHTML(st.showVoided) })}
    </div>` })}
  </div>`;
  wireBack(app, () => back('#/reglages'));
  wireSeg(/** @type {HTMLElement} */ ($('.look-style', app)), v => { buzz(8); setUiStyle(v === 'proto' ? 'proto' : 'carnet'); });
  wireSeg(/** @type {HTMLElement} */ ($('.look-radius', app)), v => { buzz(8); setLook({ radius: v }); });
  $$('[data-toggle]', app).forEach(b => (b.onclick = () => {
    const k = /** @type {string} */ (b.dataset.toggle);
    const on = !settings()[k];
    b.querySelector('.switch')?.classList.toggle('on', on);
    setSettings({ [k]: on });
    buzz(8);
  }));
}
