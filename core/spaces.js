// Espaces de données (D19, 2026-11-17) : plusieurs espaces sur un téléphone, chacun avec sa base, ses copies (D15), ses
// réglages et ses petites préférences, qui ne se mélangent jamais. Le premier espace garde les noms d'avant (bougette.db,
// bougette-copies.db, le préfixe « cauri: ») : rien n'est converti. La liste des espaces vit dans localStorage, hors de
// tout espace. Changer d'espace rouvre l'app (la session est ouverte une fois, au démarrage).

const KEY = 'bougette:spaces';
export const MAIN = 'main';
export const DEMO = 'demo';
const NAME_MAX = 30;

/** @typedef {{ id: string, name: string, cid?: string, seed?: string, nameAt?: number, cids?: Record<string, string> }} Space cid, seed, nameAt, cids : l'espace sur le compte Google lié (D21), et sur chaque compte déjà lié */
/** @typedef {{ current: string, list: Space[], gone?: string[] }} Registry */

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
  s.nameAt = Date.now();
  save(v);
}
/**
 * Ce que la synchro a appris (D21), appliqué sur la liste du moment (pas sur celle lue au début de la synchro : un
 * renommage ou une suppression faits entre-temps restent) : l'identifiant de compte de l'espace synchronisé, les espaces
 * du compte ajoutés ici, les noms changés ailleurs plus récemment.
 * @param {{ email: string, me: Space, added: Space[], renamed: Space[] }} o
 */
export function applyCloud({ email, me, added, renamed }) {
  const v = load();
  const newer = (/** @type {Space} */ s, /** @type {Space} */ n) => (n.nameAt || 0) > (s.nameAt || 0) && n.name !== s.name;
  const cur = v.list.find(s => s.id === me.id);
  if (cur) {
    if (me.cid) { cur.cid = me.cid; cur.cids = { ...(cur.cids || {}), [email]: me.cid }; }
    if (me.seed) cur.seed = me.seed;
    if (newer(cur, me)) { cur.name = me.name; cur.nameAt = me.nameAt; }
  }
  for (const n of renamed) { const s = v.list.find(x => x.id === n.id); if (s && newer(s, n)) { s.name = n.name; s.nameAt = n.nameAt; } }
  for (const n of added) {
    if (!n.cid || v.list.some(s => s.cid === n.cid) || (v.gone || []).includes(n.cid)) continue;
    v.list.push({ id: n.id, name: n.name, cid: n.cid, seed: n.seed, nameAt: n.nameAt, cids: { [email]: n.cid } });
  }
  save(v);
}
/** Le compte lié change : chaque espace reprend l'identifiant qu'il avait sur ce compte (s'il y était déjà). @param {string} email */
export function useAccount(email) {
  const v = load();
  v.list = v.list.map(({ cid, ...s }) => { const c = s.cids?.[email]; return c ? { ...s, cid: c } : s; });
  save(v);
}
/** Les espaces supprimés de la liste sur ce téléphone (leur identifiant de compte) : la synchro ne les rajoute pas. */
export const goneCids = () => new Set(load().gone || []);

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
  const s = v.list.find(x => x.id === id);
  // synchronisé (D21) : retiré aussi de la liste du compte à la prochaine synchro, et pas rajouté ici
  const cids = [s?.cid, ...Object.values(s?.cids || {})].filter(Boolean);
  if (cids.length) v.gone = [...new Set([...(v.gone || []), ...cids])];
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
