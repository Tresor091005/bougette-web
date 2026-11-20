// Feuille d'un budget (D11 revu) : créer, reconduire ou modifier. Catégorie (la liste partagée, un seul budget en cours par catégorie,
// celui d'une principale compte aussi ses sous-catégories, celui d'une sous-catégorie elle seule, D13 revu le 2026-11-11), montant au pavé, dates : début (aujourd'hui par défaut) et fin, avec les
// raccourcis « Fin du mois » (selon le début du mois réglé), « 7 jours », « 30 jours » et « Choisir » (calendrier, dates
// à venir permises) ; interrupteur « Se répète ». Reconduire : la catégorie est celle du budget terminé (affichée, pas
// un bouton). Modifier (2026-11-13) : le montant, la fin (plus tard, ou plus tôt mais pas avant aujourd'hui) et « Se
// répète » seulement — la catégorie et le début sont affichés, pas des boutons ; Supprimer (le budget seulement, jamais
// ses opérations). Un refus du domaine (fin passée, chevauchement…) s'affiche dans la feuille. Écrit par les commandes
// budget.create / budget.update / budget.delete (via le magasin).
import { settings, category, budgetById, createBudget, updateBudget, deleteBudget, accounts, subsOver, monthlySpend, balances } from '../core/store.js';
import { remindLater, assigned } from '../core/assign.js';
import { today, esc, shortDate, money } from '../core/format.js';
import { icon } from '../core/icons.js';
import { openSheet, keypad, exprHTML, buzz, chip, toast, fitText, switchHTML, noticeHTML, confirmSheet, afterSheets, $, $$ } from '../core/ui.js';
import { currentWindow, monthEnd } from '../domain/budgets.js';
import { shiftDay } from '../domain/pace.js';
import { pickCategory, pickDate } from './pickers.js';

/**
 * id : budget à modifier ; sinon un nouveau, prérempli avec category / amount (suggestion tirée de l'historique), ou
 * from : un budget terminé qu'on reconduit (même catégorie, même montant, même durée à partir d'aujourd'hui ; le
 * nouveau budget lui est relié, D11). fixed : la catégorie donnée ne se change pas (depuis la page de cette catégorie).
 * @param {{ id?: string|null, category?: string|null, amount?: number, from?: string|null, fixed?: boolean }} [o]
 */
