// Moi › Données et sauvegarde (page, ROADMAP 1b, 2026-11-09) et messages de la cloche (accueil).
// Sauvegarde : « Sauvegarder hors du téléphone » (le fichier du journal part par le menu de partage d'Android : Drive,
// WhatsApp, Fichiers… ; téléchargé dans le navigateur), « Faire une copie maintenant », « Restaurer depuis un fichier »,
// puis les copies automatiques gardées sur le téléphone (les 5 plus récentes, vérifiées, et les copies de sécurité) : en
// toucher une la restaure. « Dossier de sauvegarde » (D15, 2026-11-17, téléphone seulement) : un dossier choisi une fois
// reçoit aussi chaque copie, chiffrée ; il survit à la désinstallation, et l'on peut y restaurer.
// Avant toute restauration, le fichier est relu et rejoué, et la feuille dit ce qu'il contient. Données : export CSV,
// tout effacer.
import { toCSV, resetAll } from '../core/store.js';
import { confirmSheet, typedConfirmSheet, menuSheet, openSheet, buzz, toast, $, $$ } from '../core/ui.js';
import { folderAvailable, folderName, pickFolder, folderCopies, folderSpaces, readFromFolder } from '../core/folder.js';
import { currentSpace } from '../core/spaces.js';
import { isSafety, safetyReason } from '../data/copies.js';
import { icon } from '../core/icons.js';
import { esc, shortDate, iso, dayLabel, today } from '../core/format.js';
import { listCopies, lastExternal, journalFile, markExternal, inspect, restore, dailyCopy, keepSafety, copyToFolderNow } from '../core/backup.js';
import { messages, markAllRead } from '../core/inbox.js';

const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' });
/** « Aujourd'hui, 9 h 17 », « Hier, 8 h 05 », « 3 nov., 18 h 00 » @param {string} at */
function when(at) {
  const d = new Date(at);
  const p = Object.fromEntries(fmtTime.formatToParts(d).map(x => [x.type, x.value]));
  const l = dayLabel(iso(d));
  return `${['Aujourd’hui', 'Hier'].includes(l) ? l : shortDate(iso(d))}, ${p.hour} h ${p.minute}`;
}
/** « Il y a 12 jours » @param {string|null} at */
function since(at) {
  if (!at) return 'Jamais';
  const n = Math.floor((Date.now() - Date.parse(at)) / 86400e3);
  return n <= 0 ? 'Aujourd’hui' : n === 1 ? 'Hier' : `Il y a ${n} jours`;
}
const opsLabel = n => `${n} opération${n > 1 ? 's' : ''}`;
/** « la copie d'aujourd'hui, 9 h 17 », « la copie du 3 nov., 18 h 00 » @param {string} at */
const copyName = at => `la copie ${when(at).replace(/^Aujourd’hui/, 'd’aujourd’hui').replace(/^Hier/, 'd’hier').replace(/^(\d)/, 'du $1')}`;

/** @param {string} name @param {string} text @param {string} type */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Sur le téléphone, le menu de partage d'Android (le téléchargement par lien n'y marche pas) ; sinon téléchargement. */
function shareFile(name, text, type) {
  const A = /** @type {any} */ (globalThis).BougetteAndroid;
  if (A && typeof A.shareFile === 'function') return !!A.shareFile(name, text);
  download(name, text, type);
  return true;
}

/** Envoie le fichier du journal hors du téléphone. */
export async function shareJournal() {
  buzz(8);
  try {
    const { name, text } = await journalFile();
    if (!shareFile(name, text, 'application/octet-stream')) throw new Error('partage');
    markExternal();
    return true;
  } catch (e) {
    console.error(e);
    toast('Sauvegarde impossible pour l’instant.');
    return false;
  }
}

/** Relit puis restaure un journal, après confirmation. @param {string} text @param {string} what */
async function askRestore(text, what) {
  let info;
  try { info = await inspect(text); } catch (e) { toast(/** @type {Error} */ (e).message || 'Fichier illisible.'); return false; }
  const ok = await confirmSheet({
    title: `Restaurer ${what} ?`,
    text: `${opsLabel(info.ops)}${info.last ? `, dernier changement ${when(info.last).toLowerCase()}` : ''}. Ce qui a été noté depuis sera remplacé.`,
    yes: 'Restaurer', danger: true,
  });
  if (!ok) return false;
  try { await restore(text); } catch (e) { toast(/** @type {Error} */ (e).message || 'Restauration impossible.'); return false; }
  buzz(12);
  toast('Restauré');
  return true;
}

