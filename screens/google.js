// Moi › Compte Google (D21, 2026-11-20, avec l'utilisateur) : lier un compte pour garder ses espaces dans son Google Drive
// et les retrouver sur un autre téléphone ou sur iPhone (par le web) ; l'état de la synchro ; la délier.
import { icon } from '../core/icons.js';
import { buzz, confirmSheet, toast, $ } from '../core/ui.js';
import { esc } from '../core/format.js';
import { account, googleAvailable } from '../core/google.js';
import { syncNow, syncStatus, onSync, linkAccount, unlinkAccount, reconnect } from '../core/cloud.js';
import { isDemo } from '../core/spaces.js';

const g = /** @type {any} */ (globalThis);
const WEB_URL = 'https://tresor091005.github.io/bougette-web/';

/** « il y a 2 min » @param {string|undefined} at */
function ago(at) {
  const t = Date.parse(at || '');
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `le ${new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

/** La ligne d'état de la synchro (aussi dans Moi). */
export function syncLine() {
  const a = account();
  if (!a) return 'Garder tes espaces dans ton Drive';
  if (isDemo()) return `${a.email} · la Démo ne se synchronise pas`;
  const st = syncStatus();
  if (st.running) return `${a.email} · synchronisation…`;
  if (st.needsAuth) return `${a.email} · à reconnecter`;
  if (st.error) return `${a.email} · pas synchronisé`;
  return st.at ? `${a.email} · synchronisé ${ago(st.at)}` : a.email;
}

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
export function render(app, { back }) {
  const a = account();
  const st = syncStatus();
  const web = !g.BougetteGoogle;
  const body = !googleAvailable()
    ? `<p class="field-note">La synchronisation n’est pas encore possible ici.</p>`
    : !a && isDemo()
      ? `<p class="field-note">La Démo ne se synchronise jamais : ouvre un autre espace pour lier ton compte Google.</p>`
    : !a
      ? `<section class="section">
          <p class="gg-lead">Tes espaces gardés dans ton Google Drive : si tu perds ce téléphone, tu retrouves tout sur un autre, ou sur iPhone par le web. Chaque changement suit tout seul.</p>
          <button class="btn primary" data-link>${icon('cloud-check')} Lier un compte Google</button>
          <p class="field-note">Bougette n’a accès qu’à son propre dossier caché dans ton Drive : ni à tes fichiers, ni à ton mot de passe. Aucun serveur entre toi et Google : personne d’autre ne voit tes données.</p>
        </section>`
      : `<section class="section"><div class="group plain">
          <div class="row static"><span class="pill acc">${icon('cloud-check')}</span><div class="main"><div class="t">${esc(a.name || a.email)}</div><div class="s">${esc(a.email)}</div></div></div>
          <div class="row static"><div class="main"><div class="t">${isDemo() ? 'La Démo ne se synchronise pas' : st.running ? 'Synchronisation…' : st.needsAuth ? 'À reconnecter' : st.error ? 'Pas synchronisé' : st.at ? `Synchronisé ${ago(st.at)}` : 'Pas encore synchronisé'}</div>
            ${!isDemo() && st.error && !st.running ? `<div class="s wrap">${esc(st.error)}</div>` : ''}</div></div>
        </div>
        ${isDemo() ? '' : st.needsAuth && web
          ? `<button class="btn primary" data-reconnect>Reconnecter</button>`
          : `<button class="btn secondary" data-sync ${st.running ? 'disabled' : ''}>Synchroniser maintenant</button>`}
        <p class="field-note">Chaque espace de ce téléphone (sauf la Démo) se synchronise quand il est ouvert. Sur un autre appareil, lie le même compte : tu y retrouves tes espaces${web ? '' : ` — sur iPhone, ouvre ${WEB_URL.replace('https://', '')} dans Safari, puis Partager › « Sur l’écran d’accueil »`}.</p>
        </section>
        <section class="section"><button class="btn ghost danger" data-unlink>Délier ce téléphone</button></section>`;
  app.innerHTML = `<div class="screen settings no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Compte Google</h1></div></div>
    ${body}
  </div>`;
  $('[data-back]', app).onclick = () => back('#/reglages');
  const link = $('[data-link]', app);
  if (link) link.onclick = async () => {
    buzz(8);
    link.disabled = true;
    try {
      const r = await linkAccount();
      if (r && !r.away) toast(r.ok ? 'Compte Google lié' : `Lié, mais pas encore synchronisé : ${r.error}`);
    } catch (e) {
      toast(/** @type {Error} */ (e).message || 'Liaison impossible.');
    }
    link.disabled = false;
    render(app, { back });
  };
  const sync = $('[data-sync]', app);
  if (sync) sync.onclick = async () => {
    buzz(8);
    const r = await syncNow({ interactive: true });
    if (r.ok) toast('Synchronisé');
  };
  const rc = $('[data-reconnect]', app);
  if (rc) rc.onclick = () => reconnect();
  const un = $('[data-unlink]', app);
  if (un) un.onclick = async () => {
    const ok = await confirmSheet({ title: 'Délier ce téléphone ?', text: 'Tes données restent sur ce téléphone, et celles déjà dans ton Drive y restent aussi. Les changements ne suivront plus d’un appareil à l’autre.', yes: 'Délier', danger: true });
    if (!ok) return;
    await unlinkAccount();
    toast('Compte délié');
    render(app, { back });
  };
  // l'état de la synchro qui change redessine la page tant qu'elle est ouverte (un seul abonnement à la fois)
  stop();
  stop = onSync(() => { if (document.body.contains(app) && location.hash.startsWith('#/reglages/google')) render(app, { back }); else stop(); });
}
let stop = () => {};
