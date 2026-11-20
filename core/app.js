// Coquille de Bougette : routeur par adresse (#/ Accueil, #/operations Journal, #/mois Budget, #/reglages Moi, et depuis
// Moi #/portefeuilles, #/reglages/monnaie, #/reglages/categories ; #/bienvenue ; les anciennes #/budgets et #/analyses
// mènent à #/mois),
// dock flottant (D9) avec bouton + central, rendu à chaque changement des données.
import { settings, subscribe, setErrorHandler, storageProblem, budgetReport, uiStyle, syncAppIcon, applyLook, savingsAccounts, savingsReport, duesToLook } from './store.js';
import { icon } from './icons.js';
import { spaceGlyph } from './avatar.js';
import { currentSpace } from './spaces.js';
import { closeAllSheets, closeTopSheet, sheetOpen, buzz, toast, dockTip, paintDockTip } from './ui.js';
import { openEntry } from '../screens/entry.js';
import { dailyCopy, copyOtherSpaces } from './backup.js';
import { checkReserves } from './reserve-alerts.js';
import { checkDues } from './due-alerts.js';
import { onInbox, unread } from './inbox.js';
import * as home from '../screens/home.js';
import * as ops from '../screens/transactions.js';
import * as month from '../screens/month.js';
import * as reservesScreen from '../screens/reserves.js';
import { categoryScreen, allScreen } from '../screens/budget-cats.js';
import { duePage } from '../screens/due-page.js';
import { allDuesScreen } from '../screens/dues-ui.js';
import * as accountsScreen from '../screens/accounts.js';
import * as settingsScreen from '../screens/settings.js';
import { openUpdateSheet } from '../screens/settings.js';
import { autoCheck } from './update.js';
import * as currencyScreen from '../screens/currency.js';
import * as displayScreen from '../screens/display.js';
import * as categoriesScreen from '../screens/categories.js';
import * as onboarding from '../screens/onboarding.js';
import * as dataScreen from '../screens/backup.js';
import * as devScreen from '../screens/developer.js';
import * as lockScreen from '../screens/lockpage.js';
import * as spacesScreen from '../screens/spaces.js';
import { takeThen, isDemo } from './spaces.js';
import { loadDemo } from './devtools.js';
import { showLock, isLocked } from '../screens/lock.js';
import { AWAY_MS } from './lock.js';

const app = document.getElementById('app');
// Refus du domaine ou écriture impossible : le cache n'a pas changé, on dit pourquoi.
setErrorHandler(msg => toast(msg));
const ROUTES = {
  '': { mod: home, tab: 'home' },
  operations: { mod: ops, tab: 'ops' },
  mois: { mod: month, tab: 'month' },
  // Épargne et réserves (D17), ouverte depuis Budget
  epargne: { mod: reservesScreen },
  // Plan (ex-Budget), budget par catégorie : la page d'une catégorie (budgets, opérations) et l'arbre entier
  'mois/categorie': { mod: categoryScreen },
  'mois/categories': { mod: allScreen },
  // la page d'une échéance (D18, une page et non plus une feuille depuis le 2026-11-12) et toutes les échéances, ouvertes
  // depuis Plan
  'mois/echeance': { mod: duePage },
  'mois/echeances': { mod: allDuesScreen },
  // toutes les réserves et toute l'épargne (2026-11-12) : les pages des sections de Plan, comme « Tous les budgets »
  'mois/reserves': { mod: month.allReservesScreen },
  'mois/epargne': { mod: month.allSavingsScreen },
  // « Moi » (D9) est un onglet ; ce qui s'y ouvre (portefeuilles, monnaie, catégories) est une page avec un retour
  reglages: { mod: settingsScreen, tab: 'me' },
  portefeuilles: { mod: accountsScreen },
  'reglages/monnaie': { mod: currencyScreen },
  'reglages/affichage': { mod: displayScreen },
  'reglages/categories': { mod: categoriesScreen },
  'reglages/donnees': { mod: dataScreen },
  'reglages/dev': { mod: devScreen },
  'reglages/verrou': { mod: lockScreen },
  // espaces de données (D19)
  'reglages/espaces': { mod: spacesScreen },
  bienvenue: { mod: onboarding },
};
// anciennes adresses : Budgets et Analyses ne sont plus des onglets (D9), leur contenu vit dans Mois
const REDIRECTS = { budgets: 'mois', analyses: 'mois', comptes: 'portefeuilles' };
// Dock (D9) : Accueil · Journal · + · Budget · Moi ; l'onglet actif en graisse fill (D7).
const TABS = [
  { id: 'home', href: '#/', label: 'Accueil', icon: 'house' },
  { id: 'ops', href: '#/operations', label: 'Journal', icon: 'notebook' },
  null, // bouton +
  { id: 'month', href: '#/mois', label: 'Plan', icon: 'target' },
  { id: 'me', href: '#/reglages', label: 'Moi', icon: 'user' },
];

