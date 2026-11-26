// La feuille montant (2026-11-24, avec l'utilisateur : plus aucun montant au clavier du téléphone) : le format de la
// saisie pour un seul montant, sur le modèle de « Vérifier un solde » (accounts.js) — un titre et ✕, la question, le grand
// montant écrit en clair (calcul compris), le pavé maison, et le bouton qui dit ce qui sera enregistré. Une date
// facultative en gélule (objectif d'épargne), et une sortie « retirer » en lien (retirer l'objectif).
// Sert à : solde de départ et objectif d'un portefeuille, objectif d'une épargne, versement chaque mois (revue
// d'épargne), montant d'un jour (semaine des opérations programmées), montant d'une seule fois (page d'une opération
// programmée), réduire une dépense prévue.
import { openSheet, keypad, exprHTML, exprCharsHTML, fitText, buzz, shake, $, $$ } from '../core/ui.js';
import { money, esc, yearDate, today } from '../core/format.js';
import { icon } from '../core/icons.js';
import { sheetHead } from './parts.js';
import { pickDate } from './pickers.js';

/**
 * @typedef {{ amount: number, date: string|null } | { remove: true }} AmountResult
 * @param {{
 *   title: string, pill?: string, question?: string, value?: number, cur: any,
 *   button: (amount: number) => string,
 *   check?: (amount: number) => string|null,
 *   zero?: boolean,
 *   say?: (amount: number) => string,
 *   date?: { value: string|null, title: string, none?: string },
 *   remove?: string,
 * }} o button : le texte du bouton pour ce montant ; check : un message si le montant ne va pas (bouton éteint) ;
 *   zero : 0 permis (sinon il faut un montant) ; say : une ligne sous le montant ; date : une gélule de date facultative ;
 *   remove : le texte d'un lien qui retire (résout { remove: true })
 * @returns {Promise<AmountResult|null>} null : feuille fermée
 */
export function amountSheet({ title, pill = '', question = '', value = 0, cur, button, check = () => null, zero = false, say = () => '', date, remove = '' }) {
  return new Promise(resolve => {
    /** @type {AmountResult|null} */
    let out = null;
    let amount = Math.max(0, value || 0), day = date ? date.value : null;
    const s = openSheet(`<div class="check-sheet amount-sheet">
      <div class="e-head">${sheetHead({ title, pill })}
        <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
      ${question ? `<p class="ck-q">${question}</p>` : ''}
      <div class="e-stage"><div class="e-expr" data-expr></div><div class="e-say" data-say></div></div>
      ${date ? `<div class="e-meta"><button type="button" class="mp" data-date>${icon('calendar-blank')}<span data-datel></span></button></div>` : ''}
      <div data-pad></div>
      <button type="button" class="btn primary" data-ok></button>
      ${remove ? `<button type="button" class="link am-remove" data-remove>${remove}</button>` : ''}
    </div>`, { label: title, onClose: () => resolve(out) });
    const exprEl = /** @type {HTMLElement} */ ($('[data-expr]', s.el)), sayEl = /** @type {HTMLElement} */ ($('[data-say]', s.el));
    const ok = /** @type {HTMLButtonElement} */ ($('[data-ok]', s.el));
    /** @type {ReturnType<typeof keypad>|null} */
    let pad = null;
    const problem = () => (!zero && amount <= 0 ? 'Indique un montant.' : check(amount));
    const paint = (/** @type {number} */ v, expr = '', /** @type {string|null} */ key = null) => {
      amount = v;
      exprEl.innerHTML = pad && pad.caret() < expr.length ? exprCharsHTML(expr, { cur, caret: pad.caret() })
        : exprHTML(expr, { cur, typed: !!key && key !== 'del' && key !== 'caret' });
      const bad = problem();
      // le problème se dit sous le montant dès qu'on a tapé quelque chose ; sinon la ligne d'aide
      sayEl.innerHTML = bad && expr ? `<span class="loss">${esc(bad)}</span>` : say(amount);
      ok.innerHTML = `${icon('check')}${esc(button(amount))}`;
      ok.disabled = !!bad;
      fitText(exprEl, '.e-expr', 24);
      const dl = $('[data-datel]', s.el);
      if (dl) dl.textContent = day ? yearDate(day) : (date?.none || 'Sans date');
      $('[data-date]', s.el)?.classList.toggle('set', !!day);
    };
    pad = keypad(/** @type {HTMLElement} */ ($('[data-pad]', s.el)), {
      initial: amount, cur, onChange: paint,
      onEnter: () => { const f = /** @type {HTMLElement} */ (document.activeElement); if (f && f !== ok && s.el.contains(f) && f.matches('button')) f.click(); else ok.click(); },
    });
    paint(amount, pad.expr());
    tapCaret(exprEl, () => pad, () => cur, () => paint(amount, pad?.expr() || '', 'caret'));
    $('[data-close]', s.el).onclick = () => { buzz(6); s.close(); };
    const dateBtn = $('[data-date]', s.el);
    if (dateBtn && date) dateBtn.onclick = async () => {
      buzz(6);
      const d = await pickDate({ current: day || today(), future: true, min: today(), title: date.title });
      if (d) { day = d; paint(amount, pad?.expr() || ''); }
    };
    const rm = $('[data-remove]', s.el);
    if (rm) rm.onclick = () => { buzz(8); out = { remove: true }; s.close(); };
    ok.onclick = () => {
      if (pad?.hasOp()) pad.resolve();
      const bad = problem();
      if (bad) { sayEl.innerHTML = `<span class="loss">${esc(bad)}</span>`; shake(exprEl); buzz([10, 40, 10]); return; }
      out = { amount, date: day };
      buzz(12);
      s.close();
    };
  });
}

/**
 * Toucher le montant place le curseur avant ou après le caractère touché (comme dans la saisie) ; ailleurs (unité,
 * vide) : à la fin. Sert à la feuille montant et au formulaire d'une opération programmée.
 * @param {HTMLElement} exprEl @param {() => ReturnType<typeof keypad>|null} getPad @param {() => any} getCur
 * @param {() => void} repaint
 */
export function tapCaret(exprEl, getPad, getCur, repaint) {
  exprEl.addEventListener('click', e => {
    const pad = getPad();
    if (!pad) return;
    const expr = pad.expr();
    if (!expr) return;
    if (pad.caret() >= expr.length) exprEl.innerHTML = exprCharsHTML(expr, { cur: getCur(), caret: expr.length });
    const x = /** @type {MouseEvent} */ (e).clientX;
    let best = expr.length, dist = Infinity;
    for (const c of /** @type {HTMLElement[]} */ ($$('.ch', exprEl))) {
      const r = c.getBoundingClientRect(), i = Number(c.dataset.i);
      for (const [edge, at] of [[r.left, i], [r.right, i + 1]]) {
        const dd = Math.abs(x - edge);
        if (dd < dist) { dist = dd; best = at; }
      }
    }
    buzz(4);
    pad.setCaret(best);
    repaint();
  });
}

/** Le montant d'un champ qui ouvre la feuille montant : « 12 500 F », ou le texte vide. @param {number|null|undefined} v @param {any} cur @param {string} empty */
export const amountLabel = (v, cur, empty) => (v ? money(v, { cur }) : empty);
