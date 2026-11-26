// Épargne et réserves (D17, ROADMAP 4a) : lectures pures. Une réserve est une charge préparée à l'avance dans un
// portefeuille d'épargne. Ce qui est de côté pour elle se calcule depuis le solde (revu le 2026-11-19 : rien n'est
// enregistré) : d'abord ce que son ancienne collecte lui a versé, puis la règle des niveaux ; épargne libre = le reste.
// Son avenir (outlookOf) rejoue l'épargne avec tout ce qui est prévu sur elle pour dire si elle sera prête, et quand.
// Le manque de l'épargne (D17 revu le 2026-11-20, « une échéance est une échéance ») : ce qu'il faudrait y verser en
// plus de ce qui est prévu pour que ses réserves soient prêtes (shortfallOf) ; ses versements (versementOf).
import { walletBalances, settingsOf } from './queries.js';
import { stepOf, approxUp } from './format.js';
import { linesOf } from './projection.js';
import { monthSpan, byOptions } from './month-start.js';
// dues.js lit aussi reserves.js (reserveChain) : des fonctions seulement, appelées après le chargement des deux
import { duesOf, dueItems, scheduleById, dateAfter, nthDate } from './dues.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./projection.js').Row} Row */
/**
 * @typedef {{ id: string, wallet: string, name: string, amount: number, used: number, currency: string, start: string,
 *   due: string|null, mode: 'once'|'gradual', held: number, closed: string|null, from: string|null, uses: string[], category: string|null,
 *   created?: string, keep?: number, every: 'day'|'week'|'month'|'year'|null, interval: number,
 *   by: import('./month-start.js').By|null }} Reserve keep : en pause, ce
 *   qu'elle garde (ce qu'elle avait à la pause) ; every, interval : son rythme (2026-11-25), pour la fois suivante
 */
/**
 * Ce que dit une réserve (D17 revu le 2026-11-20) : 'full' remplie ; 'overdue' échue sans être remplie ; 'ok' prête à
 * temps ; 'later' pas prête à temps, mais ce qui est prévu la remplit plus tard (ready) ; 'short' ce qui est prévu ne la
 * remplit jamais (short : ce qui manquera à son échéance) ; 'none' rien de prévu ; 'paused' en pause, sans date (« Un jour »).
 * @typedef {'full'|'overdue'|'ok'|'later'|'short'|'none'|'paused'} ReserveStatus
 */
/**
 * day : c'est sa date aujourd'hui (2026-11-25 : le jour J, à utiliser).
 * @typedef {{ reserve: Reserve, target: number, saved: number, pct: number, full: boolean, overdue: boolean, day: boolean, soon: boolean,
 *   short: number, ready: string|null, plan: boolean, own: number, status: ReserveStatus }} ReserveView
 */

const DAY_MS = 86400e3;
/** @param {string} d */
const utc = d => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
/** Jours de a à b. @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
/** @param {string} d @param {number} n */
export const addDays = (d, n) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
/** Même jour n mois plus tard (dernier jour du mois s'il n'existe pas). @param {string} d @param {number} n */
export function addMonths(d, n) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1 + n, day = Number(d.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}

// En pause (D17 revu, 2026-11-23) : une réserve sans date (« Un jour »), due_on vide. Servie après toutes les réserves
// datées, avec ce qui reste ; hors du manque et du rejeu ; elle garde ce qu'elle a sans le bloquer (en cas de coup dur,
// son argent va d'abord aux réserves datées). Reprendre : lui redonner une date.
const FAR = '9999-12-31';
/** La date qui ordonne une réserve (en pause : après toutes les autres). @param {{ due: string|null }} r */
export const dueKey = r => r.due || FAR;
/** La date d'une réserve datée (le rejeu ne garde que celles-là). @param {{ due: string|null }} r */
const dated = r => /** @type {string} */ (r.due);
/** Une réserve en pause (sans date) ? @param {{ due: string|null }} r */
export const isPaused = r => !r.due;
/** Une réserve abandonnée : close sans avoir rien payé (elle n'entre pas dans les terminées, D17 revu). @param {{ closed: string|null, used: number }} r */
export const isAbandoned = r => !!r.closed && !r.used;

/** @param {Row} r @returns {Reserve} */
const reserveOf = r => ({
  id: r.id, wallet: r.wallet_id, name: r.name, amount: r.amount, used: r.used, currency: r.currency, start: r.start_on, due: r.due_on || null,
  mode: r.mode, held: r.held || 0, closed: r.closed_on ?? null, from: r.from_id ?? null, uses: r.uses ? JSON.parse(r.uses) : [], category: r.category_id ?? null,
  created: r.created_at || '', every: r.every ?? null, interval: r.every ? r.interval ?? 1 : 1, by: r.by_day ?? null,
});

