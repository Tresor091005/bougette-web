// Conversion des données localStorage des itérations 1 et 2 en événements initiaux (une seule fois, au premier démarrage).
// Les anciennes données peuvent être incohérentes (soldes négatifs…) : on ne passe pas par les commandes, mais chaque
// écriture reste en partie double et chaque référence est vérifiée. Les cas impossibles sont ignorés et comptés.
import { DEFAULT_WALLETS, KINDS, initialSettings, SETTING_KEYS } from './defaults.js';

// Catégories par défaut de la v2 (plates) : celles que référencent des données v2 sans liste de catégories.
const V2_CATEGORIES = [
  { id: 'food', name: 'Repas', icon: 'fork-knife', color: 'c1', type: 'expense' },
  { id: 'transport', name: 'Transport', icon: 'bus', color: 'c7', type: 'expense' },
  { id: 'bills', name: 'Factures', icon: 'lightning', color: 'c3', type: 'expense' },
  { id: 'phone', name: 'Crédit & internet', icon: 'cell-signal-high', color: 'c6', type: 'expense' },
  { id: 'home', name: 'Logement', icon: 'house', color: 'c4', type: 'expense' },
  { id: 'health', name: 'Santé', icon: 'heartbeat', color: 'c5', type: 'expense' },
  { id: 'family', name: 'Famille', icon: 'users', color: 'c8', type: 'expense' },
  { id: 'fun', name: 'Sorties', icon: 'music-notes', color: 'c2', type: 'expense' },
  { id: 'shop', name: 'Habillement', icon: 't-shirt', color: 'c9', type: 'expense' },
  { id: 'school', name: 'Éducation', icon: 'book-open', color: 'c7', type: 'expense' },
  { id: 'other', name: 'Autre', icon: 'dots-three', color: 'c10', type: 'expense' },
  { id: 'salary', name: 'Salaire', icon: 'briefcase', color: 'c8', type: 'income' },
  { id: 'sales', name: 'Ventes', icon: 'cash-register', color: 'c2', type: 'income' },
  { id: 'gift', name: 'Cadeau reçu', icon: 'gift', color: 'c5', type: 'income' },
  { id: 'otherin', name: 'Autre revenu', icon: 'tray-arrow-down', color: 'c10', type: 'income' },
];
import { DEFAULT_FMT, CURRENCIES, currencyOf } from './format.js';
import { txLines, balanceLines } from './ledger.js';

/** @typedef {import('./events.js').NewEvent} NewEvent */
/** @typedef {{ version?: any, accounts?: any[]|null, categories?: any[]|null, tx?: any[]|null, budgets?: any, settings?: any }} LegacyData */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^c(10|[0-9])$/;
/** @param {any} v */
const int = v => (Number.isSafeInteger(v) ? v : Number.isFinite(v) ? Math.round(v) : 0);

/**
 * @param {LegacyData} data
 * @param {{ today: string, currency: string }} opts devise détectée si les anciennes données n'en ont pas
 * @returns {{ events: NewEvent[], skipped: number, entries: number }}
 */
