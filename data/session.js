// Session de données : la base, l'état projeté en mémoire (cache lu par les écrans), la file des commandes,
// l'export / import exact, la reconstruction, les contrôles d'intégrité et la vue dans le passé (lecture seule).
// Une commande est validée par le domaine, écrite en base dans une transaction, puis seulement le cache est remplacé
// et les écrans sont prévenus. Si l'écriture échoue, le cache ne change pas.
import { createUlid } from '../domain/ulid.js';
import { DomainError } from '../domain/commands.js';
import { execute, appendNew, replayStored } from '../domain/engine.js';
import { emptyState, cloneState, stateHash, PROJECTION_VERSION } from '../domain/projection.js';
import { verifyChain } from '../domain/events.js';
import { settingsOf, walletBalances } from '../domain/queries.js';
import { demoCommands } from '../domain/demo.js';
import { convertLegacy } from '../domain/legacy.js';
import { iso } from '../domain/format.js';
import {
  migrate, schemaVersion, getMeta, setMeta, writeBatch, rewriteProjections, replaceAll, loadState, readEvents, sqlStateHash, sqlChecks,
} from './journal.js';
import { toJsonl, parseJsonl, ImportError } from './exchange.js';

/** @typedef {import('./db.js').Db} Db */
/** @typedef {import('../domain/projection.js').State} State */
/** @typedef {import('../domain/commands.js').Command} Command */
/** @typedef {import('../domain/events.js').StoredEvent} StoredEvent */
/** @typedef {import('../domain/legacy.js').LegacyData} LegacyData */

export const APP_VERSION = '0.261119.1845';
export const ALL_KEYS = ['accounts', 'categories', 'tx', 'budgets', 'settings'];
/** @type {Record<string, string[]>} */
const KEYS_BY_PREFIX = { entry: ['tx'], wallet: ['accounts'], category: ['categories', 'tx', 'budgets'], budget: ['budgets'], settings: ['settings'], app: ['settings'] };
/** @param {StoredEvent[]} events */
const keysOf = events => [...new Set(events.flatMap(e => KEYS_BY_PREFIX[e.type.split('.')[0]] || ALL_KEYS))];

/**
 * @param {{
 *   db: Db,
 *   clock?: () => number,
 *   random?: () => number,
 *   today?: () => string,
 *   detectCurrency?: () => string,
 *   legacy?: (() => LegacyData|null)|null,
 *   onLegacyDone?: ((info: { entries: number, skipped: number }) => void)|null,
 *   device?: string|null,
 * }} opts
 */