/**
 * La date de la fois suivante, quand on reconduit une dépense prévue (2026-11-25, avec l'utilisateur) : avec un rythme,
 * sa date plus son rythme (autant de fois qu'il faut pour passer aujourd'hui ; en pause, à partir d'aujourd'hui) ; sans
 * rythme, la règle de Reconduire : la même durée qu'avant (de son début à sa date), à partir d'aujourd'hui ; sans date
 * ni rythme, dans 3 mois. Préparée depuis « le 2e lundi » (by), la fois suivante l'est aussi (sa date la permet : une
 * date repoussée qui ne la permet plus revient au quantième).
 * @param {{ start: string, due: string|null, every?: Reserve['every'], interval?: number, by?: Reserve['by'] }} r @param {string} today
 */
export function reconductDue(r, today) {
  if (r.every) {
    const start = r.due || today;
    const rule = { start, every: r.every, interval: r.interval || 1, ...(r.every === 'month' && r.by && byOptions(start).includes(r.by) ? { by: r.by } : {}) };
    for (let k = 1; k < 100000; k++) { const d = /** @type {string} */ (nthDate(rule, k)); if (d > today) return d; }
  }
  return r.due ? addDays(today, Math.max(1, daysBetween(r.start, r.due))) : addMonths(today, 3);
}
/** Réserves (ouvertes d'abord, par échéance). @param {State} s @param {{ wallet?: string, open?: boolean }} [o] */
export function reservesOf(s, { wallet, open } = {}) {
  return [...s.reserves.values()].map(reserveOf)
    .filter(r => (!wallet || r.wallet === wallet) && (!open || !r.closed))
    .sort((a, b) => (!a.closed === !b.closed ? 0 : a.closed ? 1 : -1) || (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0) || (a.id < b.id ? -1 : 1));
}
/**
 * Les fois successives d'une même réserve (reconduites l'une de l'autre), de la plus ancienne à la plus récente.
 * @param {State} s @param {string} id
 */
export function reserveChain(s, id) {
  const all = reservesOf(s);
  const byId = new Map(all.map(r => [r.id, r]));
  let first = byId.get(id);
  if (!first) return [];
  for (let guard = 0; first.from && byId.has(first.from) && guard < 1000; guard++) first = /** @type {Reserve} */ (byId.get(first.from));
  const out = [first];
  for (let guard = 0; guard < 1000; guard++) {
    const next = all.find(r => r.from === out[out.length - 1].id);
    if (!next) break;
    out.push(next);
  }
  return out;
}
/** Une réserve a-t-elle déjà été reconduite ? @param {State} s @param {string} id */
export const reconducted = (s, id) => [...s.reserves.values()].some(r => r.from_id === id);
/** Opérations qui ont utilisé une réserve et qui ont été supprimées depuis. @param {State} s @param {Reserve} r */
export const deletedUses = (s, r) => r.uses.filter(id => s.entries.get(id)?.status === 'void');
/**
 * Opérations qui ont utilisé une réserve et comptent toujours (supprimées exclues), de la plus ancienne à la plus
 * récente : ce que montre le Journal filtré sur elle. @param {State} s @param {Reserve} r
 * @returns {{ id: string, date: string }[]}
 */