export function openBudgetSheet({ id = null, category: catIn = null, amount: amountIn = 0, from = null, fixed = false } = {}) {
  const st = settings();
  const t = today();
  const b = id ? budgetById(id) : null;
  const prev = !b && from ? budgetById(from) : null;
  if (prev) { catIn = prev.category; amountIn = prev.amount; }
  // un budget qui se répète s'ouvre sur sa période en cours (de même durée : la répétition continue à partir d'elle)
  const w = b ? currentWindow(b, t) || { start: b.start, end: b.end } : null;
  const cur = b ? b.currency : st.currency;
  const f = {
    category: b ? b.category : catIn, amount: b ? b.amount : amountIn || 0,
    start: w ? w.start : t, end: w ? w.end : prev ? shiftDay(t, Math.round((Date.parse(prev.end) - Date.parse(prev.start)) / 864e5)) : monthEnd(t, st.monthStart),
    repeat: b ? b.repeat : false,
  };
  const initial = { ...f };
  // la catégorie ne se choisit qu'à la création ; le début, pas en modification
  const catFixed = !!(b || prev || (fixed && catIn)), startFixed = !!b;
  const s = openSheet(`<div class="budget-sheet">
    <div class="e-head">${catFixed ? '<div class="bs-id bs-cat" data-cat></div>' : '<button type="button" class="bs-id bs-cat" data-cat></button>'}
      <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="e-stage"><div class="e-expr" data-expr></div></div>
    <div class="bs-dates">
      ${startFixed ? '<span class="muted" data-start></span>' : '<button type="button" class="mp" data-start></button>'}<span class="bs-to">${icon('arrow-right')}</span><button type="button" class="mp" data-end></button>
    </div>
    <div class="bs-quick" role="group" aria-label="Fin">
      <button type="button" class="mp" data-q="month">Fin du mois</button><button type="button" class="mp" data-q="7">7 jours</button>
      <button type="button" class="mp" data-q="30">30 jours</button><button type="button" class="mp" data-q="pick">Choisir</button>
    </div>
    <button type="button" class="row bs-rep" data-rep><div class="main"><div class="t">Se répète</div></div>${switchHTML(f.repeat)}</button>
    <div data-err></div>
    <div data-pad></div>
    <button type="button" class="btn primary" data-save>${icon('check')}${b ? 'Enregistrer' : 'Créer le budget'}</button>
    ${b ? `<button type="button" class="btn ghost" data-del>${icon('trash')}Supprimer ce budget</button>` : ''}
  </div>`, { label: 'Budget' });
  const el = s.el;
  const exprEl = $('[data-expr]', el), save = $('[data-save]', el), errEl = $('[data-err]', el);
  const quick = () => ({ month: monthEnd(f.start, st.monthStart), 7: shiftDay(f.start, 6), 30: shiftDay(f.start, 29) });
  const paint = () => {
    const c = f.category ? category(f.category) : null;
    const caret = catFixed ? '' : icon('caret-down');
    $('[data-cat]', el).innerHTML = c ? `${chip(c)}<h2 class="sheet-title">${esc(c.name)}</h2>${caret}`
      : `<span class="pill acc">${icon('target')}</span><h2 class="sheet-title">Catégorie</h2>${caret}`;
    $('[data-start]', el).innerHTML = `<span>${f.start === t ? 'Aujourd’hui' : `Du ${esc(shortDate(f.start))}`}</span>`;
    $('[data-end]', el).innerHTML = `<span>${f.end === t ? 'Aujourd’hui' : `Au ${esc(shortDate(f.end))}`}</span>`;
    const q = quick();
    // un seul raccourci allumé : le premier qui tombe sur la fin (fin du mois avant 30 jours quand c'est la même date)
    const hit = ['month', '7', '30'].find(k => q[k] === f.end) || 'pick';
    $$('[data-q]', el).forEach(x => x.classList.toggle('on', x.dataset.q === hit));
    $('[data-rep] .switch', el).classList.toggle('on', f.repeat);
    $('[data-rep] .switch', el).setAttribute('aria-checked', String(f.repeat));
    save.disabled = !f.category || !f.amount;
  };
  const clearErr = () => { errEl.innerHTML = ''; };
  /** @param {string} msg @param {string} [code] @param {any} [detail] */
  const showErr = (msg, code, detail) => {
    buzz(14);
    // à cheval sur un budget en cours (2026-11-13) : pas un refus, un choix — le remplacer, ou commencer après lui
    if (code === 'partial' && detail) {
      const after = shiftDay(detail.end, 1);
      errEl.innerHTML = `${noticeHTML(esc(msg), { tone: 'info' })}<div class="bs-choice">
        <button type="button" class="btn secondary" data-replace>Remplacer l’actuel</button>
        <button type="button" class="btn secondary" data-after>Commencer après, le ${esc(shortDate(after))}</button></div>`;
      $('[data-replace]', errEl).onclick = async () => {
        // l'actuel prend le nouveau montant et la nouvelle fin : ce qui est déjà dépensé y reste compté
        if (!(await updateBudget(detail.id, { amount: f.amount, end: f.end, repeat: f.repeat }, { onError: showErr }))) return;
        buzz(12); s.close(); toast('Budget remplacé');
      };
      const af = $('[data-after]', errEl);
      // le même budget, décalé : il garde sa durée (60 000 F sur 80 jours reste 60 000 F sur 80 jours)
      if (af) af.onclick = async () => {
        const days = Math.round((Date.parse(f.end) - Date.parse(f.start)) / 864e5);
        f.start = after; f.end = shiftDay(after, days);
        if (!(await createBudget({ category: f.category, amount: f.amount, start: f.start, end: f.end, repeat: f.repeat }, { onError: showErr }))) { paint(); return; }
        assigned(); buzz(12); s.close(); toast(`Budget créé, à partir du ${shortDate(after)}`);
      };
      return;
    }
    errEl.innerHTML = noticeHTML(esc(msg));
  };
  const pad = keypad($('[data-pad]', el), {
    initial: f.amount, cur, onEnter: () => save.click(),
    onChange: (v, expr = '', key = null) => {
      f.amount = v;
      exprEl.innerHTML = exprHTML(expr, { cur, typed: !!key && key !== 'del' });
      fitText(exprEl, '.e-expr', 24);
      clearErr(); paint();
    },
  });
  exprEl.innerHTML = exprHTML(pad.expr(), { cur });
  paint();

  $('[data-close]', el).onclick = () => { buzz(6); s.close(); };
  if (!catFixed) $('[data-cat]', el).onclick = async () => {
    const id2 = await pickCategory({ type: 'expense', current: f.category, title: 'Catégorie du budget' });
    if (id2 && id2 !== '*') { f.category = id2; clearErr(); paint(); }
  };
  if (!startFixed) $('[data-start]', el).onclick = async () => {
    const d = await pickDate({ current: f.start, future: true, title: 'Début du budget' });
    if (!d) return;
    // la durée suit : la fin garde son écart avec le début
    const len = Math.round((Date.parse(f.end) - Date.parse(f.start)) / 864e5);
    f.start = d;
    if (f.end < d) f.end = shiftDay(d, Math.max(0, len));
    clearErr(); paint();
  };
  const pickEnd = async () => {
    const d = await pickDate({ current: f.end, future: true, min: f.start > today() ? f.start : today(), title: 'Fin du budget' });
    if (d) { f.end = d; clearErr(); paint(); }
  };
  $('[data-end]', el).onclick = pickEnd;
  $$('[data-q]', el).forEach(x => (x.onclick = () => {
    buzz(6);
    if (x.dataset.q === 'pick') return pickEnd();
    f.end = quick()[x.dataset.q];
    clearErr(); paint();
  }));
  $('[data-rep]', el).onclick = () => { f.repeat = !f.repeat; buzz(8); clearErr(); paint(); };

  let saving = false;
  save.onclick = async () => {
    if (saving) return;
    if (pad.hasOp()) f.amount = pad.resolve();
    if (!f.category) return showErr('Choisis une catégorie.');
    if (!f.amount) return showErr('Indique un montant.');
    if (b && Object.keys(f).every(k => f[k] === initial[k])) { s.close(); return; }
    saving = true;
    const data = { category: f.category, amount: f.amount, start: f.start, end: f.end, repeat: f.repeat };
    // modifier : la catégorie et le début ne changent pas (le domaine le refuserait)
    const ok = b ? await updateBudget(b.id, { amount: f.amount, end: f.end, repeat: f.repeat }, { onError: showErr })
      : await createBudget(prev ? { ...data, from: prev.id } : data, { onError: showErr });
    saving = false;
    if (!ok) return;
    if (!b) assigned(); // un budget créé donne une destination à l'argent arrivé
    buzz(12);
    s.close();
    // famille (2026-11-11) : des budgets de sous-catégories plus gros que celui de leur principale, on le dit (sans refuser)
    const big = subsOver(f.category);
    toast(big ? `Les budgets de ses sous-catégories (${money(big.subs, { cur: big.main.currency })}) dépassent celui de ${category(big.main.category)?.name || ''} (${money(big.main.amount, { cur: big.main.currency })})`
      : b ? 'Budget enregistré' : prev ? 'Budget reconduit' : 'Budget créé');
  };
  const del = $('[data-del]', el);
  if (del) del.onclick = async () => {
    buzz(8);
    const yes = await confirmSheet({ title: 'Supprimer ce budget ?', text: 'Ses opérations restent dans le Journal.', yes: 'Supprimer', danger: true });
    if (!yes) return;
    afterSheets(async () => { if (await deleteBudget(b.id)) { s.close(); toast('Budget supprimé'); } });
  };
}

