// Moi › Données et sauvegarde (page, ROADMAP 1b, 2026-11-09 ; revue le 2026-11-21, avec l'utilisateur) et messages de la
// cloche (accueil). Deux parties :
// - Sauvegarde : Google Drive (l'état du compte et de la synchro, ouvre Moi › Google Drive, D21).
// - Données : « Vérifier mes données » (le résultat en clair dans la page), l'export CSV, « Repartir de zéro » (un
//   nouvel espace vide ; celui-ci est archivé, rien n'est effacé, D19).
// Réparer (depuis la cloche ou Vérifier) et, dans la page Développeur, revenir à une date (mountGoBack). Avant toute
// restauration, l'état repris est relu et rejoué, et la feuille dit ce qu'il contient.
// La cloche (D15) : « À faire » puis « Pour info », une ligne par message.
import { toCSV, openSpaceId } from '../core/store.js';
import { askIdentity } from './lock.js';
import { confirmSheet, menuSheet, openSheet, buzz, toast, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { esc, shortDate, iso, dayLabel, today, addDays } from '../core/format.js';
import { inspect, restore, verifyData, healPlan, heal, stateAt, firstDay, lastReturn, stay } from '../core/backup.js';
import { pickDate } from './pickers.js';
import { driveJournal } from '../core/cloud.js';
import { messages, markAllRead } from '../core/inbox.js';
import { googleAvailable, account } from '../core/google.js';
import { syncLine } from './google.js';
import { startOverFlow } from './spaces.js';
import { chooseSpace, reopen, spaces } from '../core/spaces.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML, sheetHead } from './parts.js';

const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' });
/** « Aujourd'hui, 9 h 17 », « Hier, 8 h 05 », « 3 nov., 18 h 00 » @param {string} at */
function when(at) {
  const d = new Date(at);
  const p = Object.fromEntries(fmtTime.formatToParts(d).map(x => [x.type, x.value]));
  const l = dayLabel(iso(d));
  return `${['Aujourd’hui', 'Hier'].includes(l) ? l : shortDate(iso(d))}, ${p.hour} h ${p.minute}`;
}
const opsLabel = n => `${n} opération${n > 1 ? 's' : ''}`;

/** @param {string} name @param {string} text @param {string} type */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** Sur le téléphone, le menu de partage d'Android (le téléchargement par lien n'y marche pas) ; sinon téléchargement. @param {string} name @param {string} text @param {string} type */
function shareFile(name, text, type) {
  const A = /** @type {any} */ (globalThis).BougetteAndroid;
  if (A && typeof A.shareFile === 'function') return !!A.shareFile(name, text);
  download(name, text, type);
  return true;
}

// Les contrôles de « Vérifier mes données », dits simplement : ce qui va, ce qui ne va pas (même ordre que session.verify).
const PLAIN = {
  'Chaîne d’empreintes': ['L’historique de tes changements est intact', 'L’historique de tes changements a été abîmé'],
  'Partie double': ['Chaque opération tombe juste', 'Une opération ne tombe pas juste, ou un montant a perdu son opération ou son portefeuille'],
  'Devises et comptes': ['Chaque portefeuille garde sa monnaie', 'Un montant n’est pas dans la monnaie de son portefeuille, ou il est sur un portefeuille supprimé'],
  'Soldes': ['Les soldes de tes portefeuilles sont justes', 'Un solde ne correspond pas à tes opérations'],
  'Projections': ['Ce que tu vois correspond à ton historique', 'Ce que tu vois ne correspond plus à ton historique'],
};
/** @param {{ name: string, ok: boolean, detail: string }[]} checks */
function checksHTML(checks) {
  const ok = checks.every(c => c.ok);
  const head = ok
    ? rowHTML({ tag: 'div', cls: 'rule', pill: `<span class="pill acc" style="color:var(--gain)">${icon('check-circle')}</span>`, title: 'Tout concorde', sub: 'Tes données sont saines.', subCls: 'wrap' })
    : rowHTML({ tag: 'div', cls: 'rule', pill: `<span class="pill acc" style="color:var(--loss)">${icon('warning')}</span>`, title: 'Un problème a été trouvé',
      sub: 'Rien n’est changé tant que tu ne répares pas.', subCls: 'wrap', end: '<button class="btn secondary sm" data-heal>Réparer</button>' });
  return head + checks.map(c => {
    const [good, bad] = /** @type {Record<string, string[]>} */ (PLAIN)[c.name] || [c.name, c.name];
    return `<div class="row" data-check="${c.ok ? 'ok' : 'ko'}"><span class="pill acc" style="color:var(--${c.ok ? 'gain' : 'loss'})">${icon(c.ok ? 'check' : 'warning')}</span><div class="main"><div class="s wrap">${esc(c.ok ? good : bad)}</div></div></div>`;
  }).join('');
}

