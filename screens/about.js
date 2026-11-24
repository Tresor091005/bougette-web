// Moi › À propos (2026-11-24, avec l'utilisateur) : la confidentialité et les conditions d'utilisation (lisibles hors
// ligne, les mêmes textes que les pages publiques du site), l'aide (signaler un problème, proposer une idée : WhatsApp,
// un message prérempli avec la version et le modèle du téléphone, jamais les données), les licences, la version.
// Les guides d'utilisation viendront plus tard.
import { icon } from '../core/icons.js';
import { buzz, toast, $ } from '../core/ui.js';
import { esc } from '../core/format.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML } from './parts.js';
import { PRIVACY, TERMS, LICENSES, SITE, UPDATED, SUPPORT_WHATSAPP } from '../core/legal.js';
import { APP_VERSION } from '../data/session.js';
import { versionTaps } from './developer.js';

/** Le modèle du téléphone, d'après le navigateur (« Infinix X669 »), sinon « web ». */
function device() {
  const m = /Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent);
  return m ? m[1].trim() : /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'web';
}
/** Ouvre une adresse hors de l'app (WhatsApp, le site) : Android par son pont, sinon le navigateur. @param {string} url */
export function openExternal(url) {
  const a = /** @type {any} */ (globalThis).BougetteAndroid;
  try {
    if (a?.openUrl) { if (!a.openUrl(url)) toast('Impossible d’ouvrir le lien.'); return; }
  } catch (e) { /* le navigateur */ }
  window.open(url, '_blank', 'noopener');
}
/** WhatsApp, message prérempli. @param {'bug'|'idea'} kind */
function writeUs(kind) {
  const head = kind === 'bug' ? 'Bougette · un problème' : 'Bougette · une idée';
  const ask = kind === 'bug' ? 'Ce qui se passe :' : 'Mon idée :';
  const text = `${head}\nVersion : v ${APP_VERSION}\nAppareil : ${device()}\n\n${ask}\n`;
  openExternal(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`);
}

const ROW = (/** @type {string} */ attrs, /** @type {string} */ ic, /** @type {string} */ t, /** @type {string} */ s = '') =>
  rowHTML({ attrs, pill: `<span class="pill acc">${icon(ic)}</span>`, title: t, sub: s, end: `<span class="end">${icon('caret-right')}</span>` });

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void, go: (h: string) => void }} ctx */
export function render(app, { back, go }) {
  app.innerHTML = `<div class="screen settings no-tabs about-screen">
    ${topbarHTML({ title: 'À propos' })}
    ${sectionHTML({ title: 'Aide', body: `<div class="group">
      ${ROW('data-bug', 'bug', 'Signaler un problème', 'Sur WhatsApp, avec la version de l’app')}
      ${ROW('data-idea', 'lightbulb', 'Proposer une idée', 'Sur WhatsApp')}
    </div>` })}
    ${sectionHTML({ title: 'Règles', body: `<div class="group">
      ${ROW('data-go="#/reglages/confidentialite"', 'shield-check', 'Confidentialité', 'Tes données restent à toi')}
      ${ROW('data-go="#/reglages/conditions"', 'scales', 'Conditions d’utilisation', 'Les règles, en cinq points')}
      ${ROW('data-go="#/reglages/licences"', 'file-text', 'Licences', 'Icônes, polices et bibliothèques')}
    </div>` })}
    <div class="about">${icon('logo')}<b>Bougette</b><span data-version>v ${esc(APP_VERSION)}</span></div>
  </div>`;
  wireBack(app, () => back('#/reglages'));
  // sept touchers sur la version ouvrent Développeur (le logo et la version ne sont plus qu'ici, 2026-11-24)
  versionTaps(/** @type {HTMLElement} */ ($('.about [data-version]', app)));
  $('[data-bug]', app).onclick = () => { buzz(6); writeUs('bug'); };
  $('[data-idea]', app).onclick = () => { buzz(6); writeUs('idea'); };
  app.querySelectorAll('[data-go]').forEach(b => (/** @type {HTMLElement} */ (b).onclick = () => { buzz(6); go(/** @type {string} */ (/** @type {HTMLElement} */ (b).dataset.go)); }));
}

/**
 * Une page de texte (confidentialité, conditions ; revue le 2026-11-24, avec l'utilisateur : « vilaines ») : en tête son
 * icône et ce qu'elle dit en une phrase ; chaque partie avec son icône, un titre et son texte, séparées d'un filet ; en
 * bas, la date et le lien vers la page publique.
 * @param {string} title @param {import('../core/legal.js').LegalDoc} doc @param {string} page la page publique
 */
function textScreen(title, doc, page) {
  return {
    /** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
    render(app, { back }) {
      app.innerHTML = `<div class="screen settings no-tabs legal-screen">
        ${topbarHTML({ title })}
        <div class="lg-hero"><span class="lg-badge">${icon(doc.icon)}</span><p>${doc.lead}</p></div>
        <div class="lg-list">${doc.sections.map(s => `<section class="lg-sec"><span class="pill acc">${icon(s.icon || 'info')}</span>
          <div class="lg-body"><h2>${s.title}</h2>${s.html}</div></section>`).join('')}</div>
        <p class="lg-foot">Mis à jour le ${UPDATED}<button class="link" data-web>Voir sur le site</button></p>
      </div>`;
      wireBack(app, () => back('#/reglages/a-propos'));
      $('[data-web]', app).onclick = () => openExternal(SITE + page);
    },
  };
}
export const privacyScreen = textScreen('Confidentialité', PRIVACY, 'confidentialite.html');
export const termsScreen = textScreen('Conditions d’utilisation', TERMS, 'conditions.html');
export const licensesScreen = {
  /** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
  render(app, { back }) {
    app.innerHTML = `<div class="screen settings no-tabs legal-screen">
      ${topbarHTML({ title: 'Licences' })}
      <p class="lg-lead">Bougette embarque ces icônes, polices et bibliothèques libres. Merci à leurs auteurs.</p>
      ${sectionHTML({ body: `<div class="group plain">${LICENSES.map(l => rowHTML({ tag: 'div', title: esc(l.name), sub: `${esc(l.by)} · ${esc(l.license)}`, subCls: 'wrap' })).join('')}</div>` })}
    </div>`;
    wireBack(app, () => back('#/reglages/a-propos'));
  },
};
