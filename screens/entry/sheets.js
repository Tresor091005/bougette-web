// Les feuilles ouvertes depuis la saisie : toutes les catégories, la note, les réserves d'une épargne.
import { category } from '../../core/store.js';
import { openSheet, buzz, chip, focusEnd, $, $$ } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { today, esc, money } from '../../core/format.js';
import { catTreeHTML, catSearchHTML, wireCatSearch, paintTree, NONE_ILLU } from '../catlist.js';
import { rowHTML, fieldHTML, sheetHead } from '../parts.js';
import { canUse } from './state.js';
import { RES } from '../../domain/words.js';

// Catégorie (« Toutes ») : la liste des catégories partagée (catlist.js), avec la recherche ; rien de trouvé : un dessin
// et « Créer « … » ». Résout un id, { create: nom } (créer puis choisir), ou null.
export function pickEntryCategory({ type, current }) {
  return new Promise(resolve => {
    let picked = null;
    const s = openSheet(`${sheetHead({ title: type === 'income' ? 'Catégorie du revenu' : 'Catégorie' })}
      ${catSearchHTML()}
      <div class="cl" data-tree>${catTreeHTML({ type, current })}</div>
      <div class="cl-none" data-none hidden>${NONE_ILLU}<p class="cl-none-t">Pas de catégorie à ce nom.</p><p class="cl-none-s">Crée-la, elle restera.</p>
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

// Note : petite feuille avec un champ (les notes déjà écrites ne sont plus proposées, 2026-11-24, avec l'utilisateur).
// Résout la note, ou null si on ferme sans valider. Sert aussi au nom d'une opération programmée (o : son titre, son
// exemple, sa longueur). help : un paragraphe gris sous le champ (le nom d'un portefeuille : comment distinguer deux
// comptes qui se ressemblent, 2026-11-26, avec l'utilisateur) ; sans lui, rien de plus.
/** @param {string} current @param {{ title?: string, placeholder?: string, max?: number, help?: string }} [o] @returns {Promise<string|null>} */
export function editNote(current, { title = 'Note', placeholder = 'Ex. Marché Dantokpa', max = 80, help = '' } = {}) {
  return new Promise(resolve => {
    /** @type {string|null} */
    let out = null;
    const s = openSheet(`<div class="note-sheet">${sheetHead({ title })}
      ${fieldHTML({ label: title, labelAttrs: 'class="sr"', control: `<input data-in maxlength="${max}" value="${esc(current)}" placeholder="${esc(placeholder)}" enterkeyhint="done" autocomplete="off">` })}
      ${help ? `<p class="field-note">${esc(help)}</p>` : ''}
      <button type="button" class="btn primary" data-ok>${icon('check')}OK</button></div>`, { label: title, onClose: () => resolve(out) });
    const input = /** @type {HTMLInputElement} */ ($('[data-in]', s.el));
    const ok = () => { out = input.value.trim().replace(/\s+/g, ' '); buzz(8); s.close(); };
    $('[data-ok]', s.el).onclick = ok;
    input.onkeydown = e => { if (e.key === 'Enter') ok(); };
    setTimeout(() => focusEnd(input), 320);
  });
}

/**
 * Feuille des réserves d'un portefeuille d'épargne : nom, en une fois ou en plusieurs fois, ce qui est mis de côté, catégorie.
 * Résout l'id choisi, null (« Aucune »), ou undefined (fermée).
 * @param {any[]} list @param {string} cur @param {string|null} chosen la réserve déjà choisie
 * @returns {Promise<string|null|undefined>}
 */
export function chooseReserve(list, cur, chosen) {
  const m = v => money(v, { cur });
  return new Promise(resolve => {
    let picked;
    const sh = openSheet(`${sheetHead({ title: `Payer ${RES.a}` })}
      <div class="group plain">${list.map(v => {
        const r = v.reserve, c = r.category ? category(r.category) : null, on = chosen === r.id;
        // pas utilisable (en une fois, l'épargne ne suffit pas encore) : grisée, on dit ce qu'il faut
        if (!canUse(v)) return rowHTML({ tag: 'div', cls: 'dim', pill: chip(c), title: `${esc(r.name)} <span class="rs-mode-tag">en une fois</span>`,
          sub: `Il faut ${m(v.target)} sur ce portefeuille` });
        return rowHTML({ attrs: `data-r="${r.id}"`, pill: chip(c), title: `${esc(r.name)} <span class="rs-mode-tag">${r.mode === 'once' ? 'en une fois' : 'en plusieurs fois'}</span>`,
          sub: `${v.full ? `${m(v.saved)} prêts` : `${m(v.saved)} sur ${m(v.target)}`}${c ? ` · ${esc(c.name)}` : ''}`, end: on ? icon('check') : '' });
      }).join('')}
      ${chosen ? rowHTML({ attrs: 'data-r=""', pill: `<span class="pill">${icon('x')}</span>`, title: 'Aucune' }) : ''}</div>
      <p class="muted rs-say">En une fois : payée en entier, puis fermée. En plusieurs fois : elle baisse et reste ouverte.</p>`,
      { label: `Payer ${RES.a}`, onClose: () => resolve(picked) });
    $$('[data-r]', sh.el).forEach(x => (x.onclick = () => { picked = /** @type {HTMLElement} */ (x).dataset.r || null; buzz(6); sh.close(); }));
  });
}
