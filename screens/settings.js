// Moi (onglet, D9) : « Mon argent » (Portefeuilles, Catégories, Monnaie et format), « L'app » (début du mois, affichage,
// verrouillage, mises à jour, données et sauvegarde). Chaque ligne ouvre son écran ou sa feuille. Pas de compte : tout
// reste sur le téléphone. La page Développeur est cachée (2026-11-21) : sept touchers sur la version (pied de page, ou
// feuille Mises à jour) l'ouvrent ; ensuite, sur ce téléphone, sa ligne apparaît dans « Outils ».
import { settings, setSettings, totalBalance, uiStyle } from '../core/store.js';
import { currency, money, ordinal, esc } from '../core/format.js';
import { currentSpace } from '../core/spaces.js';
import { icon } from '../core/icons.js';
import { openSheet, buzz, switchHTML, $, $$ } from '../core/ui.js';
import { pickMonthStart, monthStartLabel } from './pickers.js';
import { openSpacesSheet } from './spaces.js';
import { spaceAvatar } from '../core/avatar.js';
import { APP_VERSION } from '../data/session.js';
import { hasCode, lockAtOpen } from '../core/lock.js';
import { googleAvailable, account } from '../core/google.js';
import { syncLine } from './google.js';
import { reviewItems } from '../core/review.js';
import { versionTaps, devUnlocked } from './developer.js';
import { rowHTML, sectionHTML, sheetHead } from './parts.js';
import { versionLabel, updateAvailable, checkUpdate, installUpdate, installDownloaded, autoUpdate, setAutoUpdate } from '../core/update.js';

// le numéro de version en clair (D20 : une version porte sa date et son heure)
const VERSION = versionLabel(APP_VERSION);

/**
 * Mises à jour (D20) : chercher la dernière version publiée ; plus récente, ses notes, sa taille, puis « Télécharger et
 * installer » (une copie de sécurité d'abord, puis l'installation d'Android). Le seul accès à internet de l'app.
 */
export function openUpdateSheet(/** @type {any} */ preset = null) {
  const s = openSheet(`<div class="confirm upd">
    ${sheetHead({ title: 'Mises à jour' })}
    <p class="muted" data-u data-version>Tu as la version du ${esc(VERSION)}.</p>
    <p class="muted upd-note">Bougette regarde seulement s’il y a une version plus récente : rien n’est envoyé.</p>
    ${rowHTML({ attrs: 'data-auto', title: 'Chercher tout seul', sub: 'Une fois par jour, à l’ouverture', end: switchHTML(autoUpdate()) })}
    <button class="btn primary" data-go>Chercher une mise à jour</button>
    <button class="btn ghost" data-no>Fermer</button></div>`, { label: 'Mises à jour' });
  const msg = /** @type {HTMLElement} */ ($('[data-u]', s.el)), go = /** @type {HTMLButtonElement} */ ($('[data-go]', s.el));
  $('[data-no]', s.el).onclick = () => s.close();
  versionTaps(msg, () => s.close());
  const auto = /** @type {HTMLElement} */ ($('[data-auto]', s.el));
  auto.onclick = () => { const on = !autoUpdate(); setAutoUpdate(on); auto.querySelector('.switch')?.classList.toggle('on', on); buzz(8); };
  /** @type {{ url?: string }|null} */
  let found = null, waitingPermission = false;
  // ouverte depuis le message « Nouvelle version · Installer » (recherche du jour) : la version est déjà là
  const show = (/** @type {any} */ u) => {
    found = u;
    const mo = u.size ? ` · ${Math.round(u.size / 1e6)} Mo` : '';
    msg.innerHTML = `<b>Version du ${esc(versionLabel(u.tag || ''))}</b>${mo}${u.notes ? `<br>${esc(u.notes).replace(/\n/g, '<br>')}` : ''}`;
    go.textContent = 'Télécharger et installer';
  };
  if (preset?.newer) show(preset);
  go.onclick = async () => {
    buzz(8);
    if (waitingPermission) { if (!installDownloaded()) { msg.textContent = 'La mise à jour téléchargée n’est plus là : recommence.'; waitingPermission = false; go.textContent = 'Chercher une mise à jour'; } return; }
    if (found?.url) {
      go.disabled = true;
      try {
        const r = await installUpdate(found.url, (step, pct) => {
          if (step === 'copy') msg.textContent = 'Copie de sécurité de tes données…';
          else if (step === 'progress') msg.textContent = pct != null && pct >= 0 ? `Téléchargement… ${pct} %` : 'Téléchargement…';
          else if (step === 'ready') msg.textContent = 'Installation… L’app va se fermer : rouvre-la ensuite. Tes données restent. Android peut te demander de confirmer.';
        });
        if (r === 'permission') {
          waitingPermission = true;
          msg.textContent = 'Autorise Bougette à installer des apps (une seule fois), puis reviens et touche Installer.';
          go.textContent = 'Installer';
        }
      } catch (e) { msg.textContent = /** @type {Error} */ (e).message; }
      go.disabled = false;
      return;
    }
    go.disabled = true;
    msg.textContent = 'Recherche…';
    try {
      const u = await checkUpdate();
      if (u.none) msg.textContent = 'Aucune version publiée.';
      else if (!u.newer) msg.textContent = `Tu as déjà la dernière version (du ${esc(VERSION)}).`;
      else show(u);
    } catch (e) { msg.textContent = /** @type {Error} */ (e).message; }
    go.disabled = false;
  };
}

