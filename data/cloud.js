// Synchronisation avec le Drive (D21) : l'espace ouvert et la liste des espaces du compte. Sans écran ni stockage du
// téléphone ici (testable avec un faux Drive) : src/core/cloud.js branche ceci sur l'app.
//
// Sur le Drive : « bougette-spaces.json » = { v: 1, spaces: [{ cid, name, nameAt, seed, primary, removed }] } (cid :
// l'identifiant de l'espace sur le compte, le même sur tous les appareils ; seed : ce qui dessine sa tête, pour qu'elle
// soit la même partout ; primary : l'espace qu'un téléphone neuf prend d'abord ; removed : supprimé de la liste sur un
// appareil), et un « space-<cid>.bgj » par espace : son journal, avec dans appProperties sa tête (seq, head) et sa lignée
// (epoch : change quand un appareil remplace exprès le journal, par Restaurer ou Tout effacer). Le journal remplacé reste
// à côté (« space-<cid>.avant.bgj »).
// Sur le téléphone, par espace : le repère de synchro (session.getSync) { cid, seq, hash, epoch, force } — le dernier point
// où le téléphone et le Drive étaient pareils, la lignée d'alors, et force (Restaurer, Tout effacer faits ici).
// Un espace n'entre dans la liste du compte qu'avec son journal, et jamais vierge (rien que l'installation).
import { unsealSync, sealSync } from './seal.js';
import { parseJsonl, ImportError } from './exchange.js';
import { replayStored } from '../domain/engine.js';
import { stateHash } from '../domain/projection.js';
import { isPristine } from './sync.js';

/** @typedef {import('./drive.js').Drive} Drive */
/** @typedef {import('./drive.js').DriveFile} DriveFile */
/** @typedef {import('../domain/events.js').StoredEvent} StoredEvent */
/** @typedef {{ cid: string, name: string, nameAt: number, seed: string, primary?: boolean, removed?: boolean }} CloudSpace */
/** @typedef {{ v: 1, spaces: CloudSpace[] }} CloudIndex */
/** @typedef {{ id: string, name: string, cid?: string, seed?: string, nameAt?: number }} LocalSpace */
/** @typedef {{ cid?: string, seq?: number, hash?: string, epoch?: string, force?: string }} SyncMark force : date du geste Restaurer / Tout effacer */

export const INDEX_FILE = 'bougette-spaces.json';
/** @param {string} cid */
export const spaceFile = cid => `space-${cid}.bgj`;
/** @param {string} cid */
export const asideFile = cid => `space-${cid}.avant.bgj`;
const head = (/** @type {StoredEvent[]} */ ev) => (ev.length ? ev[ev.length - 1].hash : '');

/** @param {any} s @returns {CloudSpace|null} */
function cleanEntry(s) {
  if (!s || typeof s.cid !== 'string' || typeof s.name !== 'string') return null;
  return { cid: s.cid, name: s.name, nameAt: Number(s.nameAt) || 0, seed: String(s.seed || s.cid), ...(s.primary ? { primary: true } : {}), ...(s.removed ? { removed: true } : {}) };
}

/**
 * La liste du compte. Pas de fichier : liste vide. Un fichier qui ne se lit pas (réseau, Google qui répond mal, contenu
 * abîmé) arrête la synchro : on n'écrit jamais une liste par-dessus une liste qu'on n'a pas pu lire. Deux fichiers (deux
 * appareils l'ont créé en même temps) : réunis, le plus ancien gardé.
 * @param {Drive} drive @param {DriveFile[]} files
 * @returns {Promise<{ file: DriveFile|null, index: CloudIndex, extra: DriveFile[] }>}
 */
export async function readIndex(drive, files) {
  const all = files.filter(f => f.name === INDEX_FILE).sort((a, b) => (a.modifiedTime < b.modifiedTime ? -1 : 1));
  if (!all.length) return { file: null, index: { v: 1, spaces: [] }, extra: [] };
  /** @type {CloudSpace[]} */
  const spaces = [];
  for (const f of all) {
    let o;
    try { o = JSON.parse(await drive.read(f.id)); } catch (e) { throw new ImportError('La liste des espaces du compte ne se lit pas : synchronisation remise à plus tard.'); }
    for (const s of Array.isArray(o?.spaces) ? o.spaces : []) {
      const c = cleanEntry(s);
      if (!c) continue;
      const have = spaces.find(x => x.cid === c.cid);
      if (!have) spaces.push(c);
      else {
        if (c.nameAt > have.nameAt) { have.name = c.name; have.nameAt = c.nameAt; }
        if (c.removed) have.removed = true;
      }
    }
  }
  // un seul espace principal
  let primary = false;
  for (const s of spaces) { if (s.primary && !primary && !s.removed) primary = true; else delete s.primary; }
  return { file: all[0], index: { v: 1, spaces }, extra: all.slice(1) };
}
/** @param {Drive} drive @param {DriveFile|null} file @param {CloudIndex} index */
export async function writeIndex(drive, file, index) {
  const text = JSON.stringify(index);
  return file ? drive.update(file.id, text) : drive.create(INDEX_FILE, text);
}

