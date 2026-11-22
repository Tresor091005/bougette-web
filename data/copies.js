// Copies automatiques du journal (ROADMAP 1b, 2026-11-09) : chaque jour au plus, à l'ouverture de l'app, une copie
// vérifiée du journal est gardée sur le téléphone, dans un stockage À PART de la base (une base abîmée n'emporte pas
// ses copies), un par espace (D19). Les 5 plus récentes sont gardées (3 jusqu'au 2026-11-17) ; une 6e remplace la plus
// vieille. Copies de sécurité (D15, 2026-11-17) : juste avant « Restaurer » et avant de refaire ses changements par-dessus ceux d'un autre appareil (D21), 5 au plus, à part. Avant chaque copie, l'intégrité de la
// base est contrôlée (chaîne d'empreintes, partie double, soldes, projections = rejeu) ; si elle est atteinte, on ne
// copie pas (les copies saines restent) et l'appelant prévient l'utilisateur. Chaque copie est relue et rejouée : elle
// doit redonner exactement l'état de l'app (même empreinte d'état).
// Ces copies protègent d'une base abîmée ou d'une fausse manœuvre, pas de la perte du téléphone : pour ça, la synchro
// Google Drive (D21).
import { parseJsonl } from './exchange.js';
import { verifyChain } from '../domain/events.js';
import { replayStored } from '../domain/engine.js';
import { stateHash } from '../domain/projection.js';

/** @typedef {{ id: string, at: string, events: number, ops: number, state: string, bytes: number, text: string }} Copy */
/** @typedef {{ list: () => Promise<Copy[]>, put: (c: Copy) => Promise<void>, remove: (id: string) => Promise<void>, close?: () => Promise<void> }} CopyStore */

export const KEEP = 5;
/** Copies de sécurité gardées (avant « Restaurer », avant une synchronisation). */
export const KEEP_SAFETY = 5;
/** Une copie de sécurité : son id commence par « safe- », suivi de ce qui l'a déclenchée. @param {{ id: string }} c */
export const isSafety = c => c.id.startsWith('safe-');
/** Ce qui a déclenché une copie de sécurité (« restore », « sync » ; « reset » dans les copies d'avant le 2026-11-21), ou null. @param {{ id: string }} c */
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
  if (h !== header.state) throw new Error('Cette copie est abîmée.');
  let ops = 0;
  for (const e of s.entries.values()) if (e.status !== 'void' && ['expense', 'income', 'transfer'].includes(e.kind)) ops++;
  return { events: events.length, ops, state: h, last: events.length ? events[events.length - 1].at : null };
}

/**
 * Copie du jour, si elle est due.
 * - 'recent' : une copie a moins de MIN_HOURS heures ; 'same' : rien n'a changé depuis la dernière copie ;
 * - 'broken' : l'intégrité de la base est atteinte (rien n'est copié, les copies saines restent) ;
 * - 'done' : nouvelle copie gardée, les plus vieilles au-delà de KEEP retirées ;
 * - 'stopped' : stop() a répondu oui entre deux étapes (on change d'espace), rien n'est écrit.
 * @param {{ session: any, store: CopyStore, now?: Date, force?: boolean, stop?: () => boolean }} o
 */
export async function autoCopy({ session, store, now = new Date(), force = false, stop = () => false }) {
  const stopped = { status: /** @type {const} */ ('stopped') };
  const list = (await store.list()).filter(c => !isSafety(c)); // les copies de sécurité ne comptent pas ici
  const last = list[0] || null;
  if (!force && last && now.getTime() - Date.parse(last.at) < MIN_HOURS * 3600e3) return { status: 'recent', last };
  if (stop()) return stopped;
  const checks = await session.verify();
  if (stop()) return stopped;
  const bad = checks.filter((/** @type {{ ok: boolean }} */ c) => !c.ok);
  if (bad.length) return { status: 'broken', problems: bad, last };
  const current = await session.stateHash();
  if (last && last.state === current) return { status: 'same', last };
  if (stop()) return stopped;
  const text = await session.exportJournal();
  if (stop()) return stopped;
  let info;
  try { info = await checkJournalText(text); } catch (e) { return { status: 'broken', problems: [{ name: 'Copie', ok: false, detail: /** @type {Error} */ (e).message }], last }; }
  if (info.state !== current) return { status: 'broken', problems: [{ name: 'Copie', ok: false, detail: 'La copie ne redonne pas l’état de l’app.' }], last };
  if (stop()) return stopped;
  /** @type {Copy} */
  const copy = { id: now.toISOString(), at: now.toISOString(), events: info.events, ops: info.ops, state: info.state, bytes: text.length, text };
  await store.put(copy);
  for (const old of [copy, ...list].slice(KEEP)) await store.remove(old.id);
  return { status: 'done', copy };
}

