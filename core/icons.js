// Icônes : Phosphor Icons (licence MIT), embarquées hors ligne dans src/vendor/phosphor/icons.js (généré par
// tools/build-icons.mjs, seulement les icônes utilisées). Couleur : currentColor.
//   icon(nom, cls?)          interface, graisse regular        (ex. icon('caret-right'))
//   icon(nom, cls, 'fill')   onglet actif du dock
//   solarIcon(nom, cls?)     dessin Solar (au choix, Moi › Affichage › Icônes)
//   catIcon(nom, cls?)       pastille de catégorie, duotone     (nom du catalogue src/domain/catalog.js)
// Une icône absente du fichier généré est signalée en console et remplacée par dots-three : l'ajouter dans
// tools/build-icons.mjs puis relancer npm run icons.
import { REGULAR, FILL, DUOTONE } from '../vendor/phosphor/icons.js';
import { SOLAR } from '../vendor/solar/icons.js';
import { FALLBACK_ICON } from '../domain/catalog.js';
export { CATALOG, searchIcons, iconLabel } from '../domain/catalog.js';

const svg = (inner, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">${inner}</svg>`;
const warned = new Set();
function missing(name, weight) {
  if (!warned.has(weight + name)) { warned.add(weight + name); console.warn(`Icône absente (${weight}) : ${name}`); }
}

export function icon(name, cls = '', weight = 'regular') {
  if (name === 'logo') return logo(cls);
  // au choix (Moi › Affichage › Icônes, 2026-11-24, avec l'utilisateur ; avant : le style Proto, D1, D7) : les icônes
  // d'interface dessinées par Solar « Broken » (tools/build-solar.mjs) ;
  // l'onglet actif garde la même icône (sa couleur le dit), les catégories restent Phosphor (catIcon)
  if (weight !== 'duotone' && SOLAR[name] && typeof document !== 'undefined' && document.documentElement.dataset.icons === 'solar') return solarIcon(name, cls);
  const table = weight === 'fill' ? FILL : weight === 'duotone' ? DUOTONE : REGULAR;
  const inner = table[name];
  if (inner) return svg(inner, cls);
  missing(name, weight);
  return svg(REGULAR[FALLBACK_ICON] || DUOTONE[FALLBACK_ICON], cls);
}
// Icône d'interface dessinée par Solar ; Phosphor si Solar ne l'a pas.
export function solarIcon(name, cls = '') {
  if (!SOLAR[name]) return icon(name, cls);
  return `<svg class="ic solar${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${SOLAR[name]}</svg>`;
}
// Icône de catégorie (duotone) ; une icône inconnue (donnée pas encore migrée) devient dots-three sans bruit.
export const catIcon = (name, cls = '') => svg(DUOTONE[name] || DUOTONE[FALLBACK_ICON], cls);

// Logo de marque = l'icône livrée (docs/design/logo/bougette-icone.svg, D12) : bourse au trait dont le niveau baisse,
// ivoire sur indigo de marque, dans un carré arrondi (masque d'icône). Pas une icône Phosphor.
// Chaque copie a son propre identifiant de découpe : une copie masquée (display:none) ne doit pas casser les autres.
let logoSeq = 0;
const BAG = 'M48.2 45.5H59.8C70.5 51.5 77 59.5 77 67.5C77 77 67 83 54 83C41 83 31 77 31 67.5C31 59.5 37.5 51.5 48.2 45.5Z';
export const logo = (cls = '') => {
  const id = `bg-panse-${++logoSeq}`;
  return `<svg class="logo${cls ? ' ' + cls : ''}" viewBox="18 18 72 72" aria-hidden="true">
  <defs><clipPath id="${id}"><path d="${BAG}"/></clipPath></defs>
  <rect x="18" y="18" width="72" height="72" rx="16" fill="var(--brand)"/>
  <g transform="translate(54 56) scale(.86) translate(-54 -56)" fill="var(--brand-ink)">
    <path d="M43 27.5Q48.5 23 54 27.5Q59.5 23 65 27.5L60.2 37.5H47.8Z"/><rect x="46" y="39.5" width="16" height="4" rx="2"/>
    <path d="M30 66Q36 62 42 66T54 66T66 66T78 66V90H30Z" clip-path="url(#${id})"/>
    <path d="${BAG}" fill="none" stroke="var(--brand-ink)" stroke-width="3.6" stroke-linejoin="round"/>
  </g></svg>`;
};
