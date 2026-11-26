// Feuille d'un budget (D11 revu) : créer, reconduire ou modifier. Catégorie (la liste partagée, un seul budget en cours par catégorie,
// celui d'une principale compte aussi ses sous-catégories, celui d'une sous-catégorie elle seule, D13 revu le 2026-11-11), montant au pavé, dates : début (aujourd'hui par défaut) et fin
// (son calendrier propose « Fin du mois » (selon le début du mois réglé), « 7 jours » et « 30 jours », dates à venir
// permises) ; interrupteur « Se répète ». Plus de titre (2026-11-26, avec l'utilisateur : il ne voit jamais ce qui est en
// haut d'une feuille) : la feuille commence par le grand montant, la catégorie est la première gélule dessous, comme dans la
// saisie. Reconduire : la catégorie est celle du budget terminé (affichée, pas un bouton). Modifier (2026-11-13) : le montant, la fin (plus tard, ou plus tôt mais pas avant aujourd'hui) et « Se
// répète » seulement — la catégorie et le début sont affichés, pas des boutons ; Supprimer (le budget seulement, jamais
// ses opérations). Un refus du domaine (fin passée, chevauchement…) s'affiche dans la feuille. Écrit par les commandes
// budget.create / budget.update / budget.delete (via le magasin).
import { settings, category, budgetById, createBudget, updateBudget, deleteBudget, subsOver, savingsAccounts, savingsReport, categoryBoard } from '../core/store.js';
import { remindLater, assigned } from '../core/assign.js';
import { today, esc, shortDate, money, approx } from '../core/format.js';
import { icon, catIcon } from '../core/icons.js';
import { openSheet, keypad, exprHTML, buzz, toast, fitText, switchHTML, noticeHTML, confirmSheet, afterSheets, $, $$ } from '../core/ui.js';
import { currentWindow, monthEnd, habitsLeft } from '../domain/budgets.js';
import { asideTarget, asideAmount } from '../domain/aside.js';
import { shiftDay } from '../domain/pace.js';
import { pickCategory, pickDate } from './pickers.js';
import { sheetActions, sheetHead } from './parts.js';

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
  // un budget n'a pas de nom : sa catégorie est la première gélule sous le montant (2026-11-26, avec l'utilisateur)
  const s = openSheet(`<div class="budget-sheet">
    <div class="e-stage"><div class="e-expr" data-expr></div></div>
    <div class="e-meta bs-catrow" data-cat-host></div>
    <div class="e-meta">
      <button type="button" class="mp" data-start${startFixed ? ' aria-disabled="true"' : ''}></button><span class="bs-to">${icon('arrow-right')}</span><button type="button" class="mp" data-end></button>
      <button type="button" class="mp" data-rep role="switch" aria-checked="false">Se répète</button>
    </div>
    <div data-pad></div>
    <div data-err></div>
    ${sheetActions('<button type="button" class="btn primary go" data-save><span class="lbl" data-savel></span></button>')}
    ${b ? '<button type="button" class="link bs-del" data-del>Supprimer ce budget</button>' : ''}
  </div>`, { label: 'Budget' });
  const el = s.el;
  const exprEl = $('[data-expr]', el), save = $('[data-save]', el), errEl = $('[data-err]', el);
  const paint = () => {
    const c = f.category ? category(f.category) : null;
    // la gélule de couleur de la saisie ; figée (reconduire, modifier, catégorie donnée) : la même, sans chevron ni action
    $('[data-cat-host]', el).innerHTML = c
      ? `<button type="button" class="sc on" data-cat style="--c:var(--${c.color || 'c0'})"${catFixed ? ' aria-disabled="true"' : ''}>${catIcon(c.icon)}<span>${esc(c.name)}</span>${catFixed ? '' : icon('caret-down')}</button>`
      : `<button type="button" class="sc more ask" data-cat>${icon('squares-four')}<span>Catégorie</span></button>`;
    $('[data-start]', el).innerHTML = `<span>${f.start === t ? 'Aujourd’hui' : `Du ${esc(shortDate(f.start))}`}</span>`;
    $('[data-end]', el).innerHTML = `<span>${f.end === t ? 'Aujourd’hui' : `Au ${esc(shortDate(f.end))}`}</span>`;
    $('[data-rep]', el).classList.toggle('on', f.repeat);
    $('[data-rep]', el).setAttribute('aria-checked', String(f.repeat));
    const lack = !f.category ? 'Choisis une catégorie' : !f.amount ? 'Indique un montant' : '';
    const tail = f.amount ? ` jusqu’au ${shortDate(f.end)}` : '';
    $('[data-savel]', el).innerHTML = lack ? esc(lack)
      : `${icon('check')}<span class="go-t">${b ? 'Enregistrer' : 'Créer'} · ${money(f.amount, { cur })}</span><span class="go-c">${esc(tail)}</span>`;
    save.disabled = !!lack; save.classList.toggle('need', !!lack);
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

  if (!catFixed) $('[data-cat-host]', el).onclick = async e => {
    // la gélule seulement : le reste de la rangée ne répond pas
    if (!(/** @type {HTMLElement} */ (e.target)).closest('[data-cat]')) return;
    buzz(6);
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
    const min = f.start > today() ? f.start : today();
    // les raccourcis de la fin, dans son calendrier (2026-11-26) ; sans ceux qui tombent avant le minimum
    const quick = [['Fin du mois', monthEnd(f.start, st.monthStart)], ['7 jours', shiftDay(f.start, 6)], ['30 jours', shiftDay(f.start, 29)]]
      .filter(([, date]) => date >= min).map(([label, date]) => ({ label, date }));
    const d = await pickDate({ current: f.end, future: true, min, title: 'Fin du budget', quick });
    if (d) { f.end = d; clearErr(); paint(); }
  };
  $('[data-end]', el).onclick = pickEnd;
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
    toast(big ? `Les budgets des sous-catégories de ${category(big.main.category)?.name || ''} (${money(big.subs, { cur: big.main.currency })}) dépassent le sien (${money(big.main.amount, { cur: big.main.currency })})`
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

// Après une rentrée (D11 : le moment clé, quand l'argent arrive ; parcours 4, revu le 2026-11-25 avec l'utilisateur) :
// « 200 000 F arrivés · Disponible passe à 235 000 F ». « Mettre X de côté » n'est proposé que si des réserves manquent
// d'argent pour être prêtes à temps ET que la marge de Plan après ce revenu (Disponible − habitudes estimées) est
// positive ; X = le plus petit du revenu, de la marge et de ce qui manque, arrondi au-dessous (src/domain/aside.js) ; il
// ouvre le virement vers l'épargne à qui il manque le plus, depuis le portefeuille qui vient de recevoir, X prérempli et
// modifiable. Sinon, pas de proposition : « Créer un budget » et « Plus tard ». Rien n'est imposé. openEntry : passé par
// la saisie (pas d'import circulaire) ; openAccountSheet reste dans la signature des appelants (il ne sert plus ici :
// sans épargne, pas de réserve qui manque, donc pas de proposition).
/**
 * @param {{ amount: number, cur: string, available: number, walletId: string, openEntry: (o: any) => any, openAccountSheet?: (id: any, o?: any) => any }} o
 */
export function openIncomeSheet({ amount, cur, available, walletId, openEntry }) {
  const target = asideTarget(savingsAccounts().filter(a => !a.archived && a.currency === cur).map(a => savingsReport(a.id)));
  const margin = available - approx(habitsLeft(categoryBoard()), cur);
  const put = target ? asideAmount({ amount, margin, missing: target.missing, cur }) : 0;
  const s = openSheet(`<div class="income-sheet">
    ${sheetHead({ title: `${money(amount, { cur })} arrivés` })}
    <p class="in-say">Disponible passe à <b>${money(available)}</b></p>
    <div class="in-acts">
      ${put ? `<button type="button" class="btn primary" data-act="aside">${icon('hand-coins')}Mettre ${money(put, { cur })} de côté</button>` : ''}
      <button type="button" class="btn${put ? '' : ' primary'}" data-act="budget">${icon('target')}Créer un budget</button>
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
      if (target) openEntry({ type: 'transfer', accountId: walletId, toAccountId: target.wallet, amount: put });
    });
  }));
}
