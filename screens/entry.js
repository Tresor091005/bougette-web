// Saisie rapide (D14) : modèles des opérations qui reviennent (un toucher remplit tout), catégories suggérées en
// gélules (heure, jour, montant, habitudes) avec « Toutes », date maison (‹ › d'un jour en un toucher,
// calendrier), note avec les notes déjà écrites. Parcours habituel : + 8 0 0 Zem Ajouter (6 touchers au plus).
// Le bouton dit ce qui sera enregistré (« Ajouter 800 F · Zem ») et reste éteint tant qu'il manque la catégorie.
// Saisie « calculatrice vivante » (D4) : feuille du bas haute. Dépense / Revenu / Virement en gélule, portefeuille en
// haut comme un destinataire, calcul écrit en clair avec le résultat en direct, conséquence sur le solde, pastilles
// ‹ Date › · Note, opérateurs sur une rangée légère, pavé en gélules. Solde insuffisant : montant et phrase en rouge, lien « Vérifier
// le solde de … » (D9), bouton éteint. Mouvement (D5) : touche, coche dessinée, feuille qui descend, tremblement d'erreur.
// Pas de « Prévu » dans la saisie pour l'instant : pas de nouvelle opération prévue, pas de date à venir ;
// une opération déjà prévue garde sa pastille quand on la modifie, pour pouvoir la marquer payée. Le domaine garde le statut prévu.
// Vérifier un solde sans quitter le + (D9, nouvelle saisie seulement) : un rond à part sur la ligne des types (icône
// balance), pas un 4e type — ce n'est pas une opération. La feuille dit à quoi ça sert, demande « Combien as-tu vraiment
// dessus ? », pavé prérempli avec le solde de l'app, « C'est juste » ou « Corriger à … » ; catégories, modèles, date et
// note s'effacent. Toucher un type ou le rond à nouveau revient à la saisie.
// Épargne (D17, revu le 2026-11-10) : une Dépense depuis un portefeuille d'épargne montre, à la place des catégories, la
// liste de ses réserves qui ont de l'argent mis de côté (utiliser une réserve = la dépenser : le montant se remplit, la
// catégorie est celle de la réserve) et « Autre dépense » si le portefeuille permet les dépenses (alors les catégories
// habituelles, sans réserve). Les deux modes ne se mélangent pas. Un virement reste un virement. reserveId : saisie
// ouverte par « Utiliser » sur la réserve.
// Le budget à la saisie (2026-11-11, D4) : la gélule de la catégorie choisie est sa barre — remplie de la part de son
// budget déjà partie dès le choix, puis de cette dépense à chaque chiffre (hachurée pour une habitude sans budget),
// rouge si elle le fait dépasser ; une phrase seulement alors (« Sorties : 8 500 F de trop »). Rien de plus.
// Toute écriture passe par le magasin (commandes du domaine) ; rien n'est écrit ici en direct.
import {
  addTx, updateTx, confirmDue, account, category, accounts, categories, subcategories, categoryLabel, transactions, pref, accCur, balances,
  checkBalance, plannedWarning, checkWallet, available, settings, openReserves, savingsReport, reserveById,
  spendImpact, dueRange, scheduleById } from '../core/store.js';
import { openSheet, keypad, exprHTML, exprCharsHTML, buzz, seg, wireSeg, fitText, shake, cueMotion, reducedMotion, setSeg, afterSheets, confirmSheet, chip, toast, $, $$ } from '../core/ui.js';
import { icon, catIcon } from '../core/icons.js';
import { today, dayLabel, shortDate, esc, money, currencyOf, parse, addDays } from '../core/format.js';
import { MAX_AMOUNT, dividesByZero } from '../domain/money.js';
import { suggestCategories, byAmountStart, noteSuggestions, fold, proposeCategory, usualAmounts } from '../domain/suggest.js';
import { UNTRACKED } from '../domain/defaults.js';

const UNTRACKED_IDS = new Set(Object.values(UNTRACKED));
import { pickAccount, accountPill, pickDate } from './pickers.js';
import { balanceMessage } from './common.js';
import { openAccountSheet, openCheckSheet, checkSayHTML } from './accounts.js';
import { openCategorySheet } from './categories.js';
import { openIncomeSheet } from './budget-sheet.js';
import { assigned } from '../core/assign.js';
import { catTreeHTML, catSearchHTML, wireCatSearch, paintTree, NONE_ILLU } from './catlist.js';

const TYPES = [['expense', 'Dépense'], ['income', 'Revenu'], ['transfer', 'Virement']];
const fmtDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
// Libellé court de la date : « Aujourd'hui », « Hier », « Mer. 4 nov. », « Mer 31 déc 2025 » une autre année.
function dateLabel(d) {
  const l = dayLabel(d);
  if (['Aujourd’hui', 'Hier', 'Demain'].includes(l)) return l;
  const s = fmtDate.format(parse(d)).replace(/\./g, '');
  // une autre année que l'année en cours : on l'écrit (« Mer 31 déc 2025 »)
  const y = d.slice(0, 4) !== today().slice(0, 4) ? ` ${d.slice(0, 4)}` : '';
  return s.charAt(0).toUpperCase() + s.slice(1) + y;
}
const m = (v, cur) => money(v, { cur, hide: false });

// Effet d'une opération (payée) sur le solde d'un portefeuille.
function effect(t, accId) {
  if (!t || t.planned || !t.amount) return 0;
  if (t.type === 'transfer') return (t.accountId === accId ? -t.amount : 0) + (t.toAccountId === accId ? t.amount : 0);
  if (t.accountId !== accId) return 0;
  return t.type === 'income' ? t.amount : -t.amount;
}