export function convertLegacy(data, { today, currency }) {
  const raw = data.settings || {};
  const cur = CURRENCIES.some(c => c.code === raw.currency) ? raw.currency : currency;
  const isV1 = !!data.accounts && (data.version == null || Number(data.version) < 2);
  /** @type {Record<string, any>} */
  const settings = { ...initialSettings(cur) };
  for (const k of SETTING_KEYS) if (k in raw && k !== 'fmt') settings[k] = raw[k];
  settings.fmt = { ...DEFAULT_FMT, dec: currencyOf(cur).dec, ...(raw.fmt || {}) };
  if (isV1) {
    settings.fmt.sym = raw.format === 'long' ? 'long' : 'short';
    settings.blockNegative = true;
    settings.balancesSet = (data.accounts || []).some(a => a && a.opening);
  }
  const onboarded = !!settings.onboarded;
  delete settings.onboarded;
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28].includes(settings.monthStart)) settings.monthStart = 1;
  if (!['auto', 'light', 'dark'].includes(settings.theme)) settings.theme = 'auto';
  for (const k of ['blockNegative', 'balancesSet', 'discreet', 'haptics']) settings[k] = !!settings[k];

  /** @type {NewEvent[]} */
  const events = [{ type: 'settings.changed', payload: { changes: settings } }];
  let skipped = 0, entries = 0;

  // catégories (ordre gardé)
  const cats = (Array.isArray(data.categories) && data.categories.length ? data.categories : V2_CATEGORIES).filter(c => c && c.id && (c.type === 'expense' || c.type === 'income'));
  /** @type {Map<string, string>} */
  const catType = new Map();
  for (const c of cats) {
    if (catType.has(c.id)) continue;
    catType.set(c.id, c.type);
    events.push({ type: 'category.created', payload: { id: String(c.id), type: c.type, name: String(c.name || 'Sans nom').slice(0, 28), icon: c.icon || 'dots', emoji: c.emoji || null, color: COLOR.test(c.color) ? c.color : 'c0' } });
    if (c.archived) events.push({ type: 'category.archived', payload: { id: String(c.id) } });
  }
  /** @param {string} type */
  const fallbackCat = type => {
    const id = type === 'income' ? 'otherin' : 'other';
    if (!catType.has(id)) {
      catType.set(id, type);
      events.push({ type: 'category.created', payload: { id, type, name: type === 'income' ? 'Autre revenu' : 'Autre', icon: type === 'income' ? 'inbox' : 'dots', emoji: null, color: 'c0' } });
    }
    return id;
  };

  // portefeuilles (type déduit, devise ajoutée, ordre gardé)
  const accs = Array.isArray(data.accounts) ? data.accounts : DEFAULT_WALLETS.map(w => ({ id: w.id, name: w.name, kind: w.subtype }));
  /** @type {Map<string, string>} */
  const walletCur = new Map();
  const names = new Set();
  const tx = Array.isArray(data.tx) ? data.tx : [];
  const firstDate = tx.map(t => t && t.date).filter(d => DATE.test(d)).sort()[0] || today;
  for (const a of accs) {
    if (!a || !a.id || walletCur.has(a.id)) continue;
    const subtype = a.kind === 'momo' ? 'emoney' : KINDS.includes(a.kind) ? a.kind : 'cash';
    const wc = CURRENCIES.some(c => c.code === a.currency) ? a.currency : cur;
    let name = String(a.name || 'Portefeuille').slice(0, 28);
    while (names.has(name.toLowerCase())) name = (name + ' bis').slice(0, 28);
    names.add(name.toLowerCase());
    walletCur.set(a.id, wc);
    events.push({ type: 'wallet.created', payload: { id: String(a.id), name, subtype, currency: wc, identifier: subtype === 'cash' ? '' : String(a.ident || ''), color: COLOR.test(a.color) ? a.color : null, allow_negative: !!a.allowNegative } });
    const opening = int(a.opening);
    if (opening) events.push({ type: 'entry.recorded', payload: { id: `${a.id}-opening`, kind: 'opening', occurred_on: firstDate, status: 'posted', note: '', lines: balanceLines(String(a.id), opening, wc) } });
    if (a.archived) events.push({ type: 'wallet.archived', payload: { id: String(a.id) } });
  }

  // opérations
  const seen = new Set();
  for (const t of tx) {
    const amount = t && int(t.amount);
    const ok = t && t.id && !seen.has(t.id) && ['expense', 'income', 'transfer'].includes(t.type) && amount > 0 && DATE.test(t.date) && walletCur.has(t.accountId);
    if (!ok) { skipped++; continue; }
    const wc = /** @type {string} */ (walletCur.get(t.accountId));
    /** @type {any} */
    const m = { type: t.type, amount, accountId: String(t.accountId), date: t.date };
    if (t.type === 'transfer') {
      if (!walletCur.has(t.toAccountId) || t.toAccountId === t.accountId || walletCur.get(t.toAccountId) !== wc) { skipped++; continue; }
      m.toAccountId = String(t.toAccountId);
    } else {
      m.categoryId = catType.get(t.categoryId) === t.type ? String(t.categoryId) : fallbackCat(t.type);
    }
    seen.add(t.id);
    const createdAt = Number.isFinite(t.createdAt) ? new Date(t.createdAt).toISOString() : null;
    /** @type {Record<string, any>} */
    const payload = { id: String(t.id), kind: t.type, occurred_on: t.date, status: t.planned ? 'planned' : 'posted', note: String(t.note || '').slice(0, 120), lines: txLines(m, wc) };
    if (createdAt) payload.created_at = createdAt;
    events.push({ type: 'entry.recorded', payload });
    entries++;
  }

  // budgets (devise principale)
  const b = data.budgets || {};
  for (const [id, amount] of Object.entries(b.byCat || {})) {
    if (catType.get(id) === 'expense' && int(amount) > 0) events.push({ type: 'budget.set', payload: { id, account: id, amount: int(amount), currency: cur } });
  }
  if (int(b.global) > 0) events.push({ type: 'budget.set', payload: { id: 'global', account: null, amount: int(b.global), currency: cur } });
  if (onboarded) events.push({ type: 'app.onboarded', payload: {} });
  return { events, skipped, entries };
}
