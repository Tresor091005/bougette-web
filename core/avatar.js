// L'avatar d'un espace (D19, 2026-11-19, avec l'utilisateur) : une petite tête blobatar (licence MIT, src/vendor/blobatar),
// toujours la même pour un espace, calculée depuis son identifiant : elle ne change pas quand on le renomme. On reconnaît
// d'un coup d'œil dans quel espace on est (en haut de Moi, dans l'onglet Moi du bas, dans la liste des espaces).
import { blobatar } from '../vendor/blobatar/blob.js';

/** Le SVG de la tête d'un espace (sa taille vient du CSS). @param {{ id: string }} space */
export const spaceAvatar = space => blobatar(space.id, { background: 'circle' });

/**
 * La même tête pour l'onglet Moi du bas (2026-11-19, avec l'utilisateur : en couleur, elle cassait le dessin des autres
 * onglets) : sans disque, à la couleur de l'onglet (currentColor) comme les icônes ; le CSS en fait un contour quand
 * l'onglet est fermé, une silhouette pleine aux yeux découpés quand il est ouvert, comme une icône normale ou remplie.
 * @param {{ id: string }} space
 */
export const spaceGlyph = space => blobatar(space.id, { background: false, palette: { head: 'currentColor', eye: 'currentColor' } });