export function liveUses(s, r) {
  /** @type {{ id: string, date: string }[]} */
  const out = [];
  for (const id of r.uses) {
    const e = s.entries.get(id);
    if (e && e.status !== 'void') out.push({ id, date: e.occurred_on });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Ce qui reste à viser (le montant visé moins ce qui a déjà été utilisé petit à petit). @param {Reserve} r */
export const targetOf = r => r.amount - r.used;

/**
 * Part attendue aujourd'hui, au rythme régulier de sa création à son échéance (tout, une fois l'échéance passée). Le jour
 * de la création compte déjà (revu le 2026-11-19, avec l'utilisateur) : 8 000 F sur 12 jours, c'est 1/12 dès le premier
 * jour (667 F), 2/12 le lendemain, etc.
 * @param {Reserve} r @param {string} today
 */
export function expectedOf(r, today) {
  const t = targetOf(r);
  if (!r.due) return 0; // en pause : aucun niveau à tenir, seulement ce qui reste
  if (today >= r.due) return t;
  if (today < r.start) return 0;
  const total = daysBetween(r.start, r.due);
  return total > 0 ? Math.floor((t * Math.min(total, daysBetween(r.start, today) + 1)) / total) : t;
}

/** L'ordre de la répartition : l'échéance la plus proche d'abord (à égalité, la plus petite). @param {Reserve} x @param {Reserve} y */
const byDue = (x, y) => (dueKey(x) < dueKey(y) ? -1 : dueKey(x) > dueKey(y) ? 1 : 0) || targetOf(x) - targetOf(y);

/**
 * Répartition d'un argent entre les réserves ouvertes (revue le 2026-11-26, avec l'utilisateur : « dans la vie, c'est
 * comme ça qu'on fait ») : **la plus proche d'abord, remplie avant la suivante**. S'il n'y a pas assez, ce sont les plus
 * lointaines qui attendent : elles ont encore le temps (verser plus, repousser), et « Il manque X par mois » le dit tôt.
 * Avant, chacune recevait d'abord son niveau du jour (expectedOf) : une lointaine en retard prenait l'argent d'une
 * proche (le cas Caroline : 900 F pour février, 26 400 F pour septembre de l'année suivante). Les réserves en pause
 * (sans date) : après toutes les datées, d'abord ce qu'elles avaient à la pause (keep), puis le reste ; au-delà,
 * l'épargne libre.
 * @param {number} amount @param {Reserve[]} open @param {string} _today (gardé pour les appels ; la règle ne dépend plus du jour)
 * @returns {{ parts: Record<string, number>, free: number }}
 */
export function suggestSplit(amount, open, _today) {
  /** @type {Record<string, number>} */
  const parts = {};
  let left = Math.max(0, amount);
  for (const r of open) parts[r.id] = 0;
  const order = [...open].sort(byDue);
  const give = (/** @type {Reserve} */ r, /** @type {number} */ upTo) => {
    const g = Math.min(Math.max(0, upTo - r.held - parts[r.id]), left);
    parts[r.id] += g;
    left -= g;
  };
  // 1. les datées, la plus proche d'abord : chacune remplie avant la suivante
  for (const r of order) if (r.due) give(r, targetOf(r));
  // 2. en pause (D17 revu) : une fois les datées remplies, elle garde ce qu'elle avait à la pause (keep ; mettre en pause
  // ne la vide pas) ; en cas de coup dur, les datées passent avant ; 3. au-delà, elle est servie en dernier
  for (const r of order) if (!r.due) give(r, Math.min(r.keep || 0, targetOf(r)));
  for (const r of order) give(r, targetOf(r));
  return { parts, free: left };
}

/**
 * Suggestion de reprise quand les réserves dépassent le solde (ou pour reprendre un montant) : les échéances les plus
 * lointaines d'abord.
 * @param {number} amount @param {Reserve[]} open @returns {Record<string, number>} montants à reprendre (positifs)
 */
export function suggestRelease(amount, open) {
  /** @type {Record<string, number>} */
  const out = {};
  let left = Math.max(0, amount);
  for (const r of [...open].sort((a, b) => (dueKey(a) < dueKey(b) ? 1 : dueKey(a) > dueKey(b) ? -1 : 0))) {
    const g = Math.min(r.held, left);
    if (g > 0) { out[r.id] = g; left -= g; }
  }
  return out;
}

/**
 * Vue d'une réserve : ce qui est de côté, et ce qu'elle dit (D17 revu le 2026-11-20 : plus d'avance ni de retard sur un
 * rythme ; la réserve dit seulement si elle sera prête, d'après son avenir, look, outlookOf). own : son argent propre
 * (ownOf), ce que son ancienne collecte lui a déjà versé.
 * @param {Reserve} r @param {number} saved @param {string} today @param {Outlook|null} [look] @param {number} [own]
 * @returns {ReserveView}
 */
export function reserveView(r, saved, today, look = null, own = 0) {
  const target = targetOf(r);
  const full = saved >= target;
  const paused = !r.due;
  const daysLeft = paused ? Infinity : daysBetween(today, /** @type {string} */ (r.due));
  const overdue = !paused && today > /** @type {string} */ (r.due);
  const ready = look ? look.ready : null;
  /** @type {ReserveStatus} */
  const status = full ? 'full' : paused ? 'paused' : overdue ? 'overdue' : ready && ready <= /** @type {string} */ (r.due) ? 'ok' : ready ? 'later' : look?.plan ? 'short' : 'none';
  return {
    reserve: r, target, saved, pct: target ? Math.min(100, Math.floor((saved * 100) / target)) : 100, full, overdue, day: !paused && today === r.due,
    soon: !full && daysLeft >= 0 && daysLeft <= 7, short: look && !full ? look.short : 0, ready, plan: !!look?.plan, own, status,
  };
}

/**
 * La répartition de l'épargne entre ses réserves (revu le 2026-11-19, avec l'utilisateur : personne n'a le temps de
 * répartir) : elle n'est plus enregistrée, elle se calcule à chaque fois depuis le solde du portefeuille : d'abord à
 * chaque réserve ce que son ancienne collecte lui a versé (ownOf, 2026-11-19 : la collecte est fléchée), puis le reste comme un
 * nouvel argent (suggestSplit) : ce qui met chaque réserve à son rythme, par échéance, puis le reste les complète ;
 * jamais plus que ce qu'elle vise. Ce qui dépasse reste en épargne libre. Une dépense, un retrait ou une nouvelle mise
 * de côté la refont d'elle-même.
 * @param {State} s @param {string} walletId @param {string} today
 * @returns {{ balance: number, parts: Record<string, number>, free: number, own: Record<string, number> }}
 */
export function allocationOf(s, walletId, today) {
  const balance = walletBalances(s)[walletId] || 0;
  const open = reservesOf(s, { wallet: walletId, open: true }).map(r => ({ ...r, held: 0, keep: r.due ? 0 : r.held }));
  const own = ownOf(s, open);
  const { parts } = splitOwn(Math.max(0, balance), open, own, today);
  return { balance, parts, free: balance - Object.values(parts).reduce((n, v) => n + v, 0), own };
}

/**
 * L'argent propre de chaque réserve (2026-11-19, avec l'utilisateur : sa collecte et la répartition se marchaient dessus ;
 * depuis le 2026-11-20, on ne crée plus de collecte, l'épargne a un seul versement, mais les anciennes se lisent) :
 * ce que les virements confirmés de sa collecte (l'échéance qui la remplit) ont versé sur son épargne, moins ce qu'elle a
 * payé, dans l'ordre où c'est arrivé : une dépense prend d'abord son argent propre ; payée quand elle n'en avait pas, elle
 * a pris celui de la répartition, et la collecte qui suit reste toute à elle. Jamais plus que ce qu'elle vise encore. Un
 * virement compte pour la fois de la réserve qui existait quand il a été enregistré : une réserve reconduite ne reprend
 * pas l'argent de la fois d'avant, même le jour même ; une collecte en retard confirmée après la reconduite va à la nouvelle
 * (c'est elle que l'échéance dit remplir).
 * @param {State} s @param {Reserve[]} open les réserves ouvertes d'un même portefeuille @returns {Record<string, number>}
 */
export function ownOf(s, open) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!open.length) return out;
  const wallet = open[0].wallet;
  /** @type {Record<string, { at: string, amount: number }[]>} */
  const moves = {};
  for (const r of open) moves[r.id] = [];
  /** @type {Map<string, Reserve[]>} */
  const chains = new Map();
  for (const e of s.entries.values()) {
    if (e.status !== 'posted' || e.kind !== 'transfer' || !e.schedule_id) continue;
    const linked = s.schedules.get(e.schedule_id)?.reserve_id;
    if (!linked) continue;
    if (!chains.has(linked)) chains.set(linked, reserveChain(s, linked));
    const at = /** @type {Reserve[]} */ (chains.get(linked)).filter(r => (r.created || '') <= e.created_at).pop();
    const l = at && moves[at.id] ? linesOf(s, e.id).find(x => x.account === wallet && x.amount > 0) : null;
    if (at && l) moves[at.id].push({ at: e.created_at, amount: l.amount });
  }
  for (const r of open) {
    for (const id of r.uses) {
      const e = s.entries.get(id);
      const l = e && e.status === 'posted' ? linesOf(s, id).find(x => x.account === wallet && x.amount < 0) : null;
      if (e && l) moves[r.id].push({ at: e.created_at, amount: l.amount });
    }
    let own = 0, used = 0;
    for (const m of moves[r.id].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))) {
      if (m.amount > 0) own = Math.min(own + m.amount, r.amount - used);
      else { used -= m.amount; own = Math.max(0, own + m.amount); }
    }
    out[r.id] = Math.max(0, Math.min(own, targetOf(r)));
  }
  return out;
}

