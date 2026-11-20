// Copies automatiques du journal (ROADMAP 1b, 2026-11-09) : chaque jour au plus, à l'ouverture de l'app, une copie
// vérifiée du journal est gardée sur le téléphone, dans un stockage À PART de la base (une base abîmée n'emporte pas
// ses copies), un par espace (D19). Les 5 plus récentes sont gardées (3 jusqu'au 2026-11-17) ; une 6e remplace la plus
// vieille. Copies de sécurité (D15, 2026-11-17) : juste avant « Tout effacer » et « Restaurer », 5 au plus, à part. Avant chaque copie, l'intégrité de la
// base est contrôlée (chaîne d'empreintes, partie double, soldes, projections = rejeu) ; si elle est atteinte, on ne
// copie pas (les copies saines restent) et l'appelant prévient l'utilisateur. Chaque copie est relue et rejouée : elle
// doit redonner exactement l'état de l'app (même empreinte d'état).
// Ces copies protègent d'une base abîmée ou d'une fausse manœuvre, pas de la perte du téléphone : pour ça, la sauvegarde
// hors du téléphone (partage du même fichier).
import { parseJsonl } from './exchange.js';
import { replayStored } from '../domain/engine.js';
import { stateHash } from '../domain/projection.js';

/** @typedef {{ id: string, at: string, events: number, ops: number, state: string, bytes: number, text: string }} Copy */
/** @typedef {{ list: () => Promise<Copy[]>, put: (c: Copy) => Promise<void>, remove: (id: string) => Promise<void> }} CopyStore */

export const KEEP = 5;
/** Copies de sécurité gardées (avant « Tout effacer », « Restaurer »). */
export const KEEP_SAFETY = 5;
/** Une copie de sécurité : son id commence par « safe- », suivi de ce qui l'a déclenchée. @param {{ id: string }} c */
export const isSafety = c => c.id.startsWith('safe-');
/** Ce qui a déclenché une copie de sécurité (« reset », « restore »), ou null. @param {{ id: string }} c */
export const safetyReason = c => (isSafety(c) ? c.id.split('-')[1] || null : null);
export const MIN_HOURS = 24;

/**
 * Relit un journal (texte d'une copie ou d'un fichier) : chaîne d'empreintes, rejeu, empreinte d'état annoncée.
 * Rejette si le fichier ne redonne pas exactement les données annoncées.
 * @param {string} text
 * @param {{ schema?: number }} [opts]
 * @returns {Promise<{ events: number, ops: number, state: string, last: string|null }>}
 */
export async function checkJournalText(text, opts = {}) {
  const { header, events } = await parseJsonl(text, opts);
  const s = replayStored(events);
  const h = await stateHash(s);
  if (h !== header.state) throw new Error('Le fichier ne redonne pas les données annoncées (empreinte d’état différente).');
  let ops = 0;
  for (const e of s.entries.values()) if (e.status !== 'void' && ['expense', 'income', 'transfer'].includes(e.kind)) ops++;
  return { events: events.length, ops, state: h, last: events.length ? events[events.length - 1].at : null };
}

/**
 * Copie du jour, si elle est due.
 * - 'recent' : une copie a moins de MIN_HOURS heures ; 'same' : rien n'a changé depuis la dernière copie ;
 * - 'broken' : l'intégrité de la base est atteinte (rien n'est copié, les copies saines restent) ;
 * - 'done' : nouvelle copie gardée, les plus vieilles au-delà de KEEP retirées.
 * @param {{ session: any, store: CopyStore, now?: Date, force?: boolean }} o
 */
export async function autoCopy({ session, store, now = new Date(), force = false }) {
  const list = (await store.list()).filter(c => !isSafety(c)); // les copies de sécurité ne comptent pas ici
  const last = list[0] || null;
  if (!force && last && now.getTime() - Date.parse(last.at) < MIN_HOURS * 3600e3) return { status: 'recent', last };
  const checks = await session.verify();
  const bad = checks.filter((/** @type {{ ok: boolean }} */ c) => !c.ok);
  if (bad.length) return { status: 'broken', problems: bad, last };
  const current = await session.stateHash();
  if (last && last.state === current) return { status: 'same', last };
  const text = await session.exportJournal();
  let info;
  try { info = await checkJournalText(text); } catch (e) { return { status: 'broken', problems: [{ name: 'Copie', ok: false, detail: /** @type {Error} */ (e).message }], last }; }
  if (info.state !== current) return { status: 'broken', problems: [{ name: 'Copie', ok: false, detail: 'La copie ne redonne pas l’état de l’app.' }], last };
  /** @type {Copy} */
  const copy = { id: now.toISOString(), at: now.toISOString(), events: info.events, ops: info.ops, state: info.state, bytes: text.length, text };
  await store.put(copy);
  for (const old of [copy, ...list].slice(KEEP)) await store.remove(old.id);
  return { status: 'done', copy };
}

