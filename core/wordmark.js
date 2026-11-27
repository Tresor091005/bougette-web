// Le nom « Bougette » dessiné en blocs (2026-11-27, avec l'utilisateur) : des lettres pleines, fendues, qui ne se touchent
// jamais mais se glissent les unes sous les autres (la barre des deux t au-dessus des e, la queue du g sous le u), sans
// bords alignés. Le nom, là où il est écrit en toutes lettres (accueil, À propos, le site) ; la bourse reste le symbole
// (D12). Des rectangles seuls, sans police : il ne bouge pas avec la police choisie. Sans dépendance, le site s'en sert aussi.
export const WORDMARK_D = 'M0 6h22v120h-22zM22 60h46v64h-46zM76 44h58v60h-58zM142 52h58v58h-58zM208 36h58v64h-58zM246 100h20v18h-20zM142 118h124v16h-124zM274 60h58v60h-58zM282 30h150v22h-150zM340 14h22v16h-22zM340 52h22v88h-22zM370 0h22v30h-22zM370 52h22v60h-22zM400 60h58v56h-58zM32 86h24v12h-24zM90 68h30v12h-30zM160 52h22v36h-22zM222 62h30v12h-30zM290 76h26v10h-26zM312 96h20v10h-20zM416 74h26v10h-26zM438 92h20v10h-20z';

/** Le nom en blocs, à la couleur du texte (currentColor). @param {string} [cls] */
export const wordmark = (cls = '') =>
  `<svg class="wordmark${cls ? ` ${cls}` : ''}" viewBox="0 0 458 140" role="img" aria-label="Bougette"><path fill="currentColor" fill-rule="evenodd" d="${WORDMARK_D}"/></svg>`;