/** Un nom libre parmi d'autres (« Mon espace (2) »). @param {string} name @param {string[]} taken */
export function freeName(name, taken) {
  const low = new Set(taken.map(t => t.toLowerCase()));
  if (!low.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) { const n = `${name.slice(0, 25)} (${i})`; if (!low.has(n.toLowerCase())) return n; }
}

/**
 * L'identifiant de compte de l'espace ouvert, la première fois qu'il se synchronise avec ce compte : un premier espace
 * encore vierge reprend l'espace principal du compte ; sinon l'espace devient un nouvel espace du compte (rien ne se
 * mélange, rien ne se perd). null : rien à faire encore (vierge, et rien à reprendre).
 * @param {{ space: LocalSpace, isMainSpace: boolean, pristine: boolean, index: CloudIndex, used: Set<string>, newCid: () => string }} o
 * @returns {{ cid: string, seed: string, name: string, adopt: boolean }|null}
 */
export function chooseCid({ space, isMainSpace, pristine, index, used, newCid }) {
  const primary = index.spaces.find(s => s.primary && !s.removed && !used.has(s.cid));
  if (isMainSpace && pristine && primary) return { cid: primary.cid, seed: primary.seed, name: primary.name, adopt: true };
  if (pristine) return null;
  return { cid: newCid(), seed: space.seed || space.id, name: space.name, adopt: false };
}

/**
 * La liste du compte et celle du téléphone se rejoignent : un espace du compte absent du téléphone y est ajouté (il se
 * remplira à sa première ouverture), sauf s'il a été supprimé de la liste (ici ou ailleurs) ; un nom changé plus
 * récemment d'un côté passe de l'autre.
 * @param {LocalSpace[]} local
 * @param {CloudIndex} index
 * @param {() => string} newId identifiant local d'un espace ajouté
 * @param {Set<string>} [gone] identifiants de compte des espaces supprimés de la liste sur ce téléphone
 * @returns {{ local: LocalSpace[], index: CloudIndex, localChanged: boolean, indexChanged: boolean, added: LocalSpace[], renamed: LocalSpace[] }}
 */
export function mergeSpaces(local, index, newId, gone = new Set()) {
  const loc = local.map(s => ({ ...s }));
  const idx = { v: /** @type {1} */ (1), spaces: index.spaces.map(s => ({ ...s })) };
  let localChanged = false, indexChanged = false;
  /** @type {LocalSpace[]} */
  const added = [];
  /** @type {LocalSpace[]} */
  const renamed = [];
  for (const c of idx.spaces) {
    if (gone.has(c.cid) && !c.removed) { c.removed = true; delete c.primary; indexChanged = true; }
    const l = loc.find(s => s.cid === c.cid);
    if (!l) {
      if (c.removed) continue;
      const name = freeName(c.name, loc.map(s => s.name));
      const s = { id: newId(), name, cid: c.cid, seed: c.seed, nameAt: c.nameAt };
      loc.push(s);
      added.push(s);
      localChanged = true;
      continue;
    }
    if ((l.nameAt || 0) > c.nameAt && l.name !== c.name) { c.name = l.name; c.nameAt = l.nameAt || 0; indexChanged = true; }
    else if (c.nameAt > (l.nameAt || 0) && l.name !== c.name) {
      l.name = freeName(c.name, loc.filter(s => s !== l).map(s => s.name));
      l.nameAt = c.nameAt;
      renamed.push(l);
      localChanged = true;
    }
  }
  return { local: loc, index: idx, localChanged, indexChanged, added, renamed };
}

/**
 * Lit et vérifie un journal du Drive : déchiffré, chaîne d'empreintes, rejeu, empreinte d'état annoncée.
 * @param {string} text @param {{ schema?: number }} [opts]
 */
export async function readRemoteJournal(text, opts = {}) {
  const plain = await unsealSync(text);
  const { header, events } = await parseJsonl(plain, opts);
  let s;
  try { s = replayStored(events); } catch (e) { throw new ImportError('Le journal du Drive ne se rejoue pas : ' + /** @type {Error} */ (e).message); }
  if (await stateHash(s) !== header.state) throw new ImportError('Le journal du Drive ne redonne pas les données annoncées.');
  return events;
}