// copy : une opération à refaire (Dupliquer, depuis sa fiche) — nouvelle saisie remplie comme elle, à la date du jour.
export function openEntry({ type = 'expense', tx = null, copy = null, accountId = null, toAccountId = null, reserveId = null, completeReserve = null, due = null } = {}) {
  // aucun portefeuille (D10) : le + ouvre d'abord la fiche de création, puis la saisie sur le portefeuille créé
  if (!tx && !accounts().length) {
    openAccountSheet(null, { savings: false, intro: 'Pour noter une opération, crée d’abord un portefeuille.', onSaved: a => openEntry({ type: type === 'transfer' ? 'expense' : type, accountId: a.id }) });
    return null;
  }
  const editing = !!tx;
  const canPlan = editing && !!tx.planned; // seule une opération déjà prévue garde « Prévu »
  const firstAcc = accounts()[0]?.id;
  const last = account(pref('lastAccount'));
  // un portefeuille archivé depuis ne se reprend pas (on prend celui par défaut)
  const live = id => (id && account(id) && !account(id).archived ? id : null);
  // une échéance à confirmer avec d'autres valeurs (D18) : la saisie préremplie ; « Ajouter » la confirme (date : la
  // sienne si elle est passée, sinon aujourd'hui)
  const fromDue = due ? { type: due.kind, amount: due.amount, accountId: due.needsWallet ? null : due.wallet, toAccountId: due.to, categoryId: due.category, note: due.note } : null;
  const src = tx || copy || fromDue;
  const ref = copy || fromDue;
  // confirmer une échéance (D18, revu le 2026-11-12) : son type et sa catégorie ne se changent pas ici, la date va de la
  // fois d'avant à aujourd'hui (un retard se date du jour où il était dû), un montant loin du prévu se fait confirmer.
  // Les mêmes règles valent pour modifier, depuis le Journal, l'opération qui a confirmé une échéance (linked).
  const linked = editing && tx.schedule ? scheduleById(tx.schedule) : null;
  const held = !!(due || linked);
  const bounds = due ? dueRange(due) : linked ? dueRange({ schedule: linked.id, entry: null, date: /** @type {string} */ (tx.due) }) : null;
  /** Le montant prévu (A7), dans sa devise. */
  const planned = due ? { amount: due.amount, currency: due.currency } : linked ? { amount: linked.amount, currency: linked.currency } : null;
  const st = {
    type: src?.type || type,
    amount: src?.amount || 0,
    accountId: tx?.accountId || live(ref?.accountId) || accountId || (last && !last.archived ? last.id : firstAcc),
    toAccountId: tx?.toAccountId || live(ref?.toAccountId) || toAccountId || null,
    categoryId: tx?.categoryId || (ref?.categoryId && category(ref.categoryId) && !category(ref.categoryId).archived ? ref.categoryId : null),
    date: tx?.date || (due ? (due.date < today() ? due.date : today()) : today()),
    note: src?.note || '',
    planned: canPlan,
    auto: false, // catégorie pré-choisie d'après le montant tapé (« proposée ») : un toucher la confirme, une autre la remplace
    actual: 0, // vérification (rond balance) : le montant qu'on a vraiment
    reserveId: reserveId || due?.reserve || null, // réserve utilisée (D17), ou celle qui paie l'échéance (D18)
    other: false, // dépense ordinaire depuis une épargne qui le permet (« Autre dépense »)
  };
  // une échéance à confirmer : sa date dans ce qui est permis (de la fois d'avant à aujourd'hui) ; une opération déjà
  // notée garde la sienne (seul un changement de date est contrôlé)
  if (due && bounds) st.date = bounds.min && st.date < bounds.min ? bounds.min : st.date > bounds.max ? bounds.max : st.date;
  const checking = () => st.type === 'check';
  let opType = checking() ? 'expense' : st.type; // le type d'opération où l'on revient en quittant la vérification
  if (st.type === 'transfer' && st.toAccountId === st.accountId) st.toAccountId = null;

  const s = openSheet(`<div class="entry">
    <div class="e-head">${seg(TYPES, opType, `type-seg${held ? ' locked' : ''}`)}
      ${editing || due ? '' : `<button type="button" class="iconbtn soft e-chk" data-chk aria-pressed="false" aria-label="Vérifier un solde">${icon('scales')}</button>`}
      <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="e-from" data-from></div>
    <div class="e-stage">
      <div class="e-q" data-q hidden>
        <p class="e-help">Compte l’argent que tu as vraiment : Bougette corrige son solde.</p>
        <p class="e-qt">Combien as-tu vraiment dessus ?</p>
      </div>
      <div class="e-expr" data-expr aria-live="polite"></div>
      <div class="e-under" data-under>
        <div class="e-result" data-res aria-hidden="true"></div>
        <div class="e-say" data-say></div>
        <div class="e-tpl" data-tpl hidden></div>
      </div>
    </div>
    <div class="e-sugg" data-cats role="radiogroup" aria-label="Catégorie"></div>
    <div class="e-meta">
      ${canPlan ? '' : `<button type="button" class="mp ic-only" data-dprev aria-label="Jour précédent">${icon('caret-left')}</button>`}
      <button type="button" class="mp" data-datep>${icon('calendar-blank')}<b data-date></b></button>
      ${canPlan ? '' : `<button type="button" class="mp ic-only" data-dnext aria-label="Jour suivant">${icon('caret-right')}</button>`}
      <button type="button" class="mp" data-notep>${icon('text-align-left')}<span data-notel></span></button>
      ${canPlan ? `<button type="button" class="mp" data-plan aria-pressed="false">${icon('clock')}<span>Prévu</span></button>` : ''}
    </div>
    <div data-pad></div>
    <button type="button" class="btn primary go" data-go><span class="lbl" data-gol></span>
      ${icon('check', 'chk')}</button>
  </div>`, { cls: 'entry-sheet', label: editing ? 'Modifier l’opération' : 'Nouvelle opération', beforeClose: reason => (!dirty() ? true : reason === 'scrim' ? 'stay' : 'ask') });

  const el = s.el;
  const exprEl = $('[data-expr]', el), resEl = $('[data-res]', el), sayEl = $('[data-say]', el), goBtn = $('[data-go]', el), goLbl = $('[data-gol]', el);
  const cur = () => accCur(st.accountId);
  let pad, padCur = null, problem = null, wasShort = false, saving = false, checkFrom = 0;
  // Saisie en cours qu'un geste accidentel ferait perdre (fond touché, glissé, Retour) : un montant tapé, ou, pour une
  // opération qu'on modifie, un changement ; en vérification, un montant différent de celui proposé (ou un montant tapé avant). La croix ferme
  // toujours sans demander ; l'enregistrement aussi.
  // une copie (Dupliquer) arrive remplie : elle n'est « à perdre » que si on y a changé quelque chose
  const sig = () => JSON.stringify([st.type === 'check' ? opType : st.type, st.amount, st.accountId, st.toAccountId, st.categoryId, st.note, st.date]);
  const copyFrom = copy ? sig() : null;
  const started = () => (copy ? sig() !== copyFrom : !!st.amount);
  const dirty = () => {
    if (saving) return false;
    // (en vérification, l'opération commencée avant est gardée pour le retour : elle compte aussi)
    if (checking()) return st.actual !== checkFrom || !!(pad && pad.hasOp()) || started();
    if (!editing) return started() || !!(pad && (copy ? pad.hasOp() : pad.expr()));
    const c = candidate();
    return c.amount !== tx.amount || c.type !== tx.type || c.accountId !== tx.accountId || c.date !== tx.date || st.note !== (tx.note || '')
      || (c.type === 'transfer' ? c.toAccountId !== (tx.toAccountId || null) : c.categoryId !== (tx.categoryId || null)) || !!st.planned !== !!tx.planned;
  };

  // Opération telle qu'elle serait enregistrée (pour les contrôles).
  /** @returns {any} */
  const candidate = () => ({
    id: tx?.id, type: st.type, amount: st.amount, accountId: st.accountId, date: st.date, planned: st.planned,
    ...(st.type === 'transfer' ? { toAccountId: st.toAccountId } : { categoryId: st.categoryId }),
  });
  // Solde d'un portefeuille après l'opération (en remplaçant sa version enregistrée si on modifie).
  const after = accId => (balances()[accId] || 0) - effect(tx, accId) + effect(candidate(), accId);

  // Premier problème : { block, short (solde insuffisant), text, link, fix }.
  /** @returns {any} */
  function findProblem() {
    // calculs absurdes (ROADMAP étape 2) : division par zéro, résultat négatif, montant hors limite
    if (pad && dividesByZero(pad.expr())) return { block: true, text: 'Division par zéro.' };
    if (!st.amount) return null;
    if (st.amount < 0) return { block: true, text: 'Le résultat est négatif.' };
    if (st.amount > MAX_AMOUNT) return { block: true, text: 'Ce montant est trop grand.' };
    const a = account(st.accountId);
    if (!a) return { block: true, text: 'Choisis un portefeuille.' };
    // une réserve paie ce qu'on veut (revu le 2026-11-19), mais pas plus que ce qu'elle vise encore : au-delà, ce n'est
    // plus elle (une autre dépense) ; sinon seul le solde de l'épargne limite, comme toute dépense
    if (savingsSpend() && st.reserveId) {
      const v = openOfWallet().find(x => x.reserve.id === st.reserveId);
      if (v && st.amount > v.target) return { block: true, label: `Au plus ${m(v.target, a.currency)} pour ${esc(v.reserve.name)}`, text: '' };
    }
    if (st.type === 'transfer' && st.toAccountId) {
      const b = account(st.toAccountId);
      if (st.toAccountId === st.accountId) return { block: true, text: 'Choisis deux portefeuilles différents.' };
      if (b && b.currency !== a.currency) return { block: true, text: `Pas de virement entre ${esc(currencyOf(a.currency).long)} et ${esc(currencyOf(b.currency).long)} pour l’instant.` };
    }
    if (!st.planned && st.date > today()) {
      return canPlan
        ? { block: true, text: 'Cette date est dans le futur.', link: 'Marquer « Prévu »', fix: () => { st.planned = true; paintMeta(); } }
        : { block: true, text: 'Cette date est dans le futur.' };
    }
    const chk = checkBalance(tx, candidate());
    if (chk) {
      const acc = account(chk.accountId);
      const msg = balanceMessage(chk, { editing });
      // si l'app se trompe de solde, on le vérifie sans quitter la saisie (D9) ; le négatif reste refusé. Pas de lien
      // quand vérifier n'y peut rien : solde passé (opération antidatée) ou portefeuille archivé
      const can = chk.kind !== 'past' && acc && !acc.archived;
      return {
        block: true, short: true, text: msg.text,
        ...(can ? { link: `Vérifier le solde de ${esc(acc.name)}`, fix: async () => { await openCheckSheet(acc); refresh(); } } : {}),
      };
    }
    const w = plannedWarning(tx, candidate());
    if (w) return { block: false, text: `${esc(account(w.accountId).name)} passera à ${m(w.after, cur())} le ${shortDate(w.date)}.` };
    return null;
  }

  // Conséquence (D4) : « Il restera 22 900 F dans Espèces », « Espèces passera à … ».
  function consequence() {
    const a = account(st.accountId);
    if (!st.amount || !a) return '';
    if (st.planned) return `Prévu ${st.date === today() ? 'aujourd’hui' : `le ${shortDate(st.date)}`} : ne touche pas encore ${esc(a.name)}`;
    if (st.type === 'income') return `${esc(a.name)} passera à <b>${m(after(a.id), a.currency)}</b>`;
    return `Il restera <b>${m(after(a.id), a.currency)}</b> dans ${esc(a.name)}`;
  }

  function paintAmount(key = null) {
    if (checking()) return paintCheck(key);
    // pré-choix (ROADMAP 1a) : tant que la catégorie n'a pas été choisie à la main, celle qui domine nettement pour ce
    // montant s'allume « proposée » (rien sinon) ; le bouton « Ajouter 800 F · Zem » dit ce qui sera enregistré
    if (key && !editing && st.type !== 'transfer' && !savingsSpend() && (!st.categoryId || st.auto)) {
      const p = proposeCategory(transactions(), { type: st.type, today: today(), hour: new Date().getHours(), amount: st.amount, valid: validIds(st.type) });
      st.categoryId = p;
      st.auto = !!p;
    }
    const kp = $('.keypad', el);
    if (kp) kp.classList.toggle('locked', padLocked());
    const expr = pad ? pad.expr() : '';
    problem = findProblem();
    const short = !!(problem && problem.short);
    // curseur à la fin : rendu habituel (animation du dernier chiffre) ; déplacé : caractère par caractère
    exprEl.innerHTML = pad && pad.caret() < expr.length ? exprCharsHTML(expr, { cur: cur(), caret: pad.caret() })
      : exprHTML(expr, { cur: cur(), typed: !!key && key !== 'del' && key !== 'set' && key !== 'caret' });
    exprEl.classList.toggle('err', short);
    exprEl.classList.toggle('income', st.type === 'income' && !short);
    const hasOp = pad && pad.hasOp();
    resEl.textContent = `= ${m(st.amount, cur())}`;
    resEl.classList.toggle('hide', !hasOp);
    if (problem) {
      sayEl.className = `e-say${problem.block ? ' err' : ''}`;
      sayEl.innerHTML = `<span>${problem.text}</span>${problem.link ? `<button type="button" class="e-link" data-fix>${problem.link}</button>` : ''}`;
      const fix = $('[data-fix]', sayEl);
      if (fix) fix.onclick = () => { buzz(10); problem.fix(); refresh(); };
    } else {
      sayEl.className = 'e-say';
      // un dépassement de budget (ou « Plus que d'habitude ») : la seule phrase en plus, et seulement alors
      const x = impact();
      const over = x && x.over ? (x.kind === 'budget' ? `${esc(x.name)} : ${m(x.by, cur())} de trop` : `${esc(x.name)} : plus que d’habitude`) : '';
      sayEl.innerHTML = consequence() + (over ? `<span class="e-over">${over}</span>` : '');
    }
    // erreur : le montant tremble une fois (seulement au passage dans l'état, en tapant)
    if (short && !wasShort && key) shake(exprEl);
    wasShort = short;
    fitText(exprEl, '.e-expr', 24);
    paintGo();
    paintTemplates();
    if ((!st.categoryId || st.auto) && key) paintCats();
    paintImpact(impact());
  }
  // Vérification (rond balance) : le montant tapé, ce qui sera noté (même phrase que ⋯ › Vérifier le solde), et le bouton.
  function paintCheck(key = null) {
    const a = account(st.accountId);
    problem = null;
    paintTemplates(); // les modèles du type d'avant s'effacent (pas de suggestion ici)
    exprEl.innerHTML = exprHTML(pad ? pad.expr() : '', { cur: cur(), typed: !!key && key !== 'del' && key !== 'set' });
    exprEl.classList.remove('err', 'income');
    resEl.textContent = `= ${m(st.actual, cur())}`;
    resEl.classList.toggle('hide', !(pad && pad.hasOp()));
    sayEl.className = 'e-say ck';
    sayEl.innerHTML = a ? checkSayHTML(a, st.actual) : 'Choisis un portefeuille.';
    fitText(exprEl, '.e-expr', 24);
    const gap = a ? st.actual - (balances()[a.id] || 0) : 0;
    goLbl.innerHTML = `${icon('check')}<span class="go-t">${gap ? `Corriger à <small>${m(st.actual, cur())}</small>` : 'C’est juste'}</span>`;
    goBtn.disabled = !a;
    goBtn.classList.remove('need');
  }
  function paintGo() {
    const short = !!(problem && problem.short);
    // dépense depuis une épargne (D17) : il faut une réserve (ou « Autre dépense » si le portefeuille le permet)
    const needRes = savingsSpend() && !st.reserveId && !(st.other && st.categoryId);
    if (needRes) {
      goLbl.textContent = account(st.accountId)?.spendOk ? 'Choisis d’abord une réserve ou une autre dépense' : 'Choisis d’abord une réserve';
      goBtn.disabled = true;
      goBtn.classList.remove('need');
      return;
    }
    const verb = editing ? 'Enregistrer' : due ? 'Confirmer' : st.planned ? 'Prévoir' : st.type === 'transfer' ? 'Virer' : st.reserveId && savingsSpend() ? 'Utiliser' : 'Ajouter';
    // une opération sans catégorie ne s'enregistre pas : le bouton reste éteint et dit ce qui manque
    const noCat = st.type !== 'transfer' && (!st.categoryId || needRes);
    const c = st.type === 'transfer' || noCat ? null : category(st.categoryId); // un virement n'a pas de catégorie
    if (short) goLbl.textContent = 'Solde insuffisant';
    else if (problem && problem.label) goLbl.textContent = problem.label;
    else if (st.amount && needRes) goLbl.textContent = due ? 'Choisis un autre portefeuille' : account(st.accountId)?.spendOk ? 'Choisis une réserve ou une autre dépense' : 'Choisis une réserve';
    else if (st.amount && noCat) goLbl.textContent = 'Choisis une catégorie';
    else goLbl.innerHTML = `${icon('check')}<span class="go-t">${st.amount ? `${verb} <small>${m(st.amount, cur())}</small>` : verb}</span>${st.amount && c ? `<span class="go-c">· ${esc(c.name)}</span>` : ''}`;
    goBtn.disabled = !st.amount || noCat || !!(problem && problem.block);
    goBtn.classList.toggle('need', !short && !!st.amount && noCat);
  }
  function paintFrom() {
    const a = account(st.accountId);
    const bal = balances();
    // virement (2026-11-10) : logo et nom seulement — ni « De / À » (la flèche et l'ordre disent le sens, le lecteur
    // d'écran les lit), ni chevron (toute la pastille se touche) : le nom a presque deux fois plus de place
    const one = (acc, lbl, attr) => lbl
      ? `<button type="button" class="e-wallet tw" ${attr} aria-label="${lbl} ${esc(acc?.name || 'choisir')}">${acc ? accountPill(acc, 'sm') : `<span class="pill acc sm">${icon('wallet')}</span>`}<b>${esc(acc?.name || 'Choisir')}</b></button>`
      : `<button type="button" class="e-wallet" ${attr}>${acc ? accountPill(acc, 'sm') : `<span class="pill acc sm">${icon('wallet')}</span>`}
      <b>${esc(acc?.name || 'Choisir')}</b>${acc ? `<span class="bal${(bal[acc.id] || 0) < 0 ? ' loss' : ''}">${m(bal[acc.id] || 0, acc.currency)}</span>` : ''}${icon('caret-down')}</button>`;
    $('[data-from]', el).innerHTML = st.type === 'transfer'
      ? `${one(a, 'De', 'data-acc')}<button type="button" class="e-arrow" data-swap aria-label="Inverser De et À"${st.toAccountId ? '' : ' disabled'}>${icon('arrows-left-right')}</button>${one(account(st.toAccountId), 'À', 'data-to')}`
      : one(a, '', 'data-acc');
    $('[data-acc]', el).onclick = chooseFrom;
    const to = $('[data-to]', el);
    if (to) to.onclick = chooseTo;
    // la flèche inverse De et À (comme une traduction) ; la saisie se recalcule (solde, réserves, Dépense permise)
    const swap = $('[data-swap]', el);
    if (swap) swap.onclick = () => {
      if (!st.toAccountId) return;
      [st.accountId, st.toAccountId] = [st.toAccountId, st.accountId];
      st.reserveId = null;
      buzz(8);
      refresh();
    };
  }
  // Catégorie (D14) : une rangée de gélules — la catégorie choisie, puis les plus probables (heure, jour, montant tapé,
  // habitudes : src/domain/suggest.js), puis « Toutes ». Les suggestions vont droit à la sous-catégorie
  // (« Zem », pas « Transport » puis « Zem »). Un toucher choisit, un 2e toucher sur la même retire le choix. Tant que
  // rien n'est choisi, la rangée suit le montant tapé ; une fois choisi, elle ne bouge plus.
  // suggestions et modèles : jamais « Non suivi » (l'écart d'une vérification n'est pas une habitude ; elle reste dans « Toutes »)
  const validIds = type => categories(type).filter(c => !UNTRACKED_IDS.has(c.id)).flatMap(c => [c.id, ...subcategories(c.id).map(x => x.id)]);
  let shown = [], shownFor = null;
  const sc = (c, on) => `<button type="button" class="sc${on ? ' on' : ''}${on && st.auto ? ' auto' : ''}" data-cat="${c.id}" role="radio" aria-checked="${on}" aria-label="${esc(categoryLabel(c.id))}${on && st.auto ? ' (proposée)' : ''}" style="--c:var(--${c.color || 'c0'})">${catIcon(c.icon)}<span>${esc(c.name)}</span></button>`;
  // l'effet de la dépense sur le budget (ou l'habitude) de la catégorie choisie, ou null
  const impact = () => (st.type !== 'expense' || st.planned || checking() || savingsSpend() || !st.categoryId ? null
    : spendImpact({ categoryId: st.categoryId, accountId: st.accountId, amount: st.amount, date: st.date, except: editing ? tx.id : null }));
  // la gélule de la catégorie choisie se remplit : la part de son budget (ou de son habitude) avec cette dépense
  function paintImpact(x) {
    $$('[data-cats] .sc', el).forEach(b => { b.classList.remove('gauge', 'over', 'habit'); b.style.removeProperty('--p'); });
    // une réserve choisie (2026-11-19, comme la catégorie et son budget) : sa gélule va jusqu'à ce qu'elle vise encore ;
    // un trait blanc marque sa part (ce qui est de côté pour elle, placé automatiquement), ce qu'on tape la remplit ;
    // seul ce qu'elle vise est une limite (au-delà, refusé)
    const rb = savingsSpend() && st.reserveId ? $(`[data-cats] .rs-chip.on[data-res="${st.reserveId}"]`, el) : null;
    const rv = rb ? openOfWallet().find(v => v.reserve.id === st.reserveId) : null;
    if (rb && rv && rv.target > 0) {
      rb.classList.add('gauge');
      rb.classList.toggle('over', st.amount > rv.target);
      rb.style.setProperty('--p', String(Math.min(100, Math.round((st.amount * 100) / rv.target))));
    }
    const b = x && $(`[data-cats] .sc.on[data-cat="${st.categoryId}"]`, el);
    if (!b) return;
    b.classList.add('gauge');
    b.classList.toggle('over', x.over);
    b.classList.toggle('habit', x.kind === 'habit');
    b.style.setProperty('--p', String(Math.round(x.ratio * 100)));
  }
  function paintCats() {
    const host = $('[data-cats]', el);
    host.setAttribute('aria-label', 'Catégorie');
    host.classList.remove('list');
    if (st.type === 'transfer' && !checking()) { shownFor = null; host.hidden = true; return; }
    // une échéance se confirme dans sa catégorie (et son opération la garde) : on la voit, on ne la change pas ici (on
    // modifie l'échéance). Payée depuis une épargne sans sa réserve : une dépense ordinaire si ce portefeuille le permet,
    // sinon on le dit
    if (held) {
      shownFor = null;
      host.hidden = false;
      const w = account(st.accountId);
      st.other = savingsSpend() && !st.reserveId && !!w?.spendOk;
      const c = category(st.categoryId || '');
      host.innerHTML = (c ? sc(c, true).replace('<button type="button" class="sc', '<button type="button" aria-disabled="true" class="sc fixed') : '')
        + (savingsSpend() && !st.reserveId && !st.other ? `<p class="rs-none">${esc(w?.name || '')} ne permet pas les dépenses sans réserve : choisis un autre portefeuille.</p>` : '');
      host.onclick = null;
      return;
    }
    if (savingsSpend()) { shownFor = null; return paintReserves(host); }
    host.hidden = checking();
    if (host.hidden) return;
    const typeChanged = !shownFor || shownFor.type !== st.type;
    if (typeChanged || ((!st.categoryId || st.auto) && shownFor.amount !== st.amount)) {
      shown = suggestCategories(transactions(), { type: st.type, today: today(), hour: new Date().getHours(), amount: st.amount, valid: validIds(st.type), limit: 6 });
      shownFor = { type: st.type, amount: st.amount };
      host.scrollLeft = 0;
    }
    const ids = st.categoryId && !shown.includes(st.categoryId) ? [st.categoryId, ...shown] : shown;
    host.innerHTML = ids.map(id => category(id)).filter(Boolean).map(c => sc(c, c.id === st.categoryId)).join('')
      + `<button type="button" class="sc more" data-all>${icon('squares-four')}<span>Toutes</span></button>`;
    host.onclick = async e => {
      const b = e.target.closest('[data-cat], [data-all]');
      if (!b) return;
      buzz(6);
      // la proposée touchée : confirmée (elle reste) ; sinon un 2e toucher retire le choix
      if (b.dataset.cat) { st.categoryId = st.categoryId === b.dataset.cat && !st.auto ? null : b.dataset.cat; st.auto = false; }
      else {
        const r = await pickEntryCategory({ type: st.type, current: st.categoryId });
        if (!r) return;
        if (typeof r === 'object') {
          // rien de trouvé : on crée la catégorie avec le nom tapé, puis la saisie la choisit
          const type = st.type;
          afterSheets(() => openCategorySheet(null, type, { name: r.create, onSaved: c => {
            if (st.type !== type) return;
            st.categoryId = c.id; st.auto = false; shownFor = null;
            paintCats(); paintAmount();
          } }));
          return;
        }
        st.categoryId = r;
        st.auto = false;
      }
      paintCats(); paintAmount();
    };
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
  function paintTemplates() {
    const host = $('[data-tpl]', el);
    // dépense depuis une épargne (D17) : pas de modèles ni de montants habituels (ce ne sont pas ses dépenses)
    const blank = !checking() && !st.amount && !(pad && pad.expr()) && !savingsSpend();
    const usual = blank && !editing && !due && st.type !== 'transfer' && st.categoryId && !st.auto
      ? usualAmounts(transactions(), { categoryId: st.categoryId, type: st.type, today: today() }) : [];
    const typed = !checking() && !savingsSpend() && pad ? pad.expr() : '';
    const digits = /^[1-9]\d*$/.test(typed) ? typed : '';
    const major = (/** @type {any} */ x) => String(Math.round(x.amount / 10 ** currencyOf(accCur(x.accountId)).dec));
    const list = usual.length || !digits || editing || due ? []
      : byAmountStart(transactions(), { today: today(), type: st.type, digits, major, skip: unusable });
    const show = usual.length ? blank : list.length > 0;
    host.hidden = !show;
    // les modèles prennent la place du résultat et de la phrase (zone de même hauteur) : le montant ne bouge pas au 1er chiffre
    $('[data-under]', el).classList.toggle('tpl-on', !!show);
    if (!show) return;
    if (usual.length) {
      host.innerHTML = usual.map(v => `<button type="button" class="tpl ua" data-v="${v}"><b>${m(v, cur())}</b></button>`).join('');
      host.onclick = e => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        st.amount = Number(b.dataset.v);
        padCur = null; // le pavé repart de ce montant
        buzz(10);
        refresh();
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
      if (b) applyTemplate(list[Number(b.dataset.t)]);
    };
  }
  function applyTemplate(t) {
    st.type = t.type;
    setSeg($('.type-seg', el), t.type);
    st.amount = t.amount;
    st.accountId = t.accountId;
    st.toAccountId = t.type === 'transfer' ? t.toAccountId : null;
    st.categoryId = t.type === 'transfer' ? null : t.categoryId;
    st.auto = false;
    st.note = t.note;
    padCur = null; // le pavé repart du montant du modèle
    buzz(10);
    refresh();
  }
  function paintMeta() {
    $('[data-date]', el).textContent = dateLabel(st.date);
    // › seulement vers le passé, jamais de date à venir : éteint (pas masqué : rien ne bouge sous le doigt) quand la
    // date atteint aujourd'hui (‹ › sont absents pour une opération déjà prévue qu'on modifie)
    const next = $('[data-dnext]', el), prev = $('[data-dprev]', el);
    if (next) next.disabled = st.date >= today();
    // une échéance : pas avant la fois d'avant
    if (prev) prev.disabled = !!bounds?.min && st.date <= bounds.min;
    $('[data-notel]', el).textContent = st.note || 'Note';
    $('[data-notep]', el).classList.toggle('set', !!st.note);
    const plan = $('[data-plan]', el);
    if (!plan) return;
    plan.classList.toggle('on', st.planned);
    plan.setAttribute('aria-pressed', String(st.planned));
  }
  // Dépense depuis une épargne (D17) : nouvelle opération seulement (une dépense qu'on modifie garde sa catégorie)
  const savingsSpend = () => !editing && st.type === 'expense' && !!account(st.accountId)?.savings;
  // pavé éteint : rien de choisi encore (réserve ou autre dépense), ou réserve en une fois (montant = ce qui est de côté)
  const padLocked = () => savingsSpend() && (st.reserveId ? usableReserves().find(v => v.reserve.id === st.reserveId)?.reserve.mode === 'once' : !(st.other && st.categoryId));

  /** @param {string|null} [id] la réserve à remplir (en une fois) ou à porter au montant tapé (en plusieurs fois) */
  // Mise de côté (D17, revu le 2026-11-19 avec l'utilisateur) : rien à répartir ; la répartition entre les réserves se
  // calcule depuis le solde de l'épargne (allocationOf).
  /** En une fois : seulement remplie (on paie tout) ; en plusieurs fois : dès qu'il y a de l'argent. @param {any} v */
  // utilisable (revu le 2026-11-19) : en plusieurs fois, toujours ; en une fois, si l'épargne peut la payer entièrement
  const canUse = v => v.reserve.mode !== 'once' || savingsReport(v.reserve.wallet).balance >= v.target;
  /** Toutes les réserves ouvertes de ce portefeuille (avec ou sans argent mis de côté). */
  const openOfWallet = () => (account(st.accountId)?.savings ? savingsReport(st.accountId).reserves : []);
  /** Réserves ouvertes de ce portefeuille qui ont de l'argent mis de côté, avec ce qui l'est. */
  const usableReserves = () => (account(st.accountId)?.savings ? savingsReport(st.accountId).reserves.filter(canUse) : []);
  /**
   * Dépense depuis une épargne (D17) : une ou deux gélules à la place des catégories — « Choisir une réserve » (feuille
   * des réserves de ce portefeuille) et « Autre dépense » si le portefeuille permet les dépenses.
   * @param {HTMLElement} host
   */
  function paintReserves(host) {
    const w = account(st.accountId);
    const list = usableReserves();
    if (st.reserveId && !list.some(v => v.reserve.id === st.reserveId)) st.reserveId = null;
    host.hidden = false;
    host.setAttribute('aria-label', 'Utiliser une réserve');
    const v = st.reserveId ? list.find(x => x.reserve.id === st.reserveId) : null;
    const c = v && st.categoryId ? category(st.categoryId) : null;
    // 3 réserves au plus (2026-11-19, avec l'utilisateur) : chacune en ligne, à côté d'« Autre dépense », avec sa part
    // dans la répartition calculée et son mode ; au-delà, la feuille. Une réserve en une fois que l'épargne ne peut pas
    // encore payer entièrement est grisée.
    // celles qu'on peut utiliser d'abord (par échéance), les grisées à la fin (2026-11-19 : une grisée en tête, c'était le
    // premier toucher qui ne marchait pas)
    // la choisie en tête, comme la catégorie choisie
    const all = [...openOfWallet()].sort((x, y) => Number(y.reserve.id === st.reserveId) - Number(x.reserve.id === st.reserveId) || Number(!canUse(x)) - Number(!canUse(y)) || (x.reserve.due < y.reserve.due ? -1 : x.reserve.due > y.reserve.due ? 1 : 0));
    // une gélule de réserve, la même partout (en ligne, ou choisie depuis la feuille au-delà de 3)
    const chipOf = (/** @type {any} */ x, pick = false) => {
      const r = x.reserve, on = st.reserveId === r.id, ok = canUse(x), rc = r.category ? category(r.category) : null;
      return `<button type="button" class="sc rs-chip${on ? ' on' : ''}${ok ? '' : ' dim'}" data-res="${r.id}"${pick ? ' data-pickres' : ''} aria-pressed="${on}" style="--c:var(--${rc?.color || 'c0'})">${rc ? catIcon(rc.icon) : icon('piggy-bank')}<span>${esc(r.name)}</span>${r.mode === 'once' ? `<span class="rs-once" aria-label="en une fois">${icon('lock-simple')}</span>` : ''}</button>`;
    };
    const pick = all.length && all.length <= 3 ? all.map(x => chipOf(x)).join('')
      // au-delà de 3 (2026-11-19, avec l'utilisateur) : un seul bouton ; la réserve choisie y prend sa gélule (teinte,
      // jauge), un toucher rouvre la feuille
      : all.length ? (v ? chipOf(v, true) : `<button type="button" class="sc more" data-pickres>${icon('piggy-bank')}<span>Choisir une réserve</span>${icon('caret-down')}</button>`) : '';
    const oc = st.other && st.categoryId ? category(st.categoryId) : null;
    // réserve choisie sans catégorie : on la demande d'un toucher (rien ne s'ouvre tout seul)
    const needCat = v && !st.categoryId ? `<button type="button" class="sc need" data-needcat>${icon('squares-four')}<span>Catégorie ?</span></button>` : '';
    const other = w.spendOk ? `<button type="button" class="sc${oc ? ' on' : ' more'}" data-other${oc ? ` style="--c:var(--${oc.color || 'c0'})"` : ''}>${icon('squares-four')}<span>${oc ? `Autre · ${esc(oc.name)}` : 'Autre dépense'}</span></button>` : '';
    host.innerHTML = pick + needCat + other || `<p class="rs-none">Rien n’est mis de côté dans une réserve de ${esc(w.name)}, et ce portefeuille ne permet pas les dépenses (réglage dans sa fiche).</p>`;
    host.onclick = async e => {
      const t2 = /** @type {HTMLElement} */ (e.target);
      if (t2.closest('[data-needcat]')) {
        buzz(6);
        const r = await pickEntryCategory({ type: 'expense', current: st.categoryId });
        if (r && typeof r === 'string') { st.categoryId = r; paintReserves(host); paintAmount(); }
        return;
      }
      if (t2.closest('[data-other]')) {
        buzz(6);
        const r = await pickEntryCategory({ type: 'expense', current: st.other ? st.categoryId : null });
        if (!r) return;
        if (typeof r === 'object') {
          // rien de trouvé : on crée la catégorie avec le nom tapé, puis la saisie la choisit
          afterSheets(() => openCategorySheet(null, 'expense', { name: r.create, onSaved: c => {
            st.other = true; st.reserveId = null; st.categoryId = c.id; st.auto = false;
            paintCats(); paintAmount();
          } }));
          return;
        }
        st.other = true; st.reserveId = null; st.categoryId = r; st.auto = false;
        paintReserves(host); paintAmount();
        return;
      }
      const rb = /** @type {HTMLElement|null} */ (t2.closest('[data-pickres]') ? null : t2.closest('[data-res]'));
      if (rb) {
        const x = all.find(y => y.reserve.id === rb.dataset.res);
        if (!x) return;
        buzz(6);
        if (st.reserveId === x.reserve.id) { st.reserveId = null; st.categoryId = null; paintReserves(host); paintAmount(); return; }
        if (!canUse(x)) { toast(`${x.reserve.name} se paie en une fois : il faut ${m(x.target, w.currency)} sur ${w.name}.`); return; }
        selectReserve(x.reserve.id);
        return;
      }
      if (!t2.closest('[data-pickres]')) return;
      buzz(6);
      const id = await chooseReserve(all, w.currency); // même ordre : les utilisables d’abord
      if (id === undefined) return;
      // une réserve sans argent mis de côté : la feuille « Ajouter » (depuis l'épargne libre ou une autre réserve)
      if (id === null) { st.reserveId = null; st.categoryId = null; paintReserves(host); paintAmount(); return; }
      if (id) selectReserve(id);
    };
  }
  /**
   * Choisir une réserve utilisable : en une fois, le montant est ce qui est mis de côté (figé) ; en plusieurs fois, le pavé
   * se rallume (la tranche se tape ; keep : garder le montant déjà tapé). La catégorie est celle de la réserve.
   * @param {string} id @param {{ keep?: boolean }} [o] @returns {boolean} choisie
   */
  function selectReserve(id, { keep = false } = {}) {
    const sel = usableReserves().find(x => x.reserve.id === id);
    if (!sel) return false;
    st.reserveId = id;
    st.other = false;
    // en une fois : tout ce qu'elle vise ; sinon le montant déjà tapé, ou sa part s'il n'y en a pas encore
    const amt = sel.reserve.mode === 'once' ? sel.target : st.amount;
    st.amount = amt; pad.set(amt);
    st.categoryId = sel.reserve.category && category(sel.reserve.category) && !category(sel.reserve.category).archived ? sel.reserve.category : null;
    paintCats(); paintAmount();
    return true;
  }
  /**
   * Feuille des réserves d'un portefeuille d'épargne : nom, en une fois ou en plusieurs fois, ce qui est mis de côté, catégorie.
   * Résout l'id choisi, null (« Aucune »), ou undefined (fermée).
   * @param {any[]} list @param {string} cur @returns {Promise<string|null|undefined>}
   */
  function chooseReserve(list, cur) {
    return new Promise(resolve => {
      let picked;
      const sh = openSheet(`<h2 class="sheet-title">Utiliser une réserve</h2>
        <div class="group plain">${list.map(v => {
          const r = v.reserve, c = r.category ? category(r.category) : null, on = st.reserveId === r.id;
          // pas utilisable (en une fois, l'épargne ne suffit pas encore) : grisée, on dit ce qu'il faut
          if (!canUse(v)) return `<div class="row dim">${chip(c)}
            <div class="main"><div class="t">${esc(r.name)} <span class="rs-mode-tag">en une fois</span></div>
            <div class="s">Il faut ${m(v.target, cur)} sur ce portefeuille</div></div></div>`;
          return `<button type="button" class="row" data-r="${r.id}">${chip(c)}
            <div class="main"><div class="t">${esc(r.name)} <span class="rs-mode-tag">${r.mode === 'once' ? 'en une fois' : 'en plusieurs fois'}</span></div>
            <div class="s">${v.full ? `${m(v.saved, cur)} prêts` : `${m(v.saved, cur)} sur ${m(v.target, cur)}`}${c ? ` · ${esc(c.name)}` : ''}</div></div>${on ? icon('check') : ''}</button>`;
        }).join('')}
        ${st.reserveId ? `<button type="button" class="row" data-r=""><span class="pill">${icon('x')}</span><div class="main"><div class="t">Aucune</div></div></button>` : ''}</div>
        <p class="muted rs-say">En une fois : tout ce qu’elle vise est payé, puis elle se ferme. En plusieurs fois : elle baisse de ce montant et reste ouverte.</p>`,
        { label: 'Utiliser une réserve', onClose: () => resolve(picked) });
      $$('[data-r]', sh.el).forEach(x => (x.onclick = () => { picked = /** @type {HTMLElement} */ (x).dataset.r || null; buzz(6); sh.close(); }));
    });
  }
  // Le pavé suit la devise du portefeuille (touche décimale) : on le remonte si elle change. Vérification : un pavé à
  // part, prérempli avec le solde de l'app (0 s'il est négatif), remonté à chaque changement de portefeuille ; le montant
  // de l'opération en cours est gardé pour le retour à la saisie.
  function mountPad() {
    const key = checking() ? `check:${st.accountId}:${cur()}` : `op:${cur()}`;
    if (padCur === key) return;
    padCur = key;
    if (checking()) st.actual = checkFrom = Math.max(0, balances()[st.accountId] || 0);
    const host = $('[data-pad]', el);
    const fresh = host.cloneNode(false);
    fresh.className = '';
    host.replaceWith(fresh);
    pad = keypad(fresh, {
      cur: cur(),
      initial: checking() ? st.actual : st.amount,
      onChange: (minor, expr, key) => { if (checking()) st.actual = minor; else st.amount = minor; paintAmount(key); },
      // Entrée sur un bouton éteint : on règle le calcul et le bouton tremble (il dit ce qui manque)
      onEnter: () => { if (!goBtn.disabled) return goBtn.click(); if (pad.hasOp()) pad.resolve(); shake(goBtn); buzz([10, 40, 10]); },
    });
  }
  // Ligne du haut : en vérification, aucun type n'est choisi et le rond est allumé.
  function paintHead() {
    const segEl = $('.type-seg', el), chk = $('[data-chk]', el);
    segEl.classList.toggle('off', checking());
    if (checking()) $$('button[data-v]', segEl).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); });
    else setSeg(segEl, st.type);
    if (!chk) return;
    chk.classList.toggle('on', checking());
    chk.setAttribute('aria-pressed', String(checking()));
  }
  function refresh() {
    el.classList.toggle('checking', checking());
    paintHead();
    $('[data-q]', el).hidden = !checking();
    $('.e-meta', el).hidden = checking();
    mountPad(); paintFrom(); paintCats(); paintMeta(); paintAmount();
  }

  async function chooseFrom() {
    // une échéance se paie depuis n'importe quel portefeuille de sa devise (D18, revu le 2026-11-12)
    // une dépense d'échéance qu'aucune réserve ne paie : pas d'épargne qui refuse les dépenses (2026-11-13)
    const id = await pickAccount({ current: st.accountId, currency: planned ? planned.currency : null, title: st.type === 'transfer' ? 'Depuis' : 'Portefeuille', spending: held && st.type === 'expense' && !st.reserveId });
    if (!id) return;
    st.accountId = id;
    // revenu sur le portefeuille de la réserve qui paie l'échéance : elle repaie
    st.reserveId = due && due.reserve && id === due.wallet ? due.reserve : null;
    st.other = false;
    const to = account(st.toAccountId);
    if (st.toAccountId === id || (to && to.currency !== account(id).currency)) st.toAccountId = null;
    refresh();
  }
  async function chooseTo() {
    const id = await pickAccount({ current: st.toAccountId, exclude: st.accountId, currency: cur(), title: 'Vers' });
    if (id) { st.toAccountId = id; paintFrom(); paintAmount(); }
    return !!st.toAccountId;
  }

  // toucher le montant place le curseur avant ou après le caractère touché ; ailleurs (unité, vide) : à la fin
  exprEl.addEventListener('click', e => {
    if (!pad || checking()) return;
    const expr = pad.expr();
    if (!expr) return;
    if (pad.caret() >= expr.length) { exprEl.innerHTML = exprCharsHTML(expr, { cur: cur(), caret: expr.length }); }
    const x = /** @type {MouseEvent} */ (e).clientX;
    const chars = /** @type {HTMLElement[]} */ ($$('.ch', exprEl));
    let best = expr.length, dist = Infinity;
    for (const c of chars) {
      const r = c.getBoundingClientRect(), i = Number(c.dataset.i);
      for (const [edge, at] of [[r.left, i], [r.right, i + 1]]) {
        const dd = Math.abs(x - edge);
        if (dd < dist) { dist = dd; best = at; }
      }
    }
    buzz(4);
    pad.setCaret(best);
    paintAmount('caret');
  });

  refresh();
  // « Utiliser » sur une réserve pas prête (D17) : la répartition s'ouvre par-dessus pour la compléter

  if (held) $$('.type-seg button', el).forEach(b => { b.disabled = true; });
  wireSeg($('.type-seg', el), v => {
    st.type = opType = v;
    st.reserveId = null; st.other = false;
    if (v !== 'transfer' && st.categoryId && category(st.categoryId)?.type !== v) { st.categoryId = null; st.auto = false; }
    if (v === 'transfer' && st.toAccountId === st.accountId) st.toAccountId = null;
    refresh();
  });
  const chkBtn = $('[data-chk]', el);
  if (chkBtn) chkBtn.onclick = () => { st.type = checking() ? opType : 'check'; buzz(8); refresh(); };
  $('[data-close]', el).onclick = () => { buzz(6); s.close(); };
  const planBtn = $('[data-plan]', el);
  if (planBtn) planBtn.onclick = () => { st.planned = !st.planned; buzz(6); paintMeta(); paintAmount(); };
  // ‹ › : un jour de plus ou de moins, en un toucher (Hier, Avant-hier…) sans ouvrir le calendrier
  const shiftDate = n => { st.date = addDays(st.date, n); buzz(6); paintMeta(); paintAmount(); };
  // (absents quand on modifie une opération déjà prévue : le calendrier accepte alors les dates à venir, et « Prévu » reste visible)
  const prev = $('[data-dprev]', el), next = $('[data-dnext]', el);
  if (prev) prev.onclick = () => { if (!bounds?.min || st.date > bounds.min) shiftDate(-1); };
  if (next) next.onclick = () => { if (st.date < today()) shiftDate(1); };
  $('[data-datep]', el).onclick = async () => {
    buzz(6);
    const d = await pickDate({ current: st.date, future: canPlan, min: bounds?.min || null, title: st.type === 'income' ? 'Date du revenu' : st.type === 'transfer' ? 'Date du virement' : 'Date de la dépense' });
    if (d && d !== st.date) { st.date = d; paintMeta(); paintAmount(); }
  };
  $('[data-notep]', el).onclick = () => editNote(st.note, { type: st.type, categoryId: st.categoryId }).then(v => {
    if (!v) return;
    st.note = v.note;
    // une note déjà écrite apporte sa catégorie habituelle, si aucune n'est choisie
    if (v.categoryId && (!st.categoryId || st.auto) && st.type !== 'transfer' && validIds(st.type).includes(v.categoryId)) { st.categoryId = v.categoryId; st.auto = false; }
    paintMeta(); paintCats(); paintAmount();
  });

  goBtn.onclick = async () => {
    if (saving) return;
    if (pad.hasOp()) pad.resolve();
    // vérification (rond balance) : elle est notée (avec ou sans écart), puis la feuille descend
    if (checking()) {
      const a = account(st.accountId);
      if (!a) return;
      saving = true;
      if (!(await checkWallet(a.id, st.actual))) { saving = false; return; }
      buzz(12);
      goBtn.classList.add('done');
      setTimeout(() => s.close(), reducedMotion() ? 0 : 320);
      return;
    }
    if (!st.amount || (problem && problem.block)) { shake(exprEl); return; }
    // portefeuille d'arrivée manquant : il se choisit au passage, puis on enregistre aussitôt
    if (st.type === 'transfer' && !st.toAccountId) {
      if (!(await chooseTo()) || (problem && problem.block)) return;
    }
    if (st.type !== 'transfer' && !st.categoryId) return; // le bouton est éteint tant qu'il manque la catégorie
    // une échéance confirmée avec un montant loin du prévu (plus de moitié d'écart) : peut-être une faute de frappe
    // (une opération déjà notée : seulement si on change son montant)
    if (planned && planned.amount > 0 && cur() === planned.currency && (!editing || st.amount !== tx.amount) && Math.abs(st.amount - planned.amount) > planned.amount / 2) {
      const said = money(st.amount, { cur: cur() });
      const yes = await confirmSheet({ title: `${said} au lieu de ${money(planned.amount, { cur: planned.currency })} ?`, text: 'C’est loin du montant prévu : peut-être une faute de frappe.', yes: `Oui, ${said}`, cancel: 'Corriger' });
      if (!yes) return;
      await new Promise(done => afterSheets(done));
    }
    saving = true;
    /** @type {any} */
    const data = {
      type: st.type, amount: st.amount, accountId: st.accountId, date: st.date, note: st.note.trim(), planned: st.planned,
      ...(st.type === 'transfer' ? { toAccountId: st.toAccountId } : { categoryId: st.categoryId }),
    };
    pref('lastAccount', st.accountId);
    // D5 : bouton tassé, coche dessinée (260 ms), vibration 12 ms, puis la feuille descend (460 ms) ;
    // l'accueil répond ensuite (compteur, barre du jour, bocal).
    buzz(12);
    goBtn.classList.add('done');
    cueMotion({ type: st.type, categoryId: data.categoryId || null, amount: st.amount });
    // la confirmation, c'est ce mouvement (pas de bandeau) ; un refus d'écriture s'affiche par le message d'erreur du magasin
    if (savingsSpend() && st.reserveId && usableReserves().some(v => v.reserve.id === st.reserveId)) data.reserve = st.reserveId;
    const write = editing ? updateTx(tx.id, data) : due ? confirmDue(due, data) : addTx(data);
    const closeIn = reducedMotion() ? 0 : 320;
    setTimeout(() => s.close(), closeIn);
    const done = await write;
    // de l'argent mis de côté (virement vers un portefeuille d'épargne, D17) donne une destination à l'argent arrivé
    if (done && data.type === 'transfer' && account(data.toAccountId)?.savings) {
      assigned();
    }
    // une rentrée notée (pas une modification) propose de la répartir (D11) ; seulement si elle change Disponible
    // (portefeuille compté dans le total, monnaie principale), une fois la saisie redescendue
    const w = account(data.accountId);
    if (done && !editing && data.type === 'income' && w && !w.excluded && !w.savings && w.currency === settings().currency) {
      setTimeout(() => afterSheets(() => openIncomeSheet({
        amount: data.amount, cur: w.currency, available: available(), walletId: w.id, openEntry, openAccountSheet,
      })), closeIn + (reducedMotion() ? 0 : 520));
    }
  };
  return s;
}