export function render(app, { back, go }) {
  app.innerHTML = `<div class="screen data-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Données et sauvegarde</h1></div></div>
    <p class="screen-help">Une copie vérifiée chaque jour sur ce téléphone. Garde aussi une copie ailleurs : le fichier est chiffré, il ne se lit pas comme un texte.</p>

    <section class="section"><div class="section-h"><span class="eyebrow">Sauvegarde</span></div>
      <div class="group">
        <button class="row" data-share><span class="pill acc">${icon('upload-simple')}</span><div class="main"><div class="t">Sauvegarder hors du téléphone</div><div class="s" data-ext>${since(lastExternal())}</div></div></button>
        <button class="row" data-now><span class="pill acc">${icon('shield-check')}</span><div class="main"><div class="t">Faire une copie maintenant</div><div class="s" data-last>…</div></div></button>
        <button class="row" data-file><span class="pill acc">${icon('download-simple')}</span><div class="main"><div class="t">Restaurer depuis un fichier</div></div></button>
      </div></section>

    ${folderAvailable() ? `<section class="section"><div class="section-h"><span class="eyebrow">Hors de l’app</span></div>
      <div class="group"><button class="row" data-folder><span class="pill acc">${icon('folder-simple')}</span><div class="main"><div class="t">Dossier de sauvegarde</div><div class="s wrap" data-folder-s></div></div><span class="end">${icon('caret-right')}</span></button></div></section>` : ''}

    <section class="section"><div class="section-h"><span class="eyebrow">Sur ce téléphone</span></div>
      <div class="group" data-copies><div class="row"><div class="main"><div class="s">…</div></div></div></div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Données</span></div>
      <div class="group">
        <button class="row" data-csv><span class="pill acc">${icon('download-simple')}</span><div class="main"><div class="t">Exporter en CSV</div><div class="s">Un fichier lisible dans un tableur</div></div></button>
        <button class="row" data-reset><span class="pill acc" style="color:var(--loss)">${icon('trash')}</span><div class="main"><div class="t" style="color:var(--loss)">Tout effacer</div><div class="s">Revenir au premier lancement</div></div></button>
      </div></section>
    <input type="file" data-input hidden>
  </div>`;

  const paint = async () => {
    const list = await listCopies();
    const host = $('[data-copies]', app);
    if (!host) return;
    const daily = list.filter(c => !isSafety(c));
    $('[data-last]', app).textContent = daily[0] ? `Dernière : ${when(daily[0].at).toLowerCase()}` : 'Aucune encore';
    // copies du jour, puis copies de sécurité (D15, 2026-11-17), chacune avec ce qui l'a déclenchée
    const why = (/** @type {any} */ c) => ({ reset: 'Avant Tout effacer', restore: 'Avant restauration', sync: 'Avant synchronisation' }[safetyReason(c) || ''] || 'Copie de sécurité');
    host.innerHTML = list.length
      ? [...daily, ...list.filter(isSafety)].map(c => `<button class="row" data-copy="${esc(c.id)}"><span class="pill acc">${icon(isSafety(c) ? 'shield-check' : 'clock-counter-clockwise')}</span><div class="main"><div class="t">${isSafety(c) ? `${why(c)} · ${when(c.at).toLowerCase()}` : when(c.at)}</div><div class="s">${opsLabel(c.ops)} · vérifiée</div></div><span class="end act">Restaurer</span></button>`).join('')
      : '<div class="row"><div class="main"><div class="s">La première copie se fait à la prochaine ouverture.</div></div></div>';
    $$('[data-copy]', host).forEach(b => (b.onclick = async () => {
      const c = list.find(x => x.id === b.dataset.copy);
      if (c) await askRestore(c.text, copyName(c.at));
    }));
  };
  paint();

  $('[data-back]', app).onclick = () => back('#/reglages');
  $('[data-share]', app).onclick = async () => { if (await shareJournal()) $('[data-ext]', app).textContent = since(lastExternal()); };
  $('[data-now]', app).onclick = async () => {
    buzz(6);
    const r = await dailyCopy({ force: true });
    toast(r.status === 'done' ? 'Copie faite et vérifiée' : r.status === 'same' ? 'Rien de nouveau depuis la dernière copie' : r.status === 'broken' ? 'Intégrité atteinte : pas de copie' : 'Copie impossible pour l’instant');
    paint();
  };
  const input = /** @type {HTMLInputElement} */ ($('[data-input]', app));
  $('[data-file]', app).onclick = () => { buzz(6); input.value = ''; input.click(); };
  // dossier de sauvegarde (D15, 2026-11-17) : le choisir ; une fois choisi, le changer ou y restaurer
  const folderRow = $('[data-folder]', app);
  const paintFolder = () => {
    const el = $('[data-folder-s]', app);
    if (!el) return;
    const name = folderName();
    const n = name ? folderCopies().length : 0;
    el.textContent = name ? `${name} · ${n} copie${n > 1 ? 's' : ''} chiffrée${n > 1 ? 's' : ''} de cet espace` : 'Pas encore choisi · une copie qui survit à la désinstallation';
  };
  paintFolder();
  const choose = async () => {
    const name = await pickFolder();
    if (!name) return;
    await copyToFolderNow();
    paintFolder();
    toast(`Copies aussi dans « ${name} »`);
  };
  if (folderRow) folderRow.onclick = async () => {
    buzz(6);
    if (!folderName()) return choose();
    const k = await menuSheet({ title: 'Dossier de sauvegarde', items: [
      { key: 'restore', icon: 'clock-counter-clockwise', label: 'Restaurer depuis le dossier', note: 'Après une réinstallation, ou pour revenir en arrière' },
      { key: 'change', icon: 'folder-simple', label: 'Changer de dossier' },
    ] });
    if (k === 'change') return choose();
    if (k !== 'restore') return;
    // les copies de tous les espaces du dossier (après une réinstallation, l'espace peut porter un autre nom)
    // les copies de cet espace d'abord ; celles des autres espaces ensuite, à part et nommées (2026-11-18 : elles se
    // mélangeaient), utiles surtout après une réinstallation
    const here = currentSpace().name;
    const mine = folderCopies(here).map(f => ({ dir: here, f }));
    const others = folderSpaces().filter(d => d !== here).flatMap(dir => folderCopies(dir).map(f => ({ dir, f })));
    const all = [...mine.slice(0, 6), ...others.slice(0, 12 - Math.min(6, mine.length))];
    if (!all.length) { toast('Aucune copie dans ce dossier.'); return; }
    const pickedKey = await menuSheet({ title: 'Quelle copie ?', items: all.map(({ dir, f }, i) => ({
      key: String(i), icon: dir === here ? 'shield-check' : 'folder-simple',
      label: esc(dir === here ? when(new Date(f.modified).toISOString()) : `${dir} · ${when(new Date(f.modified).toISOString())}`),
      note: dir === here ? (i === 0 ? 'Cet espace' : '') : 'Un autre espace' })) });
    if (pickedKey === null) return;
    const c = all[Number(pickedKey)];
    const text = readFromFolder(c.f.name, c.dir);
    if (!text) { toast('Copie illisible.'); return; }
    if (await askRestore(text, `la copie du dossier (${c.dir})`)) paint();
  };
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (f) await askRestore(await f.text(), 'ce fichier');
  };
  $('[data-csv]', app).onclick = () => {
    buzz(6);
    if (shareFile(`bougette-${today()}.csv`, toCSV(), 'text/csv;charset=utf-8')) toast('Fichier CSV créé');
    else toast('Export impossible pour l’instant.');
  };
  $('[data-reset]', app).onclick = async () => {
    // D19 : taper le nom de l'espace ; D15 : une copie de sécurité d'abord (sans elle, on n'efface pas)
    const sp = currentSpace();
    const ok = await typedConfirmSheet({ title: 'Tout effacer ?', text: `Opérations, portefeuilles, catégories, budgets et réglages de l’espace « ${esc(sp.name)} » seront effacés. Une copie de sécurité est gardée juste avant.`, name: sp.name, yes: 'Tout effacer' });
    if (!ok) return;
    try { await keepSafety('reset'); } catch (e) { toast('Copie de sécurité impossible : rien n’est effacé.'); return; }
    await resetAll();
    setTimeout(() => go('#/bienvenue', { replace: true }), 260);
  };
}

