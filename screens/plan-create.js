// Programmer une opération (2026-11-26, avec l'utilisateur : une seule feuille pour noter et programmer — la saisie, dont la
// date décide ; voir src/screens/entry/plan.js) : ce qui se passe quand on enregistre une opération à venir ou qui se
// répète. D'abord la question « La préparer ? » (2026-11-25 : une dépense qui laisse des mois sans elle — leavesEmptyMonths —
// se propose en dépense prévue dans l'épargne, ou se garde telle quelle ; la personne décide, rien ne change en silence),
// puis la jumelle (« Ajouter au montant de … ? » : la même opération les mêmes jours, D18 2026-11-20), puis la création.
// Le message dit ce qui est fait : pour une seule fois, il donne la date (« Programmée pour le … »).
import { account, category, settings, createDue, createReserve, openReserves, savingsAccounts, twinOfNew, addToDue, scheduleById, dueHead } from '../core/store.js';
import { money, esc, yearDate, today, currencyOf } from '../core/format.js';
import { toast, menuSheet, confirmSheet, buzz } from '../core/ui.js';
import { DUE, RES } from '../domain/words.js';
import { whenPhrase, leavesEmptyMonths } from '../domain/when.js';
import { openAccountSheet } from './accounts.js';
import { numDate } from './reserves.js';
import { dayShort, dueTitle, dueHref } from './due-page.js';

/** @typedef {import('../domain/dues.js').Schedule} Schedule */
/** @param {string} x */
const low = x => x.charAt(0).toLowerCase() + x.slice(1);
/** « Voir » : la page de l'opération qui vient d'être créée. @param {Schedule} made */
const see = made => ({ label: 'Voir', run: () => { location.hash = dueHref(made.id); } });

/**
 * Programmer : la question, la jumelle, la création. data : { kind, amount, accountId, toAccountId, categoryId, note, start,
 * every, interval, days, by, end, times }. Résout ce qui a été fait — 'created', 'added' (à la jumelle), 'prepared' (dépense
 * prévue dans l'épargne) —, ou what null (fermée sans choisir, ou refus d'écriture : onError l'a dit). later : à lancer une
 * fois la feuille refermée (la fiche d'une épargne à créer en passant).
 * @param {Record<string, any>} data @param {{ cur?: string, onError?: ((msg: string) => void)|null }} [o]
 * @returns {Promise<{ what: 'created'|'added'|'prepared'|null, made: Schedule|null, later?: () => void }>}
 */
export async function createPlanned(data, { cur = account(data.accountId)?.currency || 'XOF', onError = null } = {}) {
  const none = { what: /** @type {null} */ (null), made: null };
  const err = onError ? { onError } : {};
  // 1. La question : une dépense qui laisse des mois sans elle
  if (data.kind === 'expense' && leavesEmptyMonths(/** @type {any} */ (data), today(), settings().monthStart)) {
    const k = await askPrepare(data, cur);
    if (!k) return none;
    if (k !== 'keep') return prepare(data, k === 'new' ? null : k, cur, err);
  }
  // 2. La jumelle d'une opération qui existe : l'ajouter à son montant plutôt qu'en créer une autre
  const twin = twinOfNew(data);
  if (twin) {
    const total = money(twin.amount + data.amount, { cur: twin.currency });
    const k = await menuSheet({ title: `Ajouter au montant de ${esc(dueTitle(twin))} ?`, items: [
      { key: 'add', icon: 'plus', label: 'Oui, ajouter', note: `${esc(dueTitle(twin))} tombe les mêmes jours : elle passe à ${total} à partir de sa prochaine fois` },
      { key: 'new', icon: 'copy', label: 'Non, créer quand même', note: `Deux ${DUE.many} les mêmes jours` },
    ] });
    if (!k) return none;
    if (k === 'add') {
      if (!(await addToDue(twin.id, data, err))) return none;
      buzz(12);
      const head = scheduleById(dueHead(twin.id)) || twin;
      toast(`${dueTitle(twin)} : ${total}`, see(head));
      return { what: 'added', made: head };
    }
  }
  // 3. La création
  const made = await createDue(data, err);
  if (!made) return none;
  buzz(12);
  // une seule fois : le message donne la date ; sinon il dit qu'elle est créée
  toast(!data.every && !data.days?.length ? `Programmé${DUE.e} pour le ${dayShort(data.start)}. Tu confirmes ce jour-là.` : `${DUE.One} créé${DUE.e}`, see(made));
  return { what: 'created', made };
}

/** Où elle est passée (2026-11-25, avec l'utilisateur : on ne cherche pas une opération programmée qui n'existe pas). @param {string} name @param {any} w */
function preparedToast(name, w) {
  toast(`${name} : préparée dans ${w.name}`, { label: 'Voir', run: () => { location.hash = `#/epargne?w=${encodeURIComponent(w.id)}`; } });
}

