// Espaces (D19, 2026-11-17 ; revu le 2026-11-19, avec l'utilisateur) : la tête de l'espace en haut de Moi ouvre leur
// feuille — chacun avec sa tête (blobatar), l'ouvert coché ; un toucher en ouvre un autre, sans confirmation (rien ne se
// perd) ; « Nouvel espace » demande un nom puis l'ouvre ; « Gérer les espaces » mène à leur page (renommer, archiver).
// Ouvrir un espace rouvre l'app dessus, sur place (core/app.js switchSpace). Archiver (2026-11-21, avec l'utilisateur) redemande
// le code ; l'espace passe dans « Archivés », en bas de la page, d'où « Rouvrir » le ramène et l'ouvre. L'espace ouvert
// ne s'archive que par « Repartir de zéro » (aussi dans Données et sauvegarde) : le code, le nom du nouvel espace, puis
// l'app se rouvre sur lui, vide, et l'ancien est archivé.
import { spaces, openSpaces, archivedSpaces, currentSpace, addSpace, renameSpace, chooseSpace, archiveSpace, reopenSpace, startOver, nextSpaceName, reopen, MAIN, DEMO } from '../core/spaces.js';
import { esc, shortDate, iso } from '../core/format.js';
import { icon } from '../core/icons.js';
import { buzz, menuSheet, promptSheet, toast, openSheet, afterSheets, $, $$ } from '../core/ui.js';
import { askIdentity } from './lock.js';
import { spaceAvatar } from '../core/avatar.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML, sheetHead } from './parts.js';

/** @param {string} v @param {string|null} [except] */
const nameProblem = (v, except = null) => (!v ? 'Donne un nom à l’espace.'
  : spaces().some(s => s.id !== except && s.name.toLowerCase() === v.toLowerCase()) ? 'Un espace porte déjà ce nom.' : null);

/**
 * Ouvrir un espace : l'app se rouvre dessus ; sans confirmation, rien ne se perd. from : la feuille des espaces, qui
 * devient l'écran d'ouverture.
 * @param {{ id: string, name: string }} s @param {Element|null} [from]
 */
function openSpace(s, from = null) {
  chooseSpace(s.id);
  reopen('', { from });
}

/** Nouvel espace : un nom, puis il s'ouvre. */
async function newSpace() {
  const name = await promptSheet({ title: 'Nouvel espace', text: `Un espace vide, avec ses propres données. Tu reviens à « ${esc(currentSpace().name)} » quand tu veux.`, placeholder: 'Ex. Tests, Famille', yes: 'Créer et ouvrir', check: v => nameProblem(v) });
  if (name === null) return;
  try { const s = addSpace(name); chooseSpace(s.id); reopen(); } catch (e) { toast(/** @type {Error} */ (e).message); }
}

/**
 * Repartir de zéro : le code, le nom du nouvel espace (proposé), puis l'app se rouvre sur lui, vide (accueil guidé) ;
 * l'espace ouvert est archivé, rien n'est effacé.
 */
export async function startOverFlow() {
  buzz(6);
  const cur = currentSpace();
  if (!(await askIdentity('Repartir de zéro'))) return;
  const name = await promptSheet({
    title: 'Repartir de zéro',
    text: `Un nouvel espace vide s’ouvre. « ${esc(cur.name)} » est archivé : rien n’est effacé. Tu le rouvres depuis Gérer les espaces.`,
    value: nextSpaceName(), yes: 'Créer et ouvrir', check: v => nameProblem(v),
  });
  if (name === null) return;
  try { startOver(name); reopen(); } catch (e) { toast(/** @type {Error} */ (e).message); }
}

/** Le petit texte d'un espace dans une liste. @param {{ id: string }} s @param {{ id: string }} cur */
const subOf = (s, cur) => (s.id === cur.id ? 'Ouvert' : s.id === DEMO ? 'Données de démonstration' : s.id === MAIN ? 'Le premier espace' : 'Toucher pour l’ouvrir');
/** @param {any} s */
const avatar = s => `<span class="sp-ava" aria-hidden="true">${spaceAvatar(s)}</span>`;
/** Un espace ouvert, coché s'il est l'espace en cours. @param {any} s @param {any} cur @param {string} attrs */
const spaceRow = (s, cur, attrs) => rowHTML({ attrs, pill: avatar(s), title: esc(s.name), sub: subOf(s, cur), end: s.id === cur.id ? `<span class="end">${icon('check')}</span>` : '' });

/**
 * La feuille des espaces, depuis la tête en haut de Moi : un toucher ouvre un autre espace.
 * @param {{ go: (hash: string) => any }} o
 */
