// « Revoir mon épargne » (D17 revu, 2026-11-23, avec l'utilisateur) : la porte des gros bouleversements, une réévaluation
// de ses capacités et de ses attentes. Proposée (la cloche, la page de l'épargne), jamais imposée. En tête, ce qui manque ;
// dessous les réserves, de la plus lointaine à la plus proche, chacune avec Réduire, Repousser (Reprendre, en pause),
// Mettre en pause, Abandonner ; le manque se recalcule à chaque geste (rien n'est écrit) ; en bas le versement, prérempli
// avec le manque en plus. Valider écrit tout d'un coup. Un versement qui laisse un manque ne bloque rien.
import { account, savingsReport, previewSavings, applySavingsReview, reservesOf, scheduleById, pref } from '../core/store.js';
import { money, esc, yearDate, today, readAmount, currencyOf, symbol } from '../core/format.js';
import { icon } from '../core/icons.js';
import { openSheet, buzz, toast, promptSheet, $, $$ } from '../core/ui.js';
import { sheetHead, sheetActions } from './parts.js';
import { pickDate } from './pickers.js';
import { statusHTML, barTone, versementFrom } from './reserves.js';
import { addMonths } from '../domain/reserves.js';

/** @typedef {{ amount?: number, due?: string, pause?: boolean, abandon?: boolean }} Gesture */

/** Les commandes des gestes, réserve par réserve. @param {Map<string, Gesture>} g @param {any[]} open */
function commandsOf(g, open) {
  /** @type {any[]} */
  const cmds = [];
  for (const r of open) {
    const x = g.get(r.id);
    if (!x) continue;
    if (x.abandon) { cmds.push({ type: 'reserve.close', id: r.id }); continue; }
    if (x.amount != null && x.amount !== r.amount) cmds.push({ type: 'reserve.update', id: r.id, changes: { amount: x.amount } });
    if (x.pause) { if (r.due) cmds.push({ type: 'reserve.pause', id: r.id }); continue; }
    if (x.due && x.due !== r.due) cmds.push(r.due ? { type: 'reserve.update', id: r.id, changes: { due: x.due } } : { type: 'reserve.resume', id: r.id, due: x.due });
  }
  return cmds;
}

