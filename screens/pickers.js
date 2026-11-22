// Feuilles de choix réutilisables : catégorie (la liste partagée de catlist.js), portefeuille (liste), devise, date, jour de
// début du mois.
import { accounts, balances, blocksNegative, reserveById, reserveChain, savingsReport, openReserves } from '../core/store.js';
import { openSheet, buzz, onSwipe, seg, wireSeg, $, $$ } from '../core/ui.js';
import { monthStartLabel as msLabel } from '../domain/month-start.js';
import { icon } from '../core/icons.js';
import { money, esc, ordinal, maskId, CURRENCIES, COMMON, currencyOf, today, approx, shortDate, yearDate } from '../core/format.js';
import { catTreeHTML, catSearchHTML, wireCatSearch, paintTree, NONE_ILLU } from './catlist.js';
import { rowHTML, fieldHTML, sheetHead, emptyState } from './parts.js';

export const ACCOUNT_ICON = { cash: 'money', emoney: 'device-mobile', bank: 'bank' };
// Pastille de portefeuille : icône du type, teinte choisie ; sans choix, teinte du type comme dans les maquettes
// (espèces neutre, monnaie électronique moutarde — acier pour Moov —, banque sarcelle).
/** La couleur d'un portefeuille, fixée par son type (2026-11-18, avec l'utilisateur : plus de couleur à choisir). @param {any} a */
export const defaultTint = a => a?.emergency ? 'c3' : (a?.kind === 'bank' ? 'c8' : a?.kind === 'emoney' ? (/moov/i.test(`${a.id} ${a.name}`) ? 'c7' : 'c2') : 'c10');
// Une épargne (D17) porte une petite tirelire sur sa pastille, partout où elle apparaît (pas de mention « épargne » en texte).
// un compte d'épargne prend la tirelire pour icône (2026-11-18, avec l'utilisateur : le badge posé dessus encombrait) ;
// son type reste écrit à côté (« Épargne · Banque »)
/**
 * La fois ouverte d'une réserve que remplit une échéance : la sienne, ou sa dernière reconduite (comme reserveFor) ; null
 * si toutes sont closes. @param {string|null} id
 */
export function openFillOf(id) {
  if (!id) return null;
  const chain = reserveChain(id);
  const i = chain.findIndex(x => x.id === id);
  return chain.slice(Math.max(0, i)).find(x => !x.closed) || null;
}

/** « 15 oct », avec l'année si ce n'est pas celle-ci. @param {string} d */
const dayShort = d => (d.slice(0, 4) === today().slice(0, 4) ? shortDate(d) : yearDate(d));
/**
 * Une ancienne collecte, qui remplit une réserve (2026-11-19 ; on n'en crée plus depuis le 2026-11-20, l'épargne a un
 * seul versement) : la barre de cette réserve sous sa ligne, et « Remplit … » ; quand ce qui est prévu ne suffira pas,
 * ce qui manquera, ou le jour où elle sera prête.
 * @param {string|null} id la réserve @returns {string}
 */
export function fillsHTML(id) {
  const r = id ? reserveById(id) : null;
  if (!r || r.closed) return '';
  const v = savingsReport(r.wallet).reserves.find(x => x.reserve.id === r.id);
  if (!v) return '';
  const cur = r.currency;
  const tone = v.status === 'overdue' || v.status === 'none' ? ' over' : v.status === 'later' || v.status === 'short' ? ' warn' : '';
  const say = v.status === 'short' ? `<span class="rs-warn">il manquera ${money(approx(v.short, cur), { cur })}</span>`
    : v.status === 'later' ? `<span class="rs-warn">prête le ${dayShort(v.ready)}</span>` : `${money(v.saved, { cur })} sur ${money(v.target, { cur })}`;
  return `<span class="due-fills"><span class="bar rs-bar${tone}"><i style="width:${v.pct}%"></i></span>
    <span class="s">Remplit ${esc(r.name)} · ${say}</span></span>`;
}

// une épargne qui a des réserves : la boîte à tiroirs (l'argent rangé par réserve) ; vide ou avec un objectif : la tirelire
// (2026-11-20, avec l'utilisateur : le type suit ce qu'elle contient, personne ne le choisit)
const savingsIcon = (/** @type {any} */ a) => (a?.id && openReserves(a.id).length ? 'archive' : 'piggy-bank');
export const accountPill = (a, size = '') => `<span class="pill ${size}" style="--c:var(--${defaultTint(a)})"${a?.savings ? ' aria-label="Épargne"' : ''}>${icon(a?.emergency ? 'lifebuoy' : a?.savings ? savingsIcon(a) : ACCOUNT_ICON[a?.kind] || 'wallet')}</span>`;
// Petit badge « négatif » (solde sous zéro alors que le négatif est refusé).
export const negBadge = (a, bal) => (bal < 0 && blocksNegative(a) ? '<span class="badge-neg">négatif</span>' : '');