/**
 * La répartition quand des réserves ont leur argent propre (ownOf) : d'abord à chacune le sien (s'il n'y a pas assez,
 * l'échéance la plus proche d'abord), puis le reste selon la règle des niveaux (suggestSplit), ce qui est déjà à chacune
 * comptant. On ne bloque rien : une dépense « dans le désordre » baisse le solde, et ce calcul refait la part de chacune.
 * @param {number} amount @param {Reserve[]} open @param {Record<string, number>} own @param {string} today
 * @returns {{ parts: Record<string, number>, free: number }}
 */
export function splitOwn(amount, open, own, today) {
  let left = Math.max(0, amount);
  /** @type {Record<string, number>} */
  const held = {};
  // l'argent propre d'abord, aux réserves datées seulement (en pause : son argent va d'abord aux datées en cas de coup dur)
  for (const r of [...open].sort(byDue)) { const g = r.due ? Math.min(own[r.id] || 0, left) : 0; held[r.id] = g; left -= g; }
  const rest = suggestSplit(left, open.map(r => ({ ...r, held: held[r.id] })), today);
  /** @type {Record<string, number>} */
  const parts = {};
  for (const r of open) parts[r.id] = held[r.id] + rest.parts[r.id];
  return { parts, free: rest.free };
}

/**
 * La répartition si l'on dépensait amount sur la réserve reserveId (2026-11-19, pour montrer à la saisie ce que les autres
 * réserves perdraient) : le solde baisse, ce qu'elle vise aussi (en une fois : elle se ferme), puis le même calcul.
 * @param {State} s @param {string} walletId @param {string} today @param {string} reserveId @param {number} amount
 * @returns {Record<string, number>}
 */
