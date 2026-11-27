// La barre de période, commune au Journal et aux rapports (2026-11-27, avec l'utilisateur : les rapports reproduits de
// Money Lover prennent la même barre d'onglets que le Journal) : les échelles, les onglets du plus ancien à aujourd'hui,
// le centrage de l'onglet affiché, le glisser gauche/droite qui touche l'onglet voisin ; et l'adresse des rapports.
import { today, windowOf, shiftWindow, tabLabel, esc } from '../core/format.js';
import { reducedMotion, $ } from '../core/ui.js';

export const UNITS = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout'], ['custom', 'Personnalisé']];
// onglets de période : de la première opération à aujourd'hui, 30 au plus ; au-delà, « Plus loin » propose de changer
// d'échelle (l'échelle ne dit que combien on voit à la fois ; une date précise se choisit avec « Personnalisé »)
const MAX_TABS = 30;

// Onglets de période, du plus ancien (à gauche) à aujourd'hui, puis « À venir » s'il y a des opérations prévues. Ils
// remontent jusqu'à la période de la première opération, MAX_TABS au plus (mais toujours jusqu'à la période affichée,
// venue d'un lien) ; further : il reste plus ancien.
export function tabsFor(w, ms, hasPlanned, first) {
  const tabs = [];
  let further = false;
  if (w.unit === 'custom') tabs.push({ w, label: w.label });
  else if (w.unit === 'all' || !w.start) tabs.push({ w: windowOf('all'), label: 'Tout' });
  else {
    let cur = windowOf(w.unit, today(), ms);
    tabs.push({ w: cur, label: tabLabel(cur, ms) });
    while ((tabs.length < MAX_TABS && cur.start > first) || cur.start > w.start) {
      cur = shiftWindow(cur, -1, ms);
      tabs.unshift({ w: cur, label: tabLabel(cur, ms) });
    }
    further = cur.start > first;
  }
  if (hasPlanned) tabs.push({ soon: true, label: 'À venir' });
  return { tabs, further };
}
export const tabHTML = (x, on) => (x.group
  ? `<button type="button" role="tab" class="ops-tab ops-gap${on ? ' on' : ''}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-gap="${x.group}" aria-label="${esc(x.label)} : aucune opération">${esc(x.label)}</button>`
  : `<button type="button" role="tab" class="ops-tab${on ? ' on' : ''}" aria-selected="${on}" tabindex="${on ? 0 : -1}"${x.soon ? ' data-soon' : ` data-from="${x.w.start || ''}" data-to="${x.w.end || ''}"`}>${esc(x.label)}</button>`);

// l'onglet affiché est visible (au bout à droite pour la période en cours) : centré, puis calé sur le début d'un
// onglet (jamais un bout de mot coupé à gauche), sans jamais le couper à droite. Recalé quand la police arrive ou
// que la largeur change (2026-11-13 : calé une seule fois, « Ce mois-ci » sortait à droite)
export function centerTab(bar) {
  const on = $('.ops-tab.on', bar);
  const center = () => {
    if (!on || !on.isConnected) return;
    const kids = /** @type {HTMLElement[]} */ ([...bar.children]);
    const base = kids[0].offsetLeft, starts = kids.map(k => k.offsetLeft - base);
    const left = on.offsetLeft - base, right = left + on.offsetWidth;
    const x = Math.min(left - (bar.clientWidth - on.offsetWidth) / 2, bar.scrollWidth - bar.clientWidth);
    let start = starts.filter(v => v <= x + 1).pop() || 0;
    // calé à gauche, il pourrait couper l'onglet à droite : le premier début qui le laisse entier, marges comprises (le
    // premier onglet est à une marge du bord : sans elle, le dernier onglet du Rapport sortait de 20 px, 2026-11-27)
    const pad = parseFloat(getComputedStyle(bar).paddingLeft) || 0, room = bar.clientWidth - 2 * pad;
    if (right > start + room) start = starts.find(v => v >= right - room) ?? left;
    bar.scrollLeft = start;
  };
  center();
  document.fonts?.ready.then(center);
  if (typeof ResizeObserver !== 'undefined' && on) {
    const ro = new ResizeObserver(() => { if (!bar.isConnected) ro.disconnect(); else center(); });
    ro.observe(bar);
  }
}

