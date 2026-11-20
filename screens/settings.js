// Moi (onglet, D9) : « Mon argent » (Portefeuilles, Catégories, Monnaie et format), « L'app » (début du mois, affichage,
// données et sauvegarde), « Outils » (Développeur). Données et sauvegarde et Développeur sont des pages (2026-11-09). Chaque ligne ouvre son écran ou sa feuille. Pas de compte : tout reste sur le
// téléphone.
import { settings, setSettings, totalBalance, uiStyle } from '../core/store.js';
import { currency, money, ordinal, esc } from '../core/format.js';
import { currentSpace } from '../core/spaces.js';
import { icon } from '../core/icons.js';
import { openSheet, buzz, switchHTML, $, $$ } from '../core/ui.js';
import { pickMonthStart, monthStartLabel } from './pickers.js';
import { openSpacesSheet } from './spaces.js';
import { spaceAvatar } from '../core/avatar.js';
import { APP_VERSION } from '../data/session.js';
import { listCopies } from '../core/backup.js';
import { lockEnabled } from '../core/lock.js';
import { googleAvailable, account } from '../core/google.js';
import { syncLine } from './google.js';
import { versionLabel, updateAvailable, checkUpdate, installUpdate, installDownloaded, autoUpdate, setAutoUpdate } from '../core/update.js';

// le numéro de version en clair (D20 : une version porte sa date et son heure)
const VERSION = versionLabel(APP_VERSION);

// Affichage : mode discret, vibrations, opérations annulées (appliqués tout de suite).
/**
 * Mises à jour (D20) : chercher la dernière version publiée ; plus récente, ses notes, sa taille, puis « Télécharger et
 * installer » (une copie de sécurité d'abord, puis l'installation d'Android). Le seul accès à internet de l'app.
 */
export function openUpdateSheet(/** @type {any} */ preset = null) {
  const s = openSheet(`<div class="confirm upd">
    <h2 class="sheet-title">Mises à jour</h2>
    <p class="muted" data-u>Tu as la version du ${esc(VERSION)}.</p>
    <p class="field-note">Chercher une mise à jour est le seul moment où Bougette va sur internet : rien n'est envoyé, l'app regarde seulement s'il y a une version plus récente.</p>
    <button class="row" data-auto style="margin:4px 0 10px"><div class="main"><div class="t">Chercher tout seul</div><div class="s">Une fois par jour, à l'ouverture</div></div>${switchHTML(autoUpdate())}</button>
    <button class="btn primary" data-go>Chercher une mise à jour</button>
    <button class="btn ghost" data-no>Fermer</button></div>`, { cls: 'compact', label: 'Mises à jour' });
  const msg = /** @type {HTMLElement} */ ($('[data-u]', s.el)), go = /** @type {HTMLButtonElement} */ ($('[data-go]', s.el));
  $('[data-no]', s.el).onclick = () => s.close();
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
    if (waitingPermission) { if (!installDownloaded()) { msg.textContent = 'Le fichier téléchargé n’est plus là : recommence.'; waitingPermission = false; go.textContent = 'Chercher une mise à jour'; } return; }
    if (found?.url) {
      go.disabled = true;
      try {
        const r = await installUpdate(found.url, (step, pct) => {
          if (step === 'copy') msg.textContent = 'Copie de sécurité de tes données…';
          else if (step === 'progress') msg.textContent = pct != null && pct >= 0 ? `Téléchargement… ${pct} %` : 'Téléchargement…';
          else if (step === 'ready') msg.textContent = 'Installation… L’app va se fermer : rouvre-la. Tes données restent. (La première fois, Android demande de confirmer.)';
        });
        if (r === 'permission') {
          waitingPermission = true;
          msg.textContent = 'Autorise Bougette à installer des apps (une seule fois), reviens ici, puis touche Installer.';
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
      if (u.none) msg.textContent = 'Aucune version publiée pour l’instant.';
      else if (!u.newer) msg.textContent = `Tu as déjà la dernière version (du ${esc(VERSION)}).`;
      else show(u);
    } catch (e) { msg.textContent = /** @type {Error} */ (e).message; }
    go.disabled = false;
  };
}

export function render(app, { go }) {
  const st = settings();
  const cur = currency();
  const row = (attr, ic, t, s) => `<button class="row" ${attr}><span class="pill acc">${icon(ic)}</span>
    <div class="main"><div class="t">${t}</div><div class="s">${s}</div></div><span class="end">${icon('caret-right')}</span></button>`;
  const display = [uiStyle() === 'proto' ? 'Proto' : 'Carnet', st.discreet ? 'Mode discret' : 'Montants visibles', st.haptics ? 'vibrations' : '', st.showVoided ? 'annulées visibles' : ''].filter(Boolean).join(' · ');

  // l'espace en tête (D19, revu le 2026-11-19, avec l'utilisateur : la ligne « Espace » était trop cachée) : sa tête, son
  // nom dessous ; la toucher ouvre la liste des espaces, un toucher en ouvre un autre
  const space = currentSpace();
  app.innerHTML = `<div class="screen settings">
    <h1 class="me-title">Moi</h1>
    <button type="button" class="me-space" data-spaces aria-label="Espace ${esc(space.name)} : changer d’espace">
      <span class="me-ava" aria-hidden="true">${spaceAvatar(space)}</span>
      <span class="me-name">${esc(space.name)}${icon('caret-down')}</span>
    </button>

    <section class="section"><div class="section-h"><span class="eyebrow">Mon argent</span></div>
      <div class="group">
        ${row('data-go="#/portefeuilles"', 'wallet', 'Portefeuilles', money(totalBalance()))}
        ${row('data-go="#/reglages/categories"', 'tag', 'Catégories', 'Ranger, créer, archiver')}
        ${row('data-go="#/reglages/monnaie"', 'coin', 'Monnaie et format', `${cur.long} · ${money(1234567, { hide: false })}`)}
      </div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">L’app</span></div>
      <div class="group">
        ${row('data-start', 'calendar-blank', 'Début du mois', `${monthStartLabel(st.monthStart)} de chaque mois`)}
        ${row('data-display', 'eye', 'Affichage', display)}
        ${row('data-go="#/reglages/verrou"', 'lock-simple', 'Verrouillage', lockEnabled() ? 'Activé' : 'Désactivé')}
        ${updateAvailable() ? row('data-update', 'download-simple', 'Mises à jour', `Version du ${esc(VERSION)}`) : ''}
        ${googleAvailable() ? row('data-go="#/reglages/google"', 'cloud-check', 'Compte Google', esc(syncLine())) : ''}
        ${row('data-go="#/reglages/donnees"', 'shield-check', 'Données et sauvegarde', '<span data-backup-s>Copies vérifiées, restaurer, export CSV</span>')}
      </div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Outils</span></div>
      <div class="group">
        ${row('data-go="#/reglages/dev"', 'code', 'Développeur', 'Intégrité, export du journal, opérations annulées')}
      </div></section>

    <div class="about">${icon('logo')}<b>Bougette</b>Version du ${VERSION} · fonctionne hors ligne<br>${account() ? 'Tes données restent sur ce téléphone et dans ton Google Drive.' : 'Tes données restent sur ce téléphone.'}</div>
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
  listCopies().then(list => {
    const el = $('[data-backup-s]', app);
    if (el && list[0]) el.textContent = `Dernière copie : ${new Date(list[0].at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '')}, vérifiée`;
  }).catch(() => {});
}