// --- navigation ---
const routeName = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || '');
// depth : nombre de pages empilées par go() (sans replace) ; back() y revient, sinon remplace par fallback.
let depth = 0;
export function go(hash, { replace = false } = {}) {
  if (replace) location.replace(hash);
  else { depth++; location.hash = hash; }
}
export function back(fallback = '#/') {
  if (depth > 0) { depth--; history.back(); }
  else go(fallback, { replace: true });
}

let current = null; // { name, mod, cleanup }
function render({ keepScroll = false } = {}) {
  let name = routeName();
  const onboarded = settings().onboarded;
  if (!onboarded && name !== 'bienvenue') { go('#/bienvenue', { replace: true }); return; }
  if (onboarded && name === 'bienvenue') { go('#/', { replace: true }); return; }
  if (REDIRECTS[name]) { go('#/' + REDIRECTS[name], { replace: true }); return; }
  if (!ROUTES[name]) name = '';
  const route = ROUTES[name];
  const same = current && current.name === name;
  const y = window.scrollY;
  if (current && current.cleanup) current.cleanup();
  const ctx = { go, back, openEntry, refresh: () => render({ keepScroll: true }) };
  app.innerHTML = '';
  if (!same) dockTip(null);
  const cleanup = route.mod.render(app, ctx);
  current = { name, mod: route.mod, cleanup };
  if (same && keepScroll) {
    const s = app.querySelector('.screen');
    if (s) /** @type {HTMLElement} */ (s).style.animation = 'none';
    window.scrollTo(0, y);
  } else window.scrollTo(0, 0);
  renderTabbar(route.tab);
}

