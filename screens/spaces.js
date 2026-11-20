// Espaces (D19, 2026-11-17 ; revu le 2026-11-19, avec l'utilisateur) : la tête de l'espace en haut de Moi ouvre leur
// feuille — chacun avec sa tête (blobatar), l'ouvert coché ; un toucher en ouvre un autre, sans confirmation (rien ne se
// perd) ; « Nouvel espace » demande un nom puis l'ouvre ; « Gérer les espaces » mène à leur page (renommer, supprimer).
// Ouvrir un espace rouvre l'app (la session s'ouvre au démarrage). Supprimer demande de taper le nom ; le premier et
// l'ouvert ne se suppriment pas.
import { spaces, currentSpace, addSpace, renameSpace, chooseSpace, removeSpace, reopen, MAIN, DEMO } from '../core/spaces.js';
import { esc } from '../core/format.js';
import { renameFolderSpace } from '../core/folder.js';
import { icon } from '../core/icons.js';
import { buzz, menuSheet, promptSheet, typedConfirmSheet, toast, openSheet, $, $$ } from '../core/ui.js';
import { spaceAvatar } from '../core/avatar.js';

/** @param {string} v @param {string|null} [except] */
const nameProblem = (v, except = null) => (!v ? 'Donne un nom à l’espace.'
  : spaces().some(s => s.id !== except && s.name.toLowerCase() === v.toLowerCase()) ? 'Un espace porte déjà ce nom.' : null);

/** Ouvrir un espace : l'app se rouvre dessus ; sans confirmation, rien ne se perd. @param {{ id: string, name: string }} s */
function openSpace(s) {
  chooseSpace(s.id);
  reopen();
}

/** Nouvel espace : un nom, puis il s'ouvre. */
async function newSpace() {
  const name = await promptSheet({ title: 'Nouvel espace', text: 'Un espace vide, avec ses propres données. Tu pourras revenir ici à tout moment.', placeholder: 'Ex. Tests, Famille', yes: 'Créer et ouvrir', check: v => nameProblem(v) });
  if (name === null) return;
  try { const s = addSpace(name); chooseSpace(s.id); reopen(); } catch (e) { toast(/** @type {Error} */ (e).message); }
}

/** Le petit texte d'un espace dans une liste. @param {{ id: string }} s @param {{ id: string }} cur */
const subOf = (s, cur) => (s.id === cur.id ? 'Ouvert' : s.id === DEMO ? 'Données de démonstration' : s.id === MAIN ? 'Le premier espace' : 'Toucher pour l’ouvrir');

/**
 * La feuille des espaces, depuis la tête en haut de Moi : un toucher ouvre un autre espace.
 * @param {{ go: (hash: string) => any }} o
 */
export function openSpacesSheet({ go }) {
  const cur = currentSpace();
  const list = spaces();
  const s = openSheet(`<h2 class="sheet-title">Espaces</h2>
    <div class="group plain">
      ${list.map(x => `<button type="button" class="row" data-sp="${esc(x.id)}"><span class="sp-ava" aria-hidden="true">${spaceAvatar(x)}</span>
        <div class="main"><div class="t">${esc(x.name)}</div><div class="s">${subOf(x, cur)}</div></div>${x.id === cur.id ? `<span class="end">${icon('check')}</span>` : ''}</button>`).join('')}
      <button type="button" class="row" data-sp-new><span class="pill acc">${icon('plus')}</span><div class="main"><div class="t">Nouvel espace</div></div></button>
      <button type="button" class="row" data-sp-manage><span class="pill acc">${icon('pencil-simple')}</span><div class="main"><div class="t">Gérer les espaces</div><div class="s">Renommer, supprimer</div></div></button>
    </div>`, { label: 'Espaces' });
  $$('[data-sp]', s.el).forEach(b => (b.onclick = () => {
    const x = list.find(y => y.id === b.dataset.sp);
    if (!x || x.id === cur.id) { s.close(); return; }
    buzz(8);
    openSpace(x);
  }));
  $('[data-sp-new]', s.el).onclick = () => { buzz(6); s.close(); newSpace(); };
  $('[data-sp-manage]', s.el).onclick = () => { buzz(6); s.close(); go('#/reglages/espaces'); };
}

export function render(app, { back }) {
  const cur = currentSpace();
  const list = spaces();
  app.innerHTML = `<div class="screen spaces-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Espaces</h1></div></div>
    <p class="screen-help">Chaque espace a ses propres données, ses copies et ses réglages. Ils ne se mélangent jamais : ce que tu essaies dans un espace ne touche pas les autres.</p>
    <section class="section"><div class="group">
      ${list.map(s => `<button class="row" data-space="${esc(s.id)}"><span class="sp-ava" aria-hidden="true">${spaceAvatar(s)}</span>
        <div class="main"><div class="t">${esc(s.name)}</div><div class="s">${subOf(s, cur)}</div></div>${s.id === cur.id ? `<span class="end">${icon('check')}</span>` : ''}</button>`).join('')}
      <button class="row" data-new><span class="pill acc">${icon('plus')}</span><div class="main"><div class="t">Nouvel espace</div></div></button>
    </div></section>
  </div>`;

  $('[data-back]', app).onclick = back;
  $('[data-new]', app).onclick = () => { buzz(6); newSpace(); };
  $$('[data-space]', app).forEach(b => (b.onclick = async () => {
    const s = list.find(x => x.id === b.dataset.space);
    if (!s) return;
    buzz(6);
    const items = [
      ...(s.id !== cur.id ? [{ key: 'open', icon: 'arrows-left-right', label: 'Ouvrir cet espace' }] : []),
      { key: 'rename', icon: 'pencil-simple', label: 'Renommer' },
      ...(s.id !== MAIN && s.id !== cur.id ? [{ key: 'remove', icon: 'trash', label: 'Supprimer', danger: true }] : []),
    ];
    const k = await menuSheet({ title: esc(s.name), items });
    if (k === 'open') return openSpace(s);
    if (k === 'rename') {
      const name = await promptSheet({ title: 'Renommer l’espace', value: s.name, yes: 'Renommer', check: v => nameProblem(v, s.id) });
      if (name === null) return;
      // son dossier de sauvegarde suit (2026-11-18) : les copies de l'espace restent ensemble
      try { renameSpace(s.id, name); renameFolderSpace(s.name, name); render(app, { back }); } catch (e) { toast(/** @type {Error} */ (e).message); }
    }
    if (k === 'remove') {
      const ok = await typedConfirmSheet({ title: `Supprimer « ${esc(s.name)} » ?`, text: 'L’espace disparaît de la liste. Ses fichiers restent sur ce téléphone.', name: s.name, yes: 'Supprimer' });
      if (!ok) return;
      try { removeSpace(s.id); toast('Espace supprimé'); render(app, { back }); } catch (e) { toast(/** @type {Error} */ (e).message); }
    }
  }));
}
