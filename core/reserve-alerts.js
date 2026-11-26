// Cloche (D17) : ce que l'épargne a à dire et que Plan ne dit pas ; le jour J d'une dépense prévue (« c'est le jour », une
// fois, 2026-11-25) ; (2026-11-21, avec l'utilisateur : la cloche ne répète
// pas Plan ; une réserve échue, pas prête à temps ou sans rien de prévu s'y voit déjà, avec la pastille de l'onglet). Une
// réserve en une fois prête (une fois ; « Voir » ouvre son menu, le même partout, 2026-11-25) ; un objectif atteint (une fois). Au-delà de trois
// du même genre, un seul message qui les compte. Chaque message part de lui-même quand la situation est réglée. Lu à
// l'ouverture et après chaque changement des données.
import { savingsAccounts, savingsReport, pref, openSpaceId } from './store.js';
import { currentSpace } from './spaces.js';
import { money } from './format.js';
import { notify, resolve, messages } from './inbox.js';
import { RES } from '../domain/words.js';

// les messages d'ici, et ceux d'avant (échéances, réserves à revoir : retirés le 2026-11-21), qui partent d'eux-mêmes
const KEY = /^(res|goal|due)-/;
const MAX = 3;
const MANY = {
  ready: (/** @type {number} */ n) => ({ key: 'res-ready-many', kind: /** @type {const} */ ('ok'), title: `${RES.count(n)} prêt${RES.e}s`, body: 'Tout est de côté.', action: { label: 'Voir', id: 'savings' } }),
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
  const daySeen = new Set(/** @type {string[]} */ (pref('daySeen') || [])), dayNow = new Set();
  for (const a of savingsAccounts()) {
    if (a.archived) continue;
    const r = savingsReport(a.id);
    const cur = a.currency;
    for (const v of r.reserves) {
      const res = v.reserve;
      // en une fois et remplie (2026-11-19, avec l'utilisateur) : une fois ; « Voir » ouvre son menu (Utiliser, Modifier…)
      // le jour J (2026-11-25, avec l'utilisateur) : « c'est le jour », une fois ; « Utiliser » ouvre son menu
      if (v.day) {
        dayNow.add(res.id);
        live.add(`res-day-${res.id}`);
        if (!daySeen.has(res.id)) notify({ key: `res-day-${res.id}`, kind: v.full ? 'ok' : 'warn', title: `${res.name} : c’est le jour`,
          body: v.full ? 'Tout est de côté : utilise-la.' : `${money(v.saved, { cur })} de côté sur ${money(v.target, { cur })}.`, action: { label: 'Utiliser', id: `when:${res.id}` } });
        continue;
      }
      if (res.mode !== 'once' || !v.full || v.overdue) continue;
      readyNow.add(res.id);
      if (readySeen.has(res.id)) { keep('ready', `res-ready-${res.id}`); continue; }
      say('ready', { key: `res-ready-${res.id}`, kind: 'ok', title: `${res.name} est prête`, body: 'Tout est de côté.', action: { label: 'Voir', id: `when:${res.id}` } });
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
  // ce qui est prévu ne suffit plus (D17 revu, 2026-11-23) : une fois (et de nouveau si le manque grandit), jamais à chaque
  // ouverture ; « Voir » ouvre la page de l'épargne, où tout se fait (2026-11-25, avec l'utilisateur)
  const reviewSeen = /** @type {Record<string, number>} */ (pref('reviewSeen') || {});
  /** @type {Record<string, number>} */
  const reviewNow = {};
  for (const a of savingsAccounts()) {
    if (a.archived || a.emergency) continue;
    const vers = savingsReport(a.id).versement;
    const gap = vers.gap;
    if (!gap) continue;
    const key = `res-review-${a.id}`;
    reviewNow[a.id] = Math.max(gap, reviewSeen[a.id] || 0);
    live.add(key);
    if (gap > (reviewSeen[a.id] || 0)) notify({ key, kind: 'warn', title: `${a.name} : ${RES.yourMany} ne seront pas tout${RES.e}s prêt${RES.e}s`, body: `${vers.list.length ? 'Il manque' : 'Aucun versement : il faut'} ${money(gap, { cur: a.currency })} par mois. Modifie ${RES.yourMany} ou verse plus.`, action: { label: 'Voir', id: `review:${a.id}` } });
  }
  pref('reviewSeen', reviewNow);
  pref('readySeen', [...readyNow]);
  pref('daySeen', [...dayNow]); // le jour passé, la clé part : un seul « c'est le jour » par date
  pref('goalSeen', [...goalNow]);
  for (const m of messages()) if (KEY.test(m.key) && !live.has(m.key)) resolve(m.key);
}