/**
 * Réparer (2026-11-21, avec l'utilisateur) : un geste, l'app choisit ce qui est sain et garde le plus (core/backup.js
 * healPlan) ; la feuille dit d'où vient l'état repris et ce qui serait à refaire. @returns {Promise<boolean>}
 */
export async function healFlow() {
  const id = openSpaceId(); // commencé dans cet espace, il s'arrête si un autre s'ouvre entre-temps (D19)
  if (!(await askIdentity('Réparer mes données'))) return false;
  toast('Recherche d’une version saine…');
  let plan;
  try { const drive = await driveJournal(); stay(id); plan = await healPlan(drive); } catch (e) { console.error(e); }
  if (openSpaceId() !== id) return false;
  if (!plan) { toast('Aucune version saine à reprendre.'); return false; }
  const from = plan.from === 'drive' ? 'tes données de Google Drive' : plan.from === 'copy' ? `la copie ${when(/** @type {string} */ (plan.at)).toLowerCase()}` : 'ce qui est sur ce téléphone';
  const lost = plan.lost
    ? `${plan.lost} changement${plan.lost > 1 ? 's' : ''} noté${plan.lost > 1 ? 's' : ''} depuis ${when(/** @type {string} */ (plan.since)).toLowerCase()} ${plan.lost > 1 ? 'seront' : 'sera'} à refaire.`
    : 'Rien de ce que tu as noté n’est perdu.';
  if (!(await confirmSheet({ title: 'Réparer tes données ?', text: `On repart de ${from}. ${lost}`, yes: 'Réparer', danger: plan.lost > 0 }))) return false;
  if (openSpaceId() !== id) return false;
  try { await heal(plan); } catch (e) { toast(/** @type {Error} */ (e).message || 'Réparation impossible.'); return false; }
  buzz(12);
  toast('Réparé');
  return true;
}

/** Relit puis restaure un journal, après confirmation. @param {string} text @param {string} what */
async function askRestore(text, what) {
  const id = openSpaceId(); // comme Réparer : rien dans un autre espace ouvert entre-temps
  if (!(await askIdentity('Restaurer'))) return false;
  let info;
  try { info = await inspect(text); } catch (e) { toast(/** @type {Error} */ (e).message || 'Copie illisible.'); return false; }
  if (openSpaceId() !== id) return false;
  const ok = await confirmSheet({
    title: `Restaurer ${what} ?`,
    text: `${opsLabel(info.ops)}${info.last ? `, dernier changement ${when(info.last).toLowerCase()}` : ''}. Ce qui a été noté depuis sera remplacé.`,
    yes: 'Restaurer', danger: true,
  });
  if (!ok || openSpaceId() !== id) return false;
  try { await restore(text); } catch (e) { toast(/** @type {Error} */ (e).message || 'Restauration impossible.'); return false; }
  buzz(12);
  toast('Restauré');
  return true;
}