export function openSpacesSheet({ go }) {
  const cur = currentSpace();
  const list = openSpaces();
  const s = openSheet(`${sheetHead({ title: 'Espaces' })}
    <div class="group list-pick">
      ${list.map(x => spaceRow(x, cur, `data-sp="${esc(x.id)}"`)).join('')}
      ${rowHTML({ attrs: 'data-sp-new', pill: `<span class="pill acc">${icon('plus')}</span>`, title: 'Nouvel espace' })}
      ${rowHTML({ attrs: 'data-sp-manage', pill: `<span class="pill acc">${icon('pencil-simple')}</span>`, title: 'Gérer les espaces', sub: 'Renommer, archiver' })}
    </div>`, { label: 'Espaces' });
  $$('[data-sp]', s.el).forEach(b => (b.onclick = () => {
    const x = list.find(y => y.id === b.dataset.sp);
    if (!x || x.id === cur.id) { s.close(); return; }
    buzz(8);
    openSpace(x, b.closest('.sheet'));
  }));
  // la feuille se ferme en reculant dans l'historique : la page s'ouvre une fois ce retour fini (sinon il l'annulait, 2026-11-24)
  $('[data-sp-manage]', s.el).onclick = () => { buzz(6); s.close(); afterSheets(() => go('#/reglages/espaces')); };
  $('[data-sp-new]', s.el).onclick = () => { buzz(6); s.close(); afterSheets(() => newSpace()); };
}

export function render(app, { back }) {
  const cur = currentSpace();
  const list = openSpaces();
  const old = archivedSpaces();
  app.innerHTML = `<div class="screen spaces-screen no-tabs">
    ${topbarHTML({ title: 'Espaces' })}
    <p class="screen-help">Chaque espace a ses propres données. Un espace archivé garde tout et se rouvre quand tu veux.</p>
    ${sectionHTML({ body: `<div class="group">
      ${list.map(s => spaceRow(s, cur, `data-space="${esc(s.id)}"`)).join('')}
      ${rowHTML({ attrs: 'data-new', pill: `<span class="pill acc">${icon('plus')}</span>`, title: 'Nouvel espace' })}
      ${rowHTML({ attrs: 'data-fresh', pill: `<span class="pill acc">${icon('arrow-counter-clockwise')}</span>`, title: 'Repartir de zéro',
        sub: 'Un nouvel espace vide. L’espace ouvert est archivé, rien n’est effacé.', subCls: 'wrap' })}
    </div>` })}
    ${old.length ? sectionHTML({ title: 'Archivés', attrs: 'data-archived', body: `<div class="group">
      ${old.map(s => rowHTML({ attrs: `data-old="${esc(s.id)}"`, pill: avatar(s), title: esc(s.name),
        sub: `Archivé le ${esc(shortDate(iso(new Date(String(s.archived)))))}`, end: '<span class="end act">Rouvrir</span>' })).join('')}
    </div>` }) : ''}
  </div>`;

  wireBack(app, () => back('#/reglages'));
  $('[data-new]', app).onclick = () => { buzz(6); newSpace(); };
  $('[data-fresh]', app).onclick = () => startOverFlow();
  // Rouvrir : l'espace revient dans la liste et l'app se rouvre dessus
  $$('[data-old]', app).forEach(b => (b.onclick = () => {
    const s = old.find(x => x.id === b.dataset.old);
    if (!s) return;
    buzz(8);
    try { reopenSpace(s.id); reopen(); } catch (e) { toast(/** @type {Error} */ (e).message); }
  }));
  $$('[data-space]', app).forEach(b => (b.onclick = async () => {
    const s = list.find(x => x.id === b.dataset.space);
    if (!s) return;
    buzz(6);
    const items = [
      ...(s.id !== cur.id ? [{ key: 'open', icon: 'arrows-left-right', label: 'Ouvrir cet espace' }] : []),
      { key: 'rename', icon: 'pencil-simple', label: 'Renommer' },
      ...(s.id !== cur.id ? [{ key: 'archive', icon: 'archive', label: 'Archiver', note: 'Il passe dans Archivés, plus bas. Rien n’est effacé.' }] : []),
    ];
    const k = await menuSheet({ title: esc(s.name), items });
    if (k === 'open') return openSpace(s);
    if (k === 'rename') {
      // renommer ne fait rien sortir ni ne casse rien : sans code à demander (2026-11-24, avec l'utilisateur)
      const name = await promptSheet({ title: 'Renommer l’espace', value: s.name, yes: 'Renommer', check: v => nameProblem(v, s.id) });
      if (name === null) return;
      try { renameSpace(s.id, name); render(app, { back }); } catch (e) { toast(/** @type {Error} */ (e).message); }
    }
    if (k === 'archive') {
      if (!(await askIdentity('Archiver l’espace'))) return;
      try { archiveSpace(s.id); toast('Espace archivé'); render(app, { back }); } catch (e) { toast(/** @type {Error} */ (e).message); }
    }
  }));
}
