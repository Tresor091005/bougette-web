// Moi › Affichage (2026-11-20, avec l'utilisateur : une page à part entière, au lieu d'une feuille) : le style (Carnet ou
// Proto, qui règle d'un coup les couleurs et les coins), la police (une pour tout : Satoshi, Geist, Geist Serif ou Roboto, celle du téléphone), les icônes (Phosphor ou Solar), les coins, et ce qui existait (vibrations, opérations annulées). Tout s'applique au toucher, sans
// Enregistrer ; pour ce téléphone, tous espaces confondus.
import { settings, setSettings, uiStyle, setUiStyle, look, setLook } from '../core/store.js';
import { buzz, seg, wireSeg, switchHTML, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { FONTS, parseFont, fontStack } from '../core/fonts.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML } from './parts.js';

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
export function render(app, { back }) {
  const st = settings(), l = look();
  app.innerHTML = `<div class="screen settings no-tabs">
    ${topbarHTML({ title: 'Affichage' })}
    ${sectionHTML({ title: 'Style', body: `
      <div class="group plain"><div class="row stack">${seg([['carnet', 'Carnet'], ['proto', 'Proto']], uiStyle(), 'look-style')}</div></div>
      <p class="hint left">Carnet : le style de Bougette. Proto : bleu ardoise et crème. Changer de style remet ses coins.</p>` })}
    ${sectionHTML({ title: 'Police', body: `<div data-fonts></div>
      <p class="hint left">Une seule police pour tout, dans les deux styles.</p>` })}
    ${sectionHTML({ title: 'Icônes', body: `
      <div class="group plain"><div class="row stack">${seg([['phosphor', 'Phosphor'], ['solar', 'Solar']], l.icons, 'look-icons')}</div></div>` })}
    ${sectionHTML({ title: 'Coins', body: `
      <div class="group plain"><div class="row stack">${seg([['round', 'Ronds'], ['square', 'Carrés']], l.radius, 'look-radius')}</div></div>` })}
    ${sectionHTML({ cls: 'tail', body: `<div class="group plain">
      ${rowHTML({ attrs: 'data-toggle="haptics"', title: 'Vibrations légères', end: switchHTML(st.haptics) })}
      ${rowHTML({ attrs: 'data-toggle="showVoided"', title: 'Afficher les opérations annulées', sub: 'Barrées et grisées, dans le Journal', subCls: 'wrap', end: switchHTML(st.showVoided) })}
    </div>` })}
  </div>`;
  wireBack(app, () => back('#/reglages'));
  wireSeg(/** @type {HTMLElement} */ ($('.look-style', app)), v => { buzz(8); setUiStyle(v === 'proto' ? 'proto' : 'carnet'); });
  // la police : une ligne par police, écrite dans sa police
  const fonts = /** @type {HTMLElement} */ ($('[data-fonts]', app));
  const paintFonts = () => {
    const cur = parseFont(look().font).font;
    fonts.innerHTML = `<div class="group plain">${FONTS.map(f => rowHTML({ attrs: `data-font="${f.id}"`, title: `<span data-ff="${f.id}">${f.name}</span>`,
      end: cur.id === f.id ? icon('check') : '' })).join('')}</div>`;
    $$('[data-ff]', fonts).forEach(s => (s.style.fontFamily = fontStack(s.dataset.ff)));
    $$('[data-font]', fonts).forEach(b => (b.onclick = () => { buzz(8); setLook({ font: /** @type {string} */ (b.dataset.font) }); paintFonts(); }));
  };
  paintFonts();
  wireSeg(/** @type {HTMLElement} */ ($('.look-icons', app)), v => { buzz(8); setLook({ icons: v }); });
  wireSeg(/** @type {HTMLElement} */ ($('.look-radius', app)), v => { buzz(8); setLook({ radius: v }); });
  $$('[data-toggle]', app).forEach(b => (b.onclick = () => {
    const k = /** @type {string} */ (b.dataset.toggle);
    const on = !settings()[k];
    b.querySelector('.switch')?.classList.toggle('on', on);
    setSettings({ [k]: on });
    buzz(8);
  }));
}