/** @param {string} walletId */
export function openSavingsReview(walletId) {
  const a = account(walletId);
  if (!a) return;
  const cur = a.currency, dec = currencyOf(cur).dec;
  const start = savingsReport(walletId);
  const list = start.versement.list;
  // un seul versement, chaque mois : il se change ici (le manque est par mois) ; un autre rythme ou plusieurs : depuis la page
  const one = list.length === 1 && (() => { const r = scheduleById(list[0].head); return !!r && r.every === 'month' && (r.interval || 1) === 1; })();
  const from = versementFrom(a);
  // de la plus lointaine à la plus proche (en pause : sans date, la plus lointaine)
  const open = reservesOf().filter(r => r.wallet === walletId && !r.closed)
    .sort((x, y) => ((y.due || '9999') < (x.due || '9999') ? -1 : (y.due || '9999') > (x.due || '9999') ? 1 : 0));
  /** @type {Map<string, Gesture>} */
  const g = new Map();
  let vAmount = one ? list[0].amount : list.length ? null : 0;
  let vBad = ''; // un montant illisible : dit, et Valider attend
  let touched = false; // le versement changé à la main : il ne suit plus le manque
  const s = openSheet(`<div class="acc-sheet sr-sheet">
    ${sheetHead({ title: 'Revoir mon épargne' })}
    <p class="sr-gap" data-gap></p>
    <div class="sr-list" data-list></div>
    <div class="sr-vers" data-vers></div>
    <p class="field-note" data-after></p>
    <div data-err></div>
    ${sheetActions(`<button class="btn primary" data-save>${icon('check')}Valider</button>`)}
  </div>`, { label: 'Revoir mon épargne' });
  const el = s.el;
  const set = (/** @type {string} */ id, /** @type {Gesture} */ ch) => { g.set(id, { ...(g.get(id) || {}), ...ch }); paint(); };

  const paint = () => {
    const cmds = commandsOf(g, open);
    // le manque d'après les gestes seuls (sans toucher au versement) : ce qu'il faudrait verser en plus
    const p = previewSavings(walletId, cmds);
    const err = $('[data-err]', el);
    err.innerHTML = p.error ? `<p class="field-note loss">${esc(p.error)}</p>` : '';
    if (!p.rep) return;
    const rep = p.rep;
    const gap = rep.versement.gap;
    $('[data-gap]', el).innerHTML = gap == null ? 'Aucune réserve datée : rien ne manque.'
      : gap ? `<span class="rs-warn">Il manque ${money(gap, { cur })} par mois</span> pour que tes réserves soient prêtes à temps.`
        : 'Tes échéances suffisent pour tes réserves.';
    if (!touched && (one || !list.length)) vAmount = (one ? list[0].amount : 0) + (gap || 0);
    $('[data-list]', el).innerHTML = open.map(r => {
      const x = g.get(r.id) || {};
      const v = rep.reserves.find(y => y.reserve.id === r.id);
      if (x.abandon || !v) return `<div class="sr-item gone"><div class="sr-t">${esc(r.name)}</div><div class="sr-s">${r.used ? 'Close' : 'Abandonnée'} : son argent retourne à l’épargne</div>
        <div class="sr-acts"><button class="link" data-undo="${r.id}">Annuler</button></div></div>`;
      const rr = v.reserve, stage = statusHTML(v);
      const changed = x.amount != null || x.due || x.pause;
      return `<div class="sr-item"><div class="sr-t">${esc(rr.name)}</div>
        <span class="bar rs-bar${barTone(v)}"><i style="width:${v.pct}%"></i></span>
        <div class="sr-s">${money(v.saved, { cur })} / ${money(v.target, { cur })} · ${rr.due ? `pour le ${yearDate(rr.due)}` : 'un jour'}</div>
        ${stage ? `<div class="sr-s">${stage}</div>` : ''}
        <div class="sr-acts">
          <button class="chip-btn" data-reduce="${r.id}">Réduire</button>
          <button class="chip-btn" data-push="${r.id}">${rr.due ? 'Repousser' : 'Reprendre'}</button>
          ${rr.due ? `<button class="chip-btn" data-pause="${r.id}">Mettre en pause</button>` : ''}
          <button class="chip-btn" data-drop="${r.id}">${r.used ? 'Clore' : 'Abandonner'}</button>
          ${changed ? `<button class="link" data-undo="${r.id}">Annuler</button>` : ''}
        </div></div>`;
    }).join('');
    // le versement : le seul se change ici, aucun se programme ; plusieurs : ils se changent depuis la page de l'épargne
    const vers = $('[data-vers]', el);
    if (list.length && !one) vers.innerHTML = `<p class="field-note">${list.length > 1 ? `Tu as ${list.length} versements` : 'Ton versement n’est pas mensuel'} : change-le${list.length > 1 ? 's' : ''} depuis la page de l’épargne.</p>`;
    else {
      const has = document.activeElement && /** @type {HTMLElement} */ (document.activeElement).dataset.v !== undefined;
      if (!has) vers.innerHTML = `<label class="field"><span>${list.length ? 'Ton versement chaque mois' : 'Un versement chaque mois'} (${symbol(cur)})</span>
        <input data-v inputmode="decimal" value="${vAmount ? vAmount / 10 ** dec : ''}" placeholder="0" autocomplete="off"></label>
        <p class="field-note">${list.length ? `Depuis ${esc(account(list[0].from)?.name || '…')}` : from ? `Depuis ${esc(account(from)?.name || '…')}, à partir du ${yearDate(rep.versement.next)}` : 'Crée d’abord un portefeuille courant pour programmer un versement.'}</p>`;
      const vi = /** @type {HTMLInputElement|null} */ ($('[data-v]', el));
      if (vi) vi.oninput = () => { const r = readAmount(vi.value || '0', cur); touched = true; if ('amount' in r) { vAmount = r.amount; vBad = ''; } else vBad = r.error; paintAfter(); };
    }
    paintAfter();
    wire();
  };
  // avec le versement choisi : ce qui manquerait encore
  const paintAfter = () => {
    if (vBad) { $('[data-after]', el).innerHTML = `<span class="loss">${esc(vBad)}</span>`; return; }
    const p = previewSavings(walletId, commandsOf(g, open), { amount: vAmount, from });
    const gap = p.rep?.versement.gap;
    $('[data-after]', el).innerHTML = !p.rep ? '' : gap ? `Avec ce versement, il manquera encore ${money(gap, { cur })} par mois : les réserves qui ne seront pas prêtes le diront sur leur ligne.`
      : gap === 0 ? 'Avec ce versement, tes réserves seront prêtes à temps.' : '';
  };
  const wire = () => {
    $$('[data-undo]', el).forEach(b => (b.onclick = () => { buzz(6); g.delete(/** @type {string} */ (b.dataset.undo)); paint(); }));
    $$('[data-drop]', el).forEach(b => (b.onclick = () => { buzz(8); set(/** @type {string} */ (b.dataset.drop), { abandon: true }); }));
    $$('[data-pause]', el).forEach(b => (b.onclick = () => { buzz(8); set(/** @type {string} */ (b.dataset.pause), { pause: true, due: undefined }); }));
    $$('[data-push]', el).forEach(b => (b.onclick = async () => {
      const r = open.find(x => x.id === b.dataset.push);
      if (!r) return;
      const cur0 = g.get(r.id)?.due || (r.due && r.due > today() ? r.due : addMonths(today(), 3));
      const d = await pickDate({ current: cur0, future: true, min: today(), title: r.due ? 'Repousser à' : 'Reprendre pour le' });
      if (d) set(r.id, { due: d, pause: false });
    }));
    $$('[data-reduce]', el).forEach(b => (b.onclick = async () => {
      const r = open.find(x => x.id === b.dataset.reduce);
      if (!r) return;
      const now = g.get(r.id)?.amount ?? r.amount;
      const v = await promptSheet({
        title: `Réduire ${esc(r.name)}`, label: `Montant visé (${symbol(cur)})`, value: String(now / 10 ** dec), yes: 'Réduire', mode: 'decimal', max: 16,
        check: t => { const x = readAmount(t, cur); return 'error' in x ? x.error : x.amount <= r.used ? 'Plus que ce qui a déjà été utilisé.' : x.amount > r.amount ? 'Pour réduire : moins qu’aujourd’hui.' : null; },
      });
      if (v != null) { const x = readAmount(v, cur); if ('amount' in x) set(r.id, { amount: x.amount }); }
    }));
  };
  $('[data-save]', el).onclick = async () => {
    if (vBad) { buzz(14); return; }
    const cmds = commandsOf(g, open);
    const unchanged = !cmds.length && (!one || vAmount === list[0].amount) && (list.length || !vAmount || !from);
    if (unchanged) { s.close(); return; }
    buzz(12);
    if (await applySavingsReview(walletId, cmds, { amount: one || !list.length ? vAmount : null, from })) {
      // la cloche ne repart pas aussitôt pour ce qui manque encore (elle parlera seulement si le manque grandit)
      const left = savingsReport(walletId).versement.gap || 0;
      pref('reviewSeen', { ...(pref('reviewSeen') || {}), [walletId]: left });
      s.close(); toast('Épargne revue');
    }
  };
  paint();
}
