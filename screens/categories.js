// Moi → Catégories : onglets Dépenses / Revenus, puis la liste des catégories partagée (catlist.js, la même que
// « Toutes »), sans recherche ; « Ranger » montre les poignées pour ranger les catégories et, dans leur groupe, les
// sous-catégories (l'ordre se retrouve partout) ; + flottant pour en créer une ; créer / modifier (nom, « Ranger dans », teinte D8, icône du catalogue Phosphor avec recherche en français et
// rubriques, D7), archiver, supprimer (seulement sans sous-catégorie ni opération : sinon on archive).
// Sous-catégories (deux niveaux) : dans la fiche d'une catégorie, liste de ses sous-catégories et « Ajouter une
// sous-catégorie ». Une sous-catégorie a un nom et une icône ; sa teinte est celle de sa catégorie.
import {
  categories, allCategories, category, subcategories, categoryLabel, addCategory, updateCategory, reorderCategories, categoryTxCount, deleteCategory, hasBudget,
} from '../core/store.js';
import { esc } from '../core/format.js';
import { icon, catIcon, searchIcons } from '../core/icons.js';
import { openSheet, seg, wireSeg, buzz, toast, confirmSheet, chip, noticeHTML, enableReorder, afterSheets, wireArrange, arrangeBtnHTML, isArranging, fabHTML, $, $$ } from '../core/ui.js';
import { pickColor, brushHTML } from './pickers.js';
import { catTreeHTML, paintTree, catSearchHTML, wireCatSearch } from './catlist.js';
import { editNote } from './entry/sheets.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML, fieldHTML, sheetHead, sheetActions } from './parts.js';

let tab = 'expense';
if (typeof window !== 'undefined') window.addEventListener('bougette:space', () => { tab = 'expense'; }); // un autre espace (D19)
const TAB_SEG = [['expense', 'Dépenses'], ['income', 'Revenus']];

// Grille du catalogue, par rubriques (ou résultats d'une recherche).
function catalogHTML(query, current) {
  const sections = searchIcons(query);
  if (!sections.length) return `<p class="hint">Aucune icône pour « ${esc(query)} ». Essaie un autre mot.</p>`;
  return sections.map(sct => `<div class="ic-sec"><div class="eyebrow">${esc(sct.title)}</div><div class="ic-grid">${sct.icons.map(i =>
    `<button type="button" class="icb${i.name === current ? ' on' : ''}" data-icon="${i.name}" role="radio" aria-checked="${i.name === current}" aria-label="${esc(i.label)}">${catIcon(i.name)}</button>`).join('')}</div></div>`).join('');
}

