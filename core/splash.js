// Écran d'ouverture (2026-11-22, avec l'utilisateur : passer d'un espace à l'autre laissait un écran noir le temps que
// l'app relise ses données) : la tête et le nom de l'espace, au centre, sur le fond des feuilles. Choisi depuis la feuille
// des espaces, il naît de cette feuille, qui monte jusqu'à prendre tout l'écran ; l'app ouvre dessous le nouvel espace,
// sur place (app.js switchSpace) ; au premier écran, il continue de monter et sort par le haut, l'accueil montant derrière
// lui (hideSplash). Il est gardé dans le téléphone pour que boot.js le pose dès la lecture de la page, à chaque ouverture
// de l'app (et si le passage sur place échoue et que la page se recharge).
import { currentSpace } from './spaces.js';
import { spaceAvatar } from './avatar.js';
import { esc } from '../domain/format.js';

const KEY = 'cauri:splash';
// la sortie va à la vitesse de la montée (2026-11-22, avec l'utilisateur : elle parcourt tout l'écran, la montée
// seulement ce qui manquait à la feuille ; à durée égale, elle filait deux fois plus vite) : sa durée, en ms, gardée
// le temps d'ouvrir le nouvel espace (aussi après un rechargement)
const OUT = 'bougette:splash-out', GROW_MS = 440;
/** @param {{ id: string, name: string, seed?: string }} s @param {string} [cls] */
const splashHTML = (s, cls = '') => `<div id="splash" class="splash${cls}" aria-hidden="true"><div class="splash-in">
  <span class="splash-ava">${spaceAvatar(s)}</span><b>${esc(s.name)}</b></div></div>`;

/** Garde l'écran d'ouverture de l'espace ouvert pour le prochain démarrage. */
export function keepSplash() {
  try { localStorage.setItem(KEY, splashHTML(currentSpace())); } catch (e) { /* sans écran d'ouverture */ }
}
/**
 * Pose l'écran d'ouverture de l'espace ouvert par-dessus tout et le garde pour la prochaine ouverture. Depuis une feuille
 * (from) : il part de sa hauteur et monte jusqu'en haut ; sinon, un fondu. Résout quand il couvre l'écran.
 * @param {{ from?: Element|null }} [o] @returns {Promise<void>}
 */
export function showSplash({ from = null } = {}) {
  keepSplash();
  document.getElementById('splash')?.remove();
  const h = from ? from.getBoundingClientRect().height : 0;
  document.body.insertAdjacentHTML('beforeend', splashHTML(currentSpace(), h ? ' grow sheet' : ' fade'));
  const el = /** @type {HTMLElement} */ (document.getElementById('splash'));
  if (!h) return new Promise(ok => setTimeout(ok, 160));
  el.style.setProperty('--from', `${Math.round(h)}px`);
  const rise = Math.max(1, innerHeight - h);
  try { sessionStorage.setItem(OUT, String(Math.round(Math.min(900, Math.max(GROW_MS, (GROW_MS * innerHeight) / rise))))); } catch (e) { /* durée par défaut */ }
  el.getBoundingClientRect(); // la hauteur de départ est posée avant de monter
  el.classList.add('full');
  return new Promise(ok => setTimeout(ok, 460));
}
/** Le premier écran est là : l'écran d'ouverture sort par le haut et l'écran monte du bas. */
export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const d = document.documentElement;
  let ms = 600; // à l'ouverture de l'app : la vitesse d'une feuille à mi-hauteur
  try { ms = Number(sessionStorage.getItem(OUT)) || ms; sessionStorage.removeItem(OUT); } catch (e) { /* durée par défaut */ }
  el.style.setProperty('--out', `${ms}ms`);
  d.classList.add('rise');
  el.classList.remove('grow', 'fade'); // né de la feuille (sur place) : sa transition de hauteur cèderait celle de la sortie
  el.classList.add('out');
  setTimeout(() => el.remove(), ms + 40);
  setTimeout(() => d.classList.remove('rise'), ms + 600);
}
