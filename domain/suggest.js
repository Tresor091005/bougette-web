// Suggestions de saisie (D14) : catégories probables, modèles des opérations qui reviennent.
// Fonctions pures, à partir des opérations passées (forme TxView) : rien n'est stocké, tout se recalcule.

/** @typedef {{ type: string, amount: number, accountId: string, toAccountId?: string|null, categoryId?: string|null, date: string, note?: string, planned?: boolean, createdAt?: number }} Move */
/** @typedef {{ type: string, amount: number, accountId: string, toAccountId: string|null, categoryId: string|null, note: string, count: number }} Template */

const DAY = 86400000;
/** @param {string} a @param {string} b « AAAA-MM-JJ » */
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
/** @param {string} d */
const weekday = d => new Date(d + 'T00:00:00Z').getUTCDay();
/** Texte sans accents ni majuscules, espaces simplifiés. @param {string|null|undefined} s */
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Heure locale d'enregistrement (0-23), ou null. @param {Move} m */
const hourOf = m => (m.createdAt ? new Date(m.createdAt).getHours() : null);

/**
 * Catégories (principales ou sous-catégories) les plus probables pour une nouvelle opération : fréquence récente,
 * pondérée par l'heure (Zem le matin, maquis le soir), le jour de la semaine et le montant déjà tapé (500 F : Zem
 * plutôt que Loyer). Le reste de la rangée, et toute la rangée sans historique : l'ordre choisi par l'utilisateur.
 * @param {Move[]} moves
 * @param {{ type: string, today: string, hour?: number, amount?: number, valid: string[], limit?: number, days?: number }} o
 *   valid : catégories proposables (actives, du bon type), dans l'ordre de repli
 * @returns {string[]}
 */
export function suggestCategories(moves, { type, today, hour = 12, amount = 0, valid, limit = 3, days = 90 }) {
  const ok = new Set(valid);
  const dow = weekday(today);
  /** @type {Map<string, number>} */
  const score = new Map();
  for (const m of moves) {
    if (m.type !== type || m.planned || !m.categoryId || !ok.has(m.categoryId)) continue;
    const age = daysBetween(m.date, today);
    if (age < 0 || age > days) continue;
    let w = Math.exp(-age / 30); // récent d'abord (demi-vie ≈ 3 semaines)
    const h = hourOf(m);
    if (h !== null) { const d = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour)); w *= 1 + Math.max(0, 1 - d / 3); }
    if (weekday(m.date) === dow) w *= 1.4;
    // montant tapé : un ordre de grandeur différent pèse presque rien (85 000 F n'est pas un repas à 3 000 F)
    if (amount > 0 && m.amount > 0) w *= 0.05 + Math.exp(-1.5 * Math.abs(Math.log(amount / m.amount)));
    score.set(m.categoryId, (score.get(m.categoryId) || 0) + w);
  }
  // à score égal, l'ordre choisi par l'utilisateur (valid est dans cet ordre)
  const pos = new Map(valid.map((id, i) => [id, i]));
  const ranked = [...score].sort((a, b) => b[1] - a[1] || (pos.get(a[0]) ?? valid.length) - (pos.get(b[0]) ?? valid.length)).map(([id]) => id);
  return [...new Set([...ranked, ...valid])].slice(0, limit);
}

/**
 * Pré-choix de la catégorie (ROADMAP 1a, seuil § 6.8) : la catégorie qui domine nettement pour le montant tapé.
 * Parmi les opérations du même type des `days` derniers jours à un montant proche (même ordre de grandeur : entre la
 * moitié et le double), pondérées par la récence et l'heure, la première a au moins `share` du poids et au moins
 * `min` occurrences. Sinon rien : mieux vaut ne rien proposer que se tromper.
 * @param {Move[]} moves
 * @param {{ type: string, today: string, hour?: number, amount: number, valid: string[], days?: number, share?: number, min?: number }} o
 * @returns {string|null}
 */
export function proposeCategory(moves, { type, today, hour = 12, amount, valid, days = 90, share = 0.6, min = 3 }) {
  if (!(amount > 0)) return null;
  const ok = new Set(valid);
  /** @type {Map<string, { w: number, n: number }>} */
  const by = new Map();
  let total = 0;
  for (const m of moves) {
    if (m.type !== type || m.planned || !m.categoryId || !ok.has(m.categoryId) || !(m.amount > 0)) continue;
    const r = amount / m.amount;
    if (r < 0.5 || r > 2) continue;
    const age = daysBetween(m.date, today);
    if (age < 0 || age > days) continue;
    let w = Math.exp(-age / 30);
    const h = hourOf(m);
    if (h !== null) { const d = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour)); w *= 1 + Math.max(0, 1 - d / 3); }
    const g = by.get(m.categoryId) || { w: 0, n: 0 };
    g.w += w; g.n++;
    by.set(m.categoryId, g);
    total += w;
  }
  const best = [...by].sort((a, b) => b[1].w - a[1].w)[0];
  if (!best || best[1].n < min || best[1].w < share * total) return null;
  return best[0];
}

