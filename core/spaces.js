// Espaces de données (D19, 2026-11-17) : plusieurs espaces sur un téléphone, chacun avec sa base, ses copies (D15), ses
// réglages et ses petites préférences, qui ne se mélangent jamais. Le premier espace garde les noms d'avant (bougette.db,
// bougette-copies.db, le préfixe « cauri: ») : rien n'est converti. La liste des espaces vit dans localStorage, hors de
// tout espace. Changer d'espace se fait sur place (2026-11-22) : la session de l'espace d'avant se referme, celle du
// nouveau s'ouvre, sans recharger la page.
// Archiver (2026-11-21, avec l'utilisateur) : un espace archivé sort de la liste principale, garde ses fichiers, ses
// copies et son compte Google, et se rouvre à tout moment. L'espace ouvert ne s'archive pas directement : seulement par
// « Repartir de zéro », qui ouvre un nouvel espace vide et archive l'ancien d'un coup. Il reste donc toujours un espace
// ouvert. Archiver ne touche qu'à ce téléphone : un espace archivé reste sur le compte Google (D21) et chez les autres
// appareils ; seul l'espace ouvert se synchronise, il attend donc d'être rouvert. Une liste d'avant (sans « archived »)
// se lit telle quelle : aucun espace n'y est archivé.

const KEY = 'bougette:spaces';
export const MAIN = 'main';
export const DEMO = 'demo';
const NAME_MAX = 30;

/** @typedef {{ id: string, name: string, cid?: string, seed?: string, nameAt?: number, cids?: Record<string, string>, owner?: string, archived?: string }} Space cid, seed, nameAt, cids : l'espace sur le compte Google lié (D21), et sur chaque compte déjà lié ; owner : le compte auquel il est attaché ; archived : date de l'archivage (ISO) */
/** @typedef {{ current: string, list: Space[], gone?: string[] }} Registry gone : identifiants de compte des espaces retirés de la liste avant le 2026-11-21 (la synchro ne les rajoute pas) */

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

/** Tous les espaces, archivés compris, le premier en tête (la synchro les connaît tous). */
export const spaces = () => load().list;
/** Les espaces non archivés (la liste principale). */
export const openSpaces = () => load().list.filter(s => !s.archived);
/** Les espaces archivés, le plus récemment archivé d'abord. */
export const archivedSpaces = () => load().list.filter(s => s.archived).sort((a, b) => String(b.archived).localeCompare(String(a.archived)));
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
/** L'espace Démo, créé au besoin (sorti des archivés s'il y était). @returns {Space} */
export function demoSpace() {
  const v = load();
  let s = v.list.find(x => x.id === DEMO);
  if (!s) { s = { id: DEMO, name: 'Démo' }; v.list.push(s); save(v); }
  else if (s.archived) { delete s.archived; save(v); }
  return s;
}
/**
 * Un nom libre pour un nouvel espace, tiré de celui de l'espace ouvert : « Mon espace » → « Mon espace 2 »,
 * « Mon espace 2 » → « Mon espace 3 » (depuis la Démo : « Mon espace 2 »…).
 */
export function nextSpaceName() {
  const v = load();
  const base = ((v.current !== DEMO && v.list.find(s => s.id === v.current)?.name) || 'Mon espace').replace(/\s+\d+$/, '').slice(0, NAME_MAX - 4) || 'Mon espace';
  const used = new Set(v.list.map(s => s.name.toLowerCase()));
  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
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
 * renommage ou un archivage faits entre-temps restent) : l'identifiant de compte de l'espace synchronisé, les espaces
 * du compte ajoutés ici, les noms changés ailleurs plus récemment.
 * @param {{ email: string, me: Space, added: Space[], renamed: Space[] }} o
 */
export function applyCloud({ email, me, added, renamed }) {
  const v = load();
  const newer = (/** @type {Space} */ s, /** @type {Space} */ n) => (n.nameAt || 0) > (s.nameAt || 0) && n.name !== s.name;
  const cur = v.list.find(s => s.id === me.id);
  if (cur) {
    // attaché au premier compte qui le reçoit (ou dont il reprend l'espace) : il ne part sur aucun autre sans preuve
    if (me.cid) { cur.cid = me.cid; cur.cids = { ...(cur.cids || {}), [email]: me.cid }; if (!cur.owner) cur.owner = email.toLowerCase(); }
    if (me.seed) cur.seed = me.seed;
    if (newer(cur, me)) { cur.name = me.name; cur.nameAt = me.nameAt; }
  }
  for (const n of renamed) { const s = v.list.find(x => x.id === n.id); if (s && newer(s, n)) { s.name = n.name; s.nameAt = n.nameAt; } }
  for (const n of added) {
    if (!n.cid || v.list.some(s => s.cid === n.cid) || (v.gone || []).includes(n.cid)) continue;
    v.list.push({ id: n.id, name: n.name, cid: n.cid, seed: n.seed, nameAt: n.nameAt, cids: { [email]: n.cid }, owner: email.toLowerCase() });
  }
  save(v);
}
/** Le compte lié change : chaque espace reprend l'identifiant qu'il avait sur ce compte (s'il y était déjà). @param {string} email */
export function useAccount(email) {
  const v = load();
  v.list = v.list.map(({ cid, ...s }) => { const c = s.cids?.[email]; return c ? { ...s, cid: c } : s; });
  save(v);
}
/**
 * À la liaison d'un compte (et à chaque ouverture tant qu'il est lié) : chaque espace sans compte attaché (sauf la Démo)
 * est attaché à celui-ci. Un espace attaché à un autre compte le reste, pour de bon (2026-11-20 et 2026-11-21, avec
 * l'utilisateur : délier puis lier un autre compte ne doit pas suffire à envoyer ses données ailleurs ; pas de transfert).
 * @param {string} email
 */