/**
 * Copie de sécurité de l'état présent (D15, 2026-11-17), juste avant une action qui remplace tout (reason : « restore »,
 * « sync »). Vérifiée comme une copie du jour ; rien si l'état est celui de la dernière copie de sécurité ; les
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
  if (info.state !== current) throw new Error('La copie de sécurité a échoué : rien n’est changé.');
  /** @type {Copy} */
  const copy = { id: `safe-${reason}-${now.toISOString()}`, at: now.toISOString(), events: info.events, ops: info.ops, state: info.state, bytes: text.length, text };
  await store.put(copy);
  for (const old of [copy, ...list].slice(KEEP_SAFETY)) await store.remove(old.id);
  return { status: 'done', copy };
}

/**
 * Copie de sécurité d'un journal déjà en main (D21 : celui du téléphone, juste avant que la synchro le réécrive ; pris dans
 * la file des commandes de la session, sans repasser par elle). Relue et rejouée comme les autres.
 * @param {{ store: CopyStore, reason: string, text: string, now?: Date }} o
 */
export async function safetyCopyText({ store, reason, text, now = new Date() }) {
  const list = (await store.list()).filter(isSafety);
  const info = await checkJournalText(text);
  if (list[0] && list[0].state === info.state) return { status: 'same', copy: list[0] };
  /** @type {Copy} */
  const copy = { id: `safe-${reason}-${now.toISOString()}`, at: now.toISOString(), events: info.events, ops: info.ops, state: info.state, bytes: text.length, text };
  await store.put(copy);
  for (const old of [copy, ...list].slice(KEEP_SAFETY)) await store.remove(old.id);
  return { status: 'done', copy };
}

/**
 * @typedef {{ from: 'journal'|'copy'|'drive', at: string|null, text: string, lost: number, since: string|null }} Heal
 * from : ce qu'on reprend (journal : celui du téléphone jusqu'au premier événement abîmé, entier s'il est intact) ;
 * lost : les changements notés ici qui n'y sont pas (à refaire), since : la date du premier d'entre eux
 */
/**
 * Réparer (2026-11-21, avec l'utilisateur) : parmi ce qui est sain — le journal du téléphone jusqu'à sa première cassure,
 * les copies, le journal du Drive — ce qui garde le plus de ce qui a été noté ici (événement par événement, par
 * identifiant : un événement abîmé n'est plus le même), à égalité le plus complet (le Drive peut avoir ceux d'un autre
 * appareil). Journal intact (seules les tables calculées divergent) : rien n'est perdu. Null si rien n'est sain.
 * @param {{ events: import('../domain/events.js').StoredEvent[], journalText: (e: any[]) => Promise<string>, copies: Copy[], driveText?: string|null }} o
 * @returns {Promise<Heal|null>}
 */
export async function pickHeal({ events, journalText, copies, driveText = null }) {
  const chain = await verifyChain(events);
  /** @type {Array<{ from: Heal['from'], at: string|null, text: () => Promise<string> }>} */
  const sources = [
    { from: 'journal', at: events[chain.count - 1]?.at || null, text: () => journalText(events.slice(0, chain.count)) },
    ...copies.map(c => ({ from: /** @type {const} */ ('copy'), at: c.at, text: async () => c.text })),
    ...(driveText ? [{ from: /** @type {const} */ ('drive'), at: null, text: async () => driveText }] : []),
  ];
  /** @type {(Heal & { n: number })|null} */
  let best = null;
  for (const s of sources) {
    try {
      const text = await s.text();
      const info = await checkJournalText(text);
      const kept = new Set((await parseJsonl(text)).events.map(e => e.id));
      const lost = events.filter(e => !kept.has(e.id));
      const h = { from: s.from, at: s.at, text, lost: lost.length, since: lost[0]?.at || null, n: info.events };
      if (!best || h.lost < best.lost || (h.lost === best.lost && h.n > best.n)) best = h;
    } catch (e) { /* pas saine : on passe */ }
  }
  if (!best) return null;
  const { n, ...plan } = best;
  return plan;
}

/**
 * Revenir en arrière par le journal (2026-11-21, avec l'utilisateur) : l'état à la fin d'un jour passé, c'est le journal
 * jusqu'au premier événement d'un jour plus récent (le jour local de l'instant noté ; un événement d'un autre appareil
 * arrivé en retard ne fait pas reculer le jour). Le journal est le même sur tous les appareils liés (D21) : on y revient
 * de partout. Renvoie combien d'événements garder (events.length : rien après ce jour, c'est l'état présent).
 * @param {import('../domain/events.js').StoredEvent[]} events @param {string} day AAAA-MM-JJ
 * @param {(at: string) => string} dayOf le jour local d'un instant
 */
export function keepUntil(events, day, dayOf) {
  let max = '';
  for (let i = 0; i < events.length; i++) {
    const d = dayOf(events[i].at);
    if (d > max) max = d;
    if (max > day) return i;
  }
  return events.length;
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
    close: async () => { (await db).close(); },
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
    close: async () => { await invoke('plugin:sql|close', { db: URL_ }); },
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
