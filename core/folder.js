// Copie hors de l'app (D15, 2026-11-17) : en plus des copies du jour gardées dans l'app, chaque nouvelle copie est écrite,
// chiffrée (src/data/seal.js), dans un dossier du téléphone choisi une fois (Documents/Bougette proposé). Ces fichiers
// survivent à la désinstallation ; après une réinstallation, on rechoisit le dossier et on y restaure. Un sous-dossier
// par espace (son nom, D19), les 5 dernières copies dans chacun. Le pont natif est window.BougetteFolder (FolderBridge.kt) ;
// sans lui (navigateur), rien de tout cela n'apparaît.
import { currentSpace } from './spaces.js';

export const FOLDER_KEEP = 5;
const F = () => /** @type {any} */ (globalThis).BougetteFolder;
const isCopy = (/** @type {string} */ n) => /^bougette-.*\.bougette$/.test(n);

/** Le pont natif est là (téléphone). */
export const folderAvailable = () => typeof F()?.pickFolder === 'function';
/** Nom du dossier choisi, ou "" (pas choisi, ou accès perdu après une réinstallation). */
export const folderName = () => (folderAvailable() ? String(F().folderName() || '') : '');
/** Le sous-dossier de l'espace ouvert. */
const sub = () => currentSpace().name;

/** Ouvre le sélecteur de dossier d'Android ; le nom du dossier choisi, ou "" si rien n'est choisi. @returns {Promise<string>} */
export function pickFolder() {
  return new Promise(resolve => {
    const g = /** @type {any} */ (globalThis);
    g.appFolderPicked = (/** @type {string} */ name) => { delete g.appFolderPicked; resolve(String(name || '')); };
    if (!F()?.pickFolder()) { delete g.appFolderPicked; resolve(''); }
  });
}

/** Nom d'un fichier de copie : bougette-AAAA-MM-JJ-HHMM.bougette (l'ordre des noms est l'ordre des dates). @param {Date} d */
const fileName = d => {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  // heure locale du téléphone (celle que l'on voit dans le gestionnaire de fichiers)
  return `bougette-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.bougette`;
};

/**
 * Les copies du dossier pour un espace, la plus récente d'abord.
 * @param {string} [space] nom du sous-dossier (l'espace ouvert par défaut)
 * @returns {{ name: string, size: number, modified: number }[]}
 */
export function folderCopies(space = sub()) {
  if (!folderName()) return [];
  try {
    return /** @type {{ name: string, size: number, modified: number }[]} */ (JSON.parse(F().listFiles(space)))
      .filter(f => isCopy(f.name)).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  } catch (e) { return []; }
}
/** Les sous-dossiers du dossier choisi (un par espace). @returns {string[]} */
export function folderSpaces() {
  if (!folderName()) return [];
  try { return JSON.parse(F().listDirs()); } catch (e) { return []; }
}
/**
 * Un espace renommé (2026-11-18) : son sous-dossier prend le nouveau nom, pour que ses copies restent ensemble. Rien si le
 * dossier n'est pas choisi, si l'ancien sous-dossier n'existe pas, ou si un sous-dossier porte déjà le nouveau nom.
 * @param {string} old @param {string} name
 */
export function renameFolderSpace(old, name) {
  if (!folderName() || old === name) return false;
  try { return !!F().renameDir(old, name); } catch (e) { return false; }
}
/** Le texte d'une copie du dossier ("" si introuvable). @param {string} name @param {string} [space] */
export const readFromFolder = (name, space = sub()) => String(F()?.readFile(space, name) || '');

/**
 * Écrit une copie (déjà chiffrée) dans le sous-dossier d'un espace (l'ouvert par défaut), puis ne garde que les
 * FOLDER_KEEP plus récentes. false si aucun dossier n'est choisi ou si l'écriture échoue.
 * @param {string} sealed @param {Date} [at] @param {string} [space] nom du sous-dossier
 */
export function writeToFolder(sealed, at = new Date(), space = sub()) {
  if (!folderName()) return false;
  if (!F().writeFile(space, fileName(at), sealed)) return false;
  for (const old of folderCopies(space).slice(FOLDER_KEEP)) F().deleteFile(space, old.name);
  return true;
}