export function render(app, { go }) {
  const st = settings();
  const cur = currency();
  const caret = `<span class="end">${icon('caret-right')}</span>`;
  const row = (attrs, ic, title, sub) => rowHTML({ attrs, pill: `<span class="pill acc">${icon(ic)}</span>`, title, sub, end: caret });
  const display = [uiStyle() === 'proto' ? 'Proto' : 'Carnet', st.haptics ? 'vibrations' : '', st.showVoided ? 'annulées visibles' : ''].filter(Boolean).join(' · ');

  // l'espace en tête (D19, revu le 2026-11-19, avec l'utilisateur : la ligne « Espace » était trop cachée) : sa tête, son
  // nom dessous ; la toucher ouvre la liste des espaces, un toucher en ouvre un autre
  const space = currentSpace();
  app.innerHTML = `<div class="screen settings">
    <h1 class="me-title">Moi</h1>
    <button type="button" class="me-space" data-spaces aria-label="Espace ${esc(space.name)} : changer d’espace">
      <span class="me-ava" aria-hidden="true">${spaceAvatar(space)}</span>
      <span class="me-name">${esc(space.name)}${icon('caret-down')}</span>
    </button>
    ${reviewItems().length ? sectionHTML({ cls: 'me-sync-s', body: `<div class="group">${rowHTML({ cls: 'rv-alert', attrs: 'data-go="#/a-revoir"', pill: `<span class="pill">${icon('warning')}</span>`, title: 'À revoir',
      sub: reviewItems().length === 1 ? 'Un changement n’a pas été gardé' : `${reviewItems().length} changements n’ont pas été gardés`, end: caret })}</div>` }) : ''}
    ${googleAvailable() ? sectionHTML({ cls: 'me-sync-s', body: `<div class="group">${row('data-go="#/reglages/google"', 'cloud-check', 'Google Drive', esc(account() ? syncLine() : 'Garde tes données, retrouve-les partout'))}</div>` }) : ''}

    ${sectionHTML({ title: 'Mon argent', body: `
      <div class="group">
        ${row('data-go="#/portefeuilles"', 'wallet', 'Portefeuilles', money(totalBalance()))}
        ${row('data-go="#/reglages/categories"', 'tag', 'Catégories', 'Ranger, créer, archiver')}
        ${row('data-start', 'calendar-blank', 'Début du mois', `${monthStartLabel(st.monthStart)} de chaque mois`)}
        ${row('data-go="#/reglages/monnaie"', 'coin', 'Monnaie et format', `${cur.long} · ${money(1234567)}`)}
      </div>` })}

    ${sectionHTML({ title: 'L’app', body: `
      <div class="group">
        ${row('data-display', 'eye', 'Affichage', display)}
        ${row('data-go="#/reglages/verrou"', 'lock-simple', 'Verrouillage', !hasCode() ? 'Pas de code' : lockAtOpen() ? 'Code demandé à l’ouverture' : 'Code choisi')}
        ${row('data-go="#/reglages/donnees"', 'shield-check', 'Données et sauvegarde', 'Vérifier, exporter, repartir de zéro')}
        ${updateAvailable() ? row('data-update', 'download-simple', 'Mises à jour', `Version du ${esc(VERSION)}`) : ''}
        ${row('data-go="#/reglages/a-propos"', 'info', 'À propos', 'Aide, confidentialité, conditions')}
      </div>` })}

    ${devUnlocked() ? sectionHTML({ title: 'Outils', body: `
      <div class="group">
        ${row('data-go="#/reglages/dev"', 'code', 'Développeur', 'Démo, accueil guidé, messages, retour en arrière')}
      </div>` }) : ''}

  </div>`;

  $$('[data-go]', app).forEach(b => (b.onclick = () => go(b.dataset.go)));
  $('[data-spaces]', app).onclick = () => { buzz(6); openSpacesSheet({ go }); };
  $('[data-start]', app).onclick = async () => {
    const d = await pickMonthStart(st.monthStart);
    if (d && d !== st.monthStart) setSettings({ monthStart: d });
  };
  $('[data-display]', app).onclick = () => go('#/reglages/affichage');
  const up = $('[data-update]', app);
  if (up) up.onclick = () => { buzz(6); openUpdateSheet(); };
}