// Après une rentrée (D11 : le moment clé, quand l'argent arrive) : « 200 000 F arrivés · Disponible passe à 235 000 F »,
// avec « Mettre de côté » (virement vers l'épargne, depuis le portefeuille qui vient de recevoir ; sans portefeuille
// d'épargne dans cette devise, sa fiche s'ouvre d'abord, en épargne : D17), « Créer un budget » et « Plus tard ». Rien n'est
// imposé. openEntry / openAccountSheet : passés par la saisie (pas d'import circulaire).
/**
 * @param {{ amount: number, cur: string, available: number, walletId: string, openEntry: (o: any) => any, openAccountSheet: (id: any, o?: any) => any }} o
 */
export function openIncomeSheet({ amount, cur, available, walletId, openEntry, openAccountSheet }) {
  const s = openSheet(`<div class="income-sheet">
    <h2 class="sheet-title">${money(amount, { cur })} arrivés</h2>
    <p class="in-say">Disponible passe à <b>${money(available)}</b></p>
    <div class="in-acts">
      <button type="button" class="btn primary" data-act="aside">${icon('hand-coins')}Mettre de côté</button>
      <button type="button" class="btn" data-act="budget">${icon('target')}Créer un budget</button>
      <button type="button" class="btn ghost" data-act="later">Plus tard</button>
    </div>
  </div>`, { label: 'Rentrée', onClose: () => { if (!chosen) remindLater(amount); } });
  // « Plus tard », ou la feuille fermée sans choix : un rappel dans la cloche (src/core/assign.js)
  let chosen = false;
  $$('[data-act]', s.el).forEach(b => (b.onclick = () => {
    const act = b.dataset.act;
    buzz(8);
    chosen = act !== 'later';
    s.close();
    if (act === 'later') return;
    afterSheets(() => {
      if (act === 'budget') return openBudgetSheet();
      const aside = to => openEntry({ type: 'transfer', accountId: walletId, toAccountId: to.id });
      // le fonds d'urgence d'abord tant qu'il couvre moins de 3 mois (2026-11-19), sinon une épargne
      const em = accounts().find(a => a.savings && a.emergency && !a.archived && a.currency === cur);
      const spend = monthlySpend();
      const emOk = em && !(spend > 0 && (balances()[em.id] || 0) >= 3 * spend) ? em : null;
      const saving = emOk || accounts().find(a => a.savings && !a.emergency && !a.archived && a.currency === cur);
      if (saving) aside(saving);
      else openAccountSheet(null, { savings: true, onSaved: aside });
    });
  }));
}
