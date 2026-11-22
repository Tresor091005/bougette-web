// Briques d'écran sans données : barre du haut, ligne, section, champ, feuille, état vide, pages « Toutes les … ».
// Un réglage visuel de ces morceaux se fait ici, une fois pour tous les écrans.
import { icon } from '../core/icons.js';
import { buzz, fitText, fabHTML, $, $$ } from '../core/ui.js';

/**
 * La barre du haut : Retour (sauf back: false), le titre, les actions à droite. title et right sont du HTML (l'appelant
 * échappe les noms saisis) ; cls : classes du titre en plus de « title » ; attrs : ses autres attributs.
 * @param {{ title: string, back?: boolean, cls?: string, attrs?: string, right?: string }} o
 */
export function topbarHTML({ title, back = true, cls = '', attrs = '', right = '' }) {
  const h1 = `<h1 class="title${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>${title}</h1>`;
  const left = back ? `<div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>${h1}</div>` : h1;
  return `<div class="topbar">${left}${right ? `<div class="right">${right}</div>` : ''}</div>`;
}

/** Branche Retour de la barre du haut. @param {ParentNode} root @param {() => void} run */
export function wireBack(root, run) {
  $('[data-back]', root).onclick = run;
}

/**
 * Une ligne de liste : la pastille, le titre et le sous-titre, à droite end (montant, chevron, coche, interrupteur…).
 * Tout est du HTML (l'appelant échappe les noms saisis). tag : button (type="button") ou div ; cls : classes en plus de
 * « row » ; attrs : ses autres attributs ; titleCls, subCls : classes du titre et du sous-titre en plus de « t » et « s »
 * (wrap, loss…).
 * @param {{ pill?: string, title: string, titleCls?: string, sub?: string, subCls?: string, end?: string, cls?: string, attrs?: string, tag?: 'button'|'div' }} o
 */
export const rowHTML = ({ pill = '', title, titleCls = '', sub = '', subCls = '', end = '', cls = '', attrs = '', tag = 'button' }) =>
  `<${tag}${tag === 'button' ? ' type="button"' : ''} class="row${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>${pill}<div class="main"><div class="t${titleCls ? ` ${titleCls}` : ''}">${title}</div>${
    sub ? `<div class="s${subCls ? ` ${subCls}` : ''}">${sub}</div>` : ''}</div>${end}</${tag}>`;

/**
 * Une section : son titre (title, du texte ; ou head, un titre déjà fait comme titleLink), puis body. cls : classes en
 * plus de « section » ; attrs : ses autres attributs. Sans titre, la section n'a que body.
 * @param {{ title?: string, head?: string, body: string, cls?: string, attrs?: string }} o
 */
export const sectionHTML = ({ title = '', head = title && `<h2>${title}</h2>`, body, cls = '', attrs = '' }) =>
  `<section class="section${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>${head ? `<div class="section-h">${head}</div>` : ''}${body}</section>`;

/**
 * Un champ de formulaire : le libellé, le contrôle, la note dessous. Un champ de saisie se range dans un <label> (toucher
 * le libellé y met le curseur), un bouton ou des choix dans un <div>. attrs : attributs du champ ; labelAttrs : du libellé.
 * @param {{ label: string, control: string, note?: string, attrs?: string, labelAttrs?: string }} o
 */
export function fieldHTML({ label, control, note = '', attrs = '', labelAttrs = '' }) {
  const tag = /^<(input|textarea)\b/.test(control) ? 'label' : 'div';
  return `<${tag} class="field"${attrs ? ` ${attrs}` : ''}><span${labelAttrs ? ` ${labelAttrs}` : ''}>${label}</span>${control}${
    note ? `<small class="field-note">${note}</small>` : ''}</${tag}>`;
}

/**
 * Le titre d'une feuille ; avec pill, la pastille devant (l'élément dont parle la feuille). attrs : attributs du titre.
 * @param {{ title: string, pill?: string, attrs?: string }} o
 */
export const sheetHead = ({ title, pill = '', attrs = '' }) => {
  const h2 = `<h2 class="sheet-title"${attrs ? ` ${attrs}` : ''}>${title}</h2>`;
  return pill ? `<div class="bs-id">${pill}${h2}</div>` : h2;
};

/** Le bas d'une feuille : ses boutons (le principal d'abord). @param {string} buttons */
export const sheetActions = buttons => `<div class="sheet-actions">${buttons}</div>`;

/**
 * Rien encore (D0) : une phrase et, s'il y a quoi créer, un + rond à droite. add : [l'attribut que l'écran branche sur
 * le +, son libellé].
 * @param {string} text @param {{ add?: [string, string] }} [o]
 */
export const emptyState = (text, { add } = {}) => `<div class="w-none"><p>${text}</p>${
  add ? `<button type="button" class="iconbtn" ${add[0]} aria-label="${add[1]}">${icon('plus')}</button>` : ''}</div>`;

/**
 * Titre d'une section de Plan (2026-11-13, avec l'utilisateur) : il ouvre sa page (« Toutes les échéances »…), toujours,
 * même avec peu de lignes ; on y crée par le + flottant. Plus de + dans les titres ni de lien « Toutes les … » en bas.
 * @param {string} text @param {string} attr
 */
export const titleLink = (text, attr) => `<h2><button type="button" class="sh-link" ${attr}>${text}${icon('caret-right')}</button></h2>`;

/**
 * Ce qui est terminé, replié en bas d'une page (« Budgets terminés 3 »). Rien sans ligne.
 * @param {string} title @param {string[]} rows
 */
export const endedHTML = (title, rows) => (rows.length ? `<details class="section b-done"><summary>${title} <span class="muted">${rows.length}</span></summary>
  <div class="group">${rows.join('')}</div></details>` : '');

/**
 * Une page « Toutes les … » (budgets, échéances, réserves, épargnes ; 2026-11-12) : la barre du haut, en tête le chiffre
 * qui la résume et sa phrase (intro : rien s'il n'y a rien), les sections, ce qui est terminé, le + flottant.
 * @param {{ title: string, intro?: { label: string, big: string, sub?: string } | null, body: string, ended?: string, fab: string }} o
 */
export const listPageHTML = ({ title, intro, body, ended = '', fab }) => `<div class="screen month no-tabs has-fab">
  ${topbarHTML({ title })}
  ${intro ? `<section class="hero b-hero b-all"><div class="label">${intro.label}</div><div class="big">${intro.big}</div>
    ${intro.sub ? `<div class="b-res">${intro.sub}</div>` : ''}</section>` : ''}
  ${body}${ended}
</div>${fabHTML(fab)}`;

/**
 * Branche une page « Toutes les … » : Retour vers Plan, le + flottant (et le + d'une section vide, [data-new]) ; les
 * grands montants rétrécissent s'ils débordent.
 * @param {HTMLElement} app @param {any} ctx @param {() => void} add
 */
export function wireListPage(app, ctx, add) {
  wireBack(app, () => ctx.back('#/mois'));
  $$('[data-add], [data-new]', app).forEach(b => (b.onclick = () => { buzz(6); add(); }));
  fitText(app, '.hero .big, .mrow .v', 13);
}
