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
import { syncPlan, merged, rebase, isPristine } from './sync.js';

/** @typedef {import('./db.js').Db} Db */
/** @typedef {import('../domain/projection.js').State} State */
/** @typedef {import('../domain/commands.js').Command} Command */
/** @typedef {import('../domain/events.js').StoredEvent} StoredEvent */
/** @typedef {import('../domain/legacy.js').LegacyData} LegacyData */

export const APP_VERSION = '0.261127.1901';
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
  // d'un journal neuf (démo, import d'un export v2), le plancher est celui de ce journal neuf.
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
      throw new ImportError('L’enregistrement a échoué : rien n’a été changé.');
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

  /** Journal en JSON Lines pour des événements donnés (copie, envoi au Drive). @param {StoredEvent[]} events */
  const journalText = async events => toJsonl({ app: 'cauri', kind: 'journal', version: APP_VERSION, schema, events: events.length, head: events.length ? events[events.length - 1].hash : '', state: await stateHash(replayStored(events)) }, events);
  // Restaurer (D21) : ce journal remplace voulu ; à la prochaine synchro il remplacera aussi celui du Drive
  // (au lieu d'être rejoint avec lui, ce qui annulerait le geste).
  // Rangé à part du repère de synchro (une synchro déjà en cours ne peut pas l'effacer en écrivant son repère), avec sa
  // date : un geste fait pendant qu'aucun compte n'était lié ne remplace rien après une nouvelle liaison.
  const markForce = async () => {
    if (!(await getMeta(db, 'sync'))) return;
    try { await commit(tx => setMeta(tx, 'sync_force', new Date(clock()).toISOString())); } catch (e) { console.error(e); }
  };

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
        try { prepared = await prepare({ news: conv.events }); } catch (e) { throw new ImportError('Cette ancienne copie ne se convertit pas : ' + /** @type {Error} */ (e).message); }
        const hash = await replace(prepared.events, prepared.next);
        await markForce();
        notify(ALL_KEYS);
        return { hash, events: prepared.events.length, legacy: true };
      }
      const { header, events } = await parseJsonl(text, { schema });
      let s;
      try { s = replayStored(events); } catch (e) { throw new ImportError('Copie abîmée : ' + /** @type {Error} */ (e).message); }
      const h = await stateHash(s);
      if (header.state !== h) throw new ImportError('Cette copie est abîmée.');
      await replace(events, s);
      await markForce();
      notify(ALL_KEYS);
      return { hash: h, events: events.length, legacy: false };
    }),

    /**
     * Synchronisation (D21) : le journal du Drive (déjà vérifié) rejoint celui du téléphone, dans la file des commandes
     * (rien ne s'écrit entre la lecture et l'écriture). Prendre ou adopter le journal du Drive, ou refaire les changements
     * du téléphone par-dessus. Jamais de mélange sans début commun : fork (l'appelant garde les deux à part).
     * since : le dernier point synchronisé, quand le journal du Drive a été remplacé ailleurs (restauration)
     * — seuls les changements faits ici depuis ce point sont refaits par-dessus le nouveau journal.
     * safety(texte) : appelé avec le journal du téléphone juste avant de le réécrire en refaisant ses changements (copie
     * de sécurité, prise dans la même file : aucun changement ne peut se glisser entre la copie et la réécriture).
     * @param {StoredEvent[]|null} remote
     * @param {{ since?: { seq: number, hash: string }|null, safety?: ((text: string) => Promise<any>)|null }} [opts]
     */
    merge: (remote, { since = null, safety = null } = {}) => serial(async () => {
      // Restaurer vient d'être fait ici pendant la synchro : on ne rejoint rien, l'appelant recommence
      if (await getMeta(db, 'sync_force')) return { plan: { kind: 'same', k: 0 }, forced: true, fork: false, events: [], skipped: [], push: false };
      const local = await readEvents(db);
      /** @type {{ kind: string, k: number }} */
      let plan = syncPlan(local, remote);
      /** @type {StoredEvent[]|null} */
      let extra = null;
      if (since && remote) {
        const ok = since.seq <= local.length && (since.seq === 0 || local[since.seq - 1].hash === since.hash);
        if (ok) {
          extra = local.slice(since.seq);
          if (since.seq === 0 && isPristine(extra)) extra = [];
          plan = { kind: extra.length ? 'rebase' : 'adopt', k: 0 };
        }
      }
      if (plan.kind === 'rebase' && plan.k === 0 && !extra) return { plan, fork: true, events: local, skipped: [], push: false };
      /** @type {{ events: StoredEvent[], state: State|null, skipped: { event: StoredEvent, reason: string }[] }|null} */
      let m = null;
      if (plan.kind === 'rebase') {
        if (safety) await safety(await journalText(local));
        const r = await rebase(/** @type {StoredEvent[]} */ (remote), extra || local.slice(plan.k));
        m = { events: r.events, state: r.state, skipped: r.skipped };
      } else {
        // le journal du Drive remplacé ailleurs, rien de neuf ici : on le prend, après une copie de celui du téléphone
        if (plan.kind === 'adopt' && since && safety && !isPristine(local)) await safety(await journalText(local));
        m = await merged(local, remote, /** @type {any} */ (plan));
      }
      if (m) {
        await replace(m.events, m.state || replayStored(m.events));
        notify(ALL_KEYS);
      }
      const events = m ? m.events : local;
      const push = !remote || events.length !== remote.length || (events.length > 0 && events[events.length - 1].hash !== remote[remote.length - 1].hash);
      return { plan, fork: false, events, skipped: m ? m.skipped : [], push };
    }),
    /** En-tête d'export pour des événements donnés (le journal envoyé au Drive). @param {StoredEvent[]} events */
    journalText: events => journalText(events),
    /** Le repère de synchro de cet espace (D21) : { cid, seq, hash, epoch, force } ou null. */
    getSync: async () => {
      const v = await getMeta(db, 'sync');
      const force = (await getMeta(db, 'sync_force')) || '';
      try { return v ? { ...JSON.parse(v), force: force || undefined } : null; } catch (e) { return null; }
    },
    /** Le geste Restaurer a été envoyé (ou ne compte pas) : on l'oublie. */
    clearForce: () => serial(() => commit(tx => setMeta(tx, 'sync_force', ''))),
    /** Referme la base, après les écritures en file (on passe à un autre espace, D19). Plus rien n'est prévenu. */
    close: () => serial(async () => { listeners.clear(); await db.close(); }),
    /** @param {Record<string, any>|null} v */
    setSync: v => serial(() => commit(tx => { const { force, ...rest } = v || {}; setMeta(tx, 'sync', v ? JSON.stringify(rest) : ''); })),

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
     * Démo déterministe produite par les commandes, dans un journal neuf ; garde l'affichage choisi (format, vibrations).
     * @param {string} day « aujourd'hui » de la démo
     */
    loadDemo: day => serial(async () => {
      const st = settingsOf(state);
      const keep = { fmt: st.fmt, haptics: st.haptics };
      const { events, next } = await prepare({ cmds: [...demoCommands(day), { type: 'settings.change', changes: keep }] });
      await replace(events, next);
      notify(ALL_KEYS);
      return state.head.seq;
    }),
  };
}
/** @typedef {Awaited<ReturnType<typeof openSession>>} Session */