export function render(app, { back }) {
  const google = googleAvailable();
  app.innerHTML = `<div class="screen data-screen no-tabs">
    ${topbarHTML({ title: 'Données et sauvegarde' })}
    <p class="screen-help">Chaque jour où tu ouvres Bougette, tes données sont vérifiées et copiées sur ce téléphone. ${google ? 'Avec un compte Google, elles sont aussi sur Google Drive et sur tes autres appareils.' : ''}</p>

    ${google ? sectionHTML({ title: 'Sauvegarde', attrs: 'data-part="save"', body: `<div class="group">
        ${rowHTML({ attrs: 'data-google', pill: `<span class="pill acc">${icon('cloud-check')}</span>`, title: 'Google Drive',
          sub: esc(account() ? syncLine() : 'Garde tes données, retrouve-les partout'), subCls: 'wrap', end: `<span class="end">${icon('caret-right')}</span>` })}
      </div>` }) : ''}

    ${sectionHTML({ title: 'Données', attrs: 'data-part="data"', body: `<div class="group">
        ${rowHTML({ attrs: 'data-verify', pill: `<span class="pill acc">${icon('check-circle')}</span>`, title: 'Vérifier mes données', sub: 'Historique, opérations, soldes' })}
        <div data-checks></div>
        ${rowHTML({ cls: 'rule', attrs: 'data-csv', pill: `<span class="pill acc">${icon('download-simple')}</span>`, title: 'Exporter en CSV', sub: 'Un fichier lisible dans un tableur' })}
        ${rowHTML({ attrs: 'data-fresh', pill: `<span class="pill acc">${icon('arrow-counter-clockwise')}</span>`, title: 'Repartir de zéro',
          sub: 'Un nouvel espace vide. Celui-ci est archivé, rien n’est effacé', subCls: 'wrap' })}
      </div>` })}
  </div>`;

  // un résultat de « Vérifier mes données » ne vaut que pour les données vérifiées : il s'efface quand elles changent
  const clearChecks = () => { const h = $('[data-checks]', app); if (h) h.innerHTML = ''; };

  wireBack(app, () => back('#/reglages'));
  const googleRow = $('[data-google]', app);
  if (googleRow) googleRow.onclick = () => { buzz(6); location.hash = '#/reglages/google'; };
  $('[data-verify]', app).onclick = async () => {
    buzz(8);
    const host = $('[data-checks]', app);
    let checks;
    try { checks = await verifyData(); } catch (e) { console.error(e); toast('Vérification impossible. Réessaie.'); return; }
    host.innerHTML = checksHTML(checks);
    const h = $('[data-heal]', host);
    if (h) h.onclick = async () => { if (await healFlow()) clearChecks(); };
    toast(checks.every(c => c.ok) ? 'Tout concorde' : 'Un problème a été trouvé');
  };
  $('[data-csv]', app).onclick = async () => {
    buzz(6);
    if (!(await askIdentity('Exporter en CSV'))) return;
    if (shareFile(`bougette-${today()}.csv`, toCSV(), 'text/csv;charset=utf-8')) toast('Fichier CSV créé');
    else toast('Export impossible. Réessaie.');
  };
  $('[data-fresh]', app).onclick = () => startOverFlow();
}

/**
 * Revenir à une date, annuler le dernier retour (2026-11-21, avec l'utilisateur : dans la page Développeur seulement ;
 * pour tout le monde, un retour en arrière efface ce qui a été noté depuis et se comprend mal, une erreur se corrige par
 * la fiche › Modifier, des données abîmées par Réparer). Le journal arrêté à la fin d'un jour choisi au calendrier.
 * @param {HTMLElement} host
 */
export async function mountGoBack(host) {
  const paint = () => mountGoBack(host);
  // une date au choix, pas de liste (trop de lignes) ; juste après un retour, de quoi l'annuler
  const undo = await lastReturn().catch(() => null);
  const caret = `<span class="end">${icon('caret-right')}</span>`;
  host.innerHTML = `${rowHTML({ attrs: 'data-pick-day', pill: `<span class="pill acc">${icon('clock-counter-clockwise')}</span>`, title: 'Revenir à une date', sub: 'Tes données comme à la fin de ce jour-là', end: caret })}
    ${undo ? rowHTML({ attrs: 'data-undo', pill: `<span class="pill acc">${icon('arrow-counter-clockwise')}</span>`, title: 'Annuler le dernier retour',
      sub: `Comme avant le retour ${esc(when(undo.at).toLowerCase())}`, end: caret }) : ''}`;
  $('[data-pick-day]', host).onclick = async () => {
    buzz(6);
    const first = await firstDay();
    if (!first) { toast('Rien n’a encore été noté.'); return; }
    const day = await pickDate({ current: addDays(today(), -1), title: 'Revenir à quel jour ?', min: first });
    if (!day) return;
    let st;
    try { st = await stateAt(day); } catch (e) { toast('Ce jour-là est abîmé. Utilise Réparer.'); return; }
    if (!st) { toast('Rien n’a changé depuis ce jour-là.'); return; }
    const name = dayLabel(day) === 'Hier' ? 'tes données d’hier soir' : `tes données du ${shortDate(day)} au soir`;
    if (await askRestore(st.text, name)) paint();
  };
  const u = $('[data-undo]', host);
  if (u && undo) u.onclick = async () => { if (await askRestore(undo.text, 'tes données d’avant le dernier retour')) paint(); };
}

