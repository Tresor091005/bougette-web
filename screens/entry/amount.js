// Le montant et ce qui le suit : calcul écrit en clair avec son résultat, phrase dessous (problème, conséquence, budget
// dépassé), suggestions par début de montant ou montants habituels, et le bouton qui dit ce qui sera enregistré.
import { account, category, transactions, accCur, balances, checkBalance, plannedWarning } from '../../core/store.js';
import { exprHTML, exprCharsHTML, buzz, fitText, shake, setSeg, $ } from '../../core/ui.js';
import { icon, catIcon } from '../../core/icons.js';
import { today, esc, money, currencyOf } from '../../core/format.js';
import { byAmountStart, proposeCategory, usualAmounts } from '../../domain/suggest.js';
import { entryProblem, consequence, overText, goVerb } from '../../domain/entry-rules.js';
import { openCheckSheet, checkSayHTML } from '../accounts.js';
import { checking, cur, candidate, after, savingsSpend, padLocked, openOfWallet, validIds, impact } from './state.js';
import { paintCats, paintImpact } from './cats.js';

/** @typedef {import('./state.js').Entry} Entry */
const m = (v, c) => money(v, { cur: c });

/** Premier problème de la saisie (entryProblem), avec ce que l'écran sait. @param {Entry} E */
function findProblem(E) {
  const { st, tx, pad } = E;
  // la réserve utilisée : pas plus que ce qu'elle vise encore
  const v = savingsSpend(E) && st.reserveId ? openOfWallet(E).find(x => x.reserve.id === st.reserveId) : null;
  return entryProblem({
    expr: pad ? pad.expr() : '', amount: st.amount, type: st.type, accountId: st.accountId, toAccountId: st.toAccountId,
    wallet: account(st.accountId), toWallet: st.toAccountId ? account(st.toAccountId) : null,
    reserve: v ? { name: v.reserve.name, target: v.target } : null,
    planned: st.planned, date: st.date, today: today(), canPlan: E.canPlan, cur: cur(E),
    balance: () => { const chk = checkBalance(tx, candidate(E)); return chk && { chk, wallet: account(chk.accountId) }; },
    warning: () => { const w = plannedWarning(tx, candidate(E)); return w && { wallet: account(w.accountId), after: w.after, date: w.date }; },
  });
}

/** Le lien sous le montant règle le problème : marquer « Prévu », ou vérifier le solde sans quitter la saisie (D9). @param {Entry} E */
async function fixProblem(E, p) {
  if (p.fix === 'plan') { E.st.planned = true; E.paintMeta(); }
  else if (p.fix === 'check') { await openCheckSheet(account(p.walletId)); E.refresh(); }
}

/** @param {Entry} E @param {string|null} [key] la touche du pavé qui vient d'être touchée */
export function paintAmount(E, key = null) {
  if (checking(E)) return paintCheck(E, key);
  const { st, el, pad, exprEl, resEl, sayEl } = E;
  // pré-choix (ROADMAP 1a) : tant que la catégorie n'a pas été choisie à la main, celle qui domine nettement pour ce
  // montant s'allume « proposée » (rien sinon) ; le bouton « Ajouter 800 F · Zem » dit ce qui sera enregistré
  if (key && !E.editing && st.type !== 'transfer' && !savingsSpend(E) && (!st.categoryId || st.auto)) {
    const p = proposeCategory(transactions(), { type: st.type, today: today(), hour: new Date().getHours(), amount: st.amount, valid: validIds(st.type) });
    st.categoryId = p;
    st.auto = !!p;
  }
  const kp = $('.keypad', el);
  if (kp) kp.classList.toggle('locked', padLocked(E));
  const expr = pad ? pad.expr() : '';
  const problem = E.problem = findProblem(E);
  const short = !!(problem && problem.short);
  // curseur à la fin : rendu habituel (animation du dernier chiffre) ; déplacé : caractère par caractère
  exprEl.innerHTML = pad && pad.caret() < expr.length ? exprCharsHTML(expr, { cur: cur(E), caret: pad.caret() })
    : exprHTML(expr, { cur: cur(E), typed: !!key && key !== 'del' && key !== 'set' && key !== 'caret' });
  exprEl.classList.toggle('err', short);
  exprEl.classList.toggle('income', st.type === 'income' && !short);
  const hasOp = pad && pad.hasOp();
  resEl.textContent = `= ${m(st.amount, cur(E))}`;
  resEl.classList.toggle('hide', !hasOp);
  if (problem) {
    sayEl.className = `e-say${problem.block ? ' err' : ''}`;
    sayEl.innerHTML = `<span>${problem.text}</span>${problem.link ? `<button type="button" class="e-link" data-fix>${problem.link}</button>` : ''}`;
    const fix = $('[data-fix]', sayEl);
    if (fix) fix.onclick = () => { buzz(10); fixProblem(E, E.problem); E.refresh(); };
  } else {
    sayEl.className = 'e-say';
    const a = account(st.accountId);
    const over = overText(impact(E), cur(E));
    sayEl.innerHTML = consequence({ amount: st.amount, wallet: a, type: st.type, planned: st.planned, date: st.date, today: today(), after: a ? after(E, a.id) : 0 })
      + (over ? `<span class="e-over">${over}</span>` : '');
  }
  // erreur : le montant tremble une fois (seulement au passage dans l'état, en tapant)
  if (short && !E.wasShort && key) shake(exprEl);
  E.wasShort = short;
  fitText(exprEl, '.e-expr', 24);
  paintGo(E);
  paintTemplates(E);
  if ((!st.categoryId || st.auto) && key) paintCats(E);
  paintImpact(E, impact(E));
}

