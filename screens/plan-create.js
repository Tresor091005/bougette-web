// Programmer une opération (2026-11-26, avec l'utilisateur : une seule feuille pour noter et programmer — la saisie, dont la
// date décide ; voir src/screens/entry/plan.js) : ce qui se passe quand on enregistre une opération à venir ou qui se
// répète. D'abord la question « La préparer ? » (2026-11-25 : une dépense qui laisse des mois sans elle — leavesEmptyMonths —
// se propose en dépense prévue dans l'épargne, ou se garde telle quelle ; la personne décide, rien ne change en silence),
// puis la jumelle (« Ajouter au montant de … ? » : la même opération les mêmes jours, D18 2026-11-20), puis la création.
// Le message dit ce qui est fait : pour une seule fois, il donne la date (« Programmée pour le … »).
import { account, category, settings, createDue, createReserve, openReserves, savingsAccounts, twinOfNew, addToDue, scheduleById, dueHead, usualSpend, savingsReport } from '../core/store.js';
import { money, esc, yearDate, today, currencyOf } from '../core/format.js';
import { toast, menuSheet, confirmSheet, buzz } from '../core/ui.js';
import { DUE, RES } from '../domain/words.js';
import { whenPhrase, leavesEmptyMonths } from '../domain/when.js';
import { monthSpan } from '../domain/month-start.js';
import { addDays } from '../domain/dues.js';
import { approxUp } from '../core/format.js';
import { worthPreparing } from '../domain/reserves.js';

/**
 * Les mois de Bougette (selon le début du mois) où l'on peut mettre de côté avant la date : celui d'aujourd'hui, puis
 * chacun qui commence avant elle. C'est ce que la question promet (2026-11-27, avec l'utilisateur : « c'est dans 1 mois »,
 * compté en mois de 30 jours, ne disait pas qu'un mois entier passerait sans elle).
 * @param {string} date @param {number|string} monthStart
 */
export function monthsBefore(date, monthStart) {
  let n = 0;
  for (let m = monthSpan(today(), monthStart); m.start < date && n < 600; m = monthSpan(addDays(m.end, 1), monthStart)) n++;
  return Math.max(1, n);
}
import { openAccountSheet } from './accounts.js';
import { openReserveSheet } from './reserves.js';
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
  if (data.kind === 'expense' && leavesEmptyMonths(/** @type {any} */ (data), today(), settings().monthStart)
    && worthPreparing(data.amount, monthsBefore(data.start, settings().monthStart), usualSpend(cur))) {
    const k = await askPrepare(data, cur);
    if (!k) return none;
    if (k === 'prep') {
      // une seule épargne : elle la prend ; plusieurs : la feuille d'une dépense prévue, préremplie, où l'on choisit
      // l'épargne (2026-11-27, avec l'utilisateur : un seul choix ici, pas un par épargne)
      const same = sameSavings(cur);
      if (same.length === 1) return prepare(data, same[0].id, cur, err);
      // la feuille s'ouvre par-dessus la saisie, qui ne se ferme que si la dépense prévue est créée : fermée sans valider,
      // on retrouve sa saisie telle quelle (2026-11-27, avec l'utilisateur)
      const made = await new Promise(done => openReserveSheet({ preset: presetOf(data), onDone: done, openEntry: (/** @type {any} */ o) => import('./entry.js').then(m => m.openEntry(o)) }));
      return made ? { what: 'prepared', made: null } : none;
    }
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
 * décide). Résout 'prep' (la préparer dans une épargne), 'new' (en créer une d'abord), 'keep' (la garder telle quelle), ou null (fermée).
 * @param {Record<string, any>} d @param {string} cur
 */
/** Les épargnes qui peuvent préparer une dépense dans cette devise. @param {string} cur */
const sameSavings = cur => savingsAccounts().filter(x => !x.archived && !x.emergency && x.currency === cur);
/** Ce que la feuille d'une dépense prévue reprend d'une dépense programmée (son rythme gardé pour la reconduction). @param {Record<string, any>} d */
const presetOf = d => ({ name: (d.note.trim() || category(d.categoryId)?.name || '').slice(0, 28), amount: d.amount, due: d.start, mode: 'once', category: d.categoryId,
  keep: { every: d.every || null, interval: d.every ? d.interval : 1, ...(d.every && d.by ? { by: d.by } : {}) } });
async function askPrepare(d, cur) {
  const name = esc(d.note.trim() || category(d.categoryId)?.name || 'Cette dépense');
  const amt = money(d.amount, { cur });
  // ce que la préparer change, en chiffres : le montant réparti sur les mois de Bougette qui passent avant elle
  const months = monthsBefore(d.start, settings().monthStart);
  // un compte rond, dit « environ » quand la division ne tombe pas juste (5 000 F sur 3 mois : environ 2 000 F)
  const each = d.amount % months === 0 ? money(d.amount / months, { cur }) : `environ ${money(approxUp(Math.ceil(d.amount / months), cur), { cur })}`;
  const title = months > 1 ? `${name} : ${months} mois pour la préparer` : `${name} : à préparer ce mois-ci`;
  const text = (d.every
    ? `Elle revient ${esc(low(whenPhrase(/** @type {any} */ (d))))}, la prochaine fois le ${esc(yearDate(d.start))}. Sans rien prévoir, ${amt} partent d’un coup ce mois-là.`
    : `Elle tombe le ${esc(yearDate(d.start))}. Sans rien prévoir, ${amt} partent d’un coup ce mois-là.`)
    + (months > 1 ? ` En la préparant, c’est ${each} par mois pendant ${months} mois, dans ton épargne` : ' En la préparant, tu mets ce montant de côté dans ton épargne dès ce mois-ci')
    + `, et tu l’utilises le jour venu${d.every ? ' (l’app te propose alors la fois suivante)' : ''}.`;
  const same = sameSavings(cur);
  // l'accumulation, c'est l'épargne qui la juge ; la question rappelle seulement si elle manque déjà de quelque chose
  const gap = same.length === 1 ? savingsReport(same[0].id)?.versement?.gap || 0 : 0;
  const say = gap > 0 ? `${text}<br><br>Ton épargne manque déjà de ${money(gap, { cur })} par mois.` : text;
  const note = `${RES.A} de ${amt} pour le ${numDate(d.start)}, dans ton épargne`;
  return menuSheet({ title, text: say, items: [
    same.length ? { key: 'prep', icon: 'piggy-bank', label: 'La préparer', note }
      : { key: 'new', icon: 'piggy-bank', label: 'La préparer', note: `${note} (à créer)` },
    { key: 'keep', icon: d.every ? 'arrows-clockwise' : 'calendar-blank', label: d.every ? `Garder en ${DUE.one}` : 'La garder telle quelle',
      note: 'Rien de mis de côté : tu la confirmes le jour venu' },
  ] });
}
