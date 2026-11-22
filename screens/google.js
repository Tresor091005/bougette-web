// Moi › Compte Google (D21, 2026-11-20, avec l'utilisateur) : lier un compte pour garder ses espaces dans son Google Drive
// et les retrouver sur un autre téléphone ou sur iPhone (par le web) ; l'état de la synchro ; la délier. Un espace attaché à
// un autre compte ne se synchronise qu'avec celui-là : pas de transfert d'un compte à l'autre (2026-11-21, avec l'utilisateur).
import { icon } from '../core/icons.js';
import { buzz, confirmSheet, toast, $ } from '../core/ui.js';
import { esc } from '../core/format.js';
import { account, googleAvailable } from '../core/google.js';
import { syncNow, syncStatus, onSync, linkAccount, unlinkAccount, reconnect } from '../core/cloud.js';
import { isDemo, currentSpace } from '../core/spaces.js';
import { askIdentity } from './lock.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML } from './parts.js';

const g = /** @type {any} */ (globalThis);

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
  if (!a) return 'Garde tes données, retrouve-les partout';
  if (isDemo()) return `${a.email} · la Démo ne se synchronise pas`;
  const st = syncStatus();
  if (st.running) return `${a.email} · synchronisation…`;
  if (st.foreign) return `${a.email} · espace d’un autre compte`;
  if (st.needsAuth) return `${a.email} · à reconnecter`;
  if (st.error) return `${a.email} · pas synchronisé`;
  return st.at ? `${a.email} · synchronisé ${ago(st.at)}` : a.email;
}

/** @param {HTMLElement} app @param {{ back: (fallback?: string) => void }} ctx */
export function render(app, { back }) {
  const a = account();
  const st = syncStatus();
  const web = !g.BougetteGoogle;
  const sp = currentSpace();
  const foreign = !!(a && sp.owner && sp.owner !== a.email.toLowerCase() && !isDemo());
  const body = !googleAvailable()
    ? `<p class="screen-help">Google Drive n’est pas disponible ici.</p>`
    : !a && isDemo()
      ? `<p class="screen-help">La Démo ne se synchronise jamais : ouvre un autre espace pour lier ton compte Google.</p>`
    : !a
      ? `<p class="screen-help">Tes espaces sont gardés dans ton Google Drive. Tu les retrouves à jour sur tes autres appareils.</p>
          <button class="btn primary" data-link>${icon('cloud-check')} Lier un compte Google</button>
          <p class="hint left">Bougette ne voit que son dossier caché dans ton Drive : ni tes fichiers, ni ton mot de passe. Tes données vont droit chez Google, sans autre serveur.</p>`
      : `${sectionHTML({ body: `<div class="group plain">
          ${rowHTML({ tag: 'div', cls: 'static', pill: `<span class="pill acc">${icon('cloud-check')}</span>`, title: esc(a.name || a.email), sub: esc(a.email) })}
          ${rowHTML({ tag: 'div', cls: 'static', title: isDemo() ? 'La Démo ne se synchronise pas' : st.running ? 'Synchronisation…' : st.needsAuth ? 'À reconnecter' : st.error ? 'Pas synchronisé' : st.at ? `Synchronisé ${ago(st.at)}` : 'Pas encore synchronisé',
            sub: !isDemo() && st.error && !st.running ? esc(st.error) : '', subCls: 'wrap' })}
        </div>
        ${foreign ? `<div class="rv-item gg-foreign"><div class="rv-t">« ${esc(sp.name)} » est attaché à un autre compte</div>
          <div class="rv-s">${esc(sp.owner || '')}</div>
          <div class="rv-why">${icon('warning')}<span>Il se synchronise seulement avec ce compte, jamais avec ${esc(a?.email || '')}. Pour le synchroniser, délie cet appareil, puis lie ce compte.</span></div></div>`
        : isDemo() ? '' : st.needsAuth && web
          ? `<button class="btn primary" data-reconnect>Reconnecter</button>`
          : `<button class="btn secondary" data-sync ${st.running ? 'disabled' : ''}>Synchroniser maintenant</button>`}
        <p class="hint left">Chaque espace (sauf la Démo) se synchronise quand il est ouvert. Sur un autre appareil, lie le même compte pour y retrouver tes espaces.</p>` })}
        ${sectionHTML({ body: '<button class="btn ghost danger" data-unlink>Délier cet appareil</button>' })}`;
  app.innerHTML = `<div class="screen settings no-tabs">
    ${topbarHTML({ title: 'Compte Google' })}
    ${body}
  </div>`;
  wireBack(app, () => back('#/reglages'));
  const link = $('[data-link]', app);
  if (link) link.onclick = async () => {
    buzz(8);
    if (!(await askIdentity('Lier un compte Google'))) return;
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
    if (!(await askIdentity('Délier cet appareil'))) return;
    const ok = await confirmSheet({ title: 'Délier cet appareil ?', text: 'Tes données restent sur cet appareil et dans ton Drive. Les changements ne passeront plus d’un appareil à l’autre.', yes: 'Délier', danger: true });
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