export function allocationAfter(s, walletId, today, reserveId, amount) {
  const balance = (walletBalances(s)[walletId] || 0) - amount;
  const before = reservesOf(s, { wallet: walletId, open: true });
  const own = ownOf(s, before);
  const all = before.map(r => ({ ...r, held: 0, keep: r.due ? 0 : Math.max(0, r.held - (r.id === reserveId ? amount : 0)), used: r.id === reserveId ? r.used + amount : r.used }));
  const it = all.find(r => r.id === reserveId);
  if (it) own[it.id] = Math.max(0, Math.min((own[it.id] || 0) - amount, targetOf(it))); // la dépense prend d'abord son argent propre
  const open = all.filter(r => !(r.id === reserveId && (r.mode === 'once' || r.used >= r.amount)));
  return splitOwn(Math.max(0, balance), open, own, today).parts;
}

/**
 * @typedef {{ atDue: number, short: number, plan: boolean, ready: string|null }} Outlook ce qu'une réserve aura à son
 *   échéance, ce qui manquera alors, si quelque chose de prévu peut la remplir, le jour où elle sera remplie (null : pas
 *   dans les 12 mois qui suivent la dernière échéance)
 */
/**
 * @typedef {{ date: string, on: string, amount: number, into: boolean, reserve: string|null, kind: string, note: string }} Flow
 *   une échéance de l'épargne dans le rejeu : sa date (un retard : aujourd'hui), sa vraie date (on), entrée ou sortie
 */
/**
 * @typedef {{ live: Reserve[], flows: Flow[], balance: number, own: Record<string, number>, plan: boolean, until: string }} Replay
 *   ce que le rejeu d'une épargne part de : ses réserves ouvertes, ses échéances, son solde, l'argent propre des réserves
 */
/**
 * Ce que le rejeu d'une épargne part de (outlookOf, shortfallOf), ou null sans réserve ouverte. Tout ce qui est prévu
 * sur l'épargne compte (D17 revu le 2026-11-20, « une échéance est une échéance ») : les virements vers elle (le
 * versement, une ancienne collecte, fléchée vers sa réserve, un virement d'une fois), les revenus qui y arrivent, les
 * dépenses qui en partent et les virements qui en sortent ; en retard, une échéance compte aujourd'hui ; en pause, pas.
 * Une échéance de dépense payée par une réserve n'est que cette réserve dépensée ; une échéance qui se paiera d'un
 * portefeuille courant (sa réserve close) ne touche pas l'épargne.
 * @param {State} s @param {string} walletId @param {string} today @returns {Replay|null}
 */
function replayOf(s, walletId, today) {
  // en pause : dans le rejeu comme sur la page (elle prend ce qui reste une fois les datées à leur niveau), sans échéance
  const live = reservesOf(s, { wallet: walletId, open: true }).map(r => ({ ...r, held: 0, keep: r.due ? 0 : r.held }));
  const datedLive = live.filter(r => r.due);
  if (!datedLive.length) return null;
  const until = addMonths(datedLive.reduce((m, r) => (dated(r) > m ? dated(r) : m), today), 12);
  // une dépense payée par une réserve datée n'est que cette réserve dépensée ; payée par une réserve en pause (sans date),
  // elle sort bien de l'épargne
  const datedIds = new Set(datedLive.map(r => r.id));
  /** @type {Flow[]} */
  const flows = duesOf(s, today, until, walletId).filter(d => !d.paused && !d.needsWallet && !(d.kind === 'expense' && d.reserve && datedIds.has(d.reserve))).map(d => ({
    date: d.date < today ? today : d.date, on: d.date, amount: d.amount, into: d.kind !== 'expense' && (d.kind === 'income' || d.to === walletId),
    reserve: d.kind === 'transfer' && d.to === walletId ? d.reserve : null, kind: d.kind, note: d.note,
  }));
  // un plan pour toutes : ce qu'une ancienne collecte verse au-delà de sa réserve sert les autres, comme le versement
  return { live, flows, balance: Math.max(0, walletBalances(s)[walletId] || 0), own: ownOf(s, live), plan: flows.some(f => f.into), until };
}

