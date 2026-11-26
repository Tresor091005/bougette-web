// L'avatar d'un espace (D19, 2026-11-19, avec l'utilisateur) : une petite tête blobatar (licence MIT, src/vendor/blobatar),
// toujours la même pour un espace, dessinée depuis sa graine (seed) : un uuid v4 tiré au hasard à sa création (2026-11-26,
// avec l'utilisateur ; avant, son identifiant — « main » pour le premier espace de tout le monde, donc la même tête
// partout). Elle ne change pas quand on le renomme. On reconnaît
// d'un coup d'œil dans quel espace on est (en haut de l'accueil, dans l'onglet Moi du bas, en haut de Moi, dans la liste des espaces).
import { blobatar } from '../vendor/blobatar/blob.js';

// seed (D21) : la même tête sur tous les appareils du compte Google (la liste du compte la porte). Sans graine (ne devrait
// plus arriver : core/spaces.js en donne une à chaque espace), l'identifiant sert encore.
/** Le SVG de la tête d'un espace (sa taille vient du CSS). @param {{ id: string, seed?: string }} space */
export const spaceAvatar = space => blobatar(space.seed || space.id, { background: 'circle' });
/** La même tête sans son disque, en couleur (l'onglet Moi du bas, 2026-11-21 : rien autour). @param {{ id: string, seed?: string }} space */
export const spaceHead = space => blobatar(space.seed || space.id, { background: false });