/**
 * @typedef {{
 *   events: () => Promise<StoredEvent[]>,
 *   merge: (r: StoredEvent[]|null, o?: { since?: { seq: number, hash: string }|null, safety?: ((t: string) => Promise<any>)|null }) => Promise<any>,
 *   journalText: (e: StoredEvent[]) => Promise<string>,
 *   getSync: () => Promise<SyncMark|null>,
 *   setSync: (v: SyncMark|null) => Promise<any>,
 *   clearForce: () => Promise<any>,
 * }} SyncSession
 */

/**
 * Synchronise le journal d'un espace avec son fichier du Drive. Renvoie kind :
 * same | push | pull | adopt | rebase | replace (ce téléphone remplace le journal du Drive : Restaurer, Tout effacer) |
 * reset (le journal du Drive a été remplacé ailleurs : on le prend, les changements faits ici depuis sont refaits
 * par-dessus) | fork (aucun début commun : rien n'est mélangé, l'appelant garde les deux à part) | busy (un autre appareil
 * a écrit pendant ce temps : recommencer).
 * @param {{ drive: Drive, files: DriveFile[], cid: string, session: SyncSession, safety: (text: string) => Promise<any>, schema?: number, newEpoch: () => string, linkedAt?: string }} o
 * @returns {Promise<{ kind: string, pushed: boolean, skipped: { event: StoredEvent, reason: string }[], events: number }>}
 */
export async function syncJournal({ drive, files, cid, session, safety, schema, newEpoch, linkedAt = '' }) {
  const file = files.find(f => f.name === spaceFile(cid)) || null;
  const mark = await session.getSync();
  const p = mark && mark.cid === cid ? mark : null;
  // Restaurer / Tout effacer ne remplace le Drive que pour l'espace et le compte d'alors, fait pendant la liaison
  const force = !!(p && mark?.force && mark.force >= linkedAt);
  if (mark?.force && !force) await session.clearForce();
  const local = await session.events();
  const props = file?.appProperties || {};
  const epoch = props.epoch || '';
  /** @param {StoredEvent[]} ev @param {string} ep */
  const remember = (ev, ep) => session.setSync({ cid, seq: ev.length, hash: head(ev), epoch: ep });
  /** @param {StoredEvent[]} ev @param {string} ep */
  const upload = async (ev, ep) => {
    const text = await sealSync(await session.journalText(ev));
    const pr = { seq: String(ev.length), head: head(ev), epoch: ep };
    return file ? drive.update(file.id, text, pr) : drive.create(spaceFile(cid), text, pr);
  };
  // un autre appareil a-t-il écrit depuis notre lecture ? (Google Drive n'a pas d'écriture conditionnelle : on relit la
  // tête juste avant d'écrire, la fenêtre se réduit à un aller-retour, et la suite se rattrape à la synchro d'après)
  const moved = async () => {
    if (!file) return (await drive.list()).some(f => f.name === spaceFile(cid));
    const m = await drive.meta(file.id);
    return (m.appProperties?.head || '') !== (props.head || '') || (m.appProperties?.epoch || '') !== epoch;
  };

  // Restaurer ou Tout effacer faits ici : ce journal remplace celui du Drive, qui reste à côté ; nouvelle lignée
  if (force && file) {
    const aside = files.find(f => f.name === asideFile(cid));
    const old = await drive.read(file.id);
    if (aside) await drive.update(aside.id, old); else await drive.create(asideFile(cid), old);
    const ep = newEpoch();
    await upload(local, ep);
    await remember(local, ep);
    await session.clearForce();
    return { kind: 'replace', pushed: true, skipped: [], events: local.length };
  }
  if (file && !force && props.head === head(local) && Number(props.seq) === local.length) {
    if (!p || p.hash !== head(local) || p.epoch !== epoch) await remember(local, epoch);
    return { kind: 'same', pushed: false, skipped: [], events: local.length };
  }
  if (!file && isPristine(local)) {
    if (force) { await session.clearForce(); await session.setSync(null); }
    return { kind: 'same', pushed: false, skipped: [], events: local.length };
  }

  const remote = file ? await readRemoteJournal(await drive.read(file.id), { schema }) : null;
  // le journal du Drive a changé de lignée depuis notre dernière synchro : remplacé exprès sur un autre appareil
  const reset = !!(file && p && (p.epoch || '') !== epoch);
  const r = await session.merge(remote, { since: reset ? { seq: p?.seq || 0, hash: p?.hash || '' } : null, safety });
  if (r.fork) return { kind: 'fork', pushed: false, skipped: [], events: local.length };
  if (r.forced) return { kind: 'busy', pushed: false, skipped: [], events: local.length };
  const kind = reset ? 'reset' : r.plan.kind;
  /** @type {StoredEvent[]} */
  const ev = r.events;
  if (r.push) {
    if (await moved()) return { kind: 'busy', pushed: false, skipped: r.skipped || [], events: ev.length };
    const ep = epoch || newEpoch();
    await upload(ev, ep);
    await remember(ev, ep);
    if (force) await session.clearForce();
  } else await remember(ev, epoch);
  return { kind, pushed: !!r.push, skipped: r.skipped || [], events: ev.length };
}

