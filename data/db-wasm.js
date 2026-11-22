// Adaptateur `Db` sur sql.js (SQLite en WebAssembly, embarqué dans src/vendor, version épinglée 1.14.2).
// Chrome : la base est gardée en IndexedDB (copie binaire après chaque transaction). Node : en mémoire.

/** @typedef {import('./db.js').Db} Db */

const DEFAULT_IDB = 'cauri';
const IDB_STORE = 'db';
const IDB_KEY = 'main';

/** @type {Promise<any>|null} */
let sqlJs = null;
/** Charge sql.js une seule fois (script classique dans le navigateur, require dans Node). */
function loadSqlJs() {
  if (sqlJs) return sqlJs;
  sqlJs = (async () => {
    const g = /** @type {any} */ (globalThis);
    const isNode = typeof g.process !== 'undefined' && !!g.process.versions?.node && typeof g.window === 'undefined';
    if (isNode) {
      const { createRequire } = await import('node:module');
      const fs = await import('node:fs/promises');
      const require = createRequire(import.meta.url);
      const vendored = '../vendor/sql-wasm.js'; // chemin en variable : le typage ne suit pas le code embarqué
      const init = require(vendored);
      const wasmBinary = await fs.readFile(new URL('../vendor/sql-wasm.wasm', import.meta.url));
      return init({ wasmBinary });
    }
    if (!g.initSqlJs) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('../vendor/sql-wasm.js', import.meta.url).href;
        s.onload = resolve;
        s.onerror = () => reject(new Error('sql.js introuvable'));
        document.head.appendChild(s);
      });
    }
    return g.initSqlJs({ locateFile: (/** @type {string} */ f) => new URL('../vendor/' + f, import.meta.url).href });
  })();
  return sqlJs;
}

// --- IndexedDB (navigateur) ---
/** @returns {Promise<IDBDatabase>} */
/** @param {string} IDB_NAME */
function idb(IDB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** @param {string} IDB_NAME @param {'readonly'|'readwrite'} mode @param {(s: IDBObjectStore) => IDBRequest} fn */
async function idbDo(IDB_NAME, mode, fn) {
  const d = await idb(IDB_NAME);
  return new Promise((resolve, reject) => {
    const t = d.transaction(IDB_STORE, mode);
    const r = fn(t.objectStore(IDB_STORE));
    t.oncomplete = () => { d.close(); resolve(r.result); };
    t.onerror = () => { d.close(); reject(t.error); };
  });
}

/**
 * @param {{ persist?: boolean, bytes?: Uint8Array|null, idbName?: string }} [opts] idbName : la base IndexedDB de l'espace ouvert (D19)
 * @returns {Promise<Db>}
 */
export async function openWasmDb({ persist = false, bytes = null, idbName = DEFAULT_IDB } = {}) {
  const SQL = await loadSqlJs();
  let initial = bytes;
  if (persist && !initial) {
    try { initial = /** @type {Uint8Array|null} */ (await idbDo(idbName, 'readonly', s => s.get(IDB_KEY))) || null; } catch (e) { persist = false; }
  }
  let db = new SQL.Database(initial || undefined);
  db.run('PRAGMA foreign_keys = ON');

  // Une opération à la fois (les transactions ne s'entrelacent jamais).
  /** @type {Promise<any>} */
  let queue = Promise.resolve();
  /** @template T @param {() => T|Promise<T>} fn @returns {Promise<T>} */
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

  // Sauvegarde : la copie binaire est prise dans la file (jamais au milieu d'une transaction : export() referme
  // et rouvre la base), puis écrite en IndexedDB en arrière-plan, dans l'ordre. flush() attend la fin de l'écriture.
  // Si IndexedDB refuse, la base en mémoire revient à la dernière copie enregistrée et flush() échoue : la commande
  // est refusée (message à l'écran), et ce qui est affiché reste ce qui est vraiment gardé.
  /** @type {Promise<any>} */
  let saving = Promise.resolve();
  let pending = false;
  /** @type {Uint8Array|null} dernière copie écrite en IndexedDB (null : base vide) */
  let lastSaved = initial || null;
  /** @type {any} */
  let failure = null;
  const save = () => {
    if (!persist || pending) return;
    pending = true;
    serial(() => {
      pending = false;
      const data = db.export();
      db.run('PRAGMA foreign_keys = ON');
      saving = saving
        .then(() => (failure ? null : idbDo(idbName, 'readwrite', s => s.put(data, IDB_KEY))))
        .then(() => { if (!failure) lastSaved = data; }, e => { console.error('Sauvegarde IndexedDB impossible', e); failure = e || new Error('IndexedDB'); });
    });
  };

  /** @param {string} sql @param {any[]} [params] */
  const run = (sql, params) => {
    if (params && params.length) db.run(sql, params.map(v => (typeof v === 'boolean' ? Number(v) : v === undefined ? null : v)));
    else db.exec(sql);
  };
  /** @param {string} sql @param {any[]} [params] */
  const selectNow = (sql, params) => {
    const st = db.prepare(sql);
    try {
      if (params && params.length) st.bind(params);
      const out = [];
      while (st.step()) out.push(st.getAsObject());
      return out;
    } finally { st.free(); }
  };

  return {
    kind: 'wasm',
    exec: (sql, params) => serial(() => { run(sql, params); save(); }),
    select: (sql, params) => serial(() => selectNow(sql, params)),
    transaction: fn => serial(async () => {
      db.run('BEGIN IMMEDIATE');
      try {
        await fn({ exec: run, select: async (sql, params) => selectNow(sql, params) });
        db.run('COMMIT');
      } catch (e) {
        try { db.run('ROLLBACK'); } catch (e2) { /* déjà annulée par SQLite */ }
        throw e;
      }
      save();
    }),
    size: () => serial(() => {
      const [r] = selectNow('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()');
      return Number(r?.n || 0);
    }),
    flush: async () => {
      await serial(() => saving);
      await saving;
      if (!failure) return;
      const e = failure;
      await serial(() => {
        db.close();
        db = new SQL.Database(lastSaved || undefined);
        db.run('PRAGMA foreign_keys = ON');
        failure = null;
      });
      throw new Error('Enregistrement impossible sur ce navigateur : ' + String(e && e.message || e));
    },
    close: () => serial(async () => { await saving; db.close(); }),
  };
}
