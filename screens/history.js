// Fiche d'une opération (D6) : feuille avec le montant en grand et la note dessous, lisible, les faits (portefeuille,
// date, statut, « Saisie le … » avec l'heure), l'historique replié s'il y a eu des modifications (« Historique ·
// 2 modifications », un toucher déplie la frise : le plus récent en haut, « ancien barré → nouveau », date et heure,
// origine), et les boutons
// Modifier et « Annuler l'opération » (ou « Rétablir » pour une opération annulée). En haut, Dupliquer : la saisie
// s'ouvre remplie comme elle (date du jour), il ne reste qu'à valider. Titre = la catégorie ; la note sous le montant,
// si elle ne répète pas la catégorie. Pas de « Supprimer »
// pour les opérations. La chronologie est dérivée du journal (entry_history).
import { DUE } from '../domain/words.js';
import { entryHistory, accountName, moveById, category, account, accCur, eventMeta, deviceId, budgetOfTx } from '../core/store.js';
import { openReserveMenu } from './reserves.js';
import { openSheet, toast, buzz, chip, splitAmount, fitText, $ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, esc, shortDate, iso, parse, dayLabel, today } from '../core/format.js';
import { openEntry } from './entry.js';
import { voidOperation, restoreOperation, originOf, noteIsOrigin, originIcon } from './common.js';
import { openDueSheet } from './due-page.js';
import { firstDateFrom, addDays } from '../domain/dues.js';

const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// « Aujourd'hui, 19 h 42 », « Hier, 8 h 05 », « 3 nov., 18 h 00 »
export function atLabel(at) {
  const d = new Date(at);
  const p = Object.fromEntries(fmtTime.formatToParts(d).map(x => [x.type, x.value]));
  const day = iso(d);
  const l = dayLabel(day);
  const when = ['Aujourd’hui', 'Hier'].includes(l) ? l : shortDate(day);
  return `${when}, ${p.hour} h ${p.minute}`;
}
const longDate = d => cap(fmtLong.format(parse(d)));
const KIND = { expense: 'Dépense', income: 'Revenu', transfer: 'Virement', opening: 'Solde de départ', adjustment: 'Correction du solde' };
const amt = v => money(v.amount, { cur: v.currency });
const was = (a, b) => `<s>${a}</s> → ${b}`;

// Différences entre deux versions : « Montant : 12 000 F (barré) → 12 500 F ».
function changes(a, b) {
  const out = [];
  if (a.kind !== b.kind) out.push(`Type : ${was(KIND[a.kind] || a.kind, KIND[b.kind] || b.kind)}`);
  if (a.amount !== b.amount) out.push(`Montant : ${was(amt(a), amt(b))}`);
  if (a.date !== b.date) out.push(`Date : ${was(shortDate(a.date), shortDate(b.date))}`);
  if (a.wallet !== b.wallet) out.push(`${b.kind === 'transfer' ? 'De' : 'Portefeuille'} : ${was(esc(accountName(a.wallet)), esc(accountName(b.wallet)))}`);
  if (a.to !== b.to && b.kind === 'transfer') out.push(`Vers : ${was(esc(accountName(a.to) || '–'), esc(accountName(b.to)))}`);
  if (a.category !== b.category && b.category) out.push(`Catégorie : ${was(esc(category(a.category || '')?.name || '–'), esc(category(b.category)?.name || '–'))}`);
  if (a.status !== b.status && b.status !== 'void' && a.status !== 'void') out.push(b.status === 'planned' ? 'Marquée à venir' : 'Marquée payée');
  if ((a.note || '') !== (b.note || '')) out.push(b.note ? `Note : ${a.note ? `<s>${esc(a.note)}</s> → ` : ''}« ${esc(b.note)} »` : `Note retirée : <s>${esc(a.note)}</s>`);
  return out;
}

// Ligne de frise : { t (HTML), s (sous-titre) }.
function line(h) {
  const v = h.after || h.before;
  if (h.action === 'recorded') {
    const when = v.date !== iso(new Date(h.at)) ? ` pour le ${shortDate(v.date)}` : '';
    return { t: `${v.status === 'planned' ? 'À venir' : 'Créée'}${when}, ${amt(v)}` };
  }
  if (h.action === 'amended') return { t: changes(h.before, h.after).join('<br>') || 'Enregistrée sans changement' };
  if (h.action === 'voided') return { t: 'Annulée', s: 'ne compte plus' };
  if (h.action === 'restored') return { t: 'Rétablie' };
  if (h.action === 'reset') {
    const d = changes(h.before, h.after);
    return { t: h.before.status === 'void' ? ['Rétablie', ...d].join('<br>') : (d.join('<br>') || 'Remise comme avant'), s: 'remise à une version d’avant' };
  }
  return { t: esc(h.action) };
}