/**
 * Montants habituels d'une catégorie (ROADMAP 1a) : quand la catégorie est touchée avant le montant, ses 2 ou 3
 * montants les plus fréquents (au moins 2 fois en `days` jours), rangés du plus petit au plus grand (Zem : 300 · 500 · 800).
 * @param {Move[]} moves @param {{ categoryId: string, type: string, today: string, days?: number, limit?: number }} o
 * @returns {number[]}
 */
export function usualAmounts(moves, { categoryId, type, today, days = 120, limit = 3 }) {
  /** @type {Map<number, { n: number, last: string }>} */
  const by = new Map();
  for (const m of moves) {
    if (m.type !== type || m.planned || m.categoryId !== categoryId || !(m.amount > 0)) continue;
    const age = daysBetween(m.date, today);
    if (age < 0 || age > days) continue;
    const g = by.get(m.amount) || { n: 0, last: m.date };
    g.n++;
    if (m.date > g.last) g.last = m.date;
    by.set(m.amount, g);
  }
  return [...by].filter(([, g]) => g.n >= 2)
    .sort((a, b) => b[1].n - a[1].n || (a[1].last < b[1].last ? 1 : a[1].last > b[1].last ? -1 : 0))
    .slice(0, limit).map(([v]) => v).sort((a, b) => a - b);
}

/**
 * Modèles : opérations qui reviennent (au moins 3 fois en 120 jours, la dernière il y a moins de 60 jours), même type,
 * catégorie, portefeuilles et note (et même montant quand il n'y a pas de note). Le montant doit être stable : le plus
 * fréquent revient au moins une fois sur deux (un forfait, un retrait, pas un Zem dont le prix change) ; c'est lui le
 * montant du modèle (le plus récent en cas d'égalité).
 * @param {Move[]} moves @param {{ today: string, limit?: number }} o
 * @returns {Template[]}
 */
export function templates(moves, { today, limit = 3 }) {
  /** @type {Map<string, { last: Move, count: number, score: number, amounts: Map<number, number> }>} */
  const groups = new Map();
  for (const m of moves) {
    if (m.planned) continue;
    const age = daysBetween(m.date, today);
    if (age < 0 || age > 120) continue;
    const note = fold(m.note);
    const key = [m.type, m.categoryId || '', m.accountId, m.toAccountId || '', note, note ? '' : m.amount].join('|');
    const g = groups.get(key) || { last: m, count: 0, score: 0, amounts: new Map() };
    g.count++;
    g.amounts.set(m.amount, (g.amounts.get(m.amount) || 0) + 1);
    g.score += Math.exp(-age / 45);
    if (m.date > g.last.date || (m.date === g.last.date && (m.createdAt || 0) > (g.last.createdAt || 0))) g.last = m;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(g => {
      const top = Math.max(...g.amounts.values());
      const amount = (g.amounts.get(g.last.amount) === top) ? g.last.amount : [...g.amounts].find(([, n]) => n === top)?.[0] ?? g.last.amount;
      return { ...g, top, amount };
    })
    .filter(g => g.count >= 3 && daysBetween(g.last.date, today) <= 60 && g.top * 2 >= g.count)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ last: m, count, amount }) => ({
      type: m.type, amount, accountId: m.accountId, toAccountId: m.toAccountId || null,
      categoryId: m.categoryId || null, note: m.note || '', count,
    }));
}

/**
 * Suggestions par début de montant (2026-11-18, avec l'utilisateur) : on tape « 15 », l'app propose les opérations des
 * 90 derniers jours dont le montant commence par 15 (Canal Box 15 000 F), du type affiché. Une même opération (même
 * catégorie, portefeuilles, nom et montant) ne compte qu'une fois ; la plus fréquente d'abord, puis la plus récente ;
 * au plus 3. Une opération faite une seule fois peut venir, si rien de plus habituel ne commence pareil.
 * @param {Move[]} moves
 * @param {{ today: string, type: string, digits: string, major: (m: Move) => string, skip?: (m: Move) => boolean, limit?: number, days?: number }} o
 * @returns {{ type: string, amount: number, accountId: string, toAccountId: string|null, categoryId: string|null, note: string, count: number }[]}
 */
export function byAmountStart(moves, { today, type, digits, major, skip = () => false, limit = 3, days = 90 }) {
  if (!/^[1-9]\d*$/.test(digits)) return [];
  /** @type {Map<string, { last: Move, count: number }>} */
  const groups = new Map();
  for (const m of moves) {
    if (m.planned || m.type !== type || skip(m)) continue;
    const age = daysBetween(m.date, today);
    if (age < 0 || age > days || !major(m).startsWith(digits)) continue;
    const key = [m.categoryId || '', m.accountId, m.toAccountId || '', fold(m.note), m.amount].join('|');
    const g = groups.get(key) || { last: m, count: 0 };
    g.count++;
    if (m.date > g.last.date || (m.date === g.last.date && (m.createdAt || 0) > (g.last.createdAt || 0))) g.last = m;
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || (a.last.date < b.last.date ? 1 : a.last.date > b.last.date ? -1 : 0))
    .slice(0, limit)
    .map(({ last: m, count }) => ({
      type: m.type, amount: m.amount, accountId: m.accountId, toAccountId: m.toAccountId || null,
      categoryId: m.categoryId || null, note: m.note || '', count,
    }));
}