/**
 * Préparer (2026-11-25) : une dépense prévue dans l'épargne — le nom (sinon la catégorie), le montant, la catégorie, la date
 * de la première fois, en une fois, et le rythme gardé (proposer la fois suivante quand on l'utilise). Une épargne qui a un
 * objectif le perd à sa première dépense prévue : on prévient, comme sa feuille. Sans épargne, la feuille d'une nouvelle
 * s'ouvre (comme la saisie sans portefeuille), puis la dépense prévue s'y crée.
 * @param {Record<string, any>} d @param {string|null} savId l'épargne choisie ; null : en créer une @param {string} cur @param {{ onError?: any }} err
 * @returns {Promise<{ what: 'prepared'|null, made: null, later?: () => void }>}
 */
async function prepare(d, savId, cur, err) {
  const name = (d.note.trim() || category(d.categoryId)?.name || '').slice(0, 28);
  const data = { name, amount: d.amount, due: d.start, mode: 'once', category: d.categoryId, every: d.every || null, interval: d.every ? d.interval : 1, ...(d.every && d.by ? { by: d.by } : {}) };
  const w = savId ? account(savId) : null;
  if (!w) {
    return { what: 'prepared', made: null, later: () => openAccountSheet(null, { savings: true, intro: `Pour préparer ${name}, crée d’abord ton épargne.`, onSaved: async (/** @type {any} */ a) => {
      const amount = Math.round(data.amount * 10 ** (currencyOf(a.currency).dec - currencyOf(cur).dec));
      if (await createReserve({ wallet: a.id, ...data, amount })) { buzz(12); preparedToast(name, a); }
    } }) };
  }
  let dropGoal = false;
  if (w.goal && !openReserves(w.id).length) {
    const yes = await confirmSheet({ title: `${esc(w.name)} a un objectif`, text: `Son objectif de ${money(w.goal.amount, { cur: w.currency })}${w.goal.on ? ` pour le ${yearDate(w.goal.on)}` : ''} sera retiré : l’épargne suivra ${RES.yourMany}.`, yes: `Créer ${RES.the}` });
    if (!yes) return { what: null, made: null };
    dropGoal = true;
  }
  const made = await createReserve({ wallet: w.id, ...data, ...(dropGoal ? { dropGoal: true } : {}) }, err);
  if (!made) return { what: null, made: null };
  buzz(12);
  preparedToast(name, w);
  return { what: 'prepared', made: null };
}

/**
 * La question, à la validation (2026-11-25, avec l'utilisateur : la situation d'abord, puis les deux choix ; la personne
 * décide). Résout l'id de l'épargne où la préparer, 'new' (en créer une), 'keep' (la garder telle quelle), ou null (fermée).
 * @param {Record<string, any>} d @param {string} cur
 */
async function askPrepare(d, cur) {
  const savChoices = savingsAccounts().filter(x => !x.archived && !x.emergency);
  const name = esc(d.note.trim() || category(d.categoryId)?.name || 'Cette dépense');
  const amt = money(d.amount, { cur });
  const months = Math.max(1, Math.round((Date.parse(d.start) - Date.parse(today())) / (30.44 * 864e5)));
  const title = d.every ? `${name} ne revient pas chaque mois` : `${name}, c’est dans ${months} mois`;
  const text = (d.every
    ? `Elle revient ${esc(low(whenPhrase(/** @type {any} */ (d))))} : des mois passent sans elle, et le jour venu, ${amt} tombent d’un coup sur un seul mois.`
    : `Elle tombe le ${esc(yearDate(d.start))} : le jour venu, ${amt} tombent d’un coup sur un seul mois.`)
    + ` Tu peux plutôt la préparer : mettre de côté un peu chaque mois dans ton épargne, et l’utiliser le jour venu${d.every ? ' (l’app te propose alors la fois suivante)' : ''}.`;
  const same = savChoices.filter(a => a.currency === cur).slice(0, 3);
  const note = `${RES.A} de ${amt} pour le ${numDate(d.start)}, dans ton épargne`;
  return menuSheet({ title, text, items: [
    ...(same.length ? same.map(a => ({ key: a.id, icon: 'piggy-bank', label: same.length > 1 ? `La préparer dans ${esc(a.name)}` : 'La préparer', note }))
      : [{ key: 'new', icon: 'piggy-bank', label: 'La préparer', note: `${note} (à créer)` }]),
    { key: 'keep', icon: d.every ? 'arrows-clockwise' : 'calendar-blank', label: d.every ? `Garder en ${DUE.one}` : 'La garder telle quelle',
      note: 'Rien de mis de côté : tu la confirmes le jour venu' },
  ] });
}