export async function openSession({ db, clock = () => Date.now(), random = Math.random, today = () => iso(new Date()), detectCurrency = () => 'XOF', legacy = null, onLegacyDone = null, device: deviceOpt = null }) {
  /** @type {number|null} */
  let virtualNow = null;
  const ulid = createUlid({ now: () => virtualNow ?? clock(), random });
  let schema = await migrate(db);
  // Une transaction n'est rendue qu'une fois durable (en Chrome : copie écrite en IndexedDB).
  /** @param {(tx: import('./db.js').Tx) => void|Promise<void>} fn */
  const commit = async fn => { await db.transaction(fn); await db.flush(); };

  let device = deviceOpt || await getMeta(db, 'device');
  if (!device || deviceOpt) {
    device = deviceOpt || 'app-' + ulid().slice(-10).toLowerCase();
    const d = device;
    await commit(tx => setMeta(tx, 'device', d));
  }

  /** @type {State} */
  let state = emptyState();
  const listeners = new Set();

  // Horodatage : jamais avant le dernier événement (le journal reste rangé dans le temps). Pendant la préparation
  // d'un journal neuf (démo, import d'un export v2, « Tout effacer »), le plancher est celui de ce journal neuf.
  /** @type {State|null} */
  let building = null;
  const lastAt = () => Date.parse((building || state).head.at || '') || 0;
  /** @type {number|null} horodatage de l'écriture en cours (commandes sans date imposée) */
  let runAt = null;
  /** @param {string|undefined} wanted */
  const stamp = wanted => {
    const last = lastAt();
    const now = clock();
    let t = wanted ? Math.min(Date.parse(wanted), now) : now;
    if (t < last) t = last;
    return t;
  };
  /** @type {import('../domain/engine.js').Env} */
  const env = {
    ctx: cmd => ({ today: (cmd && cmd.today) || today(), newId: ulid }),
    // Tous les événements d'une même écriture portent le même horodatage, distinct de celui de l'écriture précédente.
    meta: cmd => {
      let t;
      if (cmd && cmd.at) t = stamp(cmd.at);
      else {
        if (runAt === null) { runAt = stamp(undefined); if (!building && runAt <= lastAt()) runAt = lastAt() + 1; }
        t = runAt;
      }
      virtualNow = t;
      const id = ulid();
      virtualNow = null;
      return { id, at: new Date(t).toISOString(), device: /** @type {string} */ (device) };
    },
  };

  /** @type {Promise<any>} */
  let queue = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  /** @param {string[]} keys */
  const notify = keys => listeners.forEach(f => { try { f(keys); } catch (e) { console.error(e); } });

  // Après un échec d'écriture, le cache est relu en base : si la transaction a été annulée, c'est l'état d'avant ;
  // si l'issue est incertaine (natif : erreur après l'envoi du COMMIT), c'est ce que la base contient vraiment, et
  // la tête du journal (seq, empreinte) reste juste pour la commande suivante.
  async function resync() {
    const before = state.head.hash;
    try { state = await loadState(db); } catch (e) { console.error('Relecture de la base impossible', e); }
    if (state.head.hash !== before) notify(ALL_KEYS);
  }

  /** @param {Command[]} cmds */
  async function run(cmds) {
    runAt = null;
    const { next, events } = await execute(state, cmds, env);
    if (events.length) {
      try { await commit(tx => writeBatch(tx, events, next)); } catch (e) { await resync(); throw e; }
    }
    next.touched = null;
    state = next;
    return events;
  }

  /**
   * Prépare en mémoire un journal neuf, sans rien écrire : événements déjà décidés (conversion) ou commandes.
   * @param {{ news?: import('../domain/events.js').NewEvent[], cmds?: Command[] }} what
   * @returns {Promise<{ events: StoredEvent[], next: State }>}
   */
  async function prepare({ news, cmds }) {
    const fresh = cloneState(emptyState());
    building = fresh;
    runAt = null;
    try {
      if (news) return { events: await appendNew(fresh, news, env), next: fresh };
      return await execute(fresh, cmds || [], env);
    } finally { building = null; }
  }
  /**
   * Remplace journal et projections par un journal neuf déjà vérifié, en UNE transaction : si quoi que ce soit
   * échoue (contrainte SQL, disque…), la base garde tout son contenu d'avant. Le résultat est relu et comparé.
   * @param {StoredEvent[]} events
   * @param {State} s
   */
  async function replace(events, s) {
    const meta = { device: /** @type {string} */ (device), projection_version: String(PROJECTION_VERSION) };
    const old = await readEvents(db);
    try {
      await commit(tx => replaceAll(tx, events, s, meta));
    } catch (e) { await resync(); throw e; }
    const want = await stateHash(s);
    if (await sqlStateHash(db) !== want) {
      // la base ne redonne pas l'état préparé : on remet l'ancien journal (même mécanisme, tout ou rien)
      try { await commit(tx => replaceAll(tx, old, replayStored(old), meta)); } catch (e) { console.error(e); }
      await resync();
      throw new ImportError('Empreinte d’état différente après écriture en base : rien n’a été changé.');
    }
    state = await loadState(db);
    return want;
  }

  // --- démarrage : base vide → anciennes données converties, sinon premier lancement ---
  const [{ n }] = await db.select('SELECT COUNT(*) AS n FROM events');
  if (!Number(n)) {
    const old = legacy ? legacy() : null;
    let converted = false;
    if (old) {
      // anciennes données illisibles : premier lancement normal, elles restent en copie (non marquées converties)
      try {
        const conv = convertLegacy(old, { today: today(), currency: detectCurrency() });
        const { events, next } = await prepare({ news: conv.events });
        await replace(events, next);
        converted = true;
        if (onLegacyDone) onLegacyDone({ entries: conv.entries, skipped: conv.skipped });
      } catch (e) { console.error('Conversion des données v2 impossible', e); }
    }
    if (!converted) {
      await run([{ type: 'setup', currency: detectCurrency() }]);
      await commit(tx => setMeta(tx, 'projection_version', String(PROJECTION_VERSION)));
    }
  } else if ((await getMeta(db, 'projection_version')) !== String(PROJECTION_VERSION)) {
    // nouvelle forme des projections : on les reconstruit depuis le journal (rien n'est transformé en place)
    const s = replayStored(await readEvents(db));
    await commit(tx => { rewriteProjections(tx, s); setMeta(tx, 'projection_version', String(PROJECTION_VERSION)); });
    state = await loadState(db);
  } else {
    state = await loadState(db);
  }

  return {
    db,
    /** État courant. */
    get state() { return state; },
    get present() { return state; },
    get device() { return device; },
    /** Nouvel identifiant (ULID). */
    newId: () => ulid(),
    /** @param {(keys: string[]) => void} fn */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Exécute des commandes (tout ou rien). Rejette avec une DomainError si une règle est enfreinte.
     * @param {Command[]} cmds
     */
    dispatch(cmds) {
      return serial(async () => {
        const events = await run(cmds);
        if (events.length) notify(keysOf(events));
        return events;
      });
    },

    stateHash: () => stateHash(state),
    async info() {
      return { kind: db.kind, schema: await schemaVersion(db), events: state.head.seq, head: state.head.hash, bytes: await db.size(), device, version: APP_VERSION };
    },

    /** Journal complet en JSON Lines. */
    exportJournal: () => serial(async () => {
      const events = await readEvents(db);
      return toJsonl({ app: 'cauri', kind: 'journal', version: APP_VERSION, schema, events: events.length, head: state.head.hash, state: await stateHash(state) }, events);
    }),

    /**
     * Remplace tout par un journal exporté : vérification de la chaîne, rejeu, comparaison de l'empreinte d'état.
     * Accepte aussi l'export JSON de l'itération 2 (converti en événements).
     * @param {string} text
     */
    importJournal: text => serial(async () => {
      /** @type {any} */
      let legacyDoc = null;
      if (String(text).trimStart().startsWith('{') && !String(text).includes('\n{')) { try { legacyDoc = JSON.parse(text); } catch (e) { /* JSON Lines */ } }
      // Tout est préparé et vérifié en mémoire ; la base n'est touchée qu'à la fin, en une seule transaction.
      if (legacyDoc && legacyDoc.app === 'cauri' && legacyDoc.data) {
        const conv = convertLegacy(legacyDoc.data, { today: today(), currency: detectCurrency() });
        let prepared;
        try { prepared = await prepare({ news: conv.events }); } catch (e) { throw new ImportError('Conversion impossible : ' + /** @type {Error} */ (e).message); }
        const hash = await replace(prepared.events, prepared.next);
        notify(ALL_KEYS);
        return { hash, events: prepared.events.length, legacy: true };
      }
      const { header, events } = await parseJsonl(text, { schema });
      let s;
      try { s = replayStored(events); } catch (e) { throw new ImportError('Rejeu impossible : ' + /** @type {Error} */ (e).message); }
      const h = await stateHash(s);
      if (header.state !== h) throw new ImportError('Empreinte d’état différente après rejeu : le fichier ne redonne pas les mêmes données.');
      await replace(events, s);
      notify(ALL_KEYS);
      return { hash: h, events: events.length, legacy: false };
    }),

    /** Supprime et rejoue les projections ; compare l'empreinte d'état avant / après. */
    rebuild: () => serial(async () => {
      const before = await sqlStateHash(db);
      const events = await readEvents(db);
      const s = replayStored(events);
      await commit(tx => { rewriteProjections(tx, s); setMeta(tx, 'projection_version', String(PROJECTION_VERSION)); });
      state = await loadState(db);
      const after = await sqlStateHash(db);
      notify(ALL_KEYS);
      return { before, after, same: before === after, events: events.length };
    }),

    /** Chaîne d'empreintes, partie double, soldes, projections = rejeu du journal. */
    verify: () => serial(async () => {
      const events = await readEvents(db);
      const chain = await verifyChain(events);
      const sql = await sqlChecks(db);
      let replayHash = '', replayError = '';
      try { replayHash = await stateHash(replayStored(events)); } catch (e) { replayError = /** @type {Error} */ (e).message; }
      const sqlHash = await sqlStateHash(db);
      const cacheHash = await stateHash(state);
      const mem = walletBalances(state);
      const badBal = Object.keys({ ...mem, ...sql.balances }).filter(id => (mem[id] || 0) !== (sql.balances[id] || 0));
      return [
        { name: 'Chaîne d’empreintes', ok: chain.ok, detail: chain.ok ? `${chain.count} événements, tête ${chain.head.slice(0, 8)}` : chain.problem },
        { name: 'Partie double', ok: !sql.unbalanced && !sql.orphans, detail: sql.unbalanced || sql.orphans ? `${sql.unbalanced} écriture(s) déséquilibrée(s), ${sql.orphans} ligne(s) orpheline(s)` : 'Chaque écriture s’équilibre' },
        { name: 'Devises et comptes', ok: !sql.wrongCurrency && !sql.onDeleted, detail: sql.wrongCurrency || sql.onDeleted ? `${sql.wrongCurrency} ligne(s) hors de la devise du portefeuille, ${sql.onDeleted} sur un compte supprimé` : 'Chaque portefeuille reste dans sa devise' },
        { name: 'Soldes', ok: !badBal.length, detail: badBal.length ? `Écart sur ${badBal.join(', ')}` : `${Object.keys(mem).length} portefeuilles concordent` },
        { name: 'Projections', ok: !replayError && replayHash === sqlHash && sqlHash === cacheHash, detail: replayError || (replayHash === sqlHash && sqlHash === cacheHash ? `Rejeu = base = mémoire (${sqlHash.slice(0, 8)})` : 'La base diffère du rejeu du journal') },
      ];
    }),

    /** Journal complet (événements stockés, dans l'ordre). */
    events: () => serial(() => readEvents(db)),
    /** Métadonnées d'un événement (appareil, date) ou null. @param {number} seq */
    eventMeta: async seq => {
      const [r] = await db.select('SELECT seq, at, type, device FROM events WHERE seq = ?', [seq]);
      return r ? { seq: Number(r.seq), at: String(r.at), type: String(r.type), device: String(r.device) } : null;
    },
    /**
     * Démo déterministe produite par les commandes, dans un journal neuf ; garde l'affichage choisi (format, mode discret…).
     * @param {string} day « aujourd'hui » de la démo
     */
    loadDemo: day => serial(async () => {
      const st = settingsOf(state);
      const keep = { fmt: st.fmt, discreet: st.discreet, haptics: st.haptics };
      const { events, next } = await prepare({ cmds: [...demoCommands(day), { type: 'settings.change', changes: keep }] });
      await replace(events, next);
      notify(ALL_KEYS);
      return state.head.seq;
    }),

    /** Tout effacer : journal neuf, premier lancement. */
    reset: () => serial(async () => {
      const { events, next } = await prepare({ cmds: [{ type: 'setup', currency: detectCurrency() }] });
      await replace(events, next);
      notify(ALL_KEYS);
    }),
  };
}
/** @typedef {Awaited<ReturnType<typeof openSession>>} Session */
