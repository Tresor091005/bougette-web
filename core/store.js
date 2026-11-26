// Façade des données pour les écrans : tout passe par le journal d'événements (src/data) et les règles du domaine
// (src/domain).
// Lectures : synchrones, sur l'état projeté gardé en mémoire. Écritures : commandes validées, écrites en base dans
// une transaction, puis le cache est remplacé et les écrans sont prévenus (subscribe). Elles renvoient une promesse ;
// en cas de refus ou d'échec, le cache ne change pas et le message passe par setErrorHandler (un toast dans l'app).
import { openDb } from '../data/db.js';
import { openSession } from '../data/session.js';
import { openWasmDb } from '../data/db-wasm.js';
import { DomainError } from '../domain/commands.js';
import * as Q from '../domain/queries.js';
import * as R from '../domain/rules.js';
import * as B from '../domain/budgets.js';
import * as V from '../domain/reserves.js';
import * as D from '../domain/dues.js';
import { simulate } from '../domain/engine.js';
import { txLines } from '../domain/ledger.js';
import { detectCurrency, configureFormat, currencyOf, inPeriod, today } from './format.js';
import { currentSpace, storageOf, MAIN } from './spaces.js';
import { parseFont, fontStack, DEFAULT_FONT } from './fonts.js';
export { KINDS, KIND_LABEL } from '../domain/defaults.js';

