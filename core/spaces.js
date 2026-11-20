// Espaces de données (D19, 2026-11-17) : plusieurs espaces sur un téléphone, chacun avec sa base, ses copies (D15), ses
// réglages et ses petites préférences, qui ne se mélangent jamais. Le premier espace garde les noms d'avant (bougette.db,
// bougette-copies.db, le préfixe « cauri: ») : rien n'est converti. La liste des espaces vit dans localStorage, hors de
// tout espace. Changer d'espace rouvre l'app (la session est ouverte une fois, au démarrage).

const KEY = 'bougette:spaces';
export const MAIN = 'main';
export const DEMO = 'demo';
const NAME_MAX = 30;

/** @typedef {{ id: string, name: string }} Space */
/** @typedef {{ current: string, list: Space[] }} Registry */

/** @returns {Registry} */
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.list) && v.list.some((/** @type {Space} */ s) => s.id === MAIN)) return v;
  } catch (e) { /* stockage indisponible : le premier espace seul */ }
  return { current: MAIN, list: [{ id: MAIN, name: 'Mon espace' }] };
}
/** @param {Registry} v */
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* rien à faire de plus : l'espace reste celui d'avant */ }
}

/** Tous les espaces, le premier en tête. */
export const spaces = () => load().list;
/** L'espace ouvert. @returns {Space} */
export function currentSpace() {
  const v = load();
  return v.list.find(s => s.id === v.current) || v.list[0];
}
export const isMain = () => currentSpace().id === MAIN;
export const isDemo = () => currentSpace().id === DEMO;

/**
 * Noms de stockage d'un espace : base, copies (fichier sur le téléphone, IndexedDB dans le navigateur), préfixe des réglages.
 * @param {string} id
 */
export function storageOf(id) {
  if (id === MAIN) return { db: 'sqlite:bougette.db', copies: 'sqlite:bougette-copies.db', idb: 'cauri', idbCopies: 'bougette-copies', prefix: 'cauri:' };
  return { db: `sqlite:bougette-${id}.db`, copies: `sqlite:bougette-copies-${id}.db`, idb: `cauri-${id}`, idbCopies: `bougette-copies-${id}`, prefix: `cauri:${id}:` };
}
export const currentStorage = () => storageOf(currentSpace().id);

/** @param {string} name @param {string|null} [except] id à ne pas compter (renommage) */
function cleanName(name, except = null) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!n) throw new Error('Donne un nom à l’espace.');
  if (load().list.some(s => s.id !== except && s.name.toLowerCase() === n.toLowerCase())) throw new Error('Un espace porte déjà ce nom.');
  return n;
}

/** Nouvel espace (pas encore ouvert). @param {string} name @returns {Space} */
export function addSpace(name) {
  const v = load();
  const s = { id: 'e' + Date.now().toString(36), name: cleanName(name) };
  v.list.push(s);
  save(v);
  return s;
}
/** L'espace Démo, créé au besoin. @returns {Space} */
export function demoSpace() {
  const v = load();
  let s = v.list.find(x => x.id === DEMO);
  if (!s) { s = { id: DEMO, name: 'Démo' }; v.list.push(s); save(v); }
  return s;
}
/** @param {string} id @param {string} name */
export function renameSpace(id, name) {
  const v = load();
  const s = v.list.find(x => x.id === id);
  if (!s) throw new Error('Espace introuvable.');
  s.name = cleanName(name, id);
  save(v);
}
/** Ouvre un espace au prochain démarrage (l'appelant rouvre l'app). @param {string} id */
export function chooseSpace(id) {
  const v = load();
  if (!v.list.some(s => s.id === id)) throw new Error('Espace introuvable.');
  v.current = id;
  save(v);
}
/** Retire un espace de la liste (ni le premier, ni l'ouvert) ; ses fichiers restent sur le téléphone. @param {string} id */
export function removeSpace(id) {
  const v = load();
  if (id === MAIN || id === v.current) throw new Error('Cet espace ne peut pas être supprimé.');
  v.list = v.list.filter(s => s.id !== id);
  save(v);
}

/** Rouvre l'app sur l'espace choisi, à l'accueil (une action à faire au démarrage peut être passée). @param {string} [then] */
export function reopen(then = '') {
  try { if (then) sessionStorage.setItem('bougette:then', then); } catch (e) { /* sans action */ }
  location.hash = '#/';
  location.reload();
}
/** L'action laissée par reopen, lue une fois. */
export function takeThen() {
  try { const t = sessionStorage.getItem('bougette:then'); sessionStorage.removeItem('bougette:then'); return t || ''; } catch (e) { return ''; }
}
