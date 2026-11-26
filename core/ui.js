// Outils d'interface partagés : retour haptique, feuilles du bas, toasts, confirmation,
// chiffres qui défilent, pavé calculatrice.
import { settings } from './store.js';
import { money, num, symbol, symFirst, unitDec, inputDec, groupSep, decSep, esc } from './format.js';
import { icon, catIcon } from './icons.js';
import { evalAmount } from '../domain/money.js';

// any : les appelants lisent .value, .disabled, .click()… selon le sélecteur (les éléments sont de types variés)
/** @type {(sel: string, root?: ParentNode) => any} */
export const $ = (sel, root = document) => root.querySelector(sel);
/** @type {(sel: string, root?: ParentNode) => any[]} */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Retour haptique léger (D5 : touche 8 ms, ajout 12 ms, fin d'animation 6 ms, erreur [10, 40, 10]),
// si le téléphone le permet et si le réglage est actif.
/** @param {number | number[]} [ms] */
export function buzz(ms = 10) {
  if (settings().haptics === false || !navigator.vibrate) return;
  // le navigateur refuse la vibration tant que l'utilisateur n'a pas touché l'écran
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate(ms); } catch (e) {}
}

// ---------- feuilles du bas ----------
// Pile de feuilles ; chacune pousse une entrée d'historique pour que « retour » la ferme.
const stack = [];
let pendingBacks = 0;
const settled = [];
window.addEventListener('popstate', () => {
  if (pendingBacks > 0) {
    pendingBacks--;
    if (!pendingBacks) settled.splice(0).forEach(fn => fn());
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  // un saut dans l'historique qui change d'adresse (menu du navigateur) : on suit, sans garde-fou (la page change)
  if (location.href !== top.href) top.close({ fromHistory: true });
  else top.dismiss('back', { fromHistory: true });
});
export const sheetOpen = () => stack.length > 0;
// Lance fn quand l'historique a fini de reculer après la fermeture des feuilles : changer d'adresse avant ferait
// reculer la nouvelle adresse au lieu de l'entrée de la feuille.
// le champ touché reste visible (2026-11-20) : quand le clavier s'ouvre ou change de hauteur, on le ramène dans la vue
if (typeof document !== 'undefined') {
  const keep = () => { const el = /** @type {HTMLElement|null} */ (document.activeElement); if (el && el.matches('input, textarea, [contenteditable]')) el.scrollIntoView({ block: 'nearest' }); };
  document.addEventListener('focusin', () => setTimeout(keep, 320));
  window.addEventListener('resize', () => setTimeout(keep, 60));
}
export function afterSheets(fn) { if (pendingBacks) settled.push(fn); else fn(); }
// ferme la feuille du dessus (bouton retour Android), en passant par son garde-fou
export function closeTopSheet() { const t = stack[stack.length - 1]; if (t) t.dismiss('back'); }

// html : contenu ; options : cls (classe en plus), onClose, label (nom de la feuille pour l'accessibilité),
// beforeClose(raison) : garde-fou des fermetures qu'on peut faire sans le vouloir — 'scrim' (fond touché), 'drag'
// (glissé vers le bas), 'back' (Retour) ; il renvoie true (fermer), 'stay' (la feuille tremble et reste) ou 'ask'
// (« Abandonner cette saisie ? »). close() (croix, enregistrement) ne passe jamais par lui.
export function openSheet(html, { cls = '', onClose = null, label = '', beforeClose = null } = {}) {
  const layer = document.createElement('div');
  layer.className = 'layer';
  // ✕ partout (2026-11-11) : une fiche sans son propre ✕ (data-close, dans son en-tête) en reçoit un, en haut à droite,
  // dans son contenu : il défile avec lui
  const x = /\sdata-close(?![\w-])/.test(html) ? '' : `<button type="button" class="iconbtn soft close sheet-x" data-sheet-x aria-label="Fermer">${icon('x')}</button>`;
  layer.innerHTML = `<div class="scrim"></div><div class="sheet ${cls}${x ? ' has-x' : ''}" role="dialog" aria-modal="true" aria-label="${String(label).replace(/"/g, '&quot;')}">
    <div class="grip" aria-hidden="true"><span></span></div><div class="sheet-body">${x}${html}</div></div>`;
  document.body.appendChild(layer);
  const sheet = $('.sheet', layer);
  let closed = false, asking = false;
  const api = {
    el: sheet,
    href: location.href, // adresse de la page sous la feuille
    body: $('.sheet-body', sheet),
    close({ fromHistory = false } = {}) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      if (!fromHistory) { pendingBacks++; history.back(); }
      layer.classList.remove('open');
      sheet.style.transform = '';
      const done = () => { layer.remove(); if (onClose) onClose(); };
      if (reducedMotion()) done(); else setTimeout(done, 460);
      if (!stack.length) document.documentElement.classList.remove('has-sheet');
    },
    async dismiss(reason, { fromHistory = false } = {}) {
      // pendant la question (ou après « Abandonner », le temps que l'historique recule) : pas de deuxième question
      if (closed || asking) return;
      const g = beforeClose ? beforeClose(reason) : true;
      if (g === true) return api.close({ fromHistory });
      // la feuille reste : Retour a déjà retiré son entrée d'historique, on la remet (le prochain Retour la retrouve)
      if (fromHistory) history.pushState({ sheet: stack.indexOf(api) + 1 }, '');
      sheet.style.transform = '';
      if (g === 'ask') {
        buzz(10);
        asking = true;
        const ok = await confirmSheet({ title: 'Abandonner cette saisie ?', text: 'Ce que tu as tapé sera perdu.', yes: 'Abandonner', danger: true, cancel: 'Continuer' });
        if (ok) afterSheets(() => api.close());
        else asking = false;
      } else shake(sheet);
    },
  };
  stack.push(api);
  history.pushState({ sheet: stack.length }, '');
  document.documentElement.classList.add('has-sheet');
  $('.scrim', layer).addEventListener('click', () => api.dismiss('scrim'));
  const xb = $('[data-sheet-x]', layer);
  if (xb) xb.addEventListener('click', () => { buzz(6); api.dismiss('x'); });
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
  dragToDismiss(sheet, api);
  return api;
}
// silent : ne touche pas à l'historique (on change déjà de page).
export function closeAllSheets({ silent = false } = {}) {
  const all = [...stack].reverse();
  all.forEach(s => s.close({ fromHistory: true }));
  // un seul recul pour toutes leurs entrées (plusieurs history.back() de suite peuvent n'en faire qu'un)
  if (!silent && all.length) { pendingBacks++; history.go(-all.length); }
}