// Grille de catégories ; résout l'id choisi, ou null si on ferme. all : case « Toutes » pour les filtres.
export function pickCategory({ type = 'expense', current = null, title = 'Catégorie', all = false } = {}) {
  return new Promise(resolve => {
    let picked = null;
    // la liste partagée (catlist.js) ; type 'any' : dépenses puis revenus ; all : « Toutes les catégories » en tête
    const types = type === 'any' ? [['expense', 'Dépenses'], ['income', 'Revenus']] : [[type, '']];
    const allRow = all ? `<div class="group cl-g">${rowHTML({ cls: `cl-row${current === '*' ? ' on' : ''}`, attrs: 'data-cat="*"', pill: `<span class="pill">${icon('squares-four')}</span>`,
      title: 'Toutes les catégories', end: current === '*' ? `<span class="end">${icon('check')}</span>` : '' })}</div>` : '';
    const s = openSheet(`${sheetHead({ title })}
      ${catSearchHTML()}
      <div class="cl" data-tree>${allRow}${types.map(([t, label]) => `${label ? `<div class="section-h cl-h"><h2>${label}</h2></div>` : ''}<div data-part>${catTreeHTML({ type: t, current })}</div>`).join('')}</div>
      <div class="cl-none" data-none hidden>${NONE_ILLU}<p class="cl-none-t">Aucune catégorie trouvée.</p></div>`, {
      cls: 'pick-sheet', label: title, onClose: () => resolve(picked),
    });
    const tree = $('[data-tree]', s.el);
    $$('[data-part]', tree).forEach(paintTree);
    wireCatSearch(tree, $('input[data-q]', s.el), (total, text) => {
      $('[data-none]', s.el).hidden = total > 0;
      // pendant une recherche : sans « Toutes les catégories » ni intertitre d'une partie vide
      tree.classList.toggle('filtering', !!text.trim());
      $$('[data-part]', tree).forEach(p => { paintTree(p); const h = p.previousElementSibling; if (h?.classList.contains('cl-h')) h.hidden = !$$('[data-g]', p).some(g => !g.hidden); });
    });
    const on = $('.cl-row.on', tree);
    if (on) requestAnimationFrame(() => on.scrollIntoView({ block: 'center' }));
    $$('[data-cat]', tree).forEach(b => (b.onclick = () => { picked = b.dataset.cat; buzz(10); s.close(); }));
  });
}

// Aucun portefeuille (D10) : une phrase et un +, partout où l'on montre les portefeuilles. Rien n'est proposé d'avance :
// le + ouvre la fiche de création, qui parle d'elle-même. Le + porte data-new-wallet (à brancher par l'écran).
export const noWalletsHTML = (text = 'Pas encore de portefeuille') => emptyState(text, { add: ['data-new-wallet', 'Nouveau portefeuille'] });

// Liste de portefeuilles avec solde. exclude : portefeuille à masquer ; currency : seuls ceux de cette devise sont
// proposés (virement : jamais entre deux devises, et on ne montre pas ce qu'on ne peut pas choisir).
// spending (2026-11-13) : le portefeuille d'une dépense — une épargne qui ne permet pas les dépenses n'y est pas proposée
export function pickAccount({ current = null, exclude = null, currency = null, title = 'Portefeuille', all = false, spending = false } = {}) {
  return new Promise(resolve => {
    let picked = null;
    const bal = balances();
    const list = accounts().filter(a => a.id !== exclude && (!currency || a.currency === currency) && !(spending && a.savings && !a.spendOk));
    const rows = (all ? [rowHTML({ attrs: 'data-id="*"', pill: `<span class="pill acc">${icon('wallet')}</span>`, title: 'Tous les portefeuilles', end: current === null ? icon('check', 'check') : '' })] : [])
      .concat(list.map(a => {
        const b = bal[a.id] || 0;
        return rowHTML({ attrs: `data-id="${a.id}"`, pill: accountPill(a), title: `${esc(a.name)}${negBadge(a, b)}`,
          sub: money(b, { cur: a.currency }), subCls: b < 0 ? 'loss' : '', end: a.id === current ? icon('check', 'check') : '' });
      }));
    const none = currency ? `Aucun autre portefeuille en ${esc(currencyOf(currency).long)}.` : 'Pas encore de portefeuille.';
    const s = openSheet(`${sheetHead({ title })}${rows.length
      ? `<div class="group list-pick pick-end">${rows.join('')}</div>`
      : `<p class="muted pick-none">${none}</p>`}`, {
      label: title, onClose: () => resolve(picked),
    });
    $$('.row', s.el).forEach(b => (b.onclick = () => { picked = b.dataset.id; buzz(10); s.close(); }));
  });
}