/** Vérification (rond balance) : le montant tapé, ce qui sera noté (même phrase que ⋯ › Vérifier le solde), et le bouton. @param {Entry} E @param {string|null} key */
function paintCheck(E, key) {
  const { st, pad, exprEl, resEl, sayEl, goBtn, goLbl } = E;
  const a = account(st.accountId);
  E.problem = null;
  paintTemplates(E); // les modèles du type d'avant s'effacent (pas de suggestion ici)
  exprEl.innerHTML = exprHTML(pad ? pad.expr() : '', { cur: cur(E), typed: !!key && key !== 'del' && key !== 'set' });
  exprEl.classList.remove('err', 'income');
  resEl.textContent = `= ${m(st.actual, cur(E))}`;
  resEl.classList.toggle('hide', !(pad && pad.hasOp()));
  sayEl.className = 'e-say ck';
  sayEl.innerHTML = a ? checkSayHTML(a, st.actual) : 'Choisis un portefeuille.';
  fitText(exprEl, '.e-expr', 24);
  const gap = a ? st.actual - (balances()[a.id] || 0) : 0;
  goLbl.innerHTML = `${icon('check')}<span class="go-t">${gap ? `Corriger à <small>${m(st.actual, cur(E))}</small>` : 'C’est juste'}</span>`;
  goBtn.disabled = !a;
  goBtn.classList.remove('need');
}

/** @param {Entry} E */
function paintGo(E) {
  const { st, problem, goBtn, goLbl } = E;
  const short = !!(problem && problem.short);
  // dépense depuis une épargne (D17) : il faut une réserve (ou « Autre dépense » si le portefeuille le permet)
  const needRes = savingsSpend(E) && !st.reserveId && !(st.other && st.categoryId);
  if (needRes) {
    goLbl.textContent = account(st.accountId)?.spendOk ? 'Réserve ou autre dépense ?' : 'Choisis une réserve';
    goBtn.disabled = true;
    goBtn.classList.remove('need');
    return;
  }
  const verb = goVerb({ editing: E.editing, due: !!E.due, planned: st.planned, type: st.type, reserve: !!st.reserveId && savingsSpend(E) });
  // une opération sans catégorie ne s'enregistre pas : le bouton reste éteint et dit ce qui manque
  const noCat = st.type !== 'transfer' && !st.categoryId;
  const c = st.type === 'transfer' || noCat ? null : category(st.categoryId); // un virement n'a pas de catégorie
  if (short) goLbl.textContent = 'Solde insuffisant';
  else if (problem && problem.label) goLbl.textContent = problem.label;
  else if (st.amount && noCat) goLbl.textContent = 'Choisis une catégorie';
  else goLbl.innerHTML = `${icon('check')}<span class="go-t">${st.amount ? `${verb} <small>${m(st.amount, cur(E))}</small>` : verb}</span>${st.amount && c ? `<span class="go-c">· ${esc(c.name)}</span>` : ''}`;
  goBtn.disabled = !st.amount || noCat || !!(problem && problem.block);
  goBtn.classList.toggle('need', !short && !!st.amount && noCat);
}

