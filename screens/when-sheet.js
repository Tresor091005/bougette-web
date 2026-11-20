// « Quand ? » d'une échéance (D18 revu le 2026-11-18, avec l'utilisateur) : un seul calendrier. On touche les jours, puis on
// dit si ce motif se répète (Une fois · Chaque semaine · Chaque mois ; « Plus » : chaque année, tous les 2 / 3 / 6…).
// L'app propose la répétition d'après les jours touchés (« proposé ») ; les jours qui suivront sont teintés ; une phrase
// en clair dit le résultat. On change de mois par ‹ › ou d'un glissement. Le résultat est une règle du domaine :
// { start, days (décalages en jours), every, interval }.
import { today, shortDate, esc } from '../core/format.js';
import { openSheet, buzz, onSwipe, menuSheet, noticeHTML, $ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { DAYS, dt, list, dayNum, datesOfWhen, whenPhrase, guessRepeat, whenOf, selectedOf } from '../domain/when.js';

export { whenPhrase };
/** @typedef {import('../domain/when.js').When} When */


const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const cap = (/** @type {string} */ t) => t.charAt(0).toUpperCase() + t.slice(1);
const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * La feuille « Quand ? ». Résout la règle choisie, ou null (refermée).
 * busy : les jours où tombent d'autres échéances → leurs noms (un point dessous ; sous le calendrier, celles des jours touchés) ; prefer : la répétition pré-cochée pour un seul jour
 * touché (« Chaque mois » pour une catégorie mensuelle).
 * @param {{ when: When|null, title?: string, busy?: Map<string, string[]>, prefer?: string|null }} o
 * @returns {Promise<When|null>}
 */
export function pickWhen({ when, title = 'Quand ?', busy = new Map(), prefer = null }) {
  return new Promise(resolve => {
    const t0 = today();
    /** @type {When|null} */
    let out = null;
    const sel = new Set(when ? selectedOf(when, t0) : []);
    let rep = when ? (when.every || 'once') : 'once';
    let n = when?.interval || 1;
    let auto = !when; // une règle qui existe garde sa répétition ; une nouvelle suit ce que l'app propose
    let view = ([...sel].sort()[0] || t0).slice(0, 7);
    const s = openSheet(`<div class="when">
      <h2 class="sheet-title">${title}</h2>
      <p class="muted when-help">Touche les jours où ça arrive.${busy.size ? ' Un point : déjà une échéance ce jour-là, touche le jour pour voir laquelle.' : ''}</p>
      <div class="cal">
        <div class="cal-h"><button type="button" class="iconbtn" data-m="-1" aria-label="Mois précédent">${icon('caret-left')}</button>
          <b class="when-month" data-title></b>
          <button type="button" class="iconbtn" data-m="1" aria-label="Mois suivant">${icon('caret-right')}</button></div>
        <div class="cal-w" aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-g when-g" data-grid role="grid"></div>
      </div>
      <div class="when-rep" data-rep></div>
      <p class="when-say" data-say></p>
      <div class="when-also" data-also></div>
      <div data-err></div>
      <div class="sheet-actions"><button class="btn primary" data-ok>${icon('check')}Valider</button></div>
    </div>`, { label: title, onClose: () => resolve(out) });
    const grid = /** @type {HTMLElement} */ ($('[data-grid]', s.el)), prev = /** @type {HTMLButtonElement} */ ($('[data-m="-1"]', s.el));
    const repEl = /** @type {HTMLElement} */ ($('[data-rep]', s.el)), sayEl = /** @type {HTMLElement} */ ($('[data-say]', s.el)), errEl = /** @type {HTMLElement} */ ($('[data-err]', s.el));
    const sorted = () => [...sel].sort();
    const current = () => whenOf(sorted(), rep, n);

    const paint = () => {
      const ds = sorted();
      const g0 = guessRepeat(ds);
      const g = g0 === 'once' && ds.length === 1 && prefer ? prefer : g0;
      if (auto && g) { rep = g; n = 1; }
      const w = current().when || null;
      // les jours qui suivront (teintés), sur deux ans au plus
      const nexts = new Set(w && w.every ? datesOfWhen(w, 400).filter(d => !sel.has(d) && d >= t0) : []);
      const [y, mo] = view.split('-').map(Number);
      const first = new Date(y, mo - 1, 1), count = new Date(y, mo, 0).getDate(), lead = (first.getDay() + 6) % 7;
      $('[data-title]', s.el).textContent = cap(fmtMonth.format(first));
      prev.disabled = view <= t0.slice(0, 7);
      let html = '<span></span>'.repeat(lead);
      for (let d = 1; d <= count; d++) {
        const k = `${view}-${String(d).padStart(2, '0')}`, past = k < t0;
        const b = busy.get(k);
        html += `<button type="button" class="cd${k === t0 ? ' now' : ''}${sel.has(k) ? ' on' : nexts.has(k) ? ' nx' : ''}${b ? ' busy' : ''}" data-d="${k}"${past ? ' disabled' : ''}${b ? ` aria-label="${d}, aussi ${esc(b.join(', '))}"` : ''}>${d}</button>`;
      }
      grid.innerHTML = html;
      // la répétition : trois choix, « Plus » pour le reste ; un seul jour : chaque choix dit ses jours
      const one = ds.length === 1 ? ds[0] : null;
      const custom = rep === 'year' || rep === 'day' || n > 1;
      const label = (/** @type {string} */ v, /** @type {string} */ l) => (one && v === 'week' ? `${l} · le ${DAYS[dt(one).getDay()]}` : one && v === 'month' ? `${l} · le ${dayNum(one)}` : l);
      repEl.innerHTML = ds.length ? [['once', 'Une fois'], ['week', 'Chaque semaine'], ['month', 'Chaque mois']].map(([v, l]) =>
        `<button type="button" class="sc${rep === v && !custom ? ' on' : ''}${g === v && rep !== v ? ' sug' : ''}" data-r="${v}">${label(v, l)}</button>`).join('')
        + `<button type="button" class="sc${custom ? ' on' : ''}" data-more>${custom ? esc(rep === 'year' ? (n > 1 ? `Tous les ${n} ans` : 'Chaque année') : rep === 'day' ? `Tous les ${n} jours` : rep === 'week' ? `Toutes les ${n} semaines` : `Tous les ${n} mois`) : 'Plus'}${icon('caret-down')}</button>` : '';
      // les autres échéances des jours touchés : ce qui tombe déjà ce jour-là
      const also = ds.filter(d => busy.has(d));
      $('[data-also]', s.el).innerHTML = also.slice(0, 3).map(d => `<p>${icon('calendar-check')}<span>Le ${esc(shortDate(d))} : aussi ${esc(list(/** @type {string[]} */ (busy.get(d))))}</span></p>`).join('')
        + (also.length > 3 ? `<p class="muted">et ${also.length - 3} autre${also.length > 4 ? 's' : ''} jour${also.length > 4 ? 's' : ''} déjà pris</p>` : '');
      const got = current();
      errEl.innerHTML = '';
      if (!ds.length) { sayEl.innerHTML = ''; return; }
      if (got.error) { sayEl.innerHTML = ''; errEl.innerHTML = noticeHTML(esc(got.error)); return; }
      const w2 = /** @type {When} */ (got.when);
      const coming = w2.every ? datesOfWhen(w2, 12).filter(d => d >= t0).slice(ds.length, ds.length + 3) : [];
      sayEl.innerHTML = `<b>${esc(whenPhrase(w2))}</b>${coming.length ? `<small>puis ${esc(list(coming.map(d => shortDate(d))))}…</small>` : ''}`;
    };
    paint();

    const step = (/** @type {number} */ k) => {
      const [y, mo] = view.split('-').map(Number);
      const d = new Date(y, mo - 1 + k, 1);
      const v = iso(d).slice(0, 7);
      if (v < t0.slice(0, 7)) return;
      view = v; buzz(6); paint();
    };
    $('[data-m="-1"]', s.el).onclick = () => step(-1);
    $('[data-m="1"]', s.el).onclick = () => step(1);
    onSwipe(grid, { left: () => step(1), right: () => step(-1) });
    grid.onclick = e => {
      const b = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-d]'));
      if (!b || b.disabled) return;
      const k = /** @type {string} */ (b.dataset.d);
      if (sel.has(k)) sel.delete(k); else sel.add(k);
      auto = true; // les jours changent : l'app repropose
      buzz(6); paint();
    };
    repEl.onclick = async e => {
      const t = /** @type {HTMLElement} */ (e.target);
      const r = /** @type {HTMLElement|null} */ (t.closest('[data-r]'));
      if (r) { rep = /** @type {string} */ (r.dataset.r); n = 1; auto = false; buzz(6); paint(); return; }
      if (!t.closest('[data-more]')) return;
      const k = await menuSheet({ title: 'Répétition', items: [
        { key: 'year:1', icon: 'calendar-blank', label: 'Chaque année' },
        { key: 'week:2', icon: 'arrows-clockwise', label: 'Toutes les 2 semaines' },
        { key: 'month:2', icon: 'arrows-clockwise', label: 'Tous les 2 mois' },
        { key: 'month:3', icon: 'arrows-clockwise', label: 'Tous les 3 mois' },
        { key: 'month:6', icon: 'arrows-clockwise', label: 'Tous les 6 mois' },
      ] });
      if (!k) return;
      const [u, m] = k.split(':');
      rep = u; n = Number(m); auto = false; paint();
    };
    $('[data-ok]', s.el).onclick = () => {
      const got = current();
      if (!got.when) { errEl.innerHTML = noticeHTML(esc(got.error || 'Touche au moins un jour.')); buzz(14); return; }
      out = got.when; buzz(12); s.close();
    };
  });
}
