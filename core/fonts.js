// Les polices au choix (Moi › Affichage › Police ; 2026-11-24, avec l'utilisateur : une seule police pour tout, texte et
// chiffres, dans les deux styles). Chacune est déclarée dans theme.css (@font-face) ; seule
// celle qui sert est téléchargée. Roboto est celle du téléphone (Android), la même que WhatsApp : rien n'est embarqué.

/** @typedef {{ id: string, name: string, family: string }} Font */

/** Gardées le 2026-11-24, avec l'utilisateur (Geist Mono et Geist Pixel essayées puis retirées). @type {Font[]} */
export const FONTS = [
  { id: 'satoshi', name: 'Satoshi', family: 'Satoshi' },
  { id: 'geist', name: 'Geist', family: 'Geist' },
  { id: 'geist-serif', name: 'Geist Serif', family: 'Geist Serif' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto' },
];
export const DEFAULT_FONT = 'satoshi';

/** Le choix enregistré (une valeur inconnue ou retirée : la police par défaut). @param {string|null|undefined} v */
export function parseFont(v) {
  const id = String(v || '').split('/')[0];
  const font = FONTS.find(f => f.id === id) || /** @type {Font} */ (FONTS.find(f => f.id === DEFAULT_FONT));
  return { font, value: font.id };
}

/** La famille CSS d'un choix, suivie des polices de repli. @param {string|null|undefined} v */
export function fontStack(v) {
  const { font } = parseFont(v);
  return `'${font.family}', ${font.id === 'roboto' ? 'system-ui, ' : ''}-apple-system, 'Segoe UI', Roboto, sans-serif`;
}