/** Messages de la cloche. Les ouvrir les marque lus. */
export function openInboxSheet() {
  const list = messages();
  const KIND = { error: ['warning', 'var(--loss)'], warn: ['info', 'var(--ink-2)'], info: ['check-circle', 'var(--gain)'] };
  const s = openSheet(`<h2 class="sheet-title">Notifications</h2>
    ${list.length ? `<div class="group plain">${list.map((m, i) => `<div class="row inbox-m${m.read ? '' : ' new'}">
      <span class="pill acc" style="color:${KIND[m.kind][1]}">${icon(KIND[m.kind][0])}</span>
      <div class="main"><div class="t">${esc(m.title)}</div><div class="s wrap">${esc(m.body)}</div><div class="s">${when(m.at)}</div></div>
      ${m.action ? `<button class="btn secondary sm" data-act="${i}">${esc(m.action.label)}</button>` : ''}</div>`).join('')}</div>`
      : '<p class="muted" style="margin:6px 0 14px">Rien de nouveau.</p>'}`, { label: 'Notifications' });
  markAllRead();
  $$('[data-act]', s.el).forEach(b => (b.onclick = async () => {
    const m = list[Number(b.dataset.act)];
    if (!m || !m.action) return;
    s.close();
    if (m.action.id === 'share') setTimeout(() => shareJournal(), 280);
    else if (m.action.id === 'backup') setTimeout(() => { location.hash = '#/reglages/donnees'; }, 280);
    else if (m.action.id === 'google') setTimeout(() => { location.hash = '#/reglages/google'; }, 280);
    else if (m.action.id === 'update') setTimeout(() => window.dispatchEvent(new CustomEvent('bougette:open-update')), 280);
    else if (m.action.id === 'assign') setTimeout(() => { location.hash = '#/mois'; }, 280);
    else if (m.action.id === 'savings') setTimeout(() => { location.hash = '#/epargne'; }, 280);
    else if (m.action.id === 'dues') setTimeout(() => { location.hash = '#/mois'; }, 280);
    // une réserve prête (2026-11-19) : « Tu la dépenses quand ? », ou Utiliser le jour venu
    else if (/^(when|use):/.test(m.action.id)) {
      const [how, id] = m.action.id.split(':');
      setTimeout(() => window.dispatchEvent(new CustomEvent('bougette:reserve', { detail: { id, when: how === 'when' } })), 280);
    }
  }));
}