/**
 * Le rejeu (2026-11-19, avec l'utilisateur : une réserve ne se juge pas seule, c'est le trio réserve, échéance, épargne
 * et ses autres réserves), avec la même répartition que la page, jusqu'à 12 mois après la dernière échéance : chaque
 * entrée prévue arrive à sa date (fléchée vers sa réserve si elle vient de son ancienne collecte), chaque sortie prévue
 * part (les entrées d'un jour avant ses sorties). Une réserve est prête (ready) le premier jour où elle est remplie et le
 * reste ; à son échéance, remplie, elle est dépensée ; pas remplie, elle reste servie la première, comme dans l'app
 * (jamais close d'office ; en une fois, elle ne se paie pas en partie), jusqu'à ce qu'elle le soit : ce jour-là, après
 * son échéance, est son ready. Moins d'un pas de la devise ne compte pas. extra : des entrées en plus (le manque,
 * shortfallOf), rien n'est écrit.
 * @param {Replay} base @param {string} today @param {Flow[]} [extra] @returns {Record<string, Outlook>}
 */
function replay(base, today, extra = []) {
  const live = [...base.live];
  const own = { ...base.own };
  const flows = extra.length ? [...base.flows, ...extra] : base.flows;
  let bal = base.balance;
  /** @type {Record<string, Outlook>} */
  const out = {};
  for (const r of live) out[r.id] = { atDue: 0, short: 0, plan: base.plan, ready: null };
  /** @type {Set<string>} */
  const seen = new Set();
  /** le premier jour depuis lequel chaque réserve est remplie @type {Record<string, string>} */
  const fullSince = {};
  const dates = [...new Set([today, ...flows.map(f => f.date), ...live.filter(r => r.due).map(r => (dated(r) < today ? today : dated(r)))])].sort();
  for (const d of dates) {
    if (!live.length) break;
    const day = flows.filter(f => f.date === d);
    for (const f of [...day.filter(x => x.into), ...day.filter(x => !x.into)]) {
      if (!f.into) { bal -= f.amount; continue; }
      bal += f.amount;
      const r = f.reserve ? live.find(x => x.id === f.reserve) : null;
      if (r) own[r.id] = Math.min((own[r.id] || 0) + f.amount, targetOf(r));
    }
    bal = Math.max(0, bal);
    const parts = splitOwn(bal, live, own, d).parts;
    for (const r of live) {
      if (targetOf(r) - parts[r.id] < stepOf(r.currency)) fullSince[r.id] ||= d;
      else delete fullSince[r.id];
    }
    for (const r of live.filter(x => x.due && dated(x) <= d)) {
      const miss = targetOf(r) - parts[r.id];
      if (!seen.has(r.id)) { seen.add(r.id); out[r.id].atDue = parts[r.id]; out[r.id].short = miss < stepOf(r.currency) ? 0 : miss; }
      if (miss < stepOf(r.currency)) {
        out[r.id].ready = fullSince[r.id] || d;
        bal = Math.max(0, bal - parts[r.id]); live.splice(live.indexOf(r), 1); delete own[r.id];
      }
    }
  }
  return out;
}

/**
 * L'avenir des réserves d'une épargne : le rejeu de tout ce qui est prévu sur elle (replayOf, replay). Un plan : une
 * entrée prévue sur l'épargne (le versement, une ancienne collecte, un revenu), pour toutes ses réserves.
 * @param {State} s @param {string} walletId @param {string} today @returns {Record<string, Outlook>}
 */
export function outlookOf(s, walletId, today) {
  const base = replayOf(s, walletId, today);
  return base ? replay(base, today) : {};
}

/**
 * Les débuts de période (settings.monthStart) strictement après from, jusqu'à to compris : les dates d'un versement.
 * @param {string} from @param {string} to @param {number|string} monthStart @returns {string[]}
 */
export function periodStarts(from, to, monthStart) {
  /** @type {string[]} */
  const out = [];
  for (let d = addDays(monthSpan(from, monthStart).end, 1); d <= to && out.length < 1200; d = addDays(monthSpan(d, monthStart).end, 1)) out.push(d);
  return out;
}

