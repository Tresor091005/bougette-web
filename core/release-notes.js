// Les versions importantes (2026-11-24, avec l'utilisateur) : à la publication, on dit si une version mérite d'être
// signalée (npm run release -- --important "…"). Les notes de chaque version portent, invisible sur GitHub, la dernière
// version importante publiée jusqu'à elle : « <!-- importante: 0.261124.1530 --> ». Une version ordinaire qui suit une
// importante la garde ; ainsi, qui a manqué plusieurs versions importantes l'apprend par la dernière publiée, une seule
// fois. Sans dépendance : l'app (core/update.js) et la publication (tools/release.mjs) s'en servent.

const MARK = /<!--\s*importante:\s*(v?0\.\d{6}\.\d{1,4})\s*-->/;

/** La dernière version importante que portent ces notes, ou ''. @param {string} [notes] */
export const importantSince = notes => (MARK.exec(String(notes || ''))?.[1] || '').replace(/^v/, '');

/** Les notes à montrer (sans la marque). @param {string} [notes] */
export const cleanNotes = notes => String(notes || '').replace(MARK, '').trim();

/** Les notes à publier : le texte et, s'il y en a une, la dernière version importante. @param {string} notes @param {string} since */
export const markNotes = (notes, since) => since ? `${notes.trim()}\n\n<!-- importante: ${since} -->` : notes.trim();
