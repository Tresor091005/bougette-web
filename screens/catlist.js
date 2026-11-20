// Liste des catégories, la même partout (D14) : façon Money Lover, une ligne par catégorie principale avec ses
// sous-catégories rattachées dessous par un trait, dans l'ordre choisi par l'utilisateur ; simples lignes (D0), coche
// sur la catégorie choisie ; le nom seul, sans compteurs. Recherche (là où on choisit, pas dans Moi › Catégories) au début des
// mots, sans accents (« transport » montre aussi Zem, Taxi…) ; une catégorie reste visible comme repère quand une de ses
// sous-catégories est trouvée ; rien de trouvé : un dessin.
// Utilisée par « Toutes » (saisie), Moi › Catégories, le filtre du Journal et « Ranger dans » : un seul code pour
// les voir.
import { categories, subcategories } from '../core/store.js';
import { esc } from '../core/format.js';
import { icon } from '../core/icons.js';
import { chip, $, $$ } from '../core/ui.js';
import { fold } from '../domain/suggest.js';

/** @typedef {{ id: string, name: string, icon?: string, color?: string, parent?: string|null }} Cat */

/**
 * Lignes de la liste, groupées par catégorie principale (une `.group.cl-g` par groupe).
 * @param {{ type: string, current?: string|null, exclude?: string|null, withSubs?: boolean, handle?: boolean }} o
 *   exclude : une catégorie à ne pas montrer (et ses sous-catégories) ; withSubs : false = catégories principales seules ;
 *   handle : poignée pour ranger (Moi › Catégories)
 */
export function catTreeHTML({ type, current = null, exclude = null, withSubs = true, handle = false }) {
  const groups = categories(type).filter(c => c.id !== exclude)
    .map(c => ({ c, subs: withSubs ? subcategories(c.id).filter(x => x.id !== exclude) : [] }));
  const grip = `<span class="handle" aria-label="Glisser pour ranger">${icon('dots-six-vertical')}</span>`;
  const line = (/** @type {Cat} */ x, q, isSub, first) => {
    const on = x.id === current;
    return `<button type="button" class="row cl-row${isSub ? ' cl-sub' : ''}${first ? '' : ' rule'}${on ? ' on' : ''}" data-cat="${x.id}" data-q="${esc(q)}"${isSub && handle ? ` data-rid="${x.id}"` : ''}>
      ${chip(x, isSub ? 'sm' : '')}<div class="main"><div class="t">${esc(x.name)}</div></div>${on ? `<span class="end">${icon('check')}</span>` : ''}${handle ? grip : ''}</button>`;
  };
  return groups.map(({ c, subs }, i) => `<div class="group cl-g" data-g${handle ? ` data-rid="${c.id}"` : ''}>${line(c, fold(c.name), false, i === 0)}${subs.map(x => line(x, fold(`${x.name} ${c.name}`), true, false)).join('')}</div>`).join('');
}

/** Dessin « rien trouvé » (loupe vide, au trait). */
export const NONE_ILLU = `<svg class="cl-illu" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
  <circle cx="40" cy="40" r="25"/><path d="M58.5 58.5 78 78" stroke-width="5"/>
  <path d="M30 40h20" stroke-dasharray="3 5"/><circle cx="40" cy="40" r="25" stroke-width="1" opacity=".35" transform="translate(4 4)"/></svg>`;

/** Champ de recherche de la liste (le clavier ne s'ouvre que si on le touche). */
export const catSearchHTML = (placeholder = 'Chercher : zem, loyer, pharmacie…') =>
  `<div class="search cat-find">${icon('magnifying-glass')}<input type="search" data-q placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="search"></div>`;

// L'arbre : le trait de la dernière sous-catégorie visible d'un groupe s'arrête à sa hauteur ; le filet entre les
// groupes part du 2e groupe visible.
export function paintTree(root) {
  $$('[data-g]', root).filter(g => !g.hidden).forEach((g, i) => $('[data-cat]', g)?.classList.toggle('rule', i > 0));
  $$('[data-g]', root).forEach(g => {
    const subs = $$('.cl-sub', g);
    const last = subs.filter(b => !b.hidden).pop();
    subs.forEach(b => b.classList.toggle('last', b === last));
  });
}

/**
 * Branche la recherche sur la liste. onFilter(total, texte) après chaque filtre (total = lignes trouvées).
 * Renvoie { first() : la 1re ligne trouvée (une sous-catégorie trouvée passe avant sa catégorie montrée comme repère),
 *   active() : vrai pendant une recherche }.
 * @param {HTMLElement} root @param {HTMLInputElement} input @param {(total: number, text: string) => void} [onFilter]
 */
export function wireCatSearch(root, input, onFilter = () => {}) {
  const hit = (/** @type {HTMLElement} */ b, t) => !t || ` ${b.dataset.q}`.includes(` ${t}`);
  input.addEventListener('input', () => {
    const t = fold(input.value);
    let total = 0;
    $$('[data-g]', root).forEach(g => {
      const rows = $$('[data-cat]', g);
      const hits = rows.map(b => hit(b, t));
      const any = hits.some(Boolean);
      // la catégorie (1re ligne) reste comme repère dès qu'une de ses lignes est trouvée
      rows.forEach((b, i) => { b.hidden = !(hits[i] || (i === 0 && any)); });
      g.hidden = !any;
      total += hits.filter(Boolean).length;
    });
    paintTree(root);
    onFilter(total, input.value);
  });
  return {
    first: () => { const t = fold(input.value); return $$('[data-cat]', root).find(b => !b.hidden && hit(b, t)) || null; },
    active: () => !!fold(input.value),
  };
}
