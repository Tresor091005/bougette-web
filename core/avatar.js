// L'avatar d'un espace (D19, 2026-11-19, avec l'utilisateur) : une petite tête blobatar (licence MIT, src/vendor/blobatar),
// toujours la même pour un espace, calculée depuis son identifiant : elle ne change pas quand on le renomme. On reconnaît
// d'un coup d'œil dans quel espace on est (en haut de l'accueil, dans l'onglet Moi du bas, en haut de Moi, dans la liste des espaces).
import { blobatar } from '../vendor/blobatar/blob.js';

// seed (D21) : la même tête sur tous les appareils du compte Google (celle de l'appareil d'où l'espace est parti).
/** Le SVG de la tête d'un espace (sa taille vient du CSS). @param {{ id: string, seed?: string }} space */
export const spaceAvatar = space => blobatar(space.seed || space.id, { background: 'circle' });
/** La même tête sans son disque, en couleur (l'onglet Moi du bas, 2026-11-21 : rien autour). @param {{ id: string, seed?: string }} space */
export const spaceHead = space => blobatar(space.seed || space.id, { background: false });