// Suggestions par début de montant (2026-11-18, avec l'utilisateur ; avant : des modèles affichés d'office, trois rangées
// à l'ouverture) : on tape « 15 », les opérations des 90 derniers jours dont le montant commence par 15 (Canal Box
// 15 000 F), du type affiché, 3 au plus (byAmountStart), à la place de la phrase sous le montant ; un toucher remplit
// tout (montant, portefeuilles, catégorie, note), il ne reste qu'à toucher Ajouter.
// les frais d'un retrait ou de la banque suivent une autre opération : jamais un modèle à part
const FOLLOWERS = new Set(['fees-momo', 'fees-bank']);
/** Une opération qui ne peut plus servir de suggestion (portefeuille archivé, catégorie disparue, frais qui suivent). @param {any} x */
const unusable = x => !account(x.accountId) || account(x.accountId).archived || (x.type === 'transfer'
  ? !account(x.toAccountId) || account(x.toAccountId).archived
  : !validIds(x.type).includes(x.categoryId) || FOLLOWERS.has(x.categoryId));
// Montants habituels (ROADMAP 1a) : catégorie touchée avant le montant → ses 2 ou 3 montants les plus fréquents en
// puces, à la place des modèles ; un toucher met le montant, il ne reste qu'Ajouter (+, Zem, 500, Ajouter).
/** @param {Entry} E */
function paintTemplates(E) {
  const { st, el, pad } = E;
  const host = $('[data-tpl]', el);
  // dépense depuis une épargne (D17) : pas de modèles ni de montants habituels (ce ne sont pas ses dépenses)
  const blank = !checking(E) && !st.amount && !(pad && pad.expr()) && !savingsSpend(E);
  const usual = blank && !E.editing && !E.due && st.type !== 'transfer' && st.categoryId && !st.auto
    ? usualAmounts(transactions(), { categoryId: st.categoryId, type: st.type, today: today() }) : [];
  const typed = !checking(E) && !savingsSpend(E) && pad ? pad.expr() : '';
  const digits = /^[1-9]\d*$/.test(typed) ? typed : '';
  const major = (/** @type {any} */ x) => String(Math.round(x.amount / 10 ** currencyOf(accCur(x.accountId)).dec));
  const list = usual.length || !digits || E.editing || E.due ? []
    : byAmountStart(transactions(), { today: today(), type: st.type, digits, major, skip: unusable });
  const show = usual.length ? blank : list.length > 0;
  host.hidden = !show;
  // les modèles prennent la place du résultat et de la phrase (zone de même hauteur) : le montant ne bouge pas au 1er chiffre
  $('[data-under]', el).classList.toggle('tpl-on', !!show);
  if (!show) return;
  if (usual.length) {
    host.innerHTML = usual.map(v => `<button type="button" class="tpl ua" data-v="${v}"><b>${m(v, cur(E))}</b></button>`).join('');
    host.onclick = e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      st.amount = Number(b.dataset.v);
      E.padCur = null; // le pavé repart de ce montant
      buzz(10);
      E.refresh();
    };
    return;
  }
  host.innerHTML = list.map((t, i) => {
    const c = category(t.categoryId);
    const pill = t.type === 'transfer' ? `<span class="tpl-ic">${icon('arrows-left-right')}</span>` : `<span class="tpl-ic" style="--c:var(--${c?.color || 'c0'})">${catIcon(c?.icon)}</span>`;
    const label = t.note || (t.type === 'transfer' ? `${account(t.accountId).name} → ${account(t.toAccountId).name}` : c?.name || '');
    return `<button type="button" class="tpl" data-t="${i}">${pill}<span>${esc(label)}</span><b>${m(t.amount, accCur(t.accountId))}</b></button>`;
  }).join('');
  host.onclick = e => {
    const b = e.target.closest('[data-t]');
    if (b) applyTemplate(E, list[Number(b.dataset.t)]);
  };
}

/** Une suggestion touchée remplit tout. @param {Entry} E @param {any} t */
function applyTemplate(E, t) {
  const { st } = E;
  st.type = t.type;
  setSeg($('.type-seg', E.el), t.type);
  st.amount = t.amount;
  st.accountId = t.accountId;
  st.toAccountId = t.type === 'transfer' ? t.toAccountId : null;
  st.categoryId = t.type === 'transfer' ? null : t.categoryId;
  st.auto = false;
  st.note = t.note;
  E.padCur = null; // le pavé repart du montant du modèle
  buzz(10);
  E.refresh();
}
