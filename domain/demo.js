// Jeu de démonstration (revu le 2026-11-11) : deux ans de la vie d'un jeune de Cotonou, des petits montants de l'étudiant
// au premier salaire, calqués sur un vrai suivi (zem tous les jours de semaine, crédit au compte-gouttes, Canal Box,
// abonnement d'IA, sorties modestes, jamais plus de 150 000 F de rentrées par mois). Déterministe : même graine, même
// « aujourd'hui » → mêmes commandes → mêmes événements → même empreinte ; produit uniquement par des commandes, chacune
// portant `at` (l'heure d'enregistrement simulée) et `today` (le jour où elle est passée).
//
// Quatre temps, comptés en mois depuis le début (0 → 24) :
//   0–6   étudiant : argent de poche de la famille, quelques cours de répétition, tout en espèces ou presque ;
//   7–12  stage : une indemnité de 40 000 F sur MTN MoMo ;
//   13–18 premier contrat : salaire à la banque (60 000, puis 65 000, puis 100 000 F), Canal Box, l'épargne à part
//         (un portefeuille, un objectif, des réserves), les premiers budgets ;
//   19–24 120 000 F, une prestation de temps en temps, une formation payée en quatre fois, le téléphone acheté sur sa
//         réserve.
// Échéances (D18) : Canal Box, l'abonnement d'IA, « Pour les parents », le salaire, la mise de côté et la formation en 4
// fois sont des opérations récurrentes, confirmées chaque mois ; l'abonnement d'IA du mois en cours n'est pas encore
// confirmé (une échéance en retard), « Pour les parents » du 25 est encore à venir.

import { budgetMonth } from './budgets.js';

/** @typedef {import('./commands.js').Command} Command */

/** @param {number} seed */
export function rng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
/** @param {Date} d */
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** @param {string} s */
const day = s => new Date(s + 'T00:00:00Z');
/** @param {string} s @param {number} n */
const plusDays = (s, n) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export const DEMO_SEED = 20261111;
/** Rentrées d'un mois, au plus (le plafond de la démo). */
export const DEMO_MONTH_CAP = 150000;

/**
 * Commandes de la démo, à partir d'une base vide.
 * @param {string} today « AAAA-MM-JJ »
 * @returns {Command[]}
 */