/**
 * Le manque d'une épargne (D17 revu le 2026-11-20, avec l'utilisateur : « une échéance est une échéance ») : ce qu'il
 * faudrait y verser **en plus de tout ce qui est prévu** sur elle, à chaque début de période (aujourd'hui compris s'il
 * en est un), pour que chaque réserve datée non échue soit prête à son échéance. Le rejeu le dit (replay) : le plus
 * petit montant, en pas de la devise, qui ne laisse aucune de ces réserves manquer à son échéance (recherche
 * dichotomique), arrondi au-dessus comme une proposition (approxUp). Une réserve dont l'échéance vient avant le prochain
 * début de période ne peut pas être aidée : elle n'y compte pas (sa ligne dit déjà où elle en est). Lissé : ce qui est dû
 * jusqu'à aujourd'hui sans être confirmé compte comme arrivé (le rejeu le met à aujourd'hui), le chiffre ne bouge donc
 * pas le jour du versement ; il ne bouge que si quelque chose change (cibles, dates, ce qui est prévu, l'argent).
 * gap : null sans réserve que le manque peut servir ; next : le prochain début de période ; inflow : la prochaine entrée
 * prévue sur l'épargne (on : sa date, un retard compris).
 * @param {State} s @param {string} walletId @param {string} today @param {number|string} [monthStart]
 * @returns {{ gap: number|null, next: string, inflow: Flow|null }}
 */
export function shortfallOf(s, walletId, today, monthStart = 1) {
  const base = replayOf(s, walletId, today);
  const first = addDays(monthSpan(addDays(today, -1), monthStart).end, 1);
  const inflow = base?.flows.find(f => f.into) || null;
  const helped = base ? base.live.filter(r => r.due && dated(r) >= today && dated(r) >= first) : [];
  if (!base || !helped.length) return { gap: null, next: first, inflow };
  const cur = s.accounts.get(walletId)?.currency || helped[0].currency;
  const step = stepOf(cur);
  const starts = periodStarts(addDays(today, -1), helped.reduce((m, r) => (dated(r) > m ? dated(r) : m), first), monthStart);
  const holds = (/** @type {number} */ k) => {
    const look = replay(base, today, k ? starts.map(d => ({ date: d, on: d, amount: k * step, into: true, reserve: null, kind: 'transfer', note: '' })) : []);
    return helped.every(r => !look[r.id].short);
  };
  if (holds(0)) return { gap: 0, next: first, inflow };
  // au plus : toutes les cibles et toutes les sorties prévues, dès le premier versement
  const most = base.live.reduce((n, r) => n + targetOf(r), 0) + base.flows.filter(f => !f.into).reduce((n, f) => n + f.amount, 0);
  let lo = 0, hi = Math.max(1, Math.ceil(most / step));
  if (holds(hi)) while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (holds(mid)) hi = mid; else lo = mid; }
  return { gap: approxUp(hi * step, cur), next: first, inflow };
}

/**
 * Le même manque, pour une dépense prévue qui n'existe pas encore (ou qu'on modifie) : shortfallOf sur un état où elle
 * existe telle quelle (2026-11-26, avec l'utilisateur : la feuille dit ce que la dépense prévue demande avant qu'on
 * l'enregistre). cand : son id (inconnu ou absent : une nouvelle), son montant, sa date (ou null), son mode ; si l'id
 * existe, ces champs remplacent ceux de l'existante. Rien n'est modifié dans s : seule la table des réserves est copiée.
 * @param {State} s @param {string} walletId @param {string} today @param {number|string} monthStart
 * @param {{ id?: string|null, amount: number, due: string|null, mode: 'once'|'gradual' }} cand
 */
export function shortfallWith(s, walletId, today, monthStart, cand) {
  const id = cand.id || '\u0000candidate';
  const old = s.reserves.get(id);
  const w = s.accounts.get(walletId);
  const due = cand.due || '';
  /** @type {Row} */
  const row = old
    ? { ...old, wallet_id: walletId, amount: cand.amount, due_on: due, mode: cand.mode, ...(old.due_on === '' && due ? { held: null } : {}) }
    : { id, wallet_id: walletId, name: '', amount: cand.amount, used: 0, currency: w?.currency, start_on: today, due_on: due, mode: cand.mode, repeats: 0,
      pinned: null, closed_on: null, created_at: '', from_id: null, uses: null, category_id: null, every: null, interval: null, by_day: null };
  const reserves = new Map(s.reserves);
  reserves.set(id, row);
  return shortfallOf({ ...s, reserves }, walletId, today, monthStart);
}

/**
 * @typedef {{ head: string, date: string, amount: number, from: string }} Versement une échéance qui verse sur
 *   l'épargne : sa règle la plus récente (head), sa prochaine fois, son montant, son portefeuille de départ
 */