let dock = null;
// Pastille de l'onglet Budget (2026-11-10) : seulement pour des faits objectifs, tant qu'ils durent — un budget dépassé,
// une réserve échue (pas remplie) ou pour laquelle rien n'est prévu, une épargne en négatif (D17 revu le 2026-11-20). Pas « argent à répartir » (une décision à prendre, rappelée par la cloche), pas de
// clignotement.
function budgetNeedsLook() {
  try {
    if (!settings().onboarded) return false;
    if (budgetReport().over.length) return true;
    // une échéance du jour ou en retard (D18), rentrées comprises : Confirmer reste à faire
    if (duesToLook().length) return true;
    // épargne : réserve échue pas remplie ou sans rien de prévu, solde négatif ; pas « Prête … trop tard » ni « Il manquera … », ni l'objectif (D17)
    return savingsAccounts().some(a => {
      if (a.archived) return false;
      const r = savingsReport(a.id);
      return r.free < 0 || r.reserves.some(v => v.status === 'none' || v.status === 'overdue');
    });
  } catch (e) { console.error(e); return false; }
}
function renderTabbar(active) {
  if (!active) { if (dock) dock.hidden = true; return; }
  if (!dock) {
    dock = document.createElement('div');
    dock.className = 'dock-wrap';
    dock.innerHTML = `<nav class="dock" aria-label="Navigation">${TABS.map(t => (t
      ? `<a class="tab" href="${t.href}" data-tab="${t.id}" aria-label="${t.label}"></a>`
      : `<button class="fab" type="button" aria-label="Ajouter une opération" data-fab>${icon('plus')}</button>`)).join('')}</nav>
      <svg class="dock-defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="ava-line" x="-10%" y="-10%" width="120%" height="120%">
        <feMorphology in="SourceGraphic" operator="erode" radius="7" result="in"/><feComposite in="SourceGraphic" in2="in" operator="out"/></filter></svg>`;
    document.body.appendChild(dock);
    dock.querySelector('[data-fab]').addEventListener('click', () => { buzz(8); dockTip(null); openEntry({}); });
    dock.addEventListener('click', e => {
      const a = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('a.tab'));
      if (!a) return;
      e.preventDefault();
      if (location.hash === a.getAttribute('href') || (a.dataset.tab === 'home' && routeName() === '')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      buzz(6);
      go(a.getAttribute('href'), { replace: true });
    });
  }
  dock.hidden = false;
  dock.querySelectorAll('.tab').forEach(a => {
    const on = a.dataset.tab === active;
    const t = TABS.find(x => x && x.id === a.dataset.tab);
    // l'icône change avec l'onglet actif et avec le style (Proto : Solar, D1)
    const key = `${on}:${document.documentElement.dataset.style}`;
    // l'onglet Moi porte la tête de l'espace ouvert (D19, 2026-11-19) : on sait toujours dans quel espace on est
    if (a.dataset.on !== key) { a.innerHTML = t.id === 'me' ? `<span class="tab-ava">${spaceGlyph(currentSpace())}</span>` : icon(t.icon, '', on ? 'fill' : 'regular'); a.dataset.on = key; }
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (a.dataset.tab === 'month') {
      const look = budgetNeedsLook();
      a.classList.toggle('alert', look);
      a.setAttribute('aria-label', look ? `${t.label} (à regarder)` : t.label);
    }
  });
  paintDockTip();
}

// Bouton retour Android (appelé par MainActivity) : ferme la feuille, sinon remonte vers l'accueil ;
// renvoie false à l'accueil pour laisser Android quitter l'app. Un écran peut d'abord traiter le retour lui-même
// (mod.back() renvoie true).
window.appBack = () => {
  if (isLocked()) return false; // verrouillée : Retour quitte l'app
  if (sheetOpen()) { closeTopSheet(); return true; }
  if (current && current.mod.back && current.mod.back()) return true;
  const n = routeName();
  if (n === '' || n === 'bienvenue') return false;
  back('#/');
  return true;
};
// Raccourci de l'icône « Nouvelle opération » (appelé par MainActivity, ROADMAP 1a) : la saisie s'ouvre sur l'accueil.
// Renvoie true une fois traité (MainActivity réessaie tant que l'app n'est pas prête). Pendant l'accueil guidé, rien.
window.appQuickEntry = () => {
  if (!settings().onboarded) return true;
  if (isLocked()) { showLock(() => window.appQuickEntry()); return true; } // la saisie s'ouvre après le code
  if (document.querySelector('.entry-sheet')) return true; // déjà ouverte
  if (sheetOpen()) closeAllSheets({ silent: true });
  if (routeName() === '') { openEntry({}); return true; }
  // depuis un autre écran : d'abord l'accueil (le changement d'adresse referme les feuilles), puis la saisie
  window.addEventListener('hashchange', () => openEntry({}), { once: true });
  go('#/', { replace: true });
  return true;
};
window.addEventListener('hashchange', () => {
  if (sheetOpen()) closeAllSheets({ silent: true });
  render();
});
// Toute modification des données redessine l'écran courant (en gardant le défilement).
subscribe(keys => {
  if (settings().onboarded) setTimeout(() => { try { checkReserves(); checkDues(); } catch (e) { console.error(e); } }, 0);
  if (current && current.mod.onData) current.mod.onData(keys);
  else render({ keepScroll: true });
});