// Devise : la devise actuelle, les courantes, puis toutes les autres par nom ; une recherche (nom ou code) filtre la liste.
const fold = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** @param {{ current?: any, title?: string }} [o] */
export function pickCurrency({ current, title = 'Devise' } = {}) {
  return new Promise(resolve => {
    let picked = null;
    const byName = (a, b) => a.name.localeCompare(b.name, 'fr');
    const common = COMMON.map(code => currencyOf(code));
    const rest = CURRENCIES.filter(c => !COMMON.includes(c.code)).sort(byName);
    const row = c => rowHTML({ attrs: `data-c="${c.code}" data-q="${esc(fold(`${c.code} ${c.name} ${c.long}`))}"`, pill: `<span class="pill acc cur-pill">${esc(c.sym)}</span>`,
      title: esc(c.name), sub: `${c.code}${c.sym !== c.code ? ` · ${esc(c.sym)}` : ''}`, end: c.code === current ? icon('check', 'check') : '' });
    const s = openSheet(`${sheetHead({ title })}
      <label class="search cat-find">${icon('magnifying-glass')}<span class="sr">Rechercher une devise</span><input data-q type="search" placeholder="Nom ou code (ex. euro, KES)" autocomplete="off" enterkeyhint="search"></label>
      <div class="eyebrow cur-h" data-h>Courantes</div>
      <div class="group list-pick" data-common>${common.map(row).join('')}</div>
      <div class="eyebrow cur-h" data-h>Toutes les devises</div>
      <div class="group list-pick pick-end" data-rest>${rest.map(row).join('')}</div>
      <p class="muted pick-none" data-none hidden>Aucune devise trouvée.</p>`, {
      label: title, onClose: () => resolve(picked),
    });
    $$('[data-c]', s.el).forEach(b => (b.onclick = () => { picked = b.dataset.c; buzz(10); s.close(); }));
    const q = $('input[data-q]', s.el);
    q.addEventListener('input', () => {
      const t = fold(q.value.trim());
      // en recherchant : titres masqués, chaque liste ne garde que ses lignes trouvées (les deux listes sont disjointes)
      let total = 0;
      for (const sel of ['[data-common]', '[data-rest]']) {
        const g = $(sel, s.el);
        let n = 0;
        // au début d'un mot : « yen » trouve le yen, pas « uruguayen »
        $$('[data-c]', g).forEach(b => { const on = !t || ` ${b.dataset.q}`.includes(` ${t}`); b.hidden = !on; n += on ? 1 : 0; });
        g.hidden = !n;
        total += n;
      }
      $$('[data-h]', s.el).forEach(h => (h.hidden = !!t));
      $('[data-none]', s.el).hidden = total > 0;
    });
  });
}