/**
 * Copie de sécurité de l'état présent (D15, 2026-11-17), juste avant une action qui remplace tout (reason : « reset »,
 * « restore »). Vérifiée comme une copie du jour ; rien si l'état est celui de la dernière copie de sécurité ; les
 * KEEP_SAFETY plus récentes restent, sans jamais toucher aux copies du jour. Rejette si la copie est impossible ou fausse
 * (l'appelant n'agit alors pas).
 * @param {{ session: any, store: CopyStore, reason: string, now?: Date }} o
 */
export async function safetyCopy({ session, store, reason, now = new Date() }) {
  const list = (await store.list()).filter(isSafety);
  const current = await session.stateHash();
  if (list[0] && list[0].state === current) return { status: 'same', copy: list[0] };
  const text = await session.exportJournal();
  const info = await checkJournalText(text);
  if (info.state !== current) throw new Error('La copie de sécurité ne redonne pas l’état de l’app.');
  /** @type {Copy} */
  const copy = { id: `safe-${reason}-${now.toISOString()}`, at: now.toISOString(), events: info.events, ops: info.ops, state: info.state, bytes: text.length, text };
  await store.put(copy);
  for (const old of [copy, ...list].slice(KEEP_SAFETY)) await store.remove(old.id);
  return { status: 'done', copy };
}

/** Copies en mémoire (tests, ou stockage indisponible). @returns {CopyStore} */
export function memoryStore() {
  /** @type {Map<string, Copy>} */
  const m = new Map();
  return {
    list: async () => [...m.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    put: async c => { m.set(c.id, c); },
    remove: async id => { m.delete(id); },
  };
}

/** Navigateur (développement) : une base IndexedDB à part, « bougette-copies » (une par espace, D19). @param {string} name @returns {CopyStore} */
function idbStore(name) {
  /** @type {Promise<IDBDatabase>} */
  const db = new Promise((ok, ko) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  /** @param {IDBTransactionMode} mode @param {(s: IDBObjectStore) => IDBRequest} fn */
  const req = async (mode, fn) => {
    const d = await db;
    return new Promise((ok, ko) => {
      const r = fn(d.transaction('copies', mode).objectStore('copies'));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  };
  return {
    list: async () => /** @type {Copy[]} */ (await req('readonly', s => s.getAll())).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
    put: async c => { await req('readwrite', s => s.put(c)); },
    remove: async id => { await req('readwrite', s => s.delete(id)); },
  };
}

/** Téléphone : un fichier SQLite à part, bougette-copies.db (même plugin que la base ; un par espace, D19). @param {string} URL_ @returns {Promise<CopyStore>} */
async function tauriStore(URL_) {
  const { literal } = await import('./db-tauri.js');
  /** @param {string} cmd @param {Record<string, any>} args */
  const invoke = (cmd, args) => /** @type {any} */ (globalThis).__TAURI_INTERNALS__.invoke(cmd, args);
  await invoke('plugin:sql|load', { db: URL_ });
  /** @param {string} query */
  const exec = query => invoke('plugin:sql|execute', { db: URL_, query, values: [] });
  /** @param {string} query */
  const select = query => invoke('plugin:sql|select', { db: URL_, query, values: [] });
  await exec('CREATE TABLE IF NOT EXISTS copies (id TEXT PRIMARY KEY, at TEXT NOT NULL, events INTEGER NOT NULL, ops INTEGER NOT NULL, state TEXT NOT NULL, bytes INTEGER NOT NULL, text TEXT NOT NULL)');
  return {
    list: async () => (await select('SELECT id, at, events, ops, state, bytes, text FROM copies ORDER BY at DESC')).map((/** @type {any} */ r) => ({ ...r, events: Number(r.events), ops: Number(r.ops), bytes: Number(r.bytes) })),
    put: async c => { await exec(`INSERT OR REPLACE INTO copies (id, at, events, ops, state, bytes, text) VALUES (${[c.id, c.at, c.events, c.ops, c.state, c.bytes, c.text].map(literal).join(', ')})`); },
    remove: async id => { await exec(`DELETE FROM copies WHERE id = ${literal(id)}`); },
  };
}

/**
 * Le stockage des copies de cette plateforme (en mémoire s'il n'y en a pas), pour l'espace donné (D19).
 * @param {{ copies?: string, idbCopies?: string }} [names]
 * @returns {Promise<CopyStore>}
 */
export async function openCopyStore({ copies = 'sqlite:bougette-copies.db', idbCopies = 'bougette-copies' } = {}) {
  const g = /** @type {any} */ (globalThis);
  try {
    if (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === 'function') return await tauriStore(copies);
    if (typeof indexedDB !== 'undefined') return idbStore(idbCopies);
  } catch (e) { console.error('Stockage des copies indisponible', e); }
  return memoryStore();
}