/**
 * Une synchro complète de l'espace ouvert : la liste du compte, l'identifiant de l'espace (la première fois), son journal,
 * puis la liste remise à jour des deux côtés.
 * @param {{
 *   drive: Drive, session: SyncSession, space: LocalSpace, isMainSpace: boolean, local: LocalSpace[], gone?: Set<string>,
 *   safety: (text: string) => Promise<any>, newCid: () => string, newId: () => string, newEpoch?: () => string, schema?: number, now?: number,
 *   linkedAt?: string, onCid?: (me: LocalSpace) => void,
 * }} o
 */
export async function syncSpace({ drive, session, space, isMainSpace, local, gone = new Set(), safety, newCid, newId, newEpoch = newCid, schema, now = Date.now(), linkedAt = '', onCid = () => {} }) {
  /** @type {DriveFile[]} */
  let files = await drive.list();
  let { file: indexFile, index, extra } = await readIndex(drive, files);
  let me = { ...space };
  let list = local.map(s => (s.id === me.id ? me : s));
  let indexChanged = extra.length > 0;
  /** @type {string|null} */
  let forkedFrom = null;
  /** @type {{ kind: string, pushed: boolean, skipped: any[], events: number }} */
  let result = { kind: 'same', pushed: false, skipped: [], events: 0 };

  if (!me.cid) {
    const used = /** @type {Set<string>} */ (new Set(list.map(s => s.cid).filter(Boolean)));
    const c = chooseCid({ space: me, isMainSpace, pristine: isPristine(await session.events()), index, used, newCid });
    if (c) {
      me = { ...me, cid: c.cid, seed: c.seed, ...(c.adopt ? { name: c.name, nameAt: now } : { nameAt: me.nameAt || now }) };
      list = list.map(s => (s.id === me.id ? me : s));
      onCid(me); // gardé tout de suite : une erreur plus loin ne doit pas faire choisir un autre identifiant la fois d'après
    }
  }
  if (me.cid) {
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await syncJournal({ drive, files, cid: /** @type {string} */ (me.cid), session, safety, schema, newEpoch, linkedAt });
      if (result.kind === 'fork') {
        // aucun début commun avec le journal du compte : les deux restent, chacun son espace
        forkedFrom = /** @type {string} */ (me.cid);
        me = { ...me, cid: newCid(), seed: me.seed || me.id, nameAt: now };
        list = list.map(s => (s.id === me.id ? me : s));
        onCid(me);
        continue;
      }
      if (result.kind !== 'busy') break;
      files = await drive.list();
    }
    const cid = /** @type {string} */ (me.cid);
    // l'espace entre dans la liste du compte avec son journal
    if (result.kind !== 'busy' && !index.spaces.some(s => s.cid === cid) && (result.pushed || files.some(f => f.name === spaceFile(cid)))) {
      const name = freeName(me.name, index.spaces.filter(s => !s.removed).map(s => s.name));
      // même nom ici et sur le compte (sinon, à date égale, ils resteraient différents)
      if (name !== me.name) { me = { ...me, name, nameAt: now }; list = list.map(s => (s.id === me.id ? me : s)); }
      index.spaces.push({ cid, name, nameAt: me.nameAt || now, seed: me.seed || me.id, ...(!index.spaces.some(s => s.primary && !s.removed) && isMainSpace ? { primary: true } : {}) });
      indexChanged = true;
    }
  }
  // les autres espaces connus ici, dont le journal est sur le Drive mais que la liste a perdus (écriture concurrente)
  files = result.pushed ? await drive.list() : files;
  for (const s of list) {
    if (!s.cid || s.cid === me.cid || gone.has(s.cid) || index.spaces.some(x => x.cid === s.cid)) continue;
    if (!files.some(f => f.name === spaceFile(/** @type {string} */ (s.cid)))) continue;
    index.spaces.push({ cid: s.cid, name: freeName(s.name, index.spaces.map(x => x.name)), nameAt: s.nameAt || now, seed: s.seed || s.id });
    indexChanged = true;
  }
  const m = mergeSpaces(list, index, newId, gone);
  if (indexChanged || m.indexChanged) {
    await writeIndex(drive, indexFile, m.index);
    for (const f of extra) { try { await drive.remove(f.id); } catch (e) { /* plus tard */ } }
  }
  return { ...result, cid: me.cid || null, me, local: m.local, added: m.added, renamed: m.renamed, index: m.index, forkedFrom };
}