// Fiche unique (catégorie ou sous-catégorie) : « Ranger dans » choisit aucune (catégorie principale) ou une catégorie
// principale (sous-catégorie : elle en prend la teinte, pas de choix de teinte). À la modification, changer ce champ
// déplace la catégorie ; une catégorie qui a des sous-catégories reste principale (son budget la suit).
// parent : catégorie proposée dans « Ranger dans » pour une création. name : nom proposé pour une création (ex. le
// texte cherché à la saisie) ; onSaved(catégorie) : appelé après l'enregistrement (ex. la saisie choisit la nouvelle).
export function openCategorySheet(id, type, { parent = null, name = '', onSaved = null } = {}) {
  const c = id ? category(id) : null;
  const was = c ? category(c.parent) || null : null; // place d'origine (libellés d'archivage)
  const f = { name: c?.name || name, icon: c?.icon || 'dots-three', own: c?.color || 'c1', /* devenue principale, elle garde la teinte qu'elle affichait */ q: '', parent: c ? c.parent || null : parent || null };
  const par = () => category(f.parent) || null;
  const color = () => par()?.color || f.own;
  const used = c ? categoryTxCount(c.id) : 0;
  const activeSame = categories(type);
  const lastActive = c && !c.parent && !c.archived && activeSame.length <= 1;
  const subs = c && !c.parent ? subcategories(c.id, { all: true }) : [];
  // une principale qui a des sous-catégories ne peut pas devenir sous-catégorie (deux niveaux) ; son budget, lui, la suit
  const stayTop = c && !c.parent && subs.length ? `« ${esc(c.name)} » a des sous-catégories : elle reste une catégorie principale.` : '';
  const what = was ? 'la sous-catégorie' : 'la catégorie';
  // supprimer : seulement sans sous-catégorie ni opération ; sinon le bouton est éteint et la raison écrite dessous
  const noDelete = !c ? '' : subs.length ? `« ${esc(c.name)} » a des sous-catégories : supprime-les d’abord, ou archive-la.`
    : used ? `« ${esc(c.name)} » a des opérations : archive-la, elles sont gardées.` : '';
  const s = openSheet(`<div class="cat-sheet">
    <div class="sheet-head"><div class="head-id cat-pv"><span class="cat-pvic" data-pv></span><span class="cat-pvname" data-pvname></span></div></div>
    ${fieldHTML({ label: 'Nom', attrs: 'data-namef', control: '<button type="button" class="field-btn" data-name></button>' })}
    ${fieldHTML({ label: 'Ranger dans', note: stayTop,
      control: `<button type="button" class="field-btn" data-par ${stayTop ? 'aria-disabled="true"' : ''}><b data-parl></b>${icon(stayTop ? 'lock-simple' : 'caret-right')}</button>${stayTop ? '' : '<small class="field-note" data-parn></small>'}` })}
    ${c && !c.parent ? fieldHTML({ label: 'Sous-catégories', attrs: 'data-subsf', control: `<div class="group plain cat-subs">${subs.map(x => rowHTML({ cls: x.archived ? 'dim' : '', attrs: `data-sub="${x.id}"`, pill: chip(x),
      title: esc(x.name), sub: x.archived ? 'Archivée' : '', end: `<span class="end">${icon('caret-right')}</span>` })).join('')}
        ${rowHTML({ cls: 'add-row', attrs: 'data-add-sub', pill: `<span class="pill">${icon('plus')}</span>`, title: 'Ajouter une sous-catégorie' })}
      </div>` }) : ''}
    ${fieldHTML({ label: 'Icône', control: `<div class="search ic-search">${icon('magnifying-glass')}<input type="search" data-q placeholder="Chercher : marché, zem, coiffure…" autocomplete="off" enterkeyhint="search"></div>
      <div data-icons role="radiogroup" aria-label="Icônes"></div>` })}
    <div data-err></div>
    ${sheetActions(`<button class="btn primary" data-save>${icon('check')}<span data-savel></span></button>`)}
    <div class="sheet-more">
      ${c && !lastActive ? `<div class="cat-links">
        <button type="button" class="link" data-arch>${c.archived ? 'Désarchiver' : 'Archiver'}</button>
        <button type="button" class="link cat-del" data-del${noDelete ? ' disabled' : ''}>Supprimer</button></div>
        ${noDelete ? `<p class="hint">${noDelete}</p>` : ''}` : ''}
      ${lastActive ? `<p class="hint">Garde au moins une catégorie de ${type === 'income' ? 'revenus' : 'dépenses'}.</p>` : ''}
    </div></div>`, { label: c ? `Modifier ${what}` : 'Nouvelle catégorie' });
  const el = s.el, nameBtn = $('[data-name]', el), errEl = $('[data-err]', el), iconsEl = $('[data-icons]', el);

  function paint() {
    const p = par();
    // teinte : le pinceau sur la pastille (une sous-catégorie prend celle de sa catégorie : pas de pinceau)
    $('[data-pv]', el).innerHTML = `${p ? chip({ color: color(), icon: f.icon }, 'lg') : `<button type="button" class="pv-btn" data-tint aria-label="Teinte">${chip({ color: color(), icon: f.icon }, 'lg')}${brushHTML()}</button>`}`;
    $$('[data-icon]', el).forEach(b => { const on = b.dataset.icon === f.icon; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    el.querySelector('.cat-sheet').style.setProperty('--c', `var(--${color()})`);
    $('[data-parl]', el).textContent = p ? p.name : 'Aucune : catégorie principale';
    const note = $('[data-parn]', el);
    if (note) note.textContent = p ? `Rangée dans « ${p.name} », elle en prend la teinte.` : '';
    // une sous-catégorie n'a pas de teinte à elle ; seule une principale déjà enregistrée montre ses sous-catégories
    const subsF = $('[data-subsf]', el);
    if (subsF) subsF.hidden = !!p;
    // le nom ne se tape pas en haut : une ligne qui ouvre sa petite feuille ; sans nom, le bouton le dit, éteint, et la ligne s'entoure (2026-11-26, avec l'utilisateur)
    const named = !!f.name.trim();
    // vide : un exemple en gris, comme un champ (2026-11-26, avec l'utilisateur : la fiche était bizarre à la création)
    nameBtn.innerHTML = `<b${named ? '' : ' class="muted"'}>${esc(named ? f.name.trim() : type === 'income' ? 'Ex. Tontine, Loyer perçu' : 'Ex. Zem, Coiffure, Loyer')}</b>${icon('caret-right')}`;
    // le contour sur le champ lui-même (arrondi), pas sur le bloc avec son libellé (un rectangle à angles droits)
    nameBtn.classList.toggle('ask', !named);
    // l'aperçu dit aussi le nom ; sans nom, ce qu'on est en train de créer, en gris
    const pv = $('[data-pvname]', el);
    pv.textContent = named ? f.name.trim() : c ? '' : p ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie';
    pv.classList.toggle('muted', !named);
    const saveBtn = $('[data-save]', el);
    saveBtn.disabled = !named;
    saveBtn.classList.toggle('need', !named);
    $('[data-savel]', el).textContent = !named ? 'Donne un nom' : c ? 'Enregistrer' : p ? 'Ajouter la sous-catégorie' : 'Ajouter la catégorie';
  }
  const paintIcons = () => { iconsEl.innerHTML = catalogHTML(f.q, f.icon); paint(); };
  paintIcons();
  nameBtn.onclick = async () => {
    buzz(6);
    const v = await editNote(f.name, { title: 'Nom', placeholder: type === 'income' ? 'Ex. Tontine, Loyer perçu' : 'Ex. Zem, Coiffure, Loyer', max: 24 });
    if (v != null) { f.name = v; paint(); }
  };
  $('[data-q]', el).oninput = e => { f.q = e.target.value; paintIcons(); };
  $('[data-pv]', el).addEventListener('click', async e => {
    if (!/** @type {HTMLElement} */ (e.target).closest('[data-tint]')) return;
    buzz(6);
    const c = await pickColor({ current: f.own, title: 'Teinte de la catégorie' });
    if (c) { f.own = c; paint(); }
  });
  iconsEl.onclick = e => { const b = e.target.closest('[data-icon]'); if (!b) return; f.icon = b.dataset.icon; buzz(8); paint(); };
  $('[data-par]', el).onclick = async () => {
    if (stayTop) { buzz([10, 40, 10]); return; }
    buzz(6);
    const to = await pickParent({ type, current: f.parent, exclude: c?.id });
    if (to === undefined) return;
    f.parent = to;
    paint();
  };

  const err = (text, field) => { errEl.innerHTML = noticeHTML(text); buzz(14); if (field) field.focus(); };
  $('[data-save]', el).onclick = async () => {
    errEl.innerHTML = '';
    const name = f.name.trim().replace(/\s+/g, ' ');
    if (!name) return err('Donne-lui un nom.');
    // un nom est unique dans le type, principales et sous-catégories confondues (D13)
    const p = par();
    const scope = p ? p.id : null;
    const twin = allCategories(type).find(x => x.id !== c?.id && !x.archived && x.name.toLowerCase() === name.toLowerCase());
    if (twin) {
      const tp = twin.parent ? category(twin.parent) : null;
      return err(tp ? `« ${esc(twin.name)} » existe déjà, dans « ${esc(tp.name)} ».` : 'Une catégorie porte déjà ce nom.');
    }
    const data = p ? { name, icon: f.icon } : { name, color: f.own, icon: f.icon };
    // modifier : « parent » déplace la catégorie (le domaine refuse ce qui casserait les deux niveaux)
    const saved = c ? ((await updateCategory(c.id, { ...data, parent: scope })) && category(c.id)) : await addCategory({ ...data, type, parent: scope });
    if (!saved) return;
    buzz(12);
    s.close();
    if (onSaved) onSaved(saved);
    const moved = c && (c.parent || null) !== scope;
    toast(moved ? (p ? `Rangée dans « ${p.name} »` : 'Devenue catégorie principale') : c ? (p ? 'Sous-catégorie enregistrée' : 'Catégorie enregistrée') : p ? 'Sous-catégorie ajoutée' : 'Catégorie ajoutée');
  };
  // sous-catégories : on ferme cette fiche, puis on ouvre celle de la sous-catégorie (une seule fiche à la fois)
  $$('[data-sub]', el).forEach(b => (b.onclick = () => { buzz(6); s.close(); afterSheets(() => openCategorySheet(b.dataset.sub, type)); }));
  const addSub = $('[data-add-sub]', el);
  if (addSub) addSub.onclick = () => { buzz(6); s.close(); afterSheets(() => openCategorySheet(null, type, { parent: c.id })); };

  const arch = $('[data-arch]', el);
  if (arch) arch.onclick = () => {
    const to = !c.archived;
    updateCategory(c.id, { archived: to });
    s.close();
    const W = was ? 'Sous-catégorie' : 'Catégorie';
    toast(to ? `${W} archivée` : `${W} désarchivée`, to ? { label: 'Annuler', run: () => updateCategory(c.id, { archived: false }) } : null);
  };
  const del = $('[data-del]', el);
  if (del && !noDelete) del.onclick = async () => {
        const ok = await confirmSheet({ title: `Supprimer « ${esc(c.name)} » ?`, text: `Elle n’a aucune opération.${hasBudget(c.id) ? ' Son budget sera retiré.' : ''}`, yes: 'Supprimer', danger: true });
    if (!ok) return;
    if (!(await deleteCategory(c.id))) return;
    s.close();
    toast('Catégorie supprimée');
  };
}

// « Ranger dans » : aucune (catégorie principale) ou une catégorie principale active du même type, dans l'ordre choisi ;
// exclude : la catégorie qu'on modifie. Résout null (principale), un id, ou undefined si on ferme sans choisir.
function pickParent({ type, current, exclude }) {
  return new Promise(resolve => {
    let picked;
    // la liste partagée (catlist.js), catégories principales seules (deux niveaux), précédée de « Aucune »
    const s = openSheet(`${sheetHead({ title: 'Ranger dans' })}
      <div class="group cl-g">${rowHTML({ cls: `cl-row${current ? '' : ' on'}`, attrs: 'data-pid', pill: `<span class="pill">${icon('squares-four')}</span>`,
        title: 'Aucune', sub: 'Catégorie principale', end: current ? '' : `<span class="end">${icon('check')}</span>` })}</div>
      <div class="cl" data-tree>${catTreeHTML({ type, current, exclude, withSubs: false })}</div>`, {
      label: 'Ranger dans', onClose: () => resolve(picked),
    });
    paintTree($('[data-tree]', s.el));
    $('[data-tree] [data-cat]', s.el)?.classList.add('rule'); // filet sous « Aucune »
    $$('[data-pid], [data-cat]', s.el).forEach(b => (b.onclick = () => { picked = b.dataset.cat || null; buzz(10); s.close(); }));
  });
}

export function render(app, { back }) {
  // archivées dans l'ordre de l'arbre : une catégorie, puis ses sous-catégories, comme la liste au-dessus
  const archived = allCategories(tab).filter(c => !c.parent).flatMap(c => [c, ...subcategories(c.id, { all: true })]).filter(c => c.archived);
  app.innerHTML = `<div class="screen cats no-tabs has-fab">
    ${topbarHTML({ title: 'Catégories', right: `<button class="iconbtn" data-find aria-label="Chercher une catégorie" aria-pressed="false">${icon('magnifying-glass')}</button>${arrangeBtnHTML()}` })}
    <p class="screen-help">Touche une catégorie pour la modifier. L’ordre choisi ici se retrouve partout.</p>
    <div data-findbox hidden>${catSearchHTML()}</div>
    ${seg(TAB_SEG, tab, 'tab-seg')}
    ${sectionHTML({ cls: 'cl-sec', body: `
      <div class="cl" data-tree>${catTreeHTML({ type: tab, handle: true })}</div>
      <p class="muted b-note" data-none hidden>Aucune catégorie trouvée.</p>` })}
    ${archived.length ? sectionHTML({ title: 'Archivées', body: `
      <div class="group">${archived.map(c => rowHTML({ cls: 'dim', attrs: `data-cat="${c.id}"`, pill: chip(c), title: esc(categoryLabel(c.id)), end: `<span class="end">${icon('caret-right')}</span>` })).join('')}</div>` }) : ''}
  </div>
  ${fabHTML(tab === 'income' ? 'Nouvelle catégorie de revenus' : 'Nouvelle catégorie de dépenses')}`;

  // même modèle que Portefeuilles (D9) : « Ranger » montre les poignées, + flottant
  wireArrange($('.screen', app), $('[data-arrange]', app), 'categories');
  wireBack(app, () => back('#/reglages'));
  wireSeg($('.tab-seg', app), v => { tab = v; setTimeout(() => render(app, { back }), 160); });
  $$('[data-cat]', app).forEach(b => (b.onclick = e => {
    if (e.target.closest('.handle') || isArranging('categories')) return;
    openCategorySheet(b.dataset.cat, tab);
  }));
  $('[data-add]', app).onclick = () => openCategorySheet(null, tab);
  // loupe (comme Portefeuilles) : filtre l'arbre par nom ; une sous-catégorie trouvée garde sa catégorie comme repère
  const find = $('[data-find]', app), box = $('[data-findbox]', app), q = /** @type {HTMLInputElement} */ ($('input[data-q]', box));
  wireCatSearch($('[data-tree]', app), q, total => { $('[data-none]', app).hidden = total > 0 || !q.value.trim(); });
  find.onclick = () => {
    const on = box.hidden;
    buzz(6);
    box.hidden = !on;
    find.setAttribute('aria-pressed', String(on));
    if (on) q.focus(); else if (q.value) { q.value = ''; q.dispatchEvent(new Event('input')); }
  };
  // ranger : les catégories (chaque groupe avec ses sous-catégories), et les sous-catégories dans leur groupe
  const tree = $('[data-tree]', app);
  paintTree(tree);
  enableReorder(tree, ids => reorderCategories(tab, ids));
  $$('[data-g]', tree).forEach(g => enableReorder(g, ids => reorderCategories(tab, ids)));
}