// Catégorie (« Toutes ») : la liste des catégories partagée (catlist.js), avec la recherche ; rien de trouvé : un dessin
// et « Créer « … » ». Résout un id, { create: nom } (créer puis choisir), ou null.
function pickEntryCategory({ type, current }) {
  return new Promise(resolve => {
    let picked = null;
    const s = openSheet(`<h2 class="sheet-title">${type === 'income' ? 'Catégorie du revenu' : 'Catégorie'}</h2>
      ${catSearchHTML()}
      <div class="cl" data-tree>${catTreeHTML({ type, current })}</div>
      <div class="cl-none" data-none hidden>${NONE_ILLU}<p class="cl-none-t">Aucune catégorie ne correspond à ta recherche.</p><p class="cl-none-s">Crée-la : elle sera là la prochaine fois.</p>
        <button type="button" class="btn primary sm" data-create>${icon('plus')}<span class="cl-c">Créer «&nbsp;<span class="cl-n" data-create-l></span>&nbsp;»</span></button></div>`, { cls: 'pick-sheet', label: 'Catégorie', onClose: () => resolve(picked) });
    const tree = $('[data-tree]', s.el), q = $('input[data-q]', s.el);
    paintTree(tree);
    $$('[data-cat]', tree).forEach(b => (b.onclick = () => { picked = b.dataset.cat; buzz(10); s.close(); }));
    // proposer le nom tapé (24 caractères au plus, comme dans la fiche), avec une majuscule
    const typed = () => { const v = q.value.trim().replace(/\s+/g, ' ').slice(0, 24); return v.charAt(0).toUpperCase() + v.slice(1); };
    $('[data-create]', s.el).onclick = () => { picked = { create: typed() }; buzz(10); s.close(); };
    // la catégorie déjà choisie se montre à l'ouverture
    const on = $('.cl-row.on', tree);
    if (on) requestAnimationFrame(() => on.scrollIntoView({ block: 'center' }));
    const search = wireCatSearch(tree, q, total => {
      $('[data-none]', s.el).hidden = total > 0;
      // le nom se coupe à l'intérieur des guillemets (« Pressing… »), le » final reste visible
      if (!total) $('[data-create-l]', s.el).textContent = typed();
    });
    // Entrée : la première trouvée ; rien de trouvé : créer
    q.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const first = search.first();
      if (first) first.click();
      else if (search.active()) $('[data-create]', s.el).click();
    });
  });
}

