// Écran de verrouillage, code redemandé avant une action sensible, choix d'un code (ROADMAP étape 2, sécurité, 2026-11-09 ;
// « code exigé, app libre », 2026-11-21, avec l'utilisateur). L'écran de verrouillage, plein écran au-dessus de l'app (sous
// les feuilles), seulement si « Verrouiller à l'ouverture » est choisi. Deux façons d'ouvrir : le code de Bougette, ou
// « Utiliser le téléphone » (empreinte s'il en a une, sinon son code ou son schéma), proposé d'emblée ; sur un téléphone
// sans verrouillage, seul le code reste.
import { icon } from '../core/icons.js';
import { buzz, openSheet, confirmSheet, closeAllSheets, shake, toast, $, $$ } from '../core/ui.js';
import { esc } from '../core/format.js';
import { hasCode, lockAtOpen, checkCode, waitMs, phoneUnlock, canAskPhone, validCode, setCode, codeLength } from '../core/lock.js';

/**
 * Pavé de code : points, chiffres, effacer. onCode(code) est appelé quand `length` chiffres sont tapés (ou au bouton
 * « Valider » si length est null : 4 à 6 chiffres au choix).
 * @param {HTMLElement} host @param {{ length: number|null, onCode: (code: string) => void }} o
 */
function codePad(host, { length, onCode }) {
  let code = '';
  const max = length || 6;
  host.innerHTML = `<div class="lk-dots" aria-hidden="true">${Array.from({ length: max }, () => '<i></i>').join('')}</div>
    <div class="lk-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button type="button" class="key" data-d="${d}">${d}</button>`).join('')}
      <span></span><button type="button" class="key" data-d="0">0</button>
      <button type="button" class="key fn" data-del aria-label="Effacer">${icon('backspace')}</button></div>
    ${length ? '' : '<button type="button" class="btn primary lk-ok" data-ok disabled>Valider</button>'}`;
  const paint = () => {
    $$('.lk-dots i', host).forEach((d, i) => d.classList.toggle('on', i < code.length));
    const ok = $('[data-ok]', host);
    if (ok) ok.disabled = !validCode(code);
  };
  $$('[data-d]', host).forEach(b => (b.onclick = () => {
    if (code.length >= max) return;
    buzz(6);
    code += b.dataset.d;
    paint();
    if (length && code.length === length) { const c = code; code = ''; setTimeout(() => { paint(); onCode(c); }, 120); }
  }));
  $('[data-del]', host).onclick = () => { code = code.slice(0, -1); buzz(6); paint(); };
  const ok = $('[data-ok]', host);
  if (ok) ok.onclick = () => { const c = code; code = ''; paint(); onCode(c); };
  paint();
  return { clear: () => { code = ''; paint(); } };
}

let el = null;
/** @type {(() => void)|null} */
let after = null;
export const isLocked = () => !!el;

/** Montre l'écran de verrouillage (rien sans « Verrouiller à l'ouverture »). then : à faire une fois déverrouillé. */
export function showLock(then = null) {
  if (!lockAtOpen()) { then?.(); return; }
  if (then) after = then;
  if (el) return;
  closeAllSheets({ silent: true });
  document.documentElement.classList.add('locked');
  el = document.createElement('div');
  el.id = 'lock';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Bougette est verrouillée');
  el.innerHTML = `<div class="lk-in">
    <div class="lk-logo">${icon('logo')}</div>
    <h1 class="lk-t">Entre ton code</h1>
    <p class="lk-s" data-msg></p>
    <div data-pad></div>
    <div class="lk-more">
      ${canAskPhone() ? `<button type="button" class="btn secondary sm" data-phone>${icon('fingerprint')}Utiliser le téléphone</button>` : ''}
      <button type="button" class="link" data-forgot>Code oublié ?</button>
    </div></div>`;
  document.body.appendChild(el);
  const msg = $('[data-msg]', el);
  const unlock = () => {
    el?.remove(); el = null;
    document.documentElement.classList.remove('locked');
    const fn = after; after = null;
    fn?.();
  };
  const tick = () => {
    const w = waitMs();
    msg.textContent = w ? `Trop d’essais : réessaie dans ${Math.ceil(w / 1000)} s.` : '';
    if (w) setTimeout(() => { if (el) tick(); }, 1000);
  };
  const pad = codePad($('[data-pad]', el), {
    length: codeLength(),
    onCode: async code => {
      if (waitMs()) { tick(); return; }
      if (await checkCode(code)) { buzz(10); unlock(); return; }
      buzz([10, 40, 10]);
      shake($('.lk-dots', el));
      pad.clear();
      if (waitMs()) tick(); else msg.textContent = 'Code incorrect.';
    },
  });
  tick();
  const phone = $('[data-phone]', el);
  if (phone) {
    let tried = 0;
    const ask = async () => {
      tried++;
      if (await phoneUnlock()) { unlock(); return; }
      // échec dès le premier essai automatique sans geste : le téléphone n'a sans doute pas de verrouillage
      if (tried > 1) msg.textContent = 'Le téléphone n’a pas confirmé : utilise le code de Bougette.';
    };
    phone.onclick = () => { buzz(6); ask(); };
    setTimeout(ask, 300);
  }
  // Code oublié : jamais d'effacement depuis l'écran verrouillé (quelqu'un d'autre pourrait tout supprimer). Le téléphone
  // atteste que c'est bien toi ; l'app s'ouvre, puis tu choisis un nouveau code.
  $('[data-forgot]', el).onclick = async () => {
    buzz(6);
    if (canAskPhone() && await phoneUnlock()) {
      unlock();
      toast('Choisis un nouveau code');
      setTimeout(() => askNewCode(), 300);
      return;
    }
    await confirmSheet({
      title: 'Code oublié ?',
      text: 'Seul le verrouillage du téléphone peut remplacer le code. Sinon, efface les données de Bougette dans les réglages du téléphone, puis relie ton compte Google pour les retrouver. Sans compte Google, elles sont perdues.',
      yes: 'Compris', cancel: false,
    });
  };
}

/**
 * Redemander qui tu es avant une action sensible (2026-11-20, avec l'utilisateur : quelqu'un qui trouve l'app ouverte ne
 * doit rien pouvoir faire sortir ni casser) : lier ou délier un compte Google, exporter, restaurer, choisir le dossier de
 * sauvegarde, repartir de zéro, renommer ou archiver un espace, changer le code, ne plus verrouiller à l'ouverture… Le
 * code de Bougette, ou le téléphone (empreinte, code ou schéma du téléphone : proposé d'emblée sur le téléphone, 2026-11-21,
 * avec l'utilisateur : les gens oublient un code de plus). Sans code de Bougette (le code est exigé, 2026-11-21) : le
 * téléphone suffit s'il confirme ; sinon (navigateur, téléphone sans verrouillage) on choisit un code d'abord, et l'action
 * continue seulement s'il est enregistré (sans le retaper). Renvoie true si c'est confirmé.
 * @param {string} what ce qu'on s'apprête à faire (« Lier un compte Google »)
 * @returns {Promise<boolean>}
 */
export async function askIdentity(what) {
  if (!hasCode()) {
    if (canAskPhone() && await phoneUnlock(what)) { buzz(10); return true; }
    return askNewCode({ title: what, intro: `Pour ${what.charAt(0).toLowerCase()}${what.slice(1)}, choisis d’abord un code` });
  }
  return new Promise(resolve => {
    let done = false;
    const s = openSheet(`<div class="lk-sheet"><h2 class="sheet-title">${esc(what)}</h2>
      <p class="muted" data-s>Entre ton code pour continuer</p><div data-pad></div>
      ${canAskPhone() ? `<button type="button" class="btn secondary sm" data-phone>${icon('fingerprint')}Utiliser le téléphone</button>` : ''}</div>`,
      { label: 'Confirmer avec ton code', onClose: () => { if (!done) resolve(false); } });
    const sub = $('[data-s]', s.el);
    const ok = () => { done = true; buzz(10); s.close(); resolve(true); };
    const pad = codePad($('[data-pad]', s.el), {
      length: codeLength(),
      onCode: async code => {
        const w = waitMs();
        if (w) { sub.textContent = `Trop d’essais : réessaie dans ${Math.ceil(w / 1000)} s.`; pad.clear(); return; }
        if (await checkCode(code)) { ok(); return; }
        buzz([10, 40, 10]);
        shake($('.lk-dots', s.el));
        pad.clear();
        sub.textContent = waitMs() ? 'Trop d’essais : patiente un peu.' : 'Code incorrect.';
      },
    });
    const phone = $('[data-phone]', s.el);
    if (phone) {
      const ask = async () => { if (await phoneUnlock(what)) ok(); else sub.textContent = 'Le téléphone n’a pas confirmé : utilise le code.'; };
      phone.onclick = () => { buzz(6); ask(); };
      setTimeout(ask, 300); // le téléphone d'abord, comme à l'ouverture : le code de Bougette reste en secours
    }
  });
}

/**
 * Choisir un nouveau code (deux fois). Renvoie true si le code est enregistré. title / intro : ce que la feuille dit
 * d'abord (askIdentity sans code : l'action demandée, et pourquoi un code).
 * @param {{ title?: string, intro?: string }} [o]
 * @returns {Promise<boolean>}
 */
export function askNewCode({ title = 'Choisis un code', intro = '4 à 6 chiffres' } = {}) {
  return new Promise(resolve => {
    let first = null, done = false;
    const s = openSheet(`<div class="lk-sheet lk-new"><h2 class="sheet-title" data-t>${esc(title)}</h2>
      <p class="muted" data-s>${esc(intro)}</p><div data-pad></div></div>`, { label: 'Choisir un code', onClose: () => { if (!done) resolve(false); } });
    const t = $('[data-t]', s.el), sub = $('[data-s]', s.el);
    codePad($('[data-pad]', s.el), {
      length: null,
      onCode: async code => {
        if (first === null) { first = code; t.textContent = 'Confirme le code'; sub.textContent = 'Tape-le encore une fois'; return; }
        if (code !== first) { first = null; t.textContent = title; sub.textContent = 'Les deux codes ne sont pas pareils : recommence.'; buzz([10, 40, 10]); return; }
        await setCode(code);
        done = true;
        buzz(12);
        s.close();
        toast('Code enregistré');
        resolve(true);
      },
    });
  });
}