export function demoCommands(today) {
  const r = rng(DEMO_SEED);
  /** montant au hasard entre a et b, arrondi au pas */
  const pick = (/** @type {number} */ a, /** @type {number} */ b, step = 50) => Math.round((a + r() * (b - a)) / step) * step;
  const chance = (/** @type {number} */ p) => r() < p;
  const end = day(today);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 729);
  const setupDay = new Date(start); setupDay.setUTCDate(setupDay.getUTCDate() - 1);
  const s0 = iso(setupDay);
  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  let tick = 0;
  /** @param {string} date @param {number} hour */
  const at = (date, hour = 12) => new Date(Date.parse(`${date}T${pad(hour)}:00:00.000Z`) + (++tick) * 1000).toISOString();

  /** @type {Command[]} */
  const cmds = [{ type: 'setup', currency: 'XOF', at: at(s0, 8) }];
  // trois portefeuilles : les espèces, MTN MoMo, et la banque (elle ne sert qu'à partir du premier salaire)
  /** @type {Record<string, number>} */
  const bal = { cash: 5000, mtn: 2500, bank: 0 };
  cmds.push({ type: 'wallet.create', id: 'cash', name: 'Espèces', subtype: 'cash', currency: 'XOF', identifier: '', balance: bal.cash, at: at(s0, 8), today: s0 });
  cmds.push({ type: 'wallet.create', id: 'mtn', name: 'MTN MoMo', subtype: 'emoney', currency: 'XOF', identifier: '97 00 45 21', balance: bal.mtn, at: at(s0, 8), today: s0 });
  cmds.push({ type: 'wallet.create', id: 'bank', name: 'Banque', subtype: 'bank', currency: 'XOF', identifier: 'BJ066 01001 0123456 4521', balance: 0, at: at(s0, 8), today: s0 });
  // une sous-catégorie à soi, dans une catégorie par défaut (teinte de sa catégorie)
  cmds.push({ type: 'category.create', id: 'fun-games', catType: 'expense', parent: 'fun', name: 'Jeux vidéo', icon: 'game-controller', at: at(s0, 8) });
  cmds.push({ type: 'settings.change', changes: { onboarded: true, balancesSet: true }, at: at(s0, 8) });

  let n = 0;
  /** @param {string} date @param {Record<string, any>} t @returns {boolean} */
  const add = (date, t) => {
    if (!t.planned) {
      if (t.type !== 'income' && (bal[t.accountId] ?? 0) < t.amount) return false; // jamais de négatif (le jour sans argent, on s'en passe)
      if (t.type === 'expense') bal[t.accountId] -= t.amount;
      if (t.type === 'income') bal[t.accountId] += t.amount;
      if (t.type === 'transfer') { bal[t.accountId] -= t.amount; bal[t.toAccountId] += t.amount; }
    }
    const tx = { note: '', planned: false, date, ...t };
    cmds.push({ type: 'entry.record', id: 'demo' + String(++n).padStart(4, '0'), tx, at: t.planned ? at(today, 18) : at(date, 9 + Math.floor(r() * 12)), today: t.planned ? today : date });
    return true;
  };
  // frais d'un retrait ou d'un envoi MoMo (comptés à part, jamais dans le virement)
  const momoFee = (/** @type {number} */ amount) => (amount <= 5000 ? 50 : amount <= 20000 ? 100 : amount <= 50000 ? 250 : 500);
  // des espèces quand il en manque : un retrait MoMo, arrondi, et ses frais
  const ensureCash = (/** @type {string} */ date, /** @type {number} */ need, /** @type {number} */ chunk) => {
    if (bal.cash >= need) return;
    const want = Math.ceil(Math.max(chunk, need - bal.cash) / 1000) * 1000;
    const w = Math.min(want, Math.floor((bal.mtn - momoFee(want)) / 1000) * 1000);
    if (w < 1000) return;
    if (add(date, { type: 'transfer', amount: w, accountId: 'mtn', toAccountId: 'cash', note: 'Retrait' })) add(date, { type: 'expense', amount: momoFee(w), accountId: 'mtn', categoryId: 'fees-momo', note: 'Frais de retrait' });
  };
  /** une dépense en espèces (avec retrait au besoin) */
  const cash = (/** @type {string} */ date, /** @type {number} */ amount, /** @type {string} */ categoryId, note = '', chunk = 10000) => {
    ensureCash(date, amount, chunk);
    return add(date, { type: 'expense', amount, accountId: 'cash', categoryId, note });
  };
  const momo = (/** @type {string} */ date, /** @type {number} */ amount, /** @type {string} */ categoryId, note = '') => add(date, { type: 'expense', amount, accountId: 'mtn', categoryId, note });

  // l'épargne à part (D17) : créée au premier salaire ; des réserves posées un mois plus tard
  /** @type {{ id: string, amount: number, held: number, open: boolean }[]} */
  const reserves = [];
  let savings = false;
  // répartir l'épargne libre, dans l'ordre des réserves ouvertes, sans dépasser ce qu'il leur reste à viser
  const allocate = (/** @type {string} */ date, /** @type {string | null} */ entry) => {
    let free = (bal.savings || 0) - reserves.filter(x => x.open).reduce((s, x) => s + x.held, 0);
    const changes = [];
    for (const x of reserves) {
      if (!x.open || free <= 0) continue;
      const g = Math.min(free, x.amount - x.held);
      if (g > 0) { changes.push({ id: x.id, delta: g }); x.held += g; free -= g; }
    }
    // la répartition n'est plus enregistrée (2026-11-19) : elle se calcule depuis le solde ; ce suivi sert seulement à la démo
    void changes; void entry; void date;
  };
  const lastId = () => 'demo' + String(n).padStart(4, '0');

  // échéances (D18) : une règle, puis chaque date confirmée (rien ne s'écrit tout seul)
  /** @param {string} date @param {string} id @param {Record<string, any>} o */
  const rule = (date, id, o) => cmds.push({ type: 'due.create', id, kind: 'expense', ...o, start: date, at: at(date, 7), today: date });
  /** @param {string} date @param {string} id @param {{ kind: string, amount: number, accountId: string, toAccountId?: string }} tx @param {number} [usual] */
  const confirm = (date, id, tx, usual = tx.amount) => {
    // pas l'argent ce jour-là : on passe cette fois (une échéance passée, pas un retard qui traîne)
    if (tx.kind !== 'income' && (bal[tx.accountId] ?? 0) < tx.amount) { cmds.push({ type: 'due.skip', id, on: date, at: at(date, 21), today: date }); return false; }
    if (tx.kind === 'expense') bal[tx.accountId] -= tx.amount;
    if (tx.kind === 'income') bal[tx.accountId] += tx.amount;
    if (tx.kind === 'transfer') { bal[tx.accountId] -= tx.amount; bal[/** @type {string} */ (tx.toAccountId)] += tx.amount; }
    cmds.push({ type: 'due.confirm', id, on: date, ...(tx.amount !== usual ? { tx: { amount: tx.amount } } : {}), at: at(date, 9 + Math.floor(r() * 12)), today: date });
    return true;
  };
  /** @type {Record<string, number>} */
  const income = {}; // rentrées par mois (plafond)
  const earn = (/** @type {string} */ date, /** @type {Record<string, any>} */ t) => {
    const k = date.slice(0, 7);
    if ((income[k] || 0) + t.amount > DEMO_MONTH_CAP) return false;
    if (!add(date, { type: 'income', ...t })) return false;
    income[k] = (income[k] || 0) + t.amount;
    return true;
  };

  // l'abonnement d'IA du dernier 10 passé (ce mois-ci, ou le mois d'avant avant le 10) n'est pas encore confirmé
  const lastTen = (() => { const d = day(today); if (d.getUTCDate() < 10) d.setUTCMonth(d.getUTCMonth() - 1, 10); else d.setUTCDate(10); return iso(d); })();
  const salaryOf = (/** @type {number} */ m) => (m >= 19 ? 120000 : m >= 17 ? 100000 : m === 16 ? 65000 : m >= 13 ? 60000 : 0);
  const formation = (/** @type {number} */ m) => m >= 19 && m <= 22;
  const firstDecember = (() => { // le premier décembre entier du premier contrat : un budget de fêtes, terminé depuis
    for (let m = 13; m <= 22; m++) { const y = Math.floor((startMonth + m) / 12), mo = (startMonth + m) % 12; if (mo === 11) return `${y}-12`; }
    return null;
  })();

  // une bonbonne de gaz toutes les 6 semaines (un rythme libre, D18), depuis le 14 du 19e mois
  let gasFrom = '';

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = iso(d), dom = d.getUTCDate(), dow = d.getUTCDay(), mo = d.getUTCMonth();
    const m = d.getUTCFullYear() * 12 + mo - startMonth; // mois depuis le début
    const student = m <= 6, intern = m >= 7 && m <= 12, worker = m >= 13;
    const weekday = dow >= 1 && dow <= 5;

    // ---------- rentrées ----------
    if (student) {
      // l'argent de poche : par petits bouts, en espèces
      if (dow === 0) earn(ds, { amount: pick(4000, 6000, 500), accountId: 'cash', categoryId: 'gift-family', note: 'Argent de poche' });
      else if (chance(0.12)) earn(ds, { amount: pick(500, 2000, 500), accountId: 'cash', categoryId: 'gift-family', note: 'Argent de poche' });
      if (dom === 28 && chance(0.6)) earn(ds, { amount: pick(5000, 10000, 1000), accountId: 'mtn', categoryId: 'sales-services', note: 'Cours de répétition' });
    }
    if (intern) {
      if (dom === 5) earn(ds, { amount: 40000, accountId: 'mtn', categoryId: 'salary-pay', note: 'Indemnité de stage' });
      if (dow === 0 && chance(0.4)) earn(ds, { amount: pick(1000, 2000, 500), accountId: 'cash', categoryId: 'gift-family', note: 'Argent de poche' });
    }
    if (worker && dom === 2) {
      const pay = salaryOf(m);
      if (m === 19) rule(ds, 'due-pay', { kind: 'income', amount: 120000, accountId: 'bank', categoryId: 'salary-pay', note: 'Salaire', every: 'month' });
      if (m >= 19) { confirm(ds, 'due-pay', { kind: 'income', amount: pay, accountId: 'bank' }); income[ds.slice(0, 7)] = (income[ds.slice(0, 7)] || 0) + pay; }
      else earn(ds, { amount: pay, accountId: 'bank', categoryId: 'salary-pay', note: 'Salaire' });
      add(ds, { type: 'expense', amount: 1500, accountId: 'bank', categoryId: 'fees-bank', note: 'Frais de tenue de compte' });
      // l'épargne : ouverte au premier salaire, pour des réserves (sans objectif : l'un ou l'autre, 2026-11-20) ; puis un
      // virement chaque mois
      if (!savings) {
        savings = true; bal.savings = 0;
        cmds.push({ type: 'wallet.create', id: 'savings', name: 'Épargne', subtype: 'bank', currency: 'XOF', identifier: '', balance: 0, savings: true,
          at: at(ds, 10), today: ds });
      }
      const put = formation(m) ? 10000 : pay >= 100000 ? 20000 : 5000;
      if (m === 19) rule(ds, 'due-save', { kind: 'transfer', amount: 20000, accountId: 'bank', toAccountId: 'savings', note: 'Mettre de côté', every: 'month' });
      if (m >= 19) { if (confirm(ds, 'due-save', { kind: 'transfer', amount: put, accountId: 'bank', toAccountId: 'savings' }, 20000)) allocate(ds, null); }
      else if (add(ds, { type: 'transfer', amount: put, accountId: 'bank', toAccountId: 'savings', note: 'Mettre de côté' })) allocate(ds, lastId());
      // le reste part sur MoMo, la banque garde de quoi payer ses frais
      const move = bal.bank - 3000;
      if (move > 0) add(ds, { type: 'transfer', amount: move, accountId: 'bank', toAccountId: 'mtn', note: 'Vers MoMo' });
    }
    if (m >= 19 && dom === 18 && m % 2 === 1) earn(ds, { amount: pick(10000, 25000, 1000), accountId: 'mtn', categoryId: 'sales-services', note: 'Prestation' });

    // ---------- l'épargne : réserves, budgets ----------
    if (worker && m === 14 && dom === 3) {
      const due = (/** @type {number} */ mm, /** @type {number} */ dd) => { const y = Math.floor((startMonth + mm) / 12), mon = (startMonth + mm) % 12; return `${y}-${pad(mon + 1)}-${pad(dd)}`; };
      cmds.push({ type: 'reserve.create', id: 'res-phone', wallet: 'savings', name: 'Téléphone', amount: 75000, category: 'phone-device', due: due(20, 15), at: at(ds, 20), today: ds });
      reserves.push({ id: 'res-phone', amount: 75000, held: 0, open: true });
      allocate(ds, null);
    }
    // le téléphone, payé sur sa réserve (D17) : hors des budgets, l'argent était mis de côté
    if (m === 20 && dom === 15) {
      const x = reserves.find(v => v.id === 'res-phone');
      if (x && x.held >= x.amount && add(ds, { type: 'expense', amount: x.amount, accountId: 'savings', categoryId: 'phone-device', note: 'Nouveau téléphone', reserve: 'res-phone' })) { x.open = false; x.held = 0; }
    }
    // puis l'ordinateur, sur un an, petit à petit
    if (m === 20 && dom === 16) {
      cmds.push({ type: 'reserve.create', id: 'res-laptop', wallet: 'savings', name: 'Ordinateur', amount: 200000, category: 'home-stuff', due: plusDays(today, 300), mode: 'gradual', at: at(ds, 20), today: ds });
      reserves.push({ id: 'res-laptop', amount: 200000, held: 0, open: true });
      allocate(ds, null);
    }
    // les fêtes de fin d'année, préparées à partir de fin octobre du dernier automne
    if (m >= 22 && mo === 9 && dom === 25 && !reserves.some(v => v.id === 'res-party')) {
      cmds.push({ type: 'reserve.create', id: 'res-party', wallet: 'savings', name: 'Fêtes de fin d’année', amount: 30000, category: 'family-events', due: `${d.getUTCFullYear()}-12-20`, at: at(ds, 20), today: ds });
      reserves.splice(1, 0, { id: 'res-party', amount: 30000, held: 0, open: true }); // passe avant l'ordinateur
    }
    // les budgets (D11) : posés au premier mois de salaire, ils se répètent ; chacun sur une sous-catégorie, qu'il compte seule (D13)
    if (m === 13 && dom === 3) {
      const w = budgetMonth(ds, 1);
      for (const [category, amount] of /** @type {[string, number][]} */ ([['transport-zem', 24000], ['phone-credit', 4000], ['food-out', 6000], ['fun-out', 10000]])) {
        cmds.push({ type: 'budget.create', id: 'budget-' + category, category, amount, start: w.start, end: w.end, repeat: true, at: at(ds, 19), today: ds });
      }
    }
    // un budget de fêtes, le premier décembre de salaire : terminé depuis
    if (firstDecember && ds === `${firstDecember}-01`) {
      cmds.push({ type: 'budget.create', id: 'budget-xmas-clothes', category: 'shop-clothes', amount: 20000, start: ds, end: `${firstDecember}-31`, repeat: false, at: at(ds, 19), today: ds });
    }
    // et un budget habits sur trois mois, en cours
    if (ds === plusDays(today, -30)) {
      cmds.push({ type: 'budget.create', id: 'budget-clothes-3m', category: 'shop-clothes', amount: 20000, start: ds, end: plusDays(ds, 90), repeat: false, at: at(ds, 19), today: ds });
    }

    // ---------- dépenses ----------
    // un plaisir ne passe que s'il reste de quoi tenir (zem, crédit) jusqu'à la prochaine rentrée
    const toPay = student ? 7 - dow : intern ? ((5 - dom + 31) % 31 || 31) : ((2 - dom + 31) % 31 || 31);
    const keep = toPay * (student ? 700 : intern ? 1100 : 1500);
    const afford = (/** @type {number} */ a) => bal.cash + bal.mtn - a >= keep;
    const k = student ? 0.55 : intern ? 0.75 : m < 17 ? 0.85 : 1; // le train de vie suit les rentrées
    const chunk = student ? 3000 : intern ? 5000 : 10000;
    // zem : l'aller et le retour, les jours de cours ou de travail (pas de cours en août ni pendant les fêtes)
    const off = (student || intern) && (mo === 7 || (mo === 11 && dom > 20) || (mo === 0 && dom < 3));
    if (weekday && !off && chance(0.93)) cash(ds, pick(student ? 300 : 800, student ? 700 : 1500, 100), 'transport-zem', 'Zem', chunk);
    else if (!weekday && chance(0.3) && afford(800)) cash(ds, pick(300, 1200, 100), 'transport-zem', 'Zem', chunk);
    if (chance(0.01) && afford(12000)) cash(ds, pick(5000, 12000, 500), 'transport-trip', 'Voyage au village', chunk);
    // crédit et forfaits, au compte-gouttes
    if (chance(student ? 0.2 : 0.3)) (chance(0.5) || bal.mtn < 1100 ? cash(ds, pick(100, student ? 500 : 1000, 100), 'phone-credit', 'Crédit', chunk) : momo(ds, pick(200, 1100, 100), 'phone-credit', 'Crédit'));
    if (m < 16 && dow === 6 && chance(student ? 0.5 : 0.8)) (bal.mtn >= 2000 ? momo(ds, pick(500, 2000, 500), 'phone-internet', 'Forfait internet') : cash(ds, 500, 'phone-internet', 'Forfait internet', chunk));
    if (m === 16 && dom === 6) rule(ds, 'due-canal', { amount: 15000, accountId: 'mtn', categoryId: 'phone-internet', note: 'Canal Box', every: 'month' });
    if (m >= 16 && dom === 6) confirm(ds, 'due-canal', { kind: 'expense', amount: 15000, accountId: 'mtn' });
    if (m === 17 && dom === 10) rule(ds, 'due-ia', { amount: 7000, accountId: 'mtn', categoryId: 'fun-subs', note: 'Abonnement IA', every: 'month' });
    if (m >= 17 && dom === 10 && ds !== lastTen) confirm(ds, 'due-ia', { kind: 'expense', amount: chance(0.8) ? 7000 : 14000, accountId: 'mtn' }, 7000);
    // manger dehors un peu ; on mange surtout à la maison
    if (chance(0.3 * k) && afford(3000)) cash(ds, pick(300, 1500, 100), 'food-out', chance(0.5) ? 'Goûter' : 'Déjeuner', chunk);
    if (chance(0.12) && afford(3000)) cash(ds, pick(200, 600, 50), 'food-drinks', 'Eau', chunk);
    if (chance(0.05 * k) && afford(3000)) cash(ds, pick(1000, 4000, 250), 'food', '', chunk);
    if (student && chance(0.08) && afford(3000)) cash(ds, pick(200, 1500, 100), 'home-gas', 'Gaz', chunk);
    if (m === 18 && dom === 14) { gasFrom = ds; rule(ds, 'due-gas', { amount: 6000, accountId: 'cash', categoryId: 'home-gas', note: 'Bonbonne de gaz', every: 'week', interval: 6 }); }
    if (gasFrom && Math.round((Date.parse(ds) - Date.parse(gasFrom)) / 864e5) % 42 === 0) confirm(ds, 'due-gas', { kind: 'expense', amount: 6000, accountId: 'cash' });
    // sorties
    if (chance(0.13 * k) && afford(3000)) cash(ds, pick(300, 2500, 100), 'fun-out', chance(0.5) ? 'Sortie' : 'Café', chunk);
    if (worker && dow === 6 && dom <= 7 && chance(0.3) && afford(12000)) cash(ds, pick(5000, 12000, 500), 'fun-out', 'Restaurant entre amis', 20000);
    if (chance(0.006) && afford(3000)) momo(ds, pick(1000, 3000, 500), 'fun-games', 'Jeu');
    if (m === 22 && dom === 20) momo(ds, 15050, 'fun-games', 'Précommande d’un jeu');
    // soins, habits
    if (chance(0.04) && afford(3000)) cash(ds, pick(1000, 1500, 500), 'care-hair', 'Coiffeur', chunk);
    if (chance(0.03) && afford(3000)) cash(ds, pick(1500, 2500, 500), 'care-hygiene', 'Déodorant', chunk);
    if (chance(0.025 * k) && afford(3000)) cash(ds, pick(3000, 9000, 500), 'shop-clothes', '', chunk);
    if (chance(0.006) && afford(3000)) cash(ds, pick(2500, 12000, 500), 'shop-shoes', 'Chaussures', chunk);
    if (firstDecember && ds.startsWith(firstDecember) && (dom === 12 || dom === 21)) cash(ds, pick(7000, 12000, 500), 'shop-clothes', 'Habits de fête', 20000);
    // santé, école
    if (chance(0.02)) cash(ds, pick(1000, 6000, 250), 'health-pharmacy', 'Pharmacie', chunk);
    if ((student || intern) && chance(0.05) && afford(3000)) cash(ds, pick(200, 1000, 100), 'school-supplies', 'Photocopies', chunk);
    if (student && m === 1 && dom === 10) cash(ds, 3000, 'school-fees', 'Frais d’inscription', 5000);
    if (m === 19 && dom === 3) rule(ds, 'due-formation', { amount: 25000, accountId: 'mtn', categoryId: 'school-courses', note: 'Formation, mensualité', every: 'month', times: 4 });
    if (formation(m) && dom === 3) confirm(ds, 'due-formation', { kind: 'expense', amount: 25000, accountId: 'mtn' });
    if (m === 21 && dom === 4) cash(ds, 1000, 'school-fees', 'Attestation', chunk);
    // famille, imprévus
    if (m === 17 && dom === 25) rule(ds, 'due-parents', { amount: 5000, accountId: 'mtn', categoryId: 'family-send', note: 'Pour les parents', every: 'month' });
    if (m >= 17 && dom === 25) confirm(ds, 'due-parents', { kind: 'expense', amount: 5000, accountId: 'mtn' });
    if (chance(0.008) && afford(3000)) cash(ds, pick(1000, 5000, 500), 'family-events', 'Cérémonie', chunk);
    if (chance(0.006)) cash(ds, pick(200, 5000, 100), 'other', 'Perte', chunk);
    if (m === 21 && dom === 20) momo(ds, 15000, 'other', 'Adhésion à une association');
    if (m === 23 && dom === 19) momo(ds, 30000, 'other', 'Passeport');

    // vérifier ses soldes, les dernières semaines (D9)
    if (Date.parse(ds) >= Date.parse(today) - 42 * 864e5 && dow === 0) {
      for (const id of ['cash', 'mtn', 'bank', 'savings']) if (id in bal) cmds.push({ type: 'wallet.check', id, actual: bal[id], at: at(ds, 21), today: ds });
    }
  }

  return cmds;
}