/** Frise de l'historique d'une opération (le plus récent en haut). */
function timeline(txId) {
  const list = entryHistory(txId).slice().reverse();
  const html = list.map((h, i) => {
    const l = line(h);
    return `<li class="${i === 0 ? 'now' : ''}" data-seq="${h.seq}" data-act="${h.action}"><i aria-hidden="true"></i><div><div class="tl-t">${l.t}</div>
      <div class="tl-s">${atLabel(h.at)}${l.s ? ` · ${l.s}` : ''}<span data-dev></span></div></div></li>`;
  }).join('');
  return { html, n: list.length };
}

/**
 * Ouvre la fiche d'une opération (annulée comprise).
 * @param {string} txId
 */
/** go : la navigation de l'écran (sans elle, l'adresse change). @param {string} txId @param {(hash: string) => any} [go] */
export function openOperation(txId, go = h => { location.hash = h; }) {
  const t = moveById(txId);
  if (!t) return null;
  const cat = category(t.categoryId);
  const cur = accCur(t.accountId);
  const title = t.type === 'transfer' ? 'Virement' : cat?.name || 'Sans catégorie';
  const note = (t.note || '').trim();
  // d'où elle vient (2026-11-13, avec l'utilisateur) : une ligne sous le montant, qui ouvre son origine
  const origin = originOf(t);
  const noteLine = note && note.toLowerCase() !== title.toLowerCase() && !noteIsOrigin(t, origin) ? note : '';
  // Répéter (D18, 2026-11-13) : une opération notée à la main (pas une échéance, une réserve ni une vérification) devient
  // une échéance préremplie, chaque mois, prochaine date un mois après elle (au plus tôt demain)
  const canRepeat = !t.void && !t.planned && !origin;
  const pill = t.type === 'transfer' ? `<span class="pill acc xl">${icon('arrows-left-right')}</span>` : chip(cat, 'xl');
  const created = t.createdAt ? iso(new Date(t.createdAt)) : t.date;
  const status = t.void ? 'Annulée' : t.planned ? (t.date < today() ? 'En retard' : 'À venir') : 'Payée';
  const acc = account(t.accountId), to = account(t.toAccountId);
  const facts = [
    t.type === 'transfer'
      ? ['De → À', `${esc(acc?.name || accountName(t.accountId))} → ${esc(to?.name || accountName(t.toAccountId))}`]
      : ['Portefeuille', esc(acc?.name || accountName(t.accountId))],
    ['Date', longDate(t.date)],
    ['Statut', status],
  ];
  // le budget où elle compte (2026-11-13) : il ne la crée pas, mais c'est là qu'elle pèse ; le toucher ouvre sa catégorie
  const bud = budgetOfTx(t);
  if (bud) facts.splice(1, 0, ['Budget', `<button type="button" class="op-res" data-bud-open>${esc(category(bud.b.category)?.name || '')} <small>jusqu’au ${shortDate(bud.w.end)}</small>${icon('caret-right')}</button>`]);
  const tl = timeline(txId);
  // « Saisie le » avec l'heure, toujours (c'est ce que l'historique dit d'une opération jamais modifiée)
  const rec = entryHistory(txId).find(h => h.action === 'recorded');
  facts.push(['Saisie le', rec ? atLabel(rec.at) : longDate(created)]);
  const changes = tl.n - 1;
  const s = openSheet(`<div class="op-sheet${t.void ? ' is-void' : ''}">
    <div class="op-head"><span class="eyebrow">${KIND[t.type] === title ? '' : KIND[t.type]}</span>
      ${canRepeat ? `<button type="button" class="iconbtn soft op-dup" data-repeat aria-label="Répéter : en faire ${DUE.a}">${icon('arrows-clockwise')}</button>` : ''}
      <button type="button" class="iconbtn soft op-dup" data-dup aria-label="Dupliquer">${icon('copy')}</button>
      <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="op-id">${pill}<div class="op-what">${esc(title)}</div>
      <div class="op-amt${t.type === 'income' ? ' in' : ''}">${splitAmount(t.amount, { cur })}</div>
      ${noteLine ? `<p class="op-note">${esc(noteLine)}</p>` : ''}
      ${origin ? `<button type="button" class="op-origin" data-origin>${originIcon(origin)}<span>${esc(origin.label)}</span>${icon('caret-right')}</button>` : ''}</div>
    <div class="facts">${facts.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>
    ${changes > 0 ? `<button type="button" class="op-histbtn" data-hist aria-expanded="false"><span>Historique</span><span class="muted">${changes} modification${changes > 1 ? 's' : ''}${icon('caret-down')}</span></button>
    <ol class="tl" hidden>${tl.html}</ol>` : ''}
    <div class="op-actions${t.void ? ' one' : ''}">
      ${t.void ? '' : '<button type="button" class="btn secondary" data-edit>Modifier</button>'}
      <button type="button" class="btn secondary${t.void ? '' : ' warn'}" data-void>${t.void ? `${icon('arrow-counter-clockwise')}Rétablir l’opération` : 'Annuler l’opération'}</button></div>
  </div>`, { label: 'Opération', cls: 'op' });
  fitText(s.el, '.op-amt', 24);
  $('[data-close]', s.el).onclick = () => { buzz(6); s.close(); };
  const away = (/** @type {string} */ h) => { buzz(6); s.close(); setTimeout(() => go(h), 60); };
  const og = $('[data-origin]', s.el);
  // une dépense prévue : son menu, le même partout (2026-11-25) ; ce qu'il ouvre ailleurs referme la fiche
  if (og && origin) og.onclick = () => (origin.reserve ? (buzz(6), openReserveMenu({ id: origin.reserve.id, openEntry, go: away, fromTx: t.id })) : away(origin.href || '#/'));
  const bo = $('[data-bud-open]', s.el);
  if (bo && bud) bo.onclick = () => away(`#/mois/categorie?c=${encodeURIComponent(bud.b.category)}`);
  // origine de la création : ce téléphone ou un autre appareil (d'après le journal)
  // historique replié : un toucher le déplie sur place (la plupart du temps, ce n'est pas ce qu'on vient voir)
  const hb = $('[data-hist]', s.el);
  if (hb) hb.onclick = () => {
    buzz(6);
    const ol = $('.tl', s.el), open = ol.hidden;
    ol.hidden = !open;
    hb.setAttribute('aria-expanded', String(open));
  };
  const recLi = $('li[data-act="recorded"]', s.el);
  if (recLi) eventMeta(Number(recLi.dataset.seq)).then(m => { if (m && recLi.isConnected) $('[data-dev]', recLi).textContent = m.device === deviceId() ? ' · sur ce téléphone' : ' · sur un autre appareil'; }).catch(() => {});
  const edit = $('[data-edit]', s.el);
  if (edit) edit.onclick = () => { buzz(6); s.close(); setTimeout(() => openEntry({ tx: t }), 60); };
  const rep = $('[data-repeat]', s.el);
  if (rep) rep.onclick = () => {
    buzz(6); s.close();
    const from = addDays(t.date, 1) > today() ? addDays(t.date, 1) : today();
    const start = firstDateFrom({ start: t.date, every: 'month', interval: 1 }, from);
    setTimeout(() => openDueSheet({
      preset: { kind: t.type, amount: t.amount, accountId: t.accountId, toAccountId: t.toAccountId || null, categoryId: t.categoryId || null, note: t.note || '', start, every: 'month', interval: 1 },
      openEntry, onCreated: d => go(`#/mois/echeance?e=${encodeURIComponent(d.id)}`),
    }), 60);
  };
  const dup = $('[data-dup]', s.el);
  if (dup) dup.onclick = () => { buzz(6); s.close(); setTimeout(() => openEntry({ copy: t }), 60); };
  const v = $('[data-void]', s.el);
  if (v) v.onclick = async () => {
    if (t.void) {
      if (!(await restoreOperation(txId))) return;
      buzz(10);
      s.close();
      toast('Opération rétablie');
      return;
    }
    if (await voidOperation(t)) s.close();
  };
  return s;
}