// Glisser horizontal n'importe où sur l'écran, vide sous la liste compris (pas sur la barre d'onglets, qui défile
// elle-même, ni dans la recherche) : au-delà
// de 72 px (ou un geste vif), l'onglet voisin est touché — vers la gauche la période suivante, vers la droite la
// précédente. Sans voisin, la liste résiste et revient. Rien pendant une recherche (pas d'onglets).
// moving : ce qui suit le doigt ; onDir(1 | −1) : le sens du glisser, pour l'arrivée de la période (1 : par la droite).
/** @param {any} scr @param {any} perEl @param {() => any[]} moving @param {(d: number) => void} [onDir] */
export function swipePeriods(scr, perEl, moving, onDir = () => {}) {
  if (!scr) return;
  let swallow = false;
  // un glisser ne doit pas ouvrir la fiche de l'opération sous le doigt
  scr.addEventListener('click', e => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
  scr.addEventListener('pointerdown', (/** @type {any} */ e) => {
    const el = /** @type {Element} */ (e.target);
    if (!e.isPrimary || e.button > 0 || el.closest('.ops-tabs, .ops-find, input')) return;
    const on = $('.ops-tab.on', perEl);
    if (!on) return;
    const sib = n => (n && n.classList.contains('ops-tab') ? n : null);
    const prev = sib(on.previousElementSibling), next = sib(on.nextElementSibling);
    const els = moving();
    const x0 = e.clientX, y0 = e.clientY, t0 = performance.now();
    let mode = '', dx = 0;
    const set = (x, anim = false) => els.forEach(m => {
      m.style.transition = anim ? 'transform .2s var(--spring)' : 'none';
      m.style.transform = x ? `translateX(${x}px)` : '';
    });
    const move = (/** @type {any} */ ev) => {
      const mx = ev.clientX - x0, my = ev.clientY - y0;
      if (!mode) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) mode = 'h';
        else if (Math.abs(my) > 10) { done(); return; }
        else return;
      }
      dx = mx;
      set((dx < 0 ? next : prev) ? dx * 0.6 : dx * 0.15);
    };
    const up = () => {
      done();
      if (mode !== 'h') return;
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
      const target = dx < 0 ? next : prev;
      const fast = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.5;
      if (!target || !(Math.abs(dx) > 72 || (fast && Math.abs(dx) > 30))) { set(0, true); return; }
      onDir(dx < 0 ? 1 : -1);
      if (reducedMotion()) { target.click(); return; }
      set(dx < 0 ? -72 : 72, true);
      setTimeout(() => target.click(), 90);
    };
    function done() {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// L'échelle des rapports quand l'adresse n'a pas de dates (2026-11-27) : « Tout » n'a ni début ni fin, il ne tient donc
// pas dans l'adresse ; il se garde ici, d'un écran de rapport à l'autre, et repart de zéro dans un autre espace (D19).
export const reportState = { unit: 'month' };
if (typeof window !== 'undefined') window.addEventListener('bougette:space', () => { reportState.unit = 'month'; });
/**
 * Adresse d'un écran de rapport : route = '' (Rapport), 'net', 'detail' ou 'categorie'. Portefeuille, période, type et
 * catégorie dans l'adresse, comme le Journal (opsHref).
 * @param {string} route @param {{ acc?: string|null, from?: string|null, to?: string|null, type?: string|null, cat?: string|null }} [f]
 */
export function reportHref(route = '', { acc = null, from = null, to = null, type = null, cat = null } = {}) {
  const q = new URLSearchParams();
  if (acc) q.set('acc', acc);
  if (from && to) { q.set('from', from); q.set('to', to); }
  if (type) q.set('type', type);
  if (cat) q.set('cat', cat);
  const s = q.toString();
  return '#/rapport' + (route ? '/' + route : '') + (s ? '?' + s : '');
}