export function claimSpaces(email) {
  const v = load();
  let changed = false;
  // un espace qui a déjà été sur un compte (avant le rattachement) reste à ce compte-là
  for (const s of v.list) if (!s.owner && s.id !== DEMO) { s.owner = (Object.keys(s.cids || {})[0] || email).toLowerCase(); changed = true; }
  if (changed) save(v);
}
/** Les espaces retirés de la liste sur ce téléphone avant le 2026-11-21 (leur identifiant de compte) : la synchro ne les rajoute pas. */
export const goneCids = () => new Set(load().gone || []);

/** Choisit l'espace à ouvrir (l'appelant rouvre l'app dessus : reopen). @param {string} id */
export function chooseSpace(id) {
  const v = load();
  if (!v.list.some(s => s.id === id)) throw new Error('Espace introuvable.');
  v.current = id;
  save(v);
}
/**
 * Archive un espace : il sort de la liste principale, rien n'est effacé. Pas l'espace ouvert (on en ouvre un autre
 * d'abord, ou l'on repart de zéro), et jamais le dernier non archivé.
 * @param {string} id @param {Date} [now]
 */
export function archiveSpace(id, now = new Date()) {
  const v = load();
  const s = v.list.find(x => x.id === id);
  if (!s) throw new Error('Espace introuvable.');
  if (s.archived) return;
  if (id === v.current) throw new Error('Ouvre un autre espace avant d’archiver celui-ci.');
  if (!v.list.some(x => x.id !== id && !x.archived)) throw new Error('Il faut garder au moins un espace.');
  s.archived = now.toISOString();
  save(v);
}
/** Rouvrir un espace archivé : il revient dans la liste principale et devient l'espace ouvert (l'appelant rouvre l'app). @param {string} id */
export function reopenSpace(id) {
  const v = load();
  const s = v.list.find(x => x.id === id);
  if (!s) throw new Error('Espace introuvable.');
  delete s.archived;
  v.current = id;
  save(v);
}
/**
 * Repartir de zéro : un nouvel espace vide devient l'espace ouvert, et celui d'avant est archivé (rien n'est effacé),
 * d'un seul coup. L'appelant rouvre l'app, qui commence par l'accueil guidé.
 * @param {string} name @param {Date} [now] @returns {Space}
 */
export function startOver(name, now = new Date()) {
  const v = load();
  const s = { id: 'e' + now.getTime().toString(36), name: cleanName(name) };
  const cur = v.list.find(x => x.id === v.current);
  if (cur) cur.archived = now.toISOString();
  v.list.push(s);
  v.current = s.id;
  save(v);
  return s;
}

/** @type {((then: string) => Promise<void>)|null} */
let inPlace = null;
/** @type {Promise<void>|null} */
let opening = null;
/** L'app sait passer d'un espace à l'autre sur place (core/app.js). @param {(then: string) => Promise<void>} fn */
export function reopenWith(fn) { inPlace = fn; }
/**
 * Rouvre l'app sur l'espace choisi, à l'accueil (une action à faire à l'ouverture peut être passée : 'demo'), sur place.
 * from : la feuille d'où l'on vient, qui monte jusqu'à devenir l'écran d'ouverture. Si le passage sur place échoue, la
 * page se recharge sur l'espace choisi (l'action passe par sessionStorage, takeThen).
 * @param {string} [then] @param {{ from?: Element|null }} [o]
 */
export function reopen(then = '', { from = null } = {}) {
  if (opening) return opening; // déjà en train de changer, sous l'écran d'ouverture (rien ne se touche) : le même passage
  // la tête du nouvel espace tout de suite, par-dessus tout (feuilles comprises), le temps d'ouvrir ses données
  opening = import('./splash.js').then(S => S.showSplash({ from })).catch(() => {})
    .then(() => { if (!inPlace) throw new Error('pas encore prête'); return inPlace(then); })
    .catch(e => {
      console.error('Changement d’espace sur place impossible, rechargement', e);
      try { if (then) sessionStorage.setItem('bougette:then', then); } catch (e2) { /* sans action */ }
      location.hash = '#/';
      location.reload();
      return new Promise(() => {}); // la page part
    })
    .finally(() => { opening = null; });
  return opening;
}
/** L'action laissée par reopen, lue une fois. */
export function takeThen() {
  try { const t = sessionStorage.getItem('bougette:then'); sessionStorage.removeItem('bougette:then'); return t || ''; } catch (e) { return ''; }
}