// Glisser la poignée (ou le haut de la feuille) vers le bas pour fermer.
function dragToDismiss(sheet, api) {
  let y0 = null, t0 = 0, dy = 0;
  const grip = $('.grip', sheet);
  grip.addEventListener('pointerdown', e => {
    y0 = e.clientY; t0 = performance.now(); dy = 0;
    grip.setPointerCapture(e.pointerId);
    sheet.classList.add('dragging');
  });
  grip.addEventListener('pointermove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    y0 = null;
    sheet.classList.remove('dragging');
    if (dy > 110 || v > 0.6) api.dismiss('drag');
    else sheet.style.transform = '';
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// ---------- toast ----------
let toastTimer = 0;
export function toast(text, action = null) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  // texte simple, jamais du HTML : les messages reprennent des noms saisis (« Espèces est archivé. »)
  const span = document.createElement('span');
  span.textContent = String(text ?? '');
  t.replaceChildren(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { action.run(); hide(); buzz(8); };
    t.appendChild(b);
  }
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  function hide() { t.classList.remove('show'); }
  toastTimer = setTimeout(hide, action ? 4500 : 2200);
}

// ---------- confirmation ----------
// cancel : false pour une simple information (un seul bouton).
// Pages de gestion (Portefeuilles, Moi › Catégories, D9) : le bouton « Ranger » (icône flèches haut-bas) montre les
// poignées (classe .arranging sur l'écran), la croix les cache ; pendant le rangement, toucher une ligne ne fait rien
// d'autre. onToggle(on) : ce que la page fait en plus (ex. refermer la loupe). L'état est gardé par page
// (key) tant qu'on y reste : un glisser enregistré redessine la page sans quitter le rangement ; changer de page l'oublie.
const arranging = {};
window.addEventListener('hashchange', () => { for (const k of Object.keys(arranging)) delete arranging[k]; });
export const isArranging = key => !!arranging[key];
export function wireArrange(screen, btn, key, onToggle) {
  const paint = () => {
    const on = !!arranging[key];
    screen.classList.toggle('arranging', on);
    btn.innerHTML = icon(on ? 'x' : 'arrows-down-up');
    btn.setAttribute('aria-label', on ? 'Terminer le rangement' : 'Ranger');
    btn.setAttribute('aria-pressed', String(on));
  };
  paint();
  btn.onclick = () => { arranging[key] = !arranging[key]; buzz(6); paint(); onToggle?.(arranging[key]); };
}
// Bouton « Ranger » d'une barre du haut (l'icône est posée par wireArrange).
export const arrangeBtnHTML = () => '<button type="button" class="iconbtn" data-arrange aria-label="Ranger"></button>';
// Bouton + flottant des pages de gestion : ajouter sans défiler jusqu'en bas de la liste.
export const fabHTML = label => `<button type="button" class="fab-add" data-add aria-label="${String(label).replace(/"/g, '&quot;')}">${icon('plus')}</button>`;

// Menu d'actions (bouton ⋯) : une ligne par action. title, label et note sont du HTML : l'appelant échappe les noms
// saisis (esc). Idem pour confirmSheet (title, text). items : { key, icon, label, danger?, off? (éteinte), note? (raison
// écrite dessous) }. Résout la clé choisie, ou null si on ferme.
export function menuSheet({ title, items, text = '' }) {
  return new Promise(resolve => {
    let picked = null;
    const s = openSheet(`<h2 class="sheet-title">${title}</h2>${text ? `<p class="muted menu-say">${text}</p>` : ''}
      <div class="group menu">${items.map(it => `<button type="button" class="row menu-row${it.danger ? ' danger' : ''}" data-k="${it.key}"${it.off ? ' disabled' : ''}>
        <span class="pill acc">${icon(it.icon)}</span><div class="main"><div class="t">${it.label}</div>${it.note ? `<div class="s wrap">${it.note}</div>` : ''}</div></button>`).join('')}</div>`, {
      label: title, onClose: () => resolve(picked),
    });
    $$('[data-k]', s.el).forEach(b => (b.onclick = () => { if (b.disabled) return; picked = b.dataset.k; buzz(8); s.close(); }));
  });
}

/** @param {{ title: string, text?: string, yes?: string, danger?: boolean, cancel?: string | false }} o */
export function confirmSheet({ title, text = '', yes = 'Confirmer', danger = false, cancel = 'Annuler' }) {
  return new Promise(resolve => {
    let answered = false;
    const s = openSheet(`<div class="confirm">
      <h2 class="sheet-title">${title}</h2>${text ? `<p class="muted">${text}</p>` : ''}
      <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${yes}</button>
      ${cancel ? `<button class="btn ghost" data-no>${cancel}</button>` : ''}</div>`, {
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-yes]', s.el).onclick = () => { answered = true; buzz(12); s.close(); resolve(true); };
    if (cancel) $('[data-no]', s.el).onclick = () => s.close();
  });
}

/**
 * Saisie d'un texte court dans une feuille (nom d'un espace…). Renvoie le texte, ou null si la feuille est refermée.
 * check(texte) peut refuser en renvoyant un message (la feuille reste ouverte et l'affiche).
 * @param {{ title: string, text?: string, label?: string, value?: string, placeholder?: string, yes?: string, danger?: boolean, max?: number, check?: (v: string) => string|null, mode?: string }} o
 */
export function promptSheet({ title, text = '', label = 'Nom', value = '', placeholder = '', yes = 'Valider', danger = false, max = 30, check = () => null, mode = '' }) {
  return new Promise(resolve => {
    let answer = null;
    const s = openSheet(`<div class="confirm">
      <h2 class="sheet-title">${title}</h2>${text ? `<p class="muted">${text}</p>` : ''}
      <label class="field"><span>${label}</span><input data-v maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="sentences"${mode ? ` inputmode="${mode}"` : ''}></label>
      <p class="field-note" data-err hidden></p>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${yes}</button>
      <button class="btn ghost" data-no>Annuler</button></div>`, {
      label: title, onClose: () => resolve(answer),
    });
    const input = /** @type {HTMLInputElement} */ ($('[data-v]', s.el));
    const err = /** @type {HTMLElement} */ ($('[data-err]', s.el));
    const go = () => {
      const v = input.value.trim();
      const bad = check(v);
      if (bad) { err.textContent = bad; err.hidden = false; shake(input); return; }
      answer = v; buzz(12); s.close();
    };
    $('[data-yes]', s.el).onclick = go;
    input.onkeydown = e => { if (e.key === 'Enter') go(); };
    input.oninput = () => { err.hidden = true; };
    $('[data-no]', s.el).onclick = () => s.close();
    setTimeout(() => focusEnd(input), 350);
  });
}

/**
 * Glisser à gauche ou à droite sur un élément (2026-11-18, avec l'utilisateur : changer de mois dans les calendriers d'un
 * geste) : un mouvement surtout horizontal d'au moins 40 px. left : le doigt part vers la gauche (la suite).
 * @param {HTMLElement} el @param {{ left?: () => void, right?: () => void }} o
 */
export function onSwipe(el, { left, right }) {
  let x0 = 0, y0 = 0, t0 = 0, on = false;
  el.addEventListener('touchstart', e => { const p = e.touches[0]; x0 = p.clientX; y0 = p.clientY; t0 = Date.now(); on = e.touches.length === 1; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!on) return;
    on = false;
    const p = e.changedTouches[0], dx = p.clientX - x0, dy = p.clientY - y0;
    if (Date.now() - t0 > 800 || Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) left?.(); else right?.();
  }, { passive: true });
}

// ---------- chiffres qui défilent ----------
// Les éléments [data-count="clé"] gardent leur dernière valeur : au rendu suivant ils défilent de l'ancienne à la nouvelle.
const lastValues = new Map();
// un autre espace (D19) : ses chiffres ne défilent pas depuis ceux de l'espace d'avant
if (typeof window !== 'undefined') window.addEventListener('bougette:space', () => lastValues.clear());
export function countUp(root, opts = {}) {
  $$('[data-count]', root).forEach(el => {
    const key = el.dataset.count;
    const to = Number(el.dataset.value);
    const sign = el.dataset.sign === '1';
    const cur = el.dataset.cur || undefined;
    const from = lastValues.has(key) ? lastValues.get(key) : (opts.fromZero ? 0 : to);
    lastValues.set(key, to);
    const fmt = v => (el.dataset.plain === '1' ? num(v, { cur }) : money(v, { sign, cur }));
    if (from === to || reducedMotion()) { el.innerHTML = gs(fmt(to)); return; }
    const t0 = performance.now(), dur = 520;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 4);
      el.innerHTML = gs(fmt(Math.round(from + (to - from) * e)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ---------- pavé calculatrice ----------
// Calcul simple : nombres + − × ÷, priorité de × et ÷. Valeurs saisies en unités affichées (avec décimales si la devise en a).
const OPS = { '+': '+', '−': '-', '×': '*', '÷': '/' };
export function evaluate(expr) {
  const tokens = expr.match(/\d+(?:,\d*)?|[+−×÷]/g) || [];
  if (!tokens.length) return 0;
  if (/[+−×÷]/.test(tokens[tokens.length - 1])) tokens.pop();
  const vals = [], ops = [];
  const prec = o => (o === '×' || o === '÷' ? 2 : 1);
  const apply = () => {
    const b = vals.pop(), a = vals.pop(), o = ops.pop();
    vals.push(o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? a : a / b);
  };
  for (const t of tokens) {
    if (OPS[t]) {
      while (ops.length && prec(ops[ops.length - 1]) >= prec(t)) apply();
      ops.push(t);
    } else vals.push(parseFloat(t.replace(',', '.')) || 0);
  }
  while (ops.length) apply();
  return vals[0] || 0;
}
// Convertit en entier (plus petite unité de la devise) et inversement. L'expression interne garde la virgule
// comme signe décimal ; l'affichage utilise le signe réglé.
export const toMinor = (v, cur) => Math.max(0, Math.round(v * 10 ** unitDec(cur)));
// Expression du pavé → entier (calcul exact, arrondi demi vers le pair : src/domain/money.js), jamais négatif.
export const exprMinor = (expr, cur) => Math.max(0, evalAmount(expr, unitDec(cur)));
export const fromMinor = (a, cur) => {
  const d = unitDec(cur);
  if (!a) return '';
  const s = (a / 10 ** d).toFixed(d);
  return d ? s.replace('.', ',').replace(/,?0+$/, '') : s;
};

// Monte un pavé dans `host` (D4) : rangée légère d'opérateurs + − × ÷ (l'actif en indigo), chiffres en gélules
// (1 2 3 / … / 000 ou décimale, 0, effacer). Pas de touche « = » : le résultat se lit en direct.
// Renvoie { value(), expr(), hasOp(), resolve(), set(minor) } ; onChange(minor, expr, key) à chaque touche.
// cur : devise du portefeuille ; la touche décimale n'apparaît que si le format affiche des décimales et que la devise en a.
/** @param {HTMLElement} host @param {{ initial?: number, ops?: boolean, cur?: any, onChange?: Function, onEnter?: Function | null }} [o] */
export function keypad(host, { initial = 0, ops = true, cur, onChange = () => {}, onEnter = null } = {}) {
  let expr = fromMinor(initial, cur);
  // curseur (2026-11-10) : position dans l'expression ; à la fin par défaut. Toucher un chiffre le déplace (setCaret) ;
  // le pavé insère et efface alors à cet endroit.
  let pos = expr.length;
  const idec = inputDec(cur);
  const dec = idec > 0;
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', dec ? ',' : '000', '0', 'del'];
  const OP_LABEL = { '+': 'Plus', '−': 'Moins', '×': 'Fois', '÷': 'Divisé par' };
  host.classList.add('keypad');
  host.innerHTML = (ops ? `<div class="ops">${Object.keys(OPS).map(k => `<button type="button" class="op" data-k="${k}" aria-label="${OP_LABEL[k]}">${k}</button>`).join('')}</div>` : '')
    + `<div class="digits">${digits.map(k => {
      if (k === 'del') return `<button type="button" class="key fn" data-k="del" aria-label="Effacer (garde appuyé pour tout effacer)">${icon('backspace')}</button>`;
      if (k === ',') return `<button type="button" class="key" data-k="," aria-label="Séparateur décimal">${decSep()}</button>`;
      return `<button type="button" class="key" data-k="${k}">${k}</button>`;
    }).join('')}</div>`;
  const lastNum = () => (expr.match(/[\d,]*$/) || [''])[0];
  const paintOps = () => {
    // l'opérateur en cours reste allumé pendant qu'on tape le nombre qui suit (D4, maquette Saisie)
    const last = (expr.match(/[+−×÷]/g) || []).pop() || null;
    $$('.op', host).forEach(b => b.classList.toggle('act', b.dataset.k === last));
  };
  const emit = k => { paintOps(); onChange(exprMinor(expr, cur), expr, k); };
  /** Une expression tapable : nombres valides séparés par un opérateur, au plus un opérateur à la fin. @param {string} x */
  const valid = x => {
    if (/^[+−×÷]/.test(x) || /[+−×÷]{2}/.test(x)) return false;
    return x.split(/[+−×÷]/).every(n => {
      if (n === '') return true;
      if (!/^\d+(,\d*)?$/.test(n)) return false;
      const [i, f] = n.split(',');
      if (f !== undefined && (!dec || f.length > idec)) return false;
      // zéros en tête permis pendant la saisie (2026-11-18, avec l'utilisateur : effacer le 3 de 3 000 était refusé) ;
      // le montant vaut alors ce que disent les chiffres, et c'est l'enregistrement qui refuse un montant nul
      return i.length <= 11;
    });
  };
  /** Édition au milieu de l'expression (curseur déplacé). @param {string} k */
  function pressAt(k) {
    let next = expr, np = pos;
    if (k === 'del') { if (!pos) return; next = expr.slice(0, pos - 1) + expr.slice(pos); np = pos - 1; }
    else if (k === 'clear') { next = ''; np = 0; }
    else { next = expr.slice(0, pos) + k + expr.slice(pos); np = pos + k.length; }
    if (!valid(next)) { buzz([10, 40, 10]); return; }
    expr = next; pos = np;
    buzz(8);
    emit(k);
  }
  function press(k) {
    if (host.classList.contains('locked')) return; // pavé éteint (ex. réserve à choisir d'abord)
    if (pos < expr.length) return pressAt(k);
    const before = expr;
    if (k === 'del') expr = expr.slice(0, -1);
    else if (k === 'clear') expr = '';
    else if (OPS[k]) {
      if (!expr) return;
      if (/[+−×÷]$/.test(expr)) expr = expr.slice(0, -1);
      expr += k;
    } else if (k === ',') {
      if (!dec || lastNum().includes(',')) return;
      expr += lastNum() ? ',' : '0,';
    } else {
      const ln = lastNum();
      if (ln.includes(',')) {
        if (k === '000' || ln.split(',')[1].length >= idec) return;
        expr += k;
      } else {
        if (ln.length + k.length > 11) return;
        if (k === '000') { if (!ln || ln === '0') return; expr += k; }
        else if (ln === '0') expr = expr.slice(0, -1) + k;
        else expr += k;
      }
    }
    pos = expr.length;
    if (expr === before) return;
    buzz(8);
    emit(k);
  }
  let holdTimer = 0, held = false;
  host.addEventListener('pointerdown', e => {
    const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.key, .op'));
    if (!b) return;
    b.classList.add('down');
    if (b.dataset.k === 'del') {
      held = false;
      holdTimer = setTimeout(() => { held = true; press('clear'); buzz(14); }, 480);
    }
  });
  const up = () => {
    clearTimeout(holdTimer);
    $$('.down', host).forEach(b => b.classList.remove('down'));
  };
  host.addEventListener('pointerup', up);
  host.addEventListener('pointerleave', up);
  host.addEventListener('pointercancel', up);
  host.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('.key, .op'));
    if (!b) return;
    if (b.dataset.k === 'del' && held) { held = false; return; }
    press(b.dataset.k);
  });
  // clavier physique (ordinateur, émulateur)
  const onKey = e => {
    if (!host.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    // une autre feuille ouverte au-dessus (ex. vérifier un solde depuis la saisie) : c'est son pavé qui écoute
    const layer = host.closest('.layer');
    if (layer && layer !== stack[stack.length - 1]?.el.closest('.layer')) return;
    const map = { '+': '+', '-': '−', '*': '×', '/': '÷', Backspace: 'del', ',': ',', '.': ',' };
    if (/^\d$/.test(e.key)) press(e.key);
    else if (map[e.key] && (ops || !OPS[map[e.key]])) { if (map[e.key] === ',' && !dec) return; press(map[e.key]); }
    else if ((e.key === 'Enter' || e.key === '=') && onEnter) { e.preventDefault(); onEnter(); }
  };
  document.addEventListener('keydown', onKey);
  return {
    value: () => exprMinor(expr, cur),
    expr: () => expr,
    hasOp: () => /[+−×÷]./.test(expr),
    resolve() { const v = exprMinor(expr, cur); expr = fromMinor(v, cur); pos = expr.length; emit('='); return v; },
    set(minor) { expr = fromMinor(minor, cur); pos = expr.length; emit('set'); },
    caret: () => pos,
    /** @param {number} i */
    setCaret(i) { const n = Math.max(0, Math.min(expr.length, i)); if (n === pos) return; pos = n; emit('caret'); },
  };
}

// Affichage d'expression : « 2 000 + 500 » avec le séparateur de milliers et le signe décimal réglés.
export function prettyExpr(expr) {
  const g = groupSep(), d = decSep();
  return expr.replace(/\d+(?:,\d*)?/g, m => {
    const [i, f] = m.split(',');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, g) + (f !== undefined ? d + f : '');
  }).replace(/([+−×÷])/g, ' $1 ');
}
// Symbole d'un grand montant, placé avant ou après le nombre selon le réglage.
const curSpan = cur => `<span class="cur${symFirst() ? ' pre' : ''}">${esc(symbol(cur))}</span>`;
const place = (n, cur) => (symFirst() ? curSpan(cur) + n : n + curSpan(cur));
// Montant géant en cours de saisie : nombre + symbole en plus petit.
export function bigAmount(minor, placeholder = '0', cur) {
  const n = minor ? num(minor, { cur }) : placeholder;
  return place(`<span class="n">${n}</span>`, cur);
}
// Grand montant affiché (solde, totaux) : v ≥ 0 ; key : clé pour faire défiler les chiffres ; neg : signe moins devant.
// Grands chiffres : l'approche serrée (D2) avalerait l'espace fine des milliers ; on la remplace par une cale fixe.
export const gs = text => esc(text).replace(/[\u2009\u202f\u00a0 ]/g, '<span class="gs"></span>');
/** @param {any} v @param {{ cur?: any, key?: any, neg?: boolean }} [o] */
export function splitAmount(v, { cur, key = null, neg = false } = {}) {
  const n = key ? `<span data-count="${key}" data-value="${v}" data-plain="1" data-cur="${cur || ''}">${gs(num(v, { cur }))}</span>` : `<span>${gs(num(v, { cur }))}</span>`;
  return (neg ? '<span>−</span>' : '') + place(n, cur);
}

// Grands montants : réduit la taille tant que le texte déborde de son conteneur (formats longs, « FCFA » avant…).
export const FIT = '.hero .big, .row .amt, .preview-card .pv1, .mrow .v';
// min : plancher en px ; par défaut la moitié de la taille d'origine, jamais sous 11 px.
export function fitText(root, sel = FIT, min = null) {
  (root.matches && root.matches(sel) ? [root] : $$(sel, root)).forEach(el => {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize), guard = 0;
    const floor = min ?? Math.max(11, Math.round(size * 0.5));
    while (el.scrollWidth > el.clientWidth + 1 && size > floor && guard++ < 40) {
      size = Math.max(floor, size - Math.max(1, size * 0.06));
      el.style.fontSize = size.toFixed(1) + 'px';
    }
  });
}

// Pastille de catégorie (D8) : teinte mêlée à la surface, icône Phosphor duotone dans la teinte.
export function chip(cat, size = '') {
  if (!cat) return `<span class="pill ${size}" style="--c:var(--c0)">${catIcon('dots-three')}</span>`;
  return `<span class="pill ${size}" style="--c:var(--${cat.color || 'c0'})">${catIcon(cat.icon)}</span>`;
}

// Interrupteur (dans un bouton ligne).
export const switchHTML = on => `<span class="switch${on ? ' on' : ''}" role="switch" aria-checked="${!!on}"></span>`;

// Bandeau d'information dans une feuille : tone 'warn' (bloquant) ou 'info' ; action : libellé d'un bouton [data-fix].
export const noticeHTML = (text, { tone = 'warn', action = '', sub = '' } = {}) =>
  `<div class="notice ${tone}" role="status">${icon(tone === 'warn' ? 'warning' : 'info')}<div class="nt"><span>${text}</span>${sub ? `<small>${sub}</small>` : ''}${action ? `<button type="button" data-fix>${action}${icon('caret-right')}</button>` : ''}</div></div>`;

// ---------- réordonner en glissant ----------
// list : conteneur dont les enfants [data-rid] se déplacent. onDone(ids) reçoit le nouvel ordre.
// Par défaut on saisit la poignée .handle ; longPress : appui long (420 ms, vibration) n'importe où sur la ligne, puis
// glisser. Tant que le doigt n'a pas tenu, la page défile normalement ; une fois la ligne soulevée, le défilement est
// bloqué et le relâchement ne compte pas comme un appui.
export function enableReorder(list, onDone, { longPress = false } = {}) {
  if (longPress) return reorderByLongPress(list, onDone);
  list.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle');
    if (!h || !list.contains(h)) return;
    const item = h.closest('[data-rid]');
    // listes imbriquées (catégories, sous-catégories dans leur groupe) : chaque liste ne range que ses propres lignes
    if (!item || item.parentElement !== list) return;
    e.preventDefault();
    try { h.setPointerCapture(e.pointerId); } catch (err) {}
    const d = startDrag(list, item, e.clientY, 8);
    const mv = ev => d.move(ev.clientY);
    const end = () => {
      h.removeEventListener('pointermove', mv);
      h.removeEventListener('pointerup', end);
      h.removeEventListener('pointercancel', end);
      d.drop(onDone);
    };
    h.addEventListener('pointermove', mv);
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });
}

