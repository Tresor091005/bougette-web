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
import { category, accounts, balances } from '../core/store.js';
import { openSheet, keypad, exprCharsHTML, buzz, seg, wireSeg, shake, setSeg, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { today, dayLabel, parse, addDays } from '../core/format.js';
import { pickDate } from './pickers.js';
import { openAccountSheet } from './accounts.js';
import { entryState, checking, cur, dirty, validIds } from './entry/state.js';
import { paintAmount } from './entry/amount.js';
import { paintCats } from './entry/cats.js';
import { paintFrom } from './entry/wallets.js';
import { editNote } from './entry/sheets.js';
import { save } from './entry/save.js';

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

// copy : une opération à refaire (Dupliquer, depuis sa fiche) — nouvelle saisie remplie comme elle, à la date du jour.
// date : la date proposée (À revoir, D21 : une opération mise de côté par la synchro garde la sienne) ; onSaved : appelé
// une fois l'opération enregistrée.
// La saisie est découpée dans src/screens/entry/ : état (state.js), montant et bouton (amount.js), catégories (cats.js),
// réserves (reserves.js), portefeuilles (wallets.js), feuilles (sheets.js), enregistrement (save.js).
export function openEntry({ type = 'expense', tx = null, copy = null, accountId = null, toAccountId = null, reserveId = null, due = null, date = null, onSaved = null } = {}) {
  // aucun portefeuille (D10) : le + ouvre d'abord la fiche de création, puis la saisie sur le portefeuille créé
  if (!tx && !accounts().length) {
    openAccountSheet(null, { savings: false, intro: 'Pour noter une opération, crée d’abord un portefeuille.', onSaved: a => openEntry({ type: type === 'transfer' ? 'expense' : type, accountId: a.id }) });
    return null;
  }
  const E = entryState({ type, tx, copy, accountId, toAccountId, reserveId, due, date, onSaved });
  const { st, editing, canPlan, held, bounds } = E;

  const s = openSheet(`<div class="entry">
    <div class="e-head">${seg(TYPES, E.opType, `type-seg${held ? ' locked' : ''}`)}
      ${editing || due ? '' : `<button type="button" class="iconbtn soft e-chk" data-chk aria-pressed="false" aria-label="Vérifier un solde">${icon('scales')}</button>`}
      <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="e-from" data-from></div>
    <div class="e-stage">
      <div class="e-q" data-q hidden>
        <p class="e-help">Compte ton argent : Bougette corrige son solde.</p>
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
  </div>`, { cls: 'entry-sheet', label: editing ? 'Modifier l’opération' : 'Nouvelle opération', beforeClose: reason => (!dirty(E) ? true : reason === 'scrim' ? 'stay' : 'ask') });

  const el = s.el;
  Object.assign(E, {
    s, el, exprEl: $('[data-expr]', el), resEl: $('[data-res]', el), sayEl: $('[data-say]', el), goBtn: $('[data-go]', el), goLbl: $('[data-gol]', el),
    refresh, paintAmount: key => paintAmount(E, key), paintCats: () => paintCats(E), paintMeta,
  });
  const { exprEl, goBtn } = E;

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
  // Le pavé suit la devise du portefeuille (touche décimale) : on le remonte si elle change. Vérification : un pavé à
  // part, prérempli avec le solde de l'app (0 s'il est négatif), remonté à chaque changement de portefeuille ; le montant
  // de l'opération en cours est gardé pour le retour à la saisie.
  function mountPad() {
    const key = checking(E) ? `check:${st.accountId}:${cur(E)}` : `op:${cur(E)}`;
    if (E.padCur === key) return;
    E.padCur = key;
    if (checking(E)) st.actual = E.checkFrom = Math.max(0, balances()[st.accountId] || 0);
    const host = $('[data-pad]', el);
    const fresh = host.cloneNode(false);
    fresh.className = '';
    host.replaceWith(fresh);
    const pad = E.pad = keypad(fresh, {
      cur: cur(E),
      initial: checking(E) ? st.actual : st.amount,
      onChange: (minor, expr, key) => { if (checking(E)) st.actual = minor; else st.amount = minor; paintAmount(E, key); },
      // Entrée sur un bouton éteint : on règle le calcul et le bouton tremble (il dit ce qui manque)
      onEnter: () => { if (!goBtn.disabled) return goBtn.click(); if (pad.hasOp()) pad.resolve(); shake(goBtn); buzz([10, 40, 10]); },
    });
  }
  // Ligne du haut : en vérification, aucun type n'est choisi et le rond est allumé.
  function paintHead() {
    const segEl = $('.type-seg', el), chk = $('[data-chk]', el);
    segEl.classList.toggle('off', checking(E));
    if (checking(E)) $$('button[data-v]', segEl).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); });
    else setSeg(segEl, st.type);
    if (!chk) return;
    chk.classList.toggle('on', checking(E));
    chk.setAttribute('aria-pressed', String(checking(E)));
  }
  function refresh() {
    el.classList.toggle('checking', checking(E));
    paintHead();
    $('[data-q]', el).hidden = !checking(E);
    $('.e-meta', el).hidden = checking(E);
    mountPad(); paintFrom(E); paintCats(E); paintMeta(); paintAmount(E);
  }

  // toucher le montant place le curseur avant ou après le caractère touché ; ailleurs (unité, vide) : à la fin
  exprEl.addEventListener('click', e => {
    const { pad } = E;
    if (!pad || checking(E)) return;
    const expr = pad.expr();
    if (!expr) return;
    if (pad.caret() >= expr.length) { exprEl.innerHTML = exprCharsHTML(expr, { cur: cur(E), caret: expr.length }); }
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
    paintAmount(E, 'caret');
  });

  refresh();

  if (held) $$('.type-seg button', el).forEach(b => { b.disabled = true; });
  wireSeg($('.type-seg', el), v => {
    st.type = E.opType = v;
    st.reserveId = null; st.other = false;
    if (v !== 'transfer' && st.categoryId && category(st.categoryId)?.type !== v) { st.categoryId = null; st.auto = false; }
    if (v === 'transfer' && st.toAccountId === st.accountId) st.toAccountId = null;
    refresh();
  });
  const chkBtn = $('[data-chk]', el);
  if (chkBtn) chkBtn.onclick = () => { st.type = checking(E) ? E.opType : 'check'; buzz(8); refresh(); };
  $('[data-close]', el).onclick = () => { buzz(6); s.close(); };
  const planBtn = $('[data-plan]', el);
  if (planBtn) planBtn.onclick = () => { st.planned = !st.planned; buzz(6); paintMeta(); paintAmount(E); };
  // ‹ › : un jour de plus ou de moins, en un toucher (Hier, Avant-hier…) sans ouvrir le calendrier
  const shiftDate = n => { st.date = addDays(st.date, n); buzz(6); paintMeta(); paintAmount(E); };
  // (absents quand on modifie une opération déjà prévue : le calendrier accepte alors les dates à venir, et « Prévu » reste visible)
  const prev = $('[data-dprev]', el), next = $('[data-dnext]', el);
  if (prev) prev.onclick = () => { if (!bounds?.min || st.date > bounds.min) shiftDate(-1); };
  if (next) next.onclick = () => { if (st.date < today()) shiftDate(1); };
  $('[data-datep]', el).onclick = async () => {
    buzz(6);
    const d = await pickDate({ current: st.date, future: canPlan, min: bounds?.min || null, title: st.type === 'income' ? 'Date du revenu' : st.type === 'transfer' ? 'Date du virement' : 'Date de la dépense' });
    if (d && d !== st.date) { st.date = d; paintMeta(); paintAmount(E); }
  };
  $('[data-notep]', el).onclick = () => editNote(st.note, { type: st.type, categoryId: st.categoryId }).then(v => {
    if (!v) return;
    st.note = v.note;
    // une note déjà écrite apporte sa catégorie habituelle, si aucune n'est choisie
    if (v.categoryId && (!st.categoryId || st.auto) && st.type !== 'transfer' && validIds(st.type).includes(v.categoryId)) { st.categoryId = v.categoryId; st.auto = false; }
    paintMeta(); paintCats(E); paintAmount(E);
  });
  goBtn.onclick = () => save(E, openEntry);
  return s;
}
