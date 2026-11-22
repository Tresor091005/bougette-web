// Cloche (D17) : ce que l'épargne a à dire et que Plan ne dit pas (2026-11-21, avec l'utilisateur : la cloche ne répète
// pas Plan ; une réserve échue, pas prête à temps ou sans rien de prévu s'y voit déjà, avec la pastille de l'onglet). Une
// réserve en une fois prête (une fois : « Tu la dépenses quand ? ») ; un objectif atteint (une fois). Au-delà de trois
// du même genre, un seul message qui les compte. Chaque message part de lui-même quand la situation est réglée. Lu à
// l'ouverture et après chaque changement des données.
import { savingsAccounts, savingsReport, pref, openSpaceId } from './store.js';
import { currentSpace } from './spaces.js';
import { money } from './format.js';
import { notify, resolve, messages } from './inbox.js';

// les messages d'ici, et ceux d'avant (échéances, réserves à revoir : retirés le 2026-11-21), qui partent d'eux-mêmes
const KEY = /^(res|goal|due)-/;
const MAX = 3;
const MANY = {
  ready: (/** @type {number} */ n) => ({ key: 'res-ready-many', kind: /** @type {const} */ ('ok'), title: `${n} réserves prêtes`, body: 'Choisis quand tu les dépenses.', action: { label: 'Voir', id: 'savings' } }),
  goal: (/** @type {number} */ n) => ({ key: 'goal-many', kind: /** @type {const} */ ('ok'), title: `${n} objectifs atteints`, body: '' }),
};

export function checkReserves() {
  if (currentSpace().id !== openSpaceId()) return; // on passe à un autre espace : ses données ne sont pas encore là
  /** @type {Set<string>} */
  const live = new Set();
  // les messages de chaque genre, envoyés à la fin : un par un, ou un seul qui les compte
  /** @type {Record<keyof MANY, Array<{ key: string, send: () => void }>>} */
  const groups = { ready: [], goal: [] };
  /** @param {keyof MANY} g @param {Omit<import('./inbox.js').Message, 'at'|'read'>} m */
  const say = (g, m) => groups[g].push({ key: m.key, send: () => notify(m) });
  /** @param {keyof MANY} g @param {string} key déjà dans la cloche, il y reste */
  const keep = (g, key) => { if (messages().some(m => m.key === key)) groups[g].push({ key, send: () => {} }); };
  // déjà signalés : on ne répète pas (préférences du téléphone)
  const goalSeen = new Set(/** @type {string[]} */ (pref('goalSeen') || []));
  const readySeen = new Set(/** @type {string[]} */ (pref('readySeen') || []));
  const goalNow = new Set(), readyNow = new Set();
  for (const a of savingsAccounts()) {
    if (a.archived) continue;
    const r = savingsReport(a.id);
    const cur = a.currency;
    for (const v of r.reserves) {
      const res = v.reserve;
      // en une fois et remplie (2026-11-19, avec l'utilisateur) : une fois, « Tu la dépenses quand ? » (Maintenant, le jour
      // de son échéance, une autre date)
      if (res.mode !== 'once' || !v.full || v.overdue) continue;
      readyNow.add(res.id);
      if (readySeen.has(res.id)) { keep('ready', `res-ready-${res.id}`); continue; }
      say('ready', { key: `res-ready-${res.id}`, kind: 'ok', title: `${res.name} est prête`, body: 'Tu la dépenses quand ?', action: { label: 'Choisir', id: `when:${res.id}` } });
    }
    if (r.goal?.reached) {
      goalNow.add(a.id);
      if (goalSeen.has(a.id)) keep('goal', `goal-ok-${a.id}`);
      else say('goal', { key: `goal-ok-${a.id}`, kind: 'ok', title: 'Objectif atteint', body: `${a.name} : ${money(r.goal.amount, { cur })}.` });
    }
  }
  for (const [g, list] of /** @type {Array<[keyof MANY, typeof groups.ready]>} */ (Object.entries(groups))) {
    if (list.length > MAX) {
      const m = MANY[g](list.length);
      live.add(m.key);
      if (messages().find(x => x.key === m.key)?.title !== m.title) notify(m);
    } else for (const e of list) { live.add(e.key); e.send(); }
  }
  pref('readySeen', [...readyNow]);
  pref('goalSeen', [...goalNow]);
  for (const m of messages()) if (KEY.test(m.key) && !live.has(m.key)) resolve(m.key);
}
