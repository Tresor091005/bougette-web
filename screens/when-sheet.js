// « Quand ? » d'une échéance (D18 revu le 2026-11-18, avec l'utilisateur) : un seul calendrier. On touche les jours, puis on
// dit si ce motif se répète : quatre choix (Une fois · Semaine · Mois · Année) et un compteur « Tous les N » (2 semaines,
// 3 mois, 2 ans…).
// Un squelette fixe (2026-11-27, avec l'utilisateur) : rien n'apparaît, rien ne bouge, tout s'allume ou s'éteint. Le
// calendrier a toujours six lignes (les jours des mois voisins, presque effacés, complètent la grille), les trois rangées
// « Ça revient ? », « Tous les » et « Quel jour ? » sont toujours là, et la phrase (avec ses notices) a sa zone à hauteur fixe.
// L'app propose la répétition d'après les jours touchés (« proposé ») ; les jours qui suivront sont teintés ; une phrase
// en clair dit le résultat. On change de mois par ‹ › ou d'un glissement. Un seul jour chaque mois (ou tous les N mois) se
// lit, au choix, par son quantième (« le 14 », par défaut) ou « le 2e lundi », « le dernier lundi », « le dernier jour »
// (2026-11-25, avec l'utilisateur : tontines, associations, église). Tous les 28 à 31 jours : l'app propose chaque mois
// (une proposition, pas un refus). Le résultat est une règle du domaine : { start, days (décalages en jours), every,
// interval, by? }.
import { today, shortDate, yearDate, addDays, esc } from '../core/format.js';
import { openSheet, buzz, onSwipe, noticeHTML, $ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { sheetHead, sheetActions } from './parts.js';
import { DAYS, dt, dayNum, list, monthDay, byChoices, sameBy, nearlyMonthly, datesOfWhen, whenPhrase, guessRepeat, whenOf, selectedOf } from '../domain/when.js';

export { whenPhrase };
/** @typedef {import('../domain/when.js').When} When */


const fmtMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const fmtMonthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtMonthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
/** L'unité du compteur « Tous les N ». @param {string} every @param {number} k */
const unit = (every, k) => (every === 'week' ? 'semaine' : every === 'month' ? 'mois' : every === 'year' ? 'an' : 'jour') + (k > 1 && every !== 'month' ? 's' : '');
const cap = (/** @type {string} */ t) => t.charAt(0).toUpperCase() + t.slice(1);
/** Le rythme en mots (sans majuscule) : « chaque mois », « tous les 2 mois ». @param {string} every @param {number} n */
const rhythm = (every, n) => (every === 'week' ? (n > 1 ? `toutes les ${n} semaines` : 'chaque semaine')
  : every === 'month' ? (n > 1 ? `tous les ${n} mois` : 'chaque mois')
    : every === 'year' ? (n > 1 ? `tous les ${n} ans` : 'chaque année') : `tous les ${n} jours`);
const low = (/** @type {string} */ t) => t.charAt(0).toLowerCase() + t.slice(1);
const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * La feuille « Quand ? ». Résout la règle choisie, ou null (refermée).
 * La feuille ne montre plus les autres échéances (2026-11-26, avec l'utilisateur) : ni point sous leurs jours (quand on
 * programme tout, il y en a partout et le calendrier devient illisible ; n'en garder qu'une partie ne réglait rien), ni
 * ligne qui les cite sous le calendrier (elle n'avait pas de limite par jour).
 * prefer : la répétition pré-cochée pour un seul jour touché (« Chaque mois » pour une catégorie mensuelle).
 * past (2026-11-26, avec l'utilisateur : la saisie et la création d'une opération programmée sont une seule feuille) : les
 * jours passés se touchent et on remonte les mois ; un jour passé se sélectionne comme les autres (un seul à la fois, le
 * passé ne se répète pas) et le bouton le confirme. Raison : au moment de choisir la date, on doit savoir si on note une
 * opération passée ou si on en prépare une — la feuille le dit (C’est passé / aujourd’hui / à venir), le bouton est écrit au
 * temps du verbe (« C’était hier », « Ce sera chaque mois »).
 * « Effacer » (2026-11-26, avec l'utilisateur), sur la ligne du titre, dans les deux modes : retire tous les jours touchés
 * pour les choisir à nouveau, proprement — la feuille reste ouverte. Pas de raccourci « Aujourd’hui » qui referme : qui
 * ouvre « Quand ? » ne veut justement pas d'aujourd'hui, le choix par défaut.
 * mark : un jour entouré sans être coché (la date de la saisie).
 * @param {{ when: When|null, title?: string, prefer?: string|null, past?: boolean, mark?: string|null }} o
 * @returns {Promise<When|null>}
 */
export function pickWhen({ when, title = 'Quand ?', prefer = null, past = false, mark = null }) {
  return new Promise(resolve => {
    const t0 = today();
    /** @type {When|null} */
    let out = null;
    const sel = new Set(when ? selectedOf(when, t0) : []);
    let rep = when ? (when.every || 'once') : 'once';
    let n = when?.interval || 1;
    /** @type {import('../domain/when.js').By|null} */
    let by = when?.by || null; // la lecture d'un seul jour chaque mois (null : le quantième)
    let auto = !when; // une règle qui existe garde sa répétition ; une nouvelle suit ce que l'app propose
    /** @type {string|null} */
    let gone = null; // le jour passé sélectionné (saisie seulement) ; exclusif avec sel
    const short = (/** @type {string} */ d) => (d.slice(0, 4) === t0.slice(0, 4) ? shortDate(d) : yearDate(d));
    let view = ([...sel].sort()[0] || mark || t0).slice(0, 7);
    // les 12 mois d'une année à la place des jours (2026-11-27, avec l'utilisateur : passer d'une année à l'autre), comme le
    // calendrier simple : toucher le titre ; ‹ › changent alors d'année
    let months = false;
    const s = openSheet(`<div class="when${past ? ' from-entry' : ''}">
      <div class="when-top">${sheetHead({ title })}<button type="button" class="sc" data-reset disabled>${icon('arrow-counter-clockwise')}Effacer</button></div>
      ${past ? '' : '<p class="muted when-help">Touche les jours où ça arrive.</p>'}
      <div class="cal">
        <div class="cal-h"><button type="button" class="iconbtn" data-m="-1" aria-label="Mois précédent">${icon('caret-left')}</button>
          <button type="button" class="cal-t" data-title aria-expanded="false"><b class="when-month"></b>${icon('caret-down')}</button>
          <button type="button" class="iconbtn" data-m="1" aria-label="Mois suivant">${icon('caret-right')}</button></div>
        <div class="cal-w" data-week aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-g when-g" data-grid role="grid"></div>
      </div>
      <div class="when-row"><p class="when-lb">Ça revient ?</p><div class="when-ct" data-rep></div></div>
      <div class="when-row" data-nrow><p class="when-lb">Tous les</p><div class="when-ct when-n" data-n>
        <button type="button" class="iconbtn" data-nm="-1" aria-label="Moins">−</button><span class="when-nv"><b data-nv>1</b> <span data-nu></span></span><button type="button" class="iconbtn" data-nm="1" aria-label="Plus">+</button></div></div>
      <div class="when-row" data-byrow><p class="when-lb">Quel jour ?</p><div class="when-ct" data-by role="group" aria-label="Quel jour"></div></div>
      <div class="when-say" data-say></div>
      ${sheetActions(past ? `<button class="btn primary" data-ok disabled><span class="ok-t">Touche un jour</span></button>` : `<button class="btn primary" data-ok>${icon('check')}Valider</button>`)}
    </div>`, { label: title, onClose: () => resolve(out) });
    const grid = /** @type {HTMLElement} */ ($('[data-grid]', s.el)), prev = /** @type {HTMLButtonElement} */ ($('[data-m="-1"]', s.el));
    const byEl = /** @type {HTMLElement} */ ($('[data-by]', s.el)), resetBtn = /** @type {HTMLButtonElement} */ ($('[data-reset]', s.el));
    const repEl = /** @type {HTMLElement} */ ($('[data-rep]', s.el)), sayEl = /** @type {HTMLElement} */ ($('[data-say]', s.el));
    const nEl = /** @type {HTMLElement} */ ($('[data-n]', s.el)), nRow = /** @type {HTMLElement} */ ($('[data-nrow]', s.el)), byRow = /** @type {HTMLElement} */ ($('[data-byrow]', s.el));
    const sorted = () => [...sel].sort();
    const current = () => whenOf(sorted(), rep, n, by);

    const paint = () => {
      const ds = sorted();
      const g0 = guessRepeat(ds);
      const g = g0 === 'once' && ds.length === 1 && prefer ? prefer : g0;
      // un seul jour touché : une fois d'abord (2026-11-27, avec l'utilisateur : rien ne se répète sans qu'on le dise) ; la
      // répétition que l'app devine reste proposée, entourée (« sug »)
      if (auto && g) { rep = ds.length === 1 ? 'once' : g; n = 1; }
      const w = gone ? null : current().when || null;
      // les jours qui suivront (teintés), sur deux ans au plus
      const nexts = new Set(w && w.every ? datesOfWhen(w, 400).filter(d => !sel.has(d) && d >= t0) : []);
      const [y, mo] = view.split('-').map(Number);
      const first = new Date(y, mo - 1, 1), count = new Date(y, mo, 0).getDate(), lead = (first.getDay() + 6) % 7;
      const head = /** @type {HTMLElement} */ ($('[data-title]', s.el));
      head.setAttribute('aria-expanded', String(months));
      // les lettres des jours s'effacent sans libérer leur place : la grille des mois ne remonte pas
      /** @type {HTMLElement} */ ($('[data-week]', s.el)).style.visibility = months ? 'hidden' : '';
      grid.classList.toggle('months', months);
      /** @type {HTMLElement} */ ($('b', head)).textContent = months ? String(y) : cap(fmtMonth.format(first));
      prev.disabled = !past && (months ? y <= Number(t0.slice(0, 4)) : view <= t0.slice(0, 7));
      let html = '';
      // toujours six lignes (2026-11-27, avec l'utilisateur) : les jours des mois voisins complètent la grille, sans se toucher
      const out = (/** @type {number} */ d) => `<span class="cd out" aria-hidden="true">${d}</span>`;
      if (!months) { const before = new Date(y, mo - 1, 0).getDate(); for (let i = lead - 1; i >= 0; i--) html += out(before - i); }
      if (months) for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        html += `<button type="button" class="cm${ym === view ? ' on' : ''}${ym === t0.slice(0, 7) ? ' now' : ''}" data-ym="${ym}"${!past && ym < t0.slice(0, 7) ? ' disabled' : ''}>${cap(fmtMonthShort.format(new Date(y, m - 1, 1)).replace('.', ''))}</button>`;
      }
      for (let d = 1; !months && d <= count; d++) {
        const k = `${view}-${String(d).padStart(2, '0')}`, lock = !past && k < t0;
        html += `<button type="button" class="cd${k === t0 ? ' now' : ''}${past && k < t0 ? ' past' : ''}${sel.has(k) || k === gone ? ' on' : nexts.has(k) ? ' nx' : k === mark ? ' cur' : ''}" data-d="${k}"${lock ? ' disabled' : ''}>${d}</button>`;
      }
      if (!months) for (let i = 1; lead + count + i <= 42; i++) html += out(i);
      grid.innerHTML = html;
      // la répétition : quatre choix, toujours touchables (même avant le premier jour) ; un jour passé ne se répète pas
      const one = ds.length === 1 ? ds[0] : null;
      repEl.innerHTML = [['once', 'Une fois'], ['week', 'Semaine'], ['month', 'Mois'], ['year', 'Année']].map(([v, l]) =>
        // un jour passé ne se répète pas : Semaine, Mois et Année s'éteignent (2026-11-27, avec l'utilisateur)
        `<button type="button" class="sc${rep === v ? ' on' : ''}${g === v && rep !== v ? ' sug' : ''}" data-r="${v}" aria-pressed="${rep === v}"${gone && v !== 'once' ? ' disabled' : ''}>${l}</button>`).join('');
      // le compteur « Tous les N » : éteint (et à 1) pour une fois ou un jour passé
      const nOff = rep === 'once' || !!gone, nv = nOff ? 1 : n;
      nRow.classList.toggle('off', nOff);
      /** @type {HTMLElement} */ ($('[data-nv]', s.el)).textContent = String(nv);
      /** @type {HTMLElement} */ ($('[data-nu]', s.el)).textContent = nOff ? '' : unit(rep, nv);
      /** @type {HTMLButtonElement} */ ($('[data-nm="-1"]', s.el)).disabled = nOff || nv <= 1;
      /** @type {HTMLButtonElement} */ ($('[data-nm="1"]', s.el)).disabled = nOff || nv >= 99;
      // « Quel jour ? » : toujours là, à la même hauteur ; une gélule éteinte ou d'information quand il n'y a rien à choisir
      const pill = (/** @type {string} */ t, /** @type {boolean} */ lit) => `<span class="sc${lit ? ' on' : ' off'}">${esc(t)}</span>`;
      const weekDays = [...new Set(ds.map(d => dt(d).getDay()))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      let byHtml = '', byLit = true, choices = false;
      if (gone) { byHtml = pill('Une seule fois', false); byLit = false; }
      else if (!ds.length) { byHtml = pill('Touche un jour', false); byLit = false; }
      else if (rep === 'day') { byHtml = pill('Les jours touchés', false); byLit = false; }
      else if (rep === 'once') { byHtml = pill('Une seule fois', false); byLit = false; }
      else if (rep === 'week') byHtml = pill(cap(list(weekDays.map(d => `le ${DAYS[d]}`))), true);
      else if (rep === 'year') byHtml = pill(one ? `Le ${dayNum(one)} ${fmtMonthLong.format(dt(one))}` : 'Les jours touchés', true);
      else if (one) {
        // un seul jour chaque mois (ou tous les N mois) : son quantième, ou « le 2e lundi », « le dernier jour »…
        choices = true;
        byHtml = byChoices(one).map(c =>
          `<button type="button" class="sc${sameBy(one, c.by, by) ? ' on' : ''}" role="radio" aria-checked="${sameBy(one, c.by, by)}" data-b="${c.by || ''}">${esc(c.label)}</button>`).join('');
      } else { byHtml = pill('Les jours touchés', false); byLit = false; }
      byEl.innerHTML = byHtml;
      byEl.setAttribute('role', choices ? 'radiogroup' : 'group');
      byRow.classList.toggle('off', !byLit);
      const got = current();
      sayEl.classList.remove('idle');
      resetBtn.disabled = !sel.size && !gone && view === t0.slice(0, 7) && !months; // rien de touché, sur le mois d'aujourd'hui : rien à effacer
      if (past) paintOk(got);
      if (gone) { sayEl.innerHTML = '<b>C’est passé.</b><small class="means">Tu notes une opération déjà faite.</small>'; return; }
      if (!ds.length) {
        sayEl.innerHTML = past ? 'Avant aujourd’hui : tu notes ce qui est fait. Après : tu programmes.' : '';
        if (past) sayEl.classList.add('idle');
        return;
      }
      // les messages s'écrivent dans la zone de la phrase, à sa place (2026-11-27, avec l'utilisateur) : la feuille ne grandit pas
      if (got.error) { sayEl.innerHTML = noticeHTML(esc(got.error)); return; }
      const w2 = /** @type {When} */ (got.when);
      // tous les 28 à 31 jours : ça glisse d'un mois à l'autre ; chaque mois, proposé (rien ne change sans un toucher)
      if (one && nearlyMonthly(w2)) { sayEl.innerHTML = noticeHTML(`« Tous les ${n} jours » glisse d’un mois à l’autre${n > 28 ? ' et saute parfois février' : ''}.`, { tone: 'info', action: `Plutôt chaque mois, le ${esc(monthDay(one))}` }); return; }
      const coming = w2.every ? datesOfWhen(w2, 12).filter(d => d >= t0).slice(ds.length, ds.length + 3) : [];
      const then = coming.length ? `<small>puis ${esc(list(coming.map(d => shortDate(d))))}…</small>` : '';
      if (!past) { sayEl.innerHTML = `<b>${esc(whenPhrase(w2))}</b>${then}`; return; }
      // saisie : on dit si c'est noté maintenant ou programmé
      sayEl.innerHTML = w2.every ? `<b>${esc(whenPhrase(w2))}</b><small class="means">Tu la programmes : tu confirmes à chaque fois.</small>${then}`
        : ds.length > 1 ? `<b>${esc(whenPhrase(w2))}</b><small class="means">Tu la programmes : rien n’est noté avant, tu confirmes chaque jour venu.</small>`
          : ds[0] === t0 ? '<b>C’est aujourd’hui.</b><small class="means">Tu notes l’opération maintenant.</small>'
            : '<b>C’est à venir.</b><small class="means">Tu la programmes : rien n’est noté avant ce jour, tu confirmes le jour venu.</small>';
    };
    // sur un petit écran la phrase peut passer sous la barre du bas : après un toucher, elle revient en vue
    const reveal = () => { if (past) sayEl.scrollIntoView({ block: 'nearest' }); };
    /** Le bouton dit le choix, au temps du verbe (saisie). @param {{ when?: When, error?: string }} got */
    const paintOk = got => {
      const ds = sorted();
      const ok = /** @type {HTMLButtonElement} */ ($('[data-ok]', s.el));
      let t = '';
      if (gone) t = `C’était ${gone === addDays(t0, -1) ? 'hier' : `le ${short(gone)}`}`;
      else if (ds.length && got.when) {
        const w3 = got.when;
        t = w3.every ? `Ce sera ${rhythm(w3.every, w3.interval || 1)}`
          : ds.length > 1 ? `Ce sera ${low(whenPhrase(w3))}`
            : ds[0] === t0 ? 'C’est aujourd’hui' : `Ce sera ${ds[0] === addDays(t0, 1) ? 'demain' : `le ${short(ds[0])}`}`;
      }
      // rien de touché, ou des jours qui ne vont pas avec la répétition (la notice au-dessus dit pourquoi) : éteint, il dit quoi faire
      ok.disabled = !t;
      ok.innerHTML = t ? `${icon('check')}<span class="ok-t">${esc(t)}</span>` : `<span class="ok-t">${ds.length ? 'Corrige les jours' : 'Touche un jour'}</span>`;
    };
    paint();

    const step = (/** @type {number} */ k) => {
      const [y, mo] = view.split('-').map(Number);
      const d = months ? new Date(y + k, mo - 1, 1) : new Date(y, mo - 1 + k, 1);
      let v = iso(d).slice(0, 7);
      if (!past && v < t0.slice(0, 7)) { if (!months) return; v = t0.slice(0, 7); }
      view = v; buzz(6); paint();
    };
    $('[data-m="-1"]', s.el).onclick = () => step(-1);
    $('[data-m="1"]', s.el).onclick = () => step(1);
    onSwipe(grid, { left: () => step(1), right: () => step(-1) });
    /** @type {HTMLElement} */ ($('[data-title]', s.el)).onclick = () => { months = !months; buzz(6); paint(); };
    grid.onclick = e => {
      const ym = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-ym]'));
      if (ym) { if (!ym.disabled) { view = /** @type {string} */ (ym.dataset.ym); months = false; buzz(6); paint(); } return; }
      const b = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-d]'));
      if (!b || b.disabled) return;
      const k = /** @type {string} */ (b.dataset.d);
      // un jour passé se sélectionne (un seul, exclusif avec les autres) : le bouton le confirme, rien à répéter
      if (past && k < t0) {
        if (gone === k) gone = null;
        else { sel.clear(); rep = 'once'; n = 1; by = null; auto = true; gone = k; }
        buzz(6); paint(); reveal(); return;
      }
      gone = null;
      // depuis la saisie, aujourd'hui compte comme le passé (2026-11-27, avec l'utilisateur) : exclusif avec les autres jours —
      // la saisie arrive souvent sur aujourd'hui, toucher un jour à venir le remplace au lieu d'en faire deux
      if (past && !sel.has(k) && (k === t0 || sel.has(t0))) sel.clear();
      if (sel.has(k)) sel.delete(k); else sel.add(k);
      auto = true; by = null; // les jours changent : l'app repropose, le quantième revient
      buzz(6); paint(); reveal();
    };
    byEl.onclick = e => {
      const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-b]'));
      if (!b) return;
      const v = /** @type {any} */ (b.dataset.b || null), one = sel.size === 1 ? [...sel][0] : null;
      if (!(one && sameBy(one, v, by))) by = v; // la lecture déjà choisie (un 31 : « le dernier jour » ou son quantième) reste telle quelle
      buzz(6); paint(); reveal();
    };
    sayEl.onclick = e => {
      if (!/** @type {HTMLElement} */ (e.target).closest('[data-fix]')) return;
      rep = 'month'; n = 1; by = null; auto = false; buzz(6); paint();
    };
    repEl.onclick = e => {
      const r = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-r]'));
      if (!r || gone) return; // un jour passé ne se répète pas
      rep = /** @type {string} */ (r.dataset.r); n = 1; auto = false; buzz(6); paint(); reveal();
    };
    nEl.onclick = e => {
      const b = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-nm]'));
      if (!b || b.disabled) return;
      n = Math.min(99, Math.max(1, n + Number(b.dataset.nm))); auto = false; buzz(6); paint(); reveal();
    };
    // « Effacer » : plus aucun jour touché, la répétition repart de ce que l'app propose ; on reste sur le mois affiché
    // Effacer revient aussi au mois d'aujourd'hui, sans le cocher (2026-11-27, avec l'utilisateur)
    resetBtn.onclick = () => { sel.clear(); gone = null; rep = 'once'; n = 1; by = null; auto = true; view = t0.slice(0, 7); months = false; buzz(8); paint(); };
    $('[data-ok]', s.el).onclick = () => {
      if (gone) { out = { start: gone, days: [], every: null, interval: 1 }; buzz(12); s.close(); return; }
      const got = current();
      if (!got.when) { sayEl.classList.remove('idle'); sayEl.innerHTML = noticeHTML(esc(got.error || 'Touche au moins un jour.')); buzz(14); return; }
      out = got.when; buzz(12); s.close();
    };
  });
}