// Date (D14) : calendrier maison, mois par mois (la semaine commence le lundi), « Aujourd'hui » pour revenir ; toucher
// le titre montre les 12 mois de l'année (‹ › change d'année) pour sauter loin. Hier / Avant-hier se font sur l'écran de
// saisie (‹ ›). Jours et mois à venir : éteints, sauf future = true (opération déjà prévue qu'on modifie). Résout
// « AAAA-MM-JJ », ou null.
const fmtCalMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const fmtMonthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
/** @param {{ current?: any, title?: string, future?: boolean, min?: string|null }} [o] */
// future : les jours à venir se choisissent (fin d'un budget) ; min : rien avant cette date (grisé et éteint)
export function pickDate({ current, title = 'Date', future = false, min = null } = {}) {
  return new Promise(resolve => {
    let picked = null;
    const t0 = today(), y0 = Number(t0.slice(0, 4));
    let view = current.slice(0, 7), months = false;
    const s = openSheet(`${sheetHead({ title })}
      <div class="dq"><button type="button" class="sc${t0 === current ? ' on' : ''}" data-d="${t0}">Aujourd’hui</button></div>
      <div class="cal">
        <div class="cal-h"><button type="button" class="iconbtn" data-m="-1">${icon('caret-left')}</button>
          <button type="button" class="cal-t" data-title aria-expanded="false"><b></b>${icon('caret-down')}</button>
          <button type="button" class="iconbtn" data-m="1">${icon('caret-right')}</button></div>
        <div class="cal-w" data-week aria-hidden="true">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<span>${x}</span>`).join('')}</div>
        <div class="cal-g" data-grid role="grid"></div>
      </div>`, { label: title, onClose: () => resolve(picked) });
    const grid = $('[data-grid]', s.el), head = $('[data-title]', s.el), prev = $('[data-m="-1"]', s.el), next = $('[data-m="1"]', s.el);
    const paint = () => {
      const [y, mo] = view.split('-').map(Number);
      head.setAttribute('aria-expanded', String(months));
      $('[data-week]', s.el).hidden = months;
      grid.classList.toggle('months', months);
      if (months) {
        // les 12 mois de l'année affichée ; ‹ › changent d'année
        $('b', head).textContent = String(y);
        prev.setAttribute('aria-label', 'Année précédente'); next.setAttribute('aria-label', 'Année suivante');
        let html = '';
        for (let m = 1; m <= 12; m++) {
          const ym = `${y}-${String(m).padStart(2, '0')}`;
          const later = ym > t0.slice(0, 7);
          html += `<button type="button" class="cm${ym === view ? ' on' : ''}${ym === t0.slice(0, 7) ? ' now' : ''}" data-ym="${ym}"${later && !future ? ' disabled' : ''}>${cap(fmtMonthShort.format(new Date(y, m - 1, 1)).replace('.', ''))}</button>`;
        }
        grid.innerHTML = html;
        next.disabled = !future && y >= y0;
        return;
      }
      const first = new Date(y, mo - 1, 1);
      const days = new Date(y, mo, 0).getDate();
      const lead = (first.getDay() + 6) % 7; // lundi = 0
      $('b', head).textContent = cap(fmtCalMonth.format(first));
      prev.setAttribute('aria-label', 'Mois précédent'); next.setAttribute('aria-label', 'Mois suivant');
      let html = '<span></span>'.repeat(lead);
      for (let d = 1; d <= days; d++) {
        const iso = `${view}-${String(d).padStart(2, '0')}`;
        // grisés et éteints : les jours à venir pour une opération, les jours avant `min` (fin d'un budget)
        const off = (iso > t0 && !future) || (!!min && iso < min);
        html += `<button type="button" class="cd${iso === current ? ' on' : ''}${iso === t0 ? ' now' : ''}${off ? ' later' : ''}" data-d="${iso}"${off ? ' disabled' : ''}>${d}</button>`;
      }
      grid.innerHTML = html;
      next.disabled = !future && view >= t0.slice(0, 7); // pas de mois à venir
    };
    paint();
    const step = n => {
      const [y, mo] = view.split('-').map(Number);
      const d = months ? new Date(y + n, mo - 1, 1) : new Date(y, mo - 1 + n, 1);
      view = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      // une année à venir garde au plus le mois courant (pas de mois à venir sans « future »)
      if (!future && view > t0.slice(0, 7)) view = t0.slice(0, 7);
      buzz(6); paint();
    };
    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    // changer de mois (ou d'année) d'un glissement sur le calendrier, comme les flèches (2026-11-18)
    onSwipe(grid, { left: () => { if (!next.disabled) step(1); }, right: () => { if (!prev.disabled) step(-1); } });
    head.onclick = () => { months = !months; buzz(6); paint(); };
    s.el.addEventListener('click', e => {
      const m = e.target.closest('[data-ym]');
      if (m && !m.disabled) { view = m.dataset.ym; months = false; buzz(6); paint(); return; }
      const b = e.target.closest('[data-d]');
      if (!b || b.disabled) return;
      picked = b.dataset.d; buzz(10); s.close();
    });
  });
}

// Début du mois (revu le 2026-11-19, avec l'utilisateur) : un jour fixe (1-28), un jour de la semaine (« le 2e lundi »,
// « le dernier vendredi ») ou la fin du mois (le dernier jour, le dernier jour ouvré). Résout la règle, ou null.
/** @param {number|string} current */
export function pickMonthStart(current) {
  return new Promise(resolve => {
    let picked = null;
    const wk = typeof current === 'string' && current.startsWith('w:') ? current.split(':') : ['w', '1', '1'];
    let mode = typeof current === 'number' ? 'day' : current === 'last' || current === 'work' ? 'end' : 'week';
    let rank = wk[1], day = wk[2];
    const s = openSheet(`${sheetHead({ title: 'Début du mois' })}
      <p class="screen-help">Le jour où ton mois commence, par exemple le jour de la paie.</p>
      ${seg([['day', 'Un jour'], ['week', 'Jour de semaine'], ['end', 'Fin de mois']], mode, 'ms-mode')}
      <div data-p="day" class="ms-p"><div class="daynum-grid">${Array.from({ length: 28 }, (_, i) => i + 1).map(d => `<button type="button" data-d="${d}" class="${d === current ? 'on' : ''}">${d}</button>`).join('')}</div></div>
      <div data-p="week" class="ms-p">
        ${fieldHTML({ label: 'Lequel', control: seg([['1', '1er'], ['2', '2e'], ['3', '3e'], ['4', '4e'], ['L', 'Dernier']], rank, 'ms-rank') })}
        ${fieldHTML({ label: 'Jour', control: seg([['1', 'Lun'], ['2', 'Mar'], ['3', 'Mer'], ['4', 'Jeu'], ['5', 'Ven'], ['6', 'Sam'], ['7', 'Dim']], day, 'ms-day') })}
        <p class="ms-say" data-say></p>
        <button type="button" class="btn primary" data-week>${icon('check')}Valider</button></div>
      <div data-p="end" class="ms-p"><div class="group plain">
        ${rowHTML({ attrs: 'data-end="last"', title: 'Le dernier jour du mois', end: current === 'last' ? icon('check') : '' })}
        ${rowHTML({ attrs: 'data-end="work"', title: 'Le dernier jour ouvré', sub: 'Du lundi au vendredi', end: current === 'work' ? icon('check') : '' })}
      </div></div>`, {
      label: 'Début du mois', onClose: () => resolve(picked),
    });
    const paint = () => {
      $$('[data-p]', s.el).forEach(p => { p.hidden = p.dataset.p !== mode; });
      $('[data-say]', s.el).textContent = `${msLabel(`w:${rank}:${day}`)} de chaque mois`;
    };
    paint();
    wireSeg($('.ms-mode', s.el), v => { mode = v; buzz(6); paint(); });
    wireSeg($('.ms-rank', s.el), v => { rank = v; buzz(6); paint(); });
    wireSeg($('.ms-day', s.el), v => { day = v; buzz(6); paint(); });
    const done = (/** @type {number|string} */ v) => { picked = v; buzz(10); s.close(); };
    $$('[data-d]', s.el).forEach(b => (b.onclick = () => done(Number(b.dataset.d))));
    $('[data-week]', s.el).onclick = () => done(`w:${rank}:${day}`);
    $$('[data-end]', s.el).forEach(b => (b.onclick = () => done(/** @type {string} */ (b.dataset.end))));
  });
}
/** « Le 25 », « Le 2e lundi », « Le dernier jour ouvré »… @param {number|string} d */
export const monthStartLabel = d => msLabel(d);

// Teintes proposées (D8) : 10 teintes ; c0 (même teinte que c10, Ardoise) reste lisible mais n'est pas proposé.
export const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'];
export const COLOR_NAMES = { c1: 'Olive', c2: 'Moutarde', c3: 'Ocre', c4: 'Terre', c5: 'Rose', c6: 'Prune', c7: 'Acier', c8: 'Sarcelle', c9: 'Sable', c10: 'Ardoise', c0: 'Ardoise' };
// Couleur choisie depuis la pastille de la fiche (2026-11-10) : un petit pinceau sur la pastille ouvre cette feuille ;
// la rangée de couleurs ne prend plus de place dans la fiche. Résout la couleur ('' = neutre) ou undefined (fermée).
/** @param {{ current: string|null, none?: boolean, title?: string }} o @returns {Promise<string|undefined>} */
export function pickColor({ current, none = false, title = 'Couleur' }) {
  return new Promise(resolve => {
    let picked;
    const s = openSheet(`${sheetHead({ title })}${swatches(current, { none })}`, { label: title, onClose: () => resolve(picked) });
    s.el.querySelectorAll('[data-color]').forEach(b => (b.onclick = () => { picked = /** @type {HTMLElement} */ (b).dataset.color || ''; buzz(8); s.close(); }));
  });
}
/** Pinceau posé sur une pastille (bouton de la couleur). */
export const brushHTML = () => `<span class="brush" aria-hidden="true">${icon('paint-brush')}</span>`;

// Rangée de pastilles de couleur ; none : première pastille « neutre » (valeur vide).
export const swatches = (current, { none = false } = {}) => `<div class="swatches" role="radiogroup">${none
  ? `<button type="button" class="sw none${!current ? ' on' : ''}" data-color="" aria-label="Neutre"></button>` : ''}${COLORS
  .map(c => `<button type="button" class="sw${c === current || (c === 'c10' && current === 'c0') ? ' on' : ''}" data-color="${c}" style="--c:var(--${c})" aria-label="${COLOR_NAMES[c]}"></button>`).join('')}</div>`;