// Note : petite feuille avec un champ et les notes déjà écrites (celles de la catégorie choisie d'abord), filtrées en
// tapant. Résout { note, categoryId } (categoryId : celle d'une note suggérée), ou null si on ferme sans valider.
function editNote(current, { type, categoryId }) {
  return new Promise(resolve => {
    let out = null;
    const s = openSheet(`<div class="note-sheet"><h2 class="sheet-title">Note</h2>
      <label class="field"><span class="sr">Note</span><input data-in maxlength="80" value="${esc(current)}" placeholder="Ex. Marché Dantokpa" enterkeyhint="done" autocomplete="off"></label>
      <div class="note-sugg" data-sugg></div>
      <button type="button" class="btn primary" data-ok>${icon('check')}OK</button></div>`, { cls: 'compact', label: 'Note', onClose: () => resolve(out) });
    const input = $('[data-in]', s.el), sugg = $('[data-sugg]', s.el);
    const moves = transactions().filter(t => t.type === type && !UNTRACKED_IDS.has(t.categoryId));
    let list = [];
    const paint = () => {
      list = noteSuggestions(moves, { q: input.value, categoryId, today: today(), limit: 5 });
      sugg.innerHTML = list.map((n, i) => {
        const c = n.categoryId ? category(n.categoryId) : null;
        return `<button type="button" class="ns" data-n="${i}">${icon('clock-counter-clockwise')}<span>${esc(n.note)}</span>${c && fold(c.name) !== fold(n.note) ? `<small>${esc(c.name)}</small>` : ''}</button>`;
      }).join('');
    };
    paint();
    input.addEventListener('input', paint);
    sugg.onclick = e => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      const n = list[Number(b.dataset.n)];
      out = { note: n.note, categoryId: n.categoryId };
      buzz(8); s.close();
    };
    const ok = () => { out = { note: input.value.trim().replace(/\s+/g, ' '), categoryId: null }; buzz(8); s.close(); };
    $('[data-ok]', s.el).onclick = ok;
    input.onkeydown = e => { if (e.key === 'Enter') ok(); };
    setTimeout(() => input.focus(), 320);
  });
}