function reorderByLongPress(list, onDone) {
  let swallow = false, lifted = false;
  // Le blocage du défilement est posé dès le départ (non passif) : Chrome Android décide au premier contact si un
  // touchmove peut être bloqué. Il n'agit qu'une fois la ligne soulevée ; avant, la page défile normalement.
  list.addEventListener('touchmove', e => { if (lifted) e.preventDefault(); }, { passive: false });
  // après un glisser, le relâchement ne doit pas ouvrir la ligne
  list.addEventListener('click', e => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
  list.addEventListener('contextmenu', e => { if (e.target.closest('[data-rid]')) e.preventDefault(); });
  list.addEventListener('pointerdown', e => {
    const item = e.target.closest('[data-rid]');
    if (!item || !list.contains(item) || e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let lastY = y0, d = null;
    const timer = setTimeout(() => {
      d = startDrag(list, item, y0, 12);
      lifted = true;
      d.move(lastY);
    }, 420);
    const mv = ev => {
      lastY = ev.clientY;
      if (d) d.move(ev.clientY);
      else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) stop(false); // un défilement, pas un appui long
    };
    const up = () => stop(true);
    function stop(drop) {
      clearTimeout(timer);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      lifted = false;
      if (!d) return;
      swallow = drop;
      setTimeout(() => { swallow = false; }, 400);
      d.drop(onDone);
      d = null;
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// Soulève `item` (vibration `ms`) ; move(y) le suit et décale les autres ; drop(onDone) le pose à sa nouvelle place.
function startDrag(list, item, y0, ms) {
  const items = $$(':scope > [data-rid]', list);
  const from = items.indexOf(item);
  const rects = items.map(x => x.getBoundingClientRect());
  const hgt = rects[from].height;
  let to = from, moved = false;
  item.classList.add('lifting');
  list.classList.add('reordering');
  buzz(ms);
  return {
    move(y) {
      const dy = y - y0;
      if (Math.abs(dy) > 3) moved = true;
      // on peut dépasser un peu les bords pour atteindre la première / dernière place
      const lo = rects[0].top - rects[from].top - hgt / 3, hi = rects[rects.length - 1].bottom - rects[from].bottom + hgt / 3;
      const cy = Math.max(lo, Math.min(hi, dy));
      item.style.transform = `translateY(${cy}px)`;
      // en montant, le haut de la ligne soulevée passe le milieu d'une autre ; en descendant, son bas : les lignes de
      // hauteurs différentes (un groupe de catégorie avec ses sous-catégories) s'échangent sans tirer trop loin
      const top = rects[from].top + cy, bottom = rects[from].bottom + cy;
      let n = from;
      rects.forEach((r, i) => {
        if (i < from && top <= r.top + r.height / 2) n = Math.min(n, i);
        if (i > from && bottom >= r.top + r.height / 2) n = Math.max(n, i);
      });
      if (n !== to) { to = n; buzz(6); }
      items.forEach((x, i) => {
        if (x === item) return;
        const shift = from < to && i > from && i <= to ? -hgt : from > to && i < from && i >= to ? hgt : 0;
        x.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    },
    drop(onDone) {
      item.classList.remove('lifting');
      list.classList.remove('reordering');
      items.forEach(x => { x.style.transform = ''; });
      if (!moved || to === from) return;
      const ids = items.map(x => x.dataset.rid);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      list.insertBefore(item, to < from ? items[to] : items[to].nextSibling);
      buzz(10);
      onDone(ids);
    },
  };
}

// Contrôle segmenté : options [[valeur, libellé]…]. wireSeg(el, onChange) anime le curseur.
export function seg(options, value, cls = '') {
  const i = Math.max(0, options.findIndex(o => o[0] === value));
  return `<div class="seg ${cls}" role="tablist" style="--n:${options.length};--i:${i}"><span class="thumb"></span>${options
    .map(([v, l], j) => `<button type="button" role="tab" data-v="${v}" class="${j === i ? 'on' : ''}" aria-selected="${j === i}">${l}</button>`).join('')}</div>`;
}
// Place le curseur d'un contrôle segmenté sans déclencher onChange.
export function setSeg(el, value) {
  const btns = $$('button[data-v]', el);
  btns.forEach((x, i) => { const on = x.dataset.v === value; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); if (on) el.style.setProperty('--i', i); });
}
export function wireSeg(el, onChange) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.classList.contains('on')) return;
    const btns = $$('button[data-v]', el);
    btns.forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    el.style.setProperty('--i', btns.indexOf(b));
    buzz(8);
    onChange(b.dataset.v);
  });
}

/**
 * Met un champ en saisie, le curseur à la fin de ce qui y est déjà écrit (2026-11-26, avec l'utilisateur : pour reprendre
 * une note ou un nom, il fallait d'abord ramener soi-même le curseur à la fin).
 * @param {HTMLInputElement} input
 */
export function focusEnd(input) {
  input.focus();
  const n = input.value.length;
  try { input.setSelectionRange(n, n); } catch { /* un type de champ sans sélection (nombre) */ }
  input.scrollLeft = input.scrollWidth; // un texte plus long que le champ : sa fin en vue
}

// Tremblement d'erreur (une fois) + double vibration (D5).
export function shake(el) {
  if (!el) return;
  buzz([10, 40, 10]);
  if (reducedMotion()) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// ---------- bulle au-dessus du bouton + (D10 : « Ajoute ta première dépense ») ----------
let tipText = null;
export function dockTip(text) { tipText = text; paintDockTip(); }
export function paintDockTip() {
  const nav = document.querySelector('.dock');
  if (!nav) return;
  let tip = nav.querySelector('.dock-tip');
  const fab = nav.querySelector('.fab');
  if (!tipText) { if (tip) tip.remove(); if (fab) fab.classList.remove('halo'); return; }
  if (!tip) { tip = document.createElement('div'); tip.className = 'dock-tip'; tip.setAttribute('role', 'status'); nav.appendChild(tip); }
  tip.textContent = tipText;
  if (fab) fab.classList.add('halo');
}

// ---------- calcul écrit en clair (D4) ----------
// « 12 000 + 500 » : nombres groupés, opérateurs en gris, curseur indigo (fixe : rien ne clignote en boucle, D5).
// Sans opérateur, l'unité suit le nombre ; typed : le dernier élément « monte en place ».
/**
 * Expression caractère par caractère (chaque caractère touchable : data-i), séparateurs de milliers et décimal réglés,
 * curseur à la position caret. Pour placer le curseur en touchant un chiffre (saisie).
 * @param {string} expr @param {{ cur: any, caret: number, placeholder?: string }} o
 */
export function exprCharsHTML(expr, { cur, caret, placeholder = '0' }) {
  const unit = `<span class="unit">${esc(symbol(cur))}</span>`;
  if (!expr) return `<span class="ph">${placeholder}</span><span class="caret"></span>${unit}`;
  const g = groupSep(), d = decSep();
  let out = '';
  const re = /\d+(?:,\d*)?|[+−×÷]/g;
  let mt;
  while ((mt = re.exec(expr))) {
    const tok = mt[0], at = mt.index;
    if (/[+−×÷]/.test(tok)) {
      out += `${caret === at ? '<span class="caret"></span>' : ''}<span class="op ch" data-i="${at}">${tok}</span>`;
      continue;
    }
    const intLen = tok.split(',')[0].length;
    for (let j = 0; j < tok.length; j++) {
      const i = at + j, ch = tok[j];
      // séparateur de milliers avant ce chiffre de la partie entière
      if (j > 0 && j < intLen && (intLen - j) % 3 === 0) out += `<span class="gs" aria-hidden="true">${g === ' ' || g === '\u202f' ? '' : esc(g)}</span>`;
      out += `${caret === i ? '<span class="caret"></span>' : ''}<span class="nb ch" data-i="${i}">${ch === ',' ? esc(d) : ch}</span>`;
    }
  }
  const hasOp = /[+−×÷]/.test(expr);
  return out + (caret >= expr.length ? '<span class="caret"></span>' : '') + (hasOp ? '' : unit);
}

/** @param {string} expr @param {{ cur?: any, typed?: boolean, placeholder?: string }} [o] */
export function exprHTML(expr, { cur, typed = false, placeholder = '0' } = {}) {
  const tokens = expr.match(/\d+(?:,\d*)?|[+−×÷]/g) || [];
  const unit = `<span class="unit">${esc(symbol(cur))}</span>`;
  if (!tokens.length) return `<span class="ph">${placeholder}</span>${unit}`;
  const hasOp = tokens.some(t => /[+−×÷]/.test(t));
  const html = tokens.map((t, i) => {
    const last = typed && i === tokens.length - 1 ? ' tk' : '';
    if (/[+−×÷]/.test(t)) return `<span class="op${last}">${t}</span>`;
    return `<span class="nb${last}">${gs(prettyExpr(t))}</span>`;
  }).join('');
  return html + '<span class="caret"></span>' + (hasOp ? '' : unit);
}