/**
 * Les versements d'une épargne (D17 revu le 2026-11-20) : les échéances de virement qui se répètent vers elle depuis un
 * autre portefeuille, ni en pause ni terminées (les anciennes collectes des réserves comprises) : ce qu'on augmente quand
 * il manque quelque chose ; sans aucun, on le programme.
 * @param {State} s @param {string} walletId @param {string} today @returns {Versement[]}
 */
export function versementOf(s, walletId, today) {
  const cur = s.accounts.get(walletId)?.currency;
  /** @type {Versement[]} */
  const list = [];
  for (const d of dueItems(s, today)) {
    if (d.kind !== 'transfer' || d.to !== walletId || d.wallet === walletId || d.paused || !d.head) continue;
    const r = scheduleById(s, d.head);
    // terminée ou arrêtée : ses retards restent à régler, mais elle ne verse plus
    if (!r || !r.every || r.currency !== cur || !dateAfter(r, addDays(today, -1))) continue;
    list.push({ head: d.head, date: d.date, amount: r.amount, from: r.wallet });
  }
  return list;
}

/**
 * Tout ce que montre un portefeuille d'épargne : répartition, réserves, épargne libre (et en mois de dépenses), objectif,
 * signaux de cohérence.
 * @param {State} s @param {string} walletId @param {string} today @param {{ monthlySpend?: number }} [o]
 */
export function savingsReport(s, walletId, today, { monthlySpend = 0 } = {}) {
  const w = s.accounts.get(walletId);
  if (!w) throw new Error(`Portefeuille ${walletId} introuvable`);
  const open = reservesOf(s, { wallet: walletId, open: true });
  // ce qui est de côté pour chaque réserve : calculé depuis le solde (allocationOf), jamais plus que ce qu'elle vise
  const { balance, parts, own } = allocationOf(s, walletId, today);
  const held = open.reduce((n, r) => n + (parts[r.id] || 0), 0);
  const free = balance - held;
  /** @type {import('./reserves.js').ReserveView[]} */
  let views = [];
  const targets = open.reduce((n, r) => n + targetOf(r), 0);
  /** @type {{ kind: string, text: string, amount?: number }[]} */
  const signals = [];
  let goal = null;
  // des réserves ou un objectif, pas les deux (2026-11-20, avec l'utilisateur) : un ancien objectif d'une épargne qui a
  // des réserves n'est plus suivi
  if (w.goal_amount != null && !open.length) {
    const g = { amount: w.goal_amount, on: w.goal_on ?? null };
    const pct = Math.floor((balance * 100) / g.amount);
    const reached = balance >= g.amount;
    const passed = !!g.on && today > g.on;
    let need = null;
    if (!reached && g.on && !passed) {
      const months = Math.max(1, Math.ceil(daysBetween(today, g.on) / 30.44));
      need = Math.ceil((g.amount - balance) / months);
    }
    goal = { ...g, pct, reached, passed, over: reached ? balance - g.amount : 0, need };
    if (targets > g.amount) signals.push({ kind: 'goal', text: 'targets_over_goal', amount: targets - g.amount });
  }
  const look = outlookOf(s, walletId, today);
  views = open.map(r => reserveView(r, Math.min(parts[r.id] || 0, targetOf(r)), today, look[r.id] || null, own[r.id] || 0));
  // le verdict de l'épargne : ce qui manque à ce qui est prévu, et ses versements (D17 revu le 2026-11-20)
  const versement = { ...shortfallOf(s, walletId, today, settingsOf(s).monthStart), list: versementOf(s, walletId, today) };
  return {
    wallet: walletId, balance, reserves: views, free, held, targets, goal, signals, versement,
    freeMonths: monthlySpend > 0 && free > 0 ? Math.floor((free * 10) / monthlySpend) / 10 : null,
    emergency: !!w.emergency,
  };
}

/**
 * Dépense mensuelle moyenne des 3 derniers mois (dépenses validées, devise donnée), pour le fonds d'urgence.
 * @param {State} s @param {string} cur @param {string} today
 */
export function monthlySpend(s, cur, today) {
  const from = addDays(today, -90);
  let total = 0, first = null;
  for (const e of s.entries.values()) {
    if (e.kind !== 'expense' || e.status !== 'posted') continue;
    if (!first || e.occurred_on < first) first = e.occurred_on;
    if (e.occurred_on <= from || e.occurred_on > today) continue;
    for (const l of linesOf(s, e.id)) {
      const a = s.accounts.get(l.account);
      if (a?.kind === 'expense' && l.currency === cur) total += l.amount;
    }
  }
  if (!first) return 0;
  const days = Math.min(90, Math.max(1, daysBetween(first, today)));
  return Math.round((total * 30.44) / days);
}