/** Messages de la cloche. Les ouvrir les marque lus. */
export function openInboxSheet() {
  const list = messages();
  // piste B (2026-11-21, avec l'utilisateur, D15 ; les cartes de la piste A chargeaient trop) : une ligne par message,
  // un point de couleur (rouge problème, ambre à faire, vert réussite, gris information), le titre, une phrase pâle
  // dessous, le geste en lien sur sa propre ligne, calé à droite, avec un chevron ; une ligne de séparation entre deux messages. « À faire » : ce qui attend un geste, les problèmes d'abord ; « Pour info » : le reste.
  const DOT = { error: 'var(--loss)', warn: 'var(--c3)', ok: 'var(--gain)', info: 'var(--ink-3)' };
  const items = list.map((m, i) => ({ m, i }));
  const todo = items.filter(({ m }) => m.kind === 'error' || m.kind === 'warn' || (m.kind === 'ok' && m.action))
    .sort((a, b) => Number(b.m.kind === 'error') - Number(a.m.kind === 'error'));
  const info = items.filter(x => !todo.includes(x));
  const msgHTML = (/** @type {{ m: import('../core/inbox.js').Message, i: number }} */ { m, i }) =>
    `<div class="im-row${m.read ? '' : ' new'}"><span class="im-dot" style="--c:${DOT[m.kind] || DOT.info}"></span>
      <div class="im-main"><div class="im-t">${esc(m.title)}</div>${m.body ? `<div class="im-s">${esc(m.body)}</div>` : ''}
      ${m.action ? `<button type="button" class="im-go" data-act="${i}" aria-label="${esc(m.action.label)} : ${esc(m.title)}">${esc(m.action.label)}${icon('caret-right')}</button>` : ''}</div></div>`;
  const s = openSheet(`${sheetHead({ title: 'Notifications' })}
    ${list.length ? `${todo.length ? `<h3 class="im-h">À faire</h3><div class="im-list">${todo.map(msgHTML).join('')}</div>` : ''}
      ${info.length ? `<h3 class="im-h">Pour info</h3><div class="im-list">${info.map(msgHTML).join('')}</div>` : ''}`
      : '<p class="muted im-none">Rien de nouveau.</p>'}`, { label: 'Notifications' });
  markAllRead();
  $$('[data-act]', s.el).forEach(b => (b.onclick = async () => {
    const m = list[Number(b.dataset.act)];
    if (!m || !m.action) return;
    s.close();
    if (m.action.id === 'heal') setTimeout(healFlow, 280);
    // un autre espace abîmé : l'ouvrir (on le répare de là)
    else if (m.action.id.startsWith('space:')) {
      const id = m.action.id.slice(6);
      if (spaces().some(x => x.id === id)) { chooseSpace(id); reopen(); }
    }
    else if (m.action.id === 'google') setTimeout(() => { location.hash = '#/reglages/google'; }, 280);
    else if (m.action.id === 'review') setTimeout(() => { location.hash = '#/a-revoir'; }, 280);
    else if (m.action.id === 'update') setTimeout(() => window.dispatchEvent(new CustomEvent('bougette:open-update')), 280);
    else if (m.action.id === 'assign') setTimeout(() => { location.hash = '#/mois'; }, 280);
    else if (m.action.id === 'savings') setTimeout(() => { location.hash = '#/epargne'; }, 280);
    // une réserve prête (2026-11-19) : « Tu la dépenses quand ? »
    else if (m.action.id.startsWith('when:')) {
      const id = m.action.id.slice(5);
      setTimeout(() => window.dispatchEvent(new CustomEvent('bougette:reserve', { detail: { id } })), 280);
    }
  }));
}