// Les réglages et petites préférences sont ceux de l'espace ouvert (D19) ; le premier espace garde « cauri: ». Changer
// d'espace les remplace sur place (openSpace).
let spaceId = currentSpace().id;
let SPACE = storageOf(spaceId);
let PREFIX = SPACE.prefix;
/** L'espace de la session ouverte (le registre peut déjà en nommer un autre, le temps de passer de l'un à l'autre). */
export const openSpaceId = () => spaceId;
// Le verrouillage (D16) protège l'app entière : ses préférences sont communes à tous les espaces, comme le style, les mises
// à jour et la page Développeur ouverte (« dev », 2026-11-21).
const GLOBAL_PREFS = new Set(['lock', 'lockOpen', 'lockFails', 'style', 'font', 'icons', 'updateCheckedAt', 'updateNotified', 'dev']);
function read(key, fallback, prefix = PREFIX) {
  try {
    const v = localStorage.getItem(prefix + key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}
function write(key, value, prefix = PREFIX) {
  try {
    if (value === undefined) localStorage.removeItem(prefix + key);
    else localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch (e) {}
}

const startCurrency = () => detectCurrency();
// Données localStorage des itérations 1 et 2 : converties une fois en événements, puis gardées telles quelles en sauvegarde.
// id, sp : l'espace qu'on ouvre (pas forcément encore celui des préférences, le temps de passer de l'un à l'autre).
/** @param {string} id @param {{ prefix: string }} sp */
function legacyData(id, sp) {
  const P = sp.prefix;
  if (id !== MAIN || read('migrated', null, P)) return null; // seul le premier espace a pu connaître ces données
  const keys = ['accounts', 'categories', 'tx', 'budgets', 'settings'];
  try { if (!keys.some(k => localStorage.getItem(P + k) !== null)) return null; } catch (e) { return null; }
  return { version: read('version', null, P), accounts: read('accounts', null, P), categories: read('categories', null, P), tx: read('tx', [], P), budgets: read('budgets', null, P), settings: read('settings', {}, P) };
}

/**
 * Ouvre la session d'un espace ; warn : ce qu'il faut dire si la base manque.
 * @param {string} id @param {ReturnType<typeof storageOf>} sp
 */
async function start(id, sp) {
  const opts = { today, detectCurrency: startCurrency, legacy: () => legacyData(id, sp), onLegacyDone: () => write('migrated', new Date().toISOString(), sp.prefix) };
  try {
    return { ses: await openSession({ db: await openDb({ url: sp.db, idbName: sp.idb }), ...opts }), warn: '' };
  } catch (e) {
    console.error('Base de données indisponible', e);
    // en mémoire : les anciennes données sont montrées mais pas marquées converties (elles le seront quand la base marchera)
    return { ses: await openSession({ db: await openWasmDb({ persist: false }), ...opts, onLegacyDone: null }),
      warn: 'Bougette ne peut pas enregistrer sur cet appareil. Ce que tu notes sera perdu en fermant l’app.' };
  }
}
const first = await start(spaceId, SPACE);
export let session = first.ses;
let storageWarning = first.warn;
export const storageProblem = () => storageWarning;

// D7 : plus d'emoji. Au démarrage (et après un import), chaque emoji ou ancienne icône dessinée devient l'icône
// Phosphor la plus proche, par une commande enregistrée dans le journal (category.updated). Idempotente : sans
// rien à convertir, elle n'écrit aucun événement.
export async function migrateIcons() {
  try { await session.dispatch([{ type: 'category.migrateIcons' }]); } catch (e) { console.error('Migration des icônes impossible', e); }
}
// D9 : soldes négatifs toujours refusés, sans réglage à l'écran. Un ancien journal (ou un import) qui les autorisait
// encore est aligné par des commandes ordinaires, enregistrées dans le journal ; sans rien à aligner, rien n'est écrit.
export async function refuseNegatives() {
  const s = session.state;
  const cmds = [
    ...(Q.settingsOf(s).blockNegative ? [] : [{ type: 'settings.change', changes: { blockNegative: true } }]),
    ...Q.walletList(s).filter(w => w.allowNegative).map(w => ({ type: 'wallet.update', id: w.id, changes: { allowNegative: false } })),
  ];
  if (!cmds.length) return;
  try { await session.dispatch(cmds); } catch (e) { console.error('Alignement des soldes négatifs impossible', e); }
}
await migrateIcons();
await refuseNegatives();

/**
 * Passer à l'espace choisi sur place (D19, 2026-11-22) : la base de l'espace d'avant est refermée (ses écritures en file
 * finies), celle du nouveau ouverte, ses réglages lus ; les abonnés restent. L'appelant a d'abord arrêté la synchro et
 * les copies de l'espace d'avant. Rejette si la nouvelle session ne s'ouvre pas (l'appelant recharge alors la page).
 */
export async function openSpace() {
  try { await session.close(); } catch (e) { console.error('Fermeture de la base impossible', e); }
  // la nouvelle session d'abord ; l'espace, ses préférences et sa session changent ensuite d'un coup (jamais les
  // préférences d'un espace avec la session d'un autre)
  const id = currentSpace().id, sp = storageOf(id);
  const { ses, warn } = await start(id, sp);
  spaceId = id;
  SPACE = sp;
  PREFIX = sp.prefix;
  storageWarning = warn;
  session = ses;
  memo = { state: null };
  attach(session);
  syncFormat();
  await migrateIcons();
  await refuseNegatives();
  applyLook();
}

// --- cache des vues (recalculées seulement quand l'état change) ---
let memo = { state: null };
function lazy(k, fn) {
  const s = session.state;
  if (memo.state !== s) memo = { state: s };
  if (!(k in memo)) memo[k] = fn(s);
  return memo[k];
}
const S = () => session.state;

// Format des montants.
function syncFormat() {
  const st = settings();
  configureFormat({ currency: st.currency, fmt: st.fmt, steps: st.steps || {} });
}

// Les abonnés sont gardés ici, pas dans la session : ils suivent d'un espace à l'autre.
/** @type {Set<(keys: string[]) => void>} */
const subscribers = new Set();
/** @param {(keys: string[]) => void} fn */
export const subscribe = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
/** @param {import('../data/session.js').Session} ses */
function attach(ses) {
  ses.subscribe(keys => {
    if (ses !== session) return;
    // d'abord le format, qui suit les réglages, avant que les écrans ne se redessinent
    if (keys.includes('settings')) syncFormat();
    subscribers.forEach(f => { try { f(keys); } catch (e) { console.error(e); } });
  });
}

let onError = msg => console.warn(msg);
export function setErrorHandler(fn) { onError = fn; }
// Exécute des commandes ; renvoie les événements, ou null (message affiché) en cas de refus ou d'échec.
async function run(cmds) {
  try {
    return await session.dispatch(cmds);
  } catch (e) {
    if (e instanceof DomainError) onError(e.message);
    else { console.error(e); onError('Ça n’a pas marché, rien n’a changé. Réessaie.'); }
    return null;
  }
}
export const uid = () => session.newId();
// Comme run, mais un refus du domaine va à own (un message dans la feuille) plutôt qu'au toast.
async function runOwn(cmds, own) {
  if (!own) return run(cmds);
  try {
    return await session.dispatch(cmds);
  } catch (e) {
    if (e instanceof DomainError) own(e.message, e.code, e.detail);
    else { console.error(e); onError('Ça n’a pas marché, rien n’a changé. Réessaie.'); }
    return null;
  }
}

// --- lecture ---
export const settings = () => lazy('settings', Q.settingsOf);
attach(session);
syncFormat();
const wallets = () => lazy('wallets', Q.walletList);
const cats = () => lazy('cats', Q.categoryList);
export const accounts = () => lazy('activeWallets', () => wallets().filter(a => !a.archived));
export const allAccounts = () => wallets();
export const account = id => lazy('walletById', () => new Map(wallets().map(a => [a.id, a]))).get(id);
// Catégories principales actives (les sous-catégories se lisent avec subcategories) ; allCategories : toutes, archivées et
// sous-catégories comprises.
export const categories = (type = 'expense') => cats().filter(c => c.type === type && !c.archived && !c.parent);
export const allCategories = type => cats().filter(c => c.type === type);
export const category = id => lazy('catById', () => new Map(cats().map(c => [c.id, c]))).get(id);
// Sous-catégories d'une catégorie (actives ; all : archivées comprises), dans l'ordre choisi.
export const subcategories = (id, { all = false } = {}) => cats().filter(c => c.parent === id && (all || !c.archived));
// Catégorie principale d'une catégorie (elle-même si elle est principale) : pour les rapports qui regroupent, et pour
// les budgets (2026-11-11 : le budget d'une principale compte ses sous-catégories, D13 revu).
export const topOf = id => category(id)?.parent || id;
// « Transport › Zem » (ou « Transport »).
export function categoryLabel(id) {
  const c = category(id);
  if (!c) return '';
  return c.parent ? `${category(c.parent)?.name || ''} › ${c.name}` : c.name;
}
export const transactions = () => lazy('tx', Q.txList);
// Budgets (D11 revu) : tout est une lecture, recalculée quand l'état ou le jour change. budgetReport : budgets en cours
// (période, dépensé, reste), réservé, total des portefeuilles comptés, Disponible, dépassés.
export const budgetReport = () => lazy('budgetReport:' + today(), s => B.budgetReport(s, today()));
// Disponible = argent des portefeuilles comptés dans le total − réservé.
export const available = () => budgetReport().available;
// Budget par identifiant (résolu ; un ancien budget mensuel a les dates de son mois), ou undefined.
export const budgetById = id => lazy('budgetById', s => new Map(B.budgetsOf(s).map(b => [b.id, b]))).get(id);
// Une catégorie a-t-elle un budget (en cours ou fini) ?
export const hasBudget = catId => lazy('budgetCats', s => new Set(B.budgetsOf(s).map(b => b.category))).has(catId);
// Jusqu'à 3 suggestions tirées de l'historique (catégorie, moyenne mensuelle, montant proposé).
// Devise d'un portefeuille / d'une opération (celle de son portefeuille).
export const accCur = id => account(id)?.currency || settings().currency;
export const txCur = t => accCur(t.accountId);
// Nom d'un compte, même supprimé (pour l'historique).
export const accountName = id => (id && S().accounts.get(id)?.name) || '';

// Tri : date décroissante, puis ordre de saisie décroissant.
export const byDateDesc = (a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1);

// Solde de chaque portefeuille : écritures payées (solde de départ, opérations, corrections ; les prévues ne comptent pas).
export function balances(upTo = null) {
  if (upTo) return Q.walletBalances(S(), upTo);
  return lazy('balances', s => Q.walletBalances(s));
}
// Portefeuilles actifs comptés dans le total (pas ceux « hors du total », D11).
export const countedAccounts = () => accounts().filter(a => !a.excluded);
// Total des portefeuilles actifs comptés d'une devise (par défaut la monnaie principale).
export function totalBalance(upTo = null, cur = settings().currency) {
  const b = balances(upTo);
  return countedAccounts().filter(a => a.currency === cur).reduce((s, a) => s + (b[a.id] || 0), 0);
}
// Totaux des autres devises (portefeuilles comptés) : [{ cur, amount }].
export function otherTotals() {
  const b = balances();
  const m = new Map();
  countedAccounts().filter(a => a.currency !== settings().currency).forEach(a => m.set(a.currency, (m.get(a.currency) || 0) + (b[a.id] || 0)));
  return [...m].map(([cur, amount]) => ({ cur, amount }));
}

// Totaux d'une période (opérations de la devise donnée) : dépenses / revenus payés, par catégorie, et prévus.
export function summary(p, cur = settings().currency) {
  const out = { spent: 0, income: 0, byCat: {}, byLeaf: {}, plannedByCat: {}, planned: 0, list: [] };
  for (const t of transactions()) {
    if (!inPeriod(t.date, p) || txCur(t) !== cur) continue;
    out.list.push(t);
    if (t.type === 'expense') {
      if (t.planned) {
        out.planned += t.amount;
        const top = topOf(t.categoryId);
        out.plannedByCat[top] = (out.plannedByCat[top] || 0) + t.amount;
      } else {
        out.spent += t.amount;
        // byCat : regroupé par catégorie principale (rapports, sous-catégories comprises) ; byLeaf : tel que saisi (budgets)
        const top = topOf(t.categoryId);
        out.byCat[top] = (out.byCat[top] || 0) + t.amount;
        out.byLeaf[t.categoryId] = (out.byLeaf[t.categoryId] || 0) + t.amount;
      }
    } else if (t.type === 'income' && !t.planned) out.income += t.amount;
  }
  out.list.sort(byDateDesc);
  return out;
}

// Opérations prévues, de la plus proche à la plus lointaine.
export const plannedList = () => transactions().filter(t => t.planned).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));


// --- contrôles de cohérence (règles du domaine, sur le cache) ---
export const blocksNegative = a => !!a && settings().blockNegative && !a.allowNegative;
// Opération de l'interface (éventuellement incomplète) → brouillon d'écriture.
function draft(t) {
  if (!t || !t.amount || !t.accountId) return null;
  return { id: t.id || '__candidat', kind: t.type, occurred_on: t.date, status: t.planned ? 'planned' : 'posted', lines: txLines(t, accCur(t.accountId)) };
}
// Version enregistrée d'une opération existante (celle du journal), sinon brouillon.
const stored = t => (t && t.id && S().entries.get(t.id) ? Q.draftOf(S(), S().entries.get(t.id)) : draft(t));
// Remplacer oldTx par newTx (l'un ou l'autre peut être null) rendrait-il un solde négatif ?
export const checkBalance = (oldTx, newTx) => R.checkChange(S(), stored(oldTx), draft(newTx));
// Une opération prévue rendra-t-elle le solde négatif à sa date ?
export const plannedWarning = (oldTx, newTx) => R.plannedWarning(S(), stored(oldTx), draft(newTx));

// --- écriture : opérations ---
// t.reserve : la dépense utilise cette réserve (D17) ; le domaine relie les deux. split : la répartition enregistrée avec
// une mise de côté (virement vers une épargne) : [{ id, delta }].
export async function addTx(t, { split = null } = {}) {
  const id = uid();
  const changes = (split || []).filter(c => c.delta);
  const ok = await run([
    { type: 'entry.record', id, tx: { note: '', planned: false, date: today(), ...t } },
    ...(changes.length ? [{ type: 'reserve.allocate', wallet: t.toAccountId, changes, entry: id }] : []),
  ]);
  return ok ? Q.txById(S(), id) : null;
}
export async function updateTx(id, patch) {
  const cur = Q.txById(S(), id);
  if (!cur) return null;
  const tx = { ...cur, ...patch };
  if (tx.type !== 'transfer') delete tx.toAccountId;
  if (tx.type === 'transfer') delete tx.categoryId;
  return run([{ type: 'entry.amend', id, tx }]);
}
// « Supprimer » = annuler l'écriture : elle quitte les listes mais reste dans le journal et l'historique.
export async function deleteTx(id) {
  const t = Q.txById(S(), id);
  if (!t) return null;
  return (await run([{ type: 'entry.void', id }])) ? t : null;
}
export const restoreTx = t => run([{ type: 'entry.restore', id: typeof t === 'string' ? t : t.id }]);
// Chronologie d'une opération.
export const entryHistory = id => Q.historyOf(S(), id);
// Toutes les opérations, annulées comprises, avec la marque « corrigée » (D6).
export const moves = () => lazy('moves', Q.moveList);
export const txById = id => Q.txById(S(), id);
export const moveById = id => lazy('moveById', () => new Map(moves().map(m => [m.id, m]))).get(id) || null;

// --- journal (D6) : origine d'un événement ---
export const journal = () => session.events();
export const eventMeta = seq => session.eventMeta(seq);
export const deviceId = () => session.device;

// --- écriture : portefeuilles ---
export async function addAccount(data) {
  const id = uid();
  const ok = await run([{
    type: 'wallet.create', id, name: data.name, subtype: data.kind || 'cash', currency: data.currency || settings().currency,
    identifier: data.ident || '', color: data.color ?? null, allow_negative: !!data.allowNegative, balance: data.balance || 0,
    excluded: !!data.excluded, savings: !!data.savings, ...(data.savings ? { spendOk: !!data.spendOk } : {}),
    ...(data.savings && data.emergency ? { emergency: true } : {}), ...(data.savings && data.goal ? { goal: data.goal } : {}),
  }]);
  return ok ? account(id) : null;
}
export const updateAccount = (id, patch) => run([{ type: 'wallet.update', id, changes: patch }]);
export const reorderAccounts = ids => run([{ type: 'wallet.reorder', ids }]);
// Vérifier un portefeuille (D9) : actual = ce qu'il y a vraiment dessus ; un écart devient une opération « Non suivi ».
export const checkWallet = (id, actual) => run([{ type: 'wallet.check', id, actual }]);
// Solde de départ (accueil guidé).
// Fin du premier lancement (D10) : l'accueil guidé est fait.
export const finishOnboarding = () => setSettings({ onboarded: true });
export const accountTxCount = id => Q.moveCount(S(), id);
// Écritures qui figent la devise d'un portefeuille (supprimées et corrections comprises).
export const currencyLockCount = id => Q.currencyLockCount(S(), id);
export const accountUsed = id => accountTxCount(id) > 0;
// Suppression seulement sans opérations ; sinon il faut archiver.
export async function deleteAccount(id) {
  if (accountUsed(id)) return false;
  return !!(await run([{ type: 'wallet.delete', id }]));
}

// --- écriture : catégories ---
export async function addCategory(data) {
  const id = uid();
  const ok = await run([{ type: 'category.create', id, catType: data.type || 'expense', name: data.name, icon: data.icon || 'dots-three', color: data.color || 'c1', parent: data.parent || null }]);
  return ok ? category(id) : null;
}
export const updateCategory = (id, patch) => run([{ type: 'category.update', id, changes: patch }]);
export const reorderCategories = (type, ids) => run([{ type: 'category.reorder', catType: type, ids }]);
export const categoryTxCount = id => Q.moveCount(S(), id);
// Supprime une catégorie sans sous-catégorie ni opération (sinon on l'archive). Ses budgets sont retirés.
export const deleteCategory = async id => !!(await run([{ type: 'category.delete', id }]));

// --- écriture : budgets (D11 revu) ---
// data : { category, amount, start, end, repeat } ; renvoie le budget créé, ou null (message affiché par le gestionnaire
// d'erreurs, sauf onError fourni : la feuille montre alors le refus du domaine sur place).
export async function createBudget(data, { onError: own = null } = {}) {
  const id = uid();
  const ok = await runOwn([{ type: 'budget.create', id, ...data }], own);
  return ok ? budgetById(id) : null;
}
export const updateBudget = (id, changes, { onError: own = null } = {}) => runOwn([{ type: 'budget.update', id, changes }], own);
export const deleteBudget = id => run([{ type: 'budget.delete', id }]);

// --- échéances et opérations programmées (D18) : les dates sont calculées ; rien ne s'écrit tout seul ---
/** Les échéances à régler, une ligne chacune avec son étape en cours (écran Budget). */
export const dueItems = () => lazy('dueItems:' + today(), s => D.dueItems(s, today()));
/** Les échéances terminées (plus rien à régler ni à venir), les plus récentes d'abord : en lecture seule (D18). */
export const endedDues = () => lazy('endedDues:' + today(), s => D.endedDues(s, today()));
/** Les fois d'une échéance (sa page), d'une de ses règles. @param {string} id */
export const dueOccurrences = id => D.occurrencesOf(S(), today(), id);
/** La règle la plus récente d'une échéance (celle qu'on modifie). @param {string} id */
export const dueHead = id => D.headOf(S(), id);
/** La première règle d'une échéance (elle ne change pas quand on la modifie). @param {string} id */
export const dueRoot = id => D.rootOf(S(), id);
/** « En N fois » d'une échéance, compté sur toutes ses règles (null sans nombre de fois). @param {string} id */
export const dueTimes = id => D.timesOf(S(), id);
/** Les dates permises pour confirmer une fois (D18). @param {{ schedule: string|null, entry: string|null, date: string }} d */
export const dueRange = d => D.confirmRange(S(), today(), d);
/** Une fois de cette échéance est-elle déjà réglée (son type ne change plus) ? @param {string} id */
export const dueSettled = id => D.settledIn(S(), id);
/** Arrêter l'effacerait-il (rien de réglé, aucun retard) ? @param {string} id */
export const dueStopErases = id => D.stopErases(S(), id, today());
/**
 * Aperçu d'une modification d'échéance (D18, revu le 2026-11-12) : ses fois si on l'enregistrait, sans rien écrire ;
 * ou le refus du domaine, tel qu'il serait dit.
 * @param {string} id @param {Record<string, any>} changes
 * @returns {{ list: import('../domain/dues.js').DueView[]|null, error: string|null }}
 */
export function previewDueUpdate(id, changes) {
  const t = today();
  let n = 0;
  try {
    const next = simulate(S(), [{ type: 'due.update', id, changes }], { today: t, newId: () => `apercu-${++n}` }, new Date().toISOString());
    return { list: D.occurrencesOf(next, t, D.headOf(next, id)), error: null };
  } catch (e) {
    if (e instanceof DomainError) return { list: null, error: e.message };
    console.error(e);
    return { list: null, error: 'Impossible de calculer les prochaines dates.' };
  }
}
/** Échéances à régler jusqu'à une date (Journal « À venir »), retards compris. @param {string} until */
export const duesUntil = until => D.duesOf(S(), today(), until);
export const scheduleById = id => D.scheduleById(S(), id);
/** La prochaine date encore à régler d'une règle, ou null. @param {string} id */
export const scheduleNext = id => { const r = D.scheduleById(S(), id); return r ? D.nextPending(S(), r, today()) : null; };
export const schedules = () => lazy('schedules', s => D.schedulesOf(s));
/** Une échéance en retard ou du jour (pastille, cloche). */
export const duesToLook = () => lazy('duesLook:' + today(), s => D.duesOf(s, today(), today()).filter(d => !d.paused));
// data : { kind, amount, accountId, toAccountId, categoryId, note, start, every, end, times, reserve }
export async function createDue(data, { onError: own = null } = {}) {
  const id = uid();
  const ok = await runOwn([{ type: 'due.create', id, ...data }], own);
  return ok ? D.scheduleById(S(), id) : null;
}
export const updateDue = (id, changes, { onError: own = null } = {}) => runOwn([{ type: 'due.update', id, changes }], own);
export const stopDue = id => run([{ type: 'due.stop', id }]);
/** Les échéances jumelles d'une échéance, les plus anciennes d'abord (D18, « Regrouper »). @param {string} id */
export const dueTwins = id => D.twinsOf(S(), id, today());
/** Ce que regrouper une échéance avec ses jumelles changerait, ou null. @param {string} id */
export const dueMerge = id => D.mergeOf(S(), id, today());
/**
 * Regrouper une échéance avec ses jumelles (D18, 2026-11-20) : la plus ancienne prend la somme des montants à partir de
 * la prochaine fois, les autres s'arrêtent (leurs retards restent à régler) ; un seul enregistrement, tout ou rien.
 * Renvoie l'échéance gardée, ou null. @param {string} id
 */
export async function mergeDues(id) {
  const m = D.mergeOf(S(), id, today());
  if (!m) return null;
  const ok = await run([{ type: 'due.update', id: m.keep.id, changes: m.changes }, ...m.others.map(x => ({ type: 'due.stop', id: x.id }))]);
  return ok ? m.keep : null;
}
/**
 * La plus ancienne des échéances dont une nouvelle serait la jumelle (D18, « Ajouter au montant de … ? »), ou null :
 * la création est rejouée sans rien écrire. @param {Record<string, any>} data comme createDue
 */
export function twinOfNew(data) {
  const t = today();
  try {
    const next = simulate(S(), [{ type: 'due.create', id: 'apercu-nouvelle', ...data }], { today: t, newId: () => 'apercu-id' }, new Date().toISOString());
    const twin = D.twinsOf(next, 'apercu-nouvelle', t)[0];
    return twin ? D.scheduleById(S(), twin.id) : null;
  } catch (e) {
    if (!(e instanceof DomainError)) console.error(e);
    return null;
  }
}
/**
 * Ajouter une nouvelle échéance au montant de sa jumelle plutôt que la créer (D18, 2026-11-20) : une modification de
 * l'existante, à partir de sa prochaine fois. @param {string} id l'existante @param {Record<string, any>} data comme createDue
 */
export function addToDue(id, data, { onError: own = null } = {}) {
  const r = D.scheduleById(S(), id);
  if (!r) return Promise.resolve(null);
  return runOwn([{ type: 'due.update', id, changes: D.mergeChanges(r, [{ amount: data.amount, reserve: data.reserve ?? null }]) }], own);
}
/** Confirmer une échéance (tx : ce qu'on a changé avant). @param {{ schedule: string|null, entry: string|null, date: string }} d @param {Record<string, any>} [tx] */
export const confirmDue = (d, tx = {}, { onError: own = null } = {}) => runOwn([{ type: 'due.confirm', id: d.schedule, on: d.date, entry: d.entry, tx }], own);
/** Passer une échéance (une ancienne opération prévue est annulée). @param {{ schedule: string|null, entry: string|null, date: string }} d */
export const skipDue = d => run([{ type: 'due.skip', id: d.schedule, on: d.date, entry: d.entry }]);
/**
 * Confirmer la semaine (D18 revu le 2026-11-18) : plusieurs fois d'une échéance d'un seul enregistrement ; chacune
 * confirmée (tx : son montant changé) ou passée. Tout ou rien.
 * @param {{ d: any, ok: boolean, tx?: Record<string, any> }[]} list @param {{ onError?: any }} [o]
 */
export const settleDues = (list, { onError: own = null } = {}) => runOwn(list.map(({ d, ok, tx = {} }) => (ok
  ? { type: 'due.confirm', id: d.schedule, on: d.date, entry: d.entry, tx }
  : { type: 'due.skip', id: d.schedule, on: d.date, entry: d.entry })), own);
export const unskipDue = (id, on) => run([{ type: 'due.unskip', id, on }]);
/**
 * Un autre montant pour une seule fois encore à régler, ou celui de la règle (amount null) ; aucun solde n'est regardé
 * (2026-11-24). @param {{ schedule: string|null, date: string }} d @param {number|null} amount
 */
export const adjustDue = (d, amount, { onError: own = null } = {}) => runOwn([{ type: 'due.adjust', id: d.schedule, on: d.date, amount }], own);
// --- épargne et réserves (D17) : tout ce qui est mis de côté pour une réserve est une lecture ---
export const savingsAccounts = () => accounts().filter(a => a.savings);
export const emergencyAccount = () => accounts().find(a => a.emergency) || null;
// Dépense mensuelle moyenne des 3 derniers mois (monnaie principale), pour le fonds d'urgence.
export const monthlySpend = () => lazy('monthlySpend:' + today(), s => V.monthlySpend(s, Q.settingsOf(s).currency, today()));
// Répartition, réserves, épargne libre, objectif et signaux d'un portefeuille d'épargne.
/** Ce que deviendrait la répartition d'une épargne après une dépense sur une réserve (rien n'est écrit). @param {string} w @param {string} r @param {number} amount */
export const allocationAfter = (w, r, amount) => V.allocationAfter(S(), w, today(), r, amount);
export const savingsReport = id => lazy('savings:' + id + ':' + today(), s => V.savingsReport(s, id, today(), { monthlySpend: monthlySpend() }));
/** Le manque d'une épargne si cette dépense prévue existait telle quelle (2026-11-26) ; rien n'est écrit. @param {string} w @param {{ id?: string|null, amount: number, due: string|null, mode: 'once'|'gradual' }} cand */
export const shortfallWith = (w, cand) => V.shortfallWith(S(), w, today(), Q.settingsOf(S()).monthStart, cand);
/** Toutes les réserves (ouvertes d'abord, par échéance). */
export const reservesOf = () => lazy('reserves', s => V.reservesOf(s));
export const reserveById = id => lazy('reserves', s => V.reservesOf(s)).find(r => r.id === id) || null;
// Réserves terminées d'un portefeuille (les plus récentes d'abord), les fois successives d'une réserve, reconduite ou non,
// opérations d'utilisation supprimées depuis (D17).
// une réserve abandonnée (close sans avoir rien payé) n'y entre pas (D17 revu)
export const closedReserves = walletId => lazy('reserves', s => V.reservesOf(s)).filter(r => r.closed && !V.isAbandoned(r) && (!walletId || r.wallet === walletId))
  .sort((a, b) => (a.closed < b.closed ? 1 : a.closed > b.closed ? -1 : 0));
export const reserveChain = id => V.reserveChain(S(), id);
// Réserve utilisée par une opération (D17), ou null : la catégorie dit pour quoi, la réserve d'où l'argent était préparé.
export const reserveOfEntry = entryId => lazy('reserveByEntry', s => { const m = new Map(); for (const r of V.reservesOf(s)) for (const e of r.uses) m.set(e, r); return m; }).get(entryId) || null;
export const reserveReconducted = id => V.reconducted(S(), id);
export const reserveDeletedUses = r => V.deletedUses(S(), r);
// Opérations qui l'ont utilisée et comptent toujours ({ id, date }, les plus anciennes d'abord) : le Journal filtré sur elle.
export const reserveUses = r => V.liveUses(S(), r);
// Budgets terminés (D11) : finis, qui ne se répètent pas, avec ce qu'ils ont dépensé ; « Reconduire ».
export const finishedBudgets = () => lazy('finishedBudgets:' + today(), s => B.finishedBudgets(s, today()));
// Budgets terminés d'une catégorie (sa page), les plus récents d'abord.
// Budgets terminés, une ligne par catégorie (2026-11-12) : combien, et le plus récent.
export const finishedGroups = () => lazy('finishedGroups:' + today(), s => B.finishedGroups(s, today()));
export const finishedOf = catId => lazy('finishedAll:' + today(), s => B.finishedBudgets(s, today(), Infinity)).filter(x => x.budget.category === catId);
export const finishedBudget = id => lazy('finishedAll:' + today(), s => B.finishedBudgets(s, today(), Infinity)).find(x => x.budget.id === id) || null;
// Budgets par catégorie, dans l'ordre rangé (écran Budget et sa page « Toutes les catégories »).
// Ce que fait la dépense qu'on saisit sur le budget (ou l'habitude) de sa catégorie (saisie, D4).
export const spendImpact = d => B.spendImpact(S(), today(), d);
/** Le budget où compte une dépense payée d'un portefeuille courant (2026-11-13), ou null. @param {any} t */
export const budgetOfTx = t => {
  if (!t || t.type !== 'expense' || t.planned || t.void || !t.categoryId) return null;
  const a = S().accounts.get(t.accountId);
  return a && B.isCurrent(a) ? B.coveringBudget(S(), t.categoryId, a.currency, t.date) : null;
};
export const categoryBoard = () => lazy('catBoard:' + today(), s => B.categoryBoard(s, today()));
// Budgets de sous-catégories plus gros que celui de leur principale (on prévient, 2026-11-11).
export const subsOver = catId => B.subsOver(S(), today(), catId);
export const openReserves = walletId => lazy('reserves', s => V.reservesOf(s)).filter(r => !r.closed && (!walletId || r.wallet === walletId));
export async function createReserve(data, { onError: own = null } = {}) {
  const id = uid();
  const ok = await runOwn([{ type: 'reserve.create', id, ...data }], own);
  return ok ? reserveById(id) : null;
}
export const updateReserve = (id, changes, { onError: own = null } = {}) => runOwn([{ type: 'reserve.update', id, changes }], own);
export const reduceReserve = (id, to) => run([{ type: 'reserve.reduce', id, to }]);
export const closeReserve = id => run([{ type: 'reserve.close', id }]);
export const pauseReserve = id => run([{ type: 'reserve.pause', id }]);
export const resumeReserve = (id, due) => run([{ type: 'reserve.resume', id, due }]);
export const setSettings = patch => run([{ type: 'settings.change', changes: patch }]);

// Export CSV (séparateur « ; », virgule décimale, lisible par un tableur en français).
// Le montant est dans l'unité de la devise de son portefeuille (colonne « devise »).
export function toCSV() {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const amt = t => { const d = currencyOf(txCur(t)).dec; return (t.amount / 10 ** d).toFixed(d).replace('.', ','); };
  const rows = [['date', 'type', 'montant', 'devise', 'portefeuille', 'vers', 'categorie', 'note', 'statut', 'reserve'].join(';')];
  [...transactions()].sort(byDateDesc).forEach(t => {
    rows.push([
      t.date, { expense: 'dépense', income: 'revenu', transfer: 'virement' }[t.type], amt(t), txCur(t),
      q(account(t.accountId)?.name), q(t.toAccountId ? account(t.toAccountId)?.name : ''),
      q(t.categoryId ? categoryLabel(t.categoryId) : ''), q(t.note), t.planned ? 'prévu' : 'payé', q(reserveOfEntry(t.id)?.name || ''),
    ].join(';'));
  });
  return '﻿' + rows.join('\n');
}

// Petites préférences d'interface sans redessin (dernier portefeuille utilisé…) : restent dans localStorage.
export function pref(key, value) {
  const prefix = GLOBAL_PREFS.has(key) ? 'cauri:' : PREFIX;
  if (value === undefined) return read('pref:' + key, null, prefix);
  write('pref:' + key, value, prefix);
}

// Style de l'app (D1, 2026-11-17) : « carnet » (par défaut) ou « proto » ; un réglage du téléphone, commun aux espaces.
export const uiStyle = () => (pref('style') === 'proto' ? 'proto' : 'carnet');
/** Change le style : le document le prend tout de suite (html[data-style]), l'écran ouvert est redessiné ; ses réglages
 * (les coins) reviennent à ceux du style ; la police reste. @param {'carnet'|'proto'} v */
export function setUiStyle(v) {
  pref('style', v === 'proto' ? 'proto' : null);
  pref('look', null);
  applyLook();
  window.dispatchEvent(new Event('bougette:restyle'));
  syncAppIcon();
}

/**
 * L'affichage réglé à la main (2026-11-20, avec l'utilisateur : Moi › Affichage, une page à part) : la police (une seule
 * pour tout, texte et chiffres, dans les deux styles : Satoshi par défaut, ou Geist ; 2026-11-24, avec l'utilisateur : plus
 * de mélange de polices, plus de monospace en Proto) et les coins (round ou square ; ce qui n'est pas réglé suit le style).
 * La police est un réglage à part : changer de style ne la change pas. Un réglage du téléphone, commun aux espaces.
 * La police : son identifiant (core/fonts.js).
 * Les icônes d'interface : Phosphor (par défaut) ou Solar (2026-11-24, avec l'utilisateur ; avant : Solar venait avec Proto),
 * un réglage à part comme la police.
 * @returns {{ font: string, icons: 'phosphor'|'solar', radius: 'round'|'square' }}
 */
export function look() {
  const l = /** @type {any} */ (pref('look') || {}), proto = uiStyle() === 'proto';
  return { font: parseFont(/** @type {string} */ (pref('font'))).value, icons: pref('icons') === 'solar' ? 'solar' : 'phosphor', radius: l.radius || (proto ? 'square' : 'round') };
}
/** @param {Partial<{ font: string, icons: string, radius: string }>} ch */
export function setLook(ch) {
  const { font, icons, ...rest } = ch;
  if (font) { const v = parseFont(font).value; pref('font', v === DEFAULT_FONT ? null : v); }
  if (icons) pref('icons', icons === 'solar' ? 'solar' : null);
  if (Object.keys(rest).length) pref('look', { .../** @type {any} */ (pref('look') || {}), ...rest });
  applyLook();
  window.dispatchEvent(new Event('bougette:restyle'));
}
/** Le document prend le style et l'affichage (html[data-style], data-font, data-radius). */
export function applyLook() {
  const d = document.documentElement, l = look();
  d.dataset.style = uiStyle();
  d.dataset.font = l.font;
  d.dataset.icons = l.icons;
  d.style.setProperty('--sans', fontStack(l.font));
  d.dataset.radius = l.radius;
}
/** L'icône de l'app suit le style (D1, 2026-11-18 ; téléphone seulement : window.BougetteIcon, IconBridge.kt). */
export function syncAppIcon() {
  try { /** @type {any} */ (globalThis).BougetteIcon?.setIcon(uiStyle()); } catch (e) { console.error('Icône de l’app', e); }
}
