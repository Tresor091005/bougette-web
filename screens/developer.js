// Moi › Développeur (page, 2026-11-09) : état du stockage, empreinte d'état, intégrité (résultat affiché dans la page),
// reconstruction depuis le journal, opérations annulées (liste dans la page ; chacune ouvre sa fiche), export / import
// exact du journal, démo, accueil guidé, remise à zéro. Plus de feuilles empilées les unes sur les autres.
import { deletedTransactions, resetAll } from '../core/store.js';
import { currentSpace, isDemo, demoSpace, chooseSpace, reopen, DEMO } from '../core/spaces.js';
import { keepSafety } from '../core/backup.js';
import { txRow } from './common.js';
import { openHistory } from './history.js';
import { today, esc } from '../core/format.js';
import { icon } from '../core/icons.js';
import { buzz, toast, confirmSheet, typedConfirmSheet, $ } from '../core/ui.js';
import { loadDemo, replayOnboarding, exportText, importText, stateHash, storageInfo, rebuild, verify } from '../core/devtools.js';

/** @param {string} text */
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
/** @param {string} name @param {string} text */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function render(app, { back, go }) {
  app.innerHTML = `<div class="screen dev-screen no-tabs">
    <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
      <h1 class="title sm">Développeur</h1></div></div>
    <p class="screen-help">Le journal d’événements est la source de vérité ; tout le reste en est tiré.</p>

    <section class="section"><div class="group">
      <div class="row"><div class="main"><div class="t">Stockage</div><div class="s wrap" data-info>lecture…</div></div></div>
      <button class="row" data-hash><div class="main"><div class="t">Empreinte d’état</div><div class="s mono" data-hash-v>calcul…</div></div><span class="end">${icon('copy')}</span></button>
    </div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Intégrité</span></div><div class="group">
      <button class="row" data-verify><div class="main"><div class="t">Vérifier l’intégrité</div><div class="s">Chaîne d’empreintes, partie double, soldes</div></div></button>
      <div data-checks></div>
      <button class="row" data-rebuild><div class="main"><div class="t">Reconstruire depuis le journal</div><div class="s">Rejoue tout, compare l’empreinte avant / après</div></div></button>
    </div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Opérations annulées</span><span class="muted" data-voided-n></span></div>
      <div class="group plain-list" data-voided></div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Journal</span></div><div class="group">
      <button class="row" data-exp><div class="main"><div class="t">Exporter le journal</div><div class="s">Copie exacte en JSON Lines</div></div><span class="end">${icon('download-simple')}</span></button>
      <button class="row" data-imp><div class="main"><div class="t">Importer un journal</div><div class="s">Remplace tout, après vérification de la chaîne</div></div></button>
      <input type="file" data-file accept=".jsonl,.json,application/json,application/x-ndjson,text/plain" hidden>
    </div></section>

    <section class="section"><div class="section-h"><span class="eyebrow">Essais</span></div><div class="group">
      <button class="row" data-demo><div class="main"><div class="t">${isDemo() ? 'Recharger la démo' : 'Ouvrir l’espace Démo'}</div><div class="s">${isDemo() ? '90 jours réalistes, dans l’espace Démo seulement' : '90 jours réalistes, dans un espace à part : tes données ne bougent pas'}</div></div></button>
      <button class="row" data-onb><div class="main"><div class="t">Relancer l’accueil guidé</div><div class="s">Sans effacer les données</div></div></button>
      <button class="row" data-wipe><div class="main"><div class="t" style="color:var(--loss)">Tout effacer</div><div class="s">Journal neuf, premier lancement</div></div></button>
    </div></section>
  </div>`;

  const hv = $('[data-hash-v]', app);
  let hash = '';
  const paintInfo = async () => {
    const info = await storageInfo();
    const kb = (info.bytes / 1024).toFixed(0);
    $('[data-info]', app).textContent = `SQLite ${info.kind === 'tauri' ? 'natif' : 'WebAssembly'} · schéma ${info.schema} · ${info.events} événements · ${info.tx} opérations · ${info.accounts} portefeuilles · ${kb} Ko`;
    hash = await stateHash();
    hv.textContent = hash.slice(0, 16) + '…' + hash.slice(-8);
  };
  const paintVoided = () => {
    const list = deletedTransactions();
    $('[data-voided-n]', app).textContent = list.length ? String(list.length) : '';
    $('[data-voided]', app).innerHTML = list.length
      ? list.map(t => txRow(t, { date: true })).join('')
      : '<div class="row"><div class="main"><div class="s">Aucune opération annulée</div></div></div>';
  };
  paintInfo();
  paintVoided();

  $('[data-back]', app).onclick = () => back('#/reglages');
  $('[data-hash]', app).onclick = async () => { if (hash && await copy(hash)) toast('Empreinte copiée'); };
  $('[data-verify]', app).onclick = async () => {
    buzz(8);
    const checks = await verify();
    $('[data-checks]', app).innerHTML = checks.map(c => `<div class="row hist"><span class="pill acc" style="color:var(--${c.ok ? 'gain' : 'loss'})">${icon(c.ok ? 'check' : 'warning')}</span>
      <div class="main"><div class="t">${esc(c.name)}</div><div class="s wrap">${esc(c.detail)}</div></div></div>`).join('');
    toast(checks.every(c => c.ok) ? 'Tout concorde' : 'Un contrôle a échoué');
  };
  $('[data-rebuild]', app).onclick = async () => {
    buzz(8);
    const r = await rebuild();
    toast(r.same ? `Reconstruit depuis ${r.events} événements · empreinte identique` : 'Empreinte différente après reconstruction');
    paintInfo();
  };
  $('[data-voided]', app).onclick = e => {
    const r = /** @type {Element} */ (e.target).closest('[data-tx]');
    if (!r) return;
    buzz(6);
    openHistory(/** @type {HTMLElement} */ (r).dataset.tx);
  };
  $('[data-demo]', app).onclick = async () => {
    // D19 : la démo vit dans son espace ; depuis un autre espace, on l'ouvre (l'app s'y rouvre et la remplit)
    if (!isDemo()) {
      const go2 = await confirmSheet({ title: 'Ouvrir l’espace Démo ?', text: 'L’app se rouvre sur un espace à part, rempli de 90 jours de démonstration. Tes données restent où elles sont ; tu y reviens par Moi › Espace.', yes: 'Ouvrir la démo' });
      if (!go2) return;
      demoSpace(); chooseSpace(DEMO); reopen('demo');
      return;
    }
    const ok = await confirmSheet({ title: 'Recharger la démo ?', text: 'L’espace Démo repart de zéro avec 90 jours de démonstration. Aucun autre espace ne change.', yes: 'Recharger' });
    if (!ok) return;
    try { toast(`Démo chargée · ${await loadDemo()} événements`); paintInfo(); paintVoided(); } catch (e) { console.error(e); toast('Démo impossible : ' + /** @type {Error} */ (e).message); }
  };
  $('[data-onb]', app).onclick = async () => { await replayOnboarding(); go('#/bienvenue', { replace: true }); };
  $('[data-exp]', app).onclick = async () => {
    const text = await exportText();
    download(`bougette-journal-${today()}.jsonl`, text);
    toast(await copy(text) ? 'Journal exporté et copié' : 'Fichier du journal créé');
  };
  const file = /** @type {HTMLInputElement} */ ($('[data-file]', app));
  $('[data-imp]', app).onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const text = await f.text();
    file.value = '';
    const ok = await confirmSheet({ title: 'Importer ce journal ?', text: 'Toutes les données de ce téléphone seront remplacées par celles du fichier, après vérification.', yes: 'Importer', danger: true });
    if (!ok) return;
    try { await keepSafety('restore'); } catch (e) { toast('Copie de sécurité impossible : rien n’est importé.'); return; }
    try { toast('Importé · empreinte ' + (await importText(text)).slice(0, 8) + ' vérifiée'); paintInfo(); paintVoided(); }
    catch (e) { toast(/** @type {Error} */ (e).message); }
  };
  $('[data-wipe]', app).onclick = async () => {
    const sp = currentSpace();
    const ok = await typedConfirmSheet({ title: 'Tout effacer ?', text: `Le journal de l’espace « ${esc(sp.name)} » repart de zéro. Une copie de sécurité est gardée juste avant.`, name: sp.name, yes: 'Tout effacer' });
    if (!ok) return;
    try { await keepSafety('reset'); } catch (e) { toast('Copie de sécurité impossible : rien n’est effacé.'); return; }
    await resetAll();
    setTimeout(() => go('#/bienvenue', { replace: true }), 260);
  };
}