// style de l'app (D1) : posé avant le premier écran ; un changement redessine l'écran ouvert, sans fermer la feuille
applyLook();
// version web (2026-11-20 : accès depuis un iPhone) : l'app gardée pour s'ouvrir hors ligne (sw.js), et le navigateur prié
// de ne pas effacer les données (Safari les efface sinon après des semaines sans visite) ; pas dans l'APK ni en local
if (!(/** @type {any} */ (globalThis).__TAURI_INTERNALS__) && location.protocol === 'https:') {
  try { navigator.serviceWorker?.register('sw.js'); } catch (e) { console.error('Service worker', e); }
  try { navigator.storage?.persist?.(); } catch (e) { /* rien */ }
}
// l'icône de l'app suit le style ; un peu après l'ouverture (rien à faire si elle est déjà la bonne)
setTimeout(syncAppIcon, 2000);
window.addEventListener('bougette:restyle', () => render({ keepScroll: true }));
// mises à jour (D20) : la recherche du jour, un peu après l'ouverture ; son message ou la cloche ouvre la feuille
setTimeout(() => { if (settings().onboarded) autoCheck(); }, 4000);
window.addEventListener('bougette:open-update', e => openUpdateSheet(/** @type {CustomEvent} */ (e).detail || null));
// la cloche d'une réserve prête (2026-11-19) : « Tu la dépenses quand ? », ou Utiliser le jour venu
window.addEventListener('bougette:reserve', e => {
  const d = /** @type {CustomEvent} */ (e).detail || {};
  import('../screens/reserves.js').then(R => (d.when ? R.askWhen(d.id, openEntry) : R.useReserve(d.id, openEntry)));
});
// « Charger la démo » depuis un autre espace (D19) : l'app s'est rouverte sur l'espace Démo, on le remplit ici
if (takeThen() === 'demo' && isDemo()) { try { await loadDemo(); toast('Espace Démo prêt'); } catch (e) { console.error(e); toast('Démo impossible.'); } }
render();
document.documentElement.classList.add('ready');
// Sauvegarde (ROADMAP 1b) : copie du jour vérifiée, un peu après l'ouverture (l'écran d'abord) ; la cloche de
// l'accueil se met à jour quand un message arrive.
onInbox(() => {
  const bell = document.querySelector('[data-inbox]');
  if (!bell) return;
  const n = unread();
  bell.querySelector('.dot')?.remove();
  if (n) bell.insertAdjacentHTML('beforeend', '<i class="dot" aria-hidden="true"></i>');
  bell.setAttribute('aria-label', n ? `Notifications (${n} nouvelle${n > 1 ? 's' : ''})` : 'Notifications');
});
// puis les autres espaces, en arrière-plan (2026-11-19) : vérifiés et copiés eux aussi, une fois par jour
setTimeout(() => { if (settings().onboarded) dailyCopy().finally(() => copyOtherSpaces()); }, 1500);
// Réserves et objectifs (D17) : ce qu'ils ont à dire va dans la cloche
setTimeout(() => { if (settings().onboarded) { try { checkReserves(); checkDues(); } catch (e) { console.error(e); } } }, 1200);
// Verrouillage (ROADMAP étape 2) : à l'ouverture, et au retour dans l'app après plus d'une minute ailleurs. MainActivity
// appelle appPaused / appResumed ; le navigateur passe par visibilitychange. Le verrou protège tous les espaces (D19) :
// même un espace pas encore commencé le demande.
showLock();
let awayAt = 0;
window.appPaused = () => { awayAt = Date.now(); };
window.appResumed = () => { if (awayAt && Date.now() - awayAt > AWAY_MS && settings().onboarded) showLock(); awayAt = 0; };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.appPaused(); else window.appResumed(); });
if (storageProblem()) setTimeout(() => toast(storageProblem()), 600);
