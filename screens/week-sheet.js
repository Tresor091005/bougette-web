// Confirmer la semaine (D18 revu le 2026-11-18, avec l'utilisateur) : une échéance qui revient plusieurs fois par semaine
// (le zem lundi, mardi, vendredi) se confirme par semaine, pas jour par jour. Une feuille montre ses jours de la semaine
// jusqu'à aujourd'hui, tous cochés ; on décoche celui qui n'a pas eu lieu, on touche un montant pour le changer, le total
// suit ; « Confirmer N jours » (les décochés sont passés), tout décoché : « Passer cette semaine ». Un seul
// enregistrement, tout ou rien.
import { dueOccurrences, scheduleById, settleDues } from '../core/store.js';
import { money, esc, readAmount, today } from '../core/format.js';
import { icon } from '../core/icons.js';
import { openSheet, buzz, toast, noticeHTML, promptSheet, fromMinor, afterSheets, $, $$ } from '../core/ui.js';
import { addDays } from '../domain/dues.js';
import { sheetHead, sheetActions } from './parts.js';

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
const cap = (/** @type {string} */ t) => t.charAt(0).toUpperCase() + t.slice(1);
const monday = (/** @type {string} */ s) => addDays(s, -((new Date(`${s}T12:00:00`).getDay() + 6) % 7));

/**
 * Les fois à régler de la semaine de d (du lundi au dimanche), jusqu'à aujourd'hui ; [] si l'échéance ne revient pas
 * plusieurs fois par semaine.
 * @param {any} d (une fois : DueItem ou DueView) @returns {any[]}
 */
export function weekOf(d) {
  if (!d.schedule) return [];
  const r = scheduleById(d.schedule);
  if (!r || r.every !== 'week' || !r.days?.length) return [];
  const m = monday(d.date), t0 = today();
  return dueOccurrences(d.schedule).filter(o => (o.state === 'late' || o.state === 'today') && o.date <= t0 && monday(o.date) === m && o.schedule);
}

/**
 * Confirmer : la feuille de la semaine s'il y a plusieurs fois à régler cette semaine-là, sinon fallback (confirmer d'un
 * toucher). @param {any} d @param {() => any} fallback @returns {any}
 */
export function confirmWeekOr(d, fallback) {
  const list = weekOf(d);
  if (list.length < 2) return fallback();
  return openWeekSheet(list);
}

/** @param {any[]} list */
function openWeekSheet(list) {
  const cur = list[0].currency;
  const rows = list.map(o => ({ o, on: true, amount: o.amount }));
  const name = list[0].note || 'Échéance';
  const s = openSheet(`<div class="wk">
    ${sheetHead({ title: `${esc(name)} · la semaine` })}
    <p class="muted wk-help">Décoche le jour qui n’a pas eu lieu. Touche un montant pour le changer.</p>
    <div class="group wk-list" data-list></div>
    <p class="wk-total" data-total></p>
    <div data-err></div>
    ${sheetActions('<button class="btn primary" data-go></button>')}
  </div>`, { label: `${name} · la semaine` });
  const listEl = /** @type {HTMLElement} */ ($('[data-list]', s.el));
  const paint = () => {
    listEl.innerHTML = rows.map((x, i) => `<div class="row wk-row${x.on ? ' on' : ''}">
      <button type="button" class="wk-tick" data-i="${i}" role="checkbox" aria-checked="${x.on}"><span class="wk-box">${icon('check')}</span><span>${esc(cap(DAY.format(new Date(`${x.o.date}T12:00:00`))))}</span></button>
      <button type="button" class="wk-amt${x.amount !== x.o.amount ? ' changed' : ''}" data-a="${i}"${x.on ? '' : ' disabled'}>${money(x.amount, { cur })}</button></div>`).join('');
    const n = rows.filter(x => x.on).length;
    const total = rows.reduce((a, x) => a + (x.on ? x.amount : 0), 0);
    $('[data-total]', s.el).innerHTML = n ? `Total <b>${money(total, { cur })}</b>${n < rows.length ? ` · ${rows.length - n} passé${rows.length - n > 1 ? 's' : ''}` : ''}` : 'Rien cette semaine.';
    $('[data-go]', s.el).innerHTML = n ? `${icon('check')}Confirmer ${n} jour${n > 1 ? 's' : ''}` : 'Passer cette semaine';
  };
  paint();
  listEl.onclick = async e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const tick = /** @type {HTMLElement|null} */ (t.closest('[data-i]'));
    if (tick) { const x = rows[Number(tick.dataset.i)]; x.on = !x.on; buzz(6); paint(); return; }
    const a = /** @type {HTMLButtonElement|null} */ (t.closest('[data-a]'));
    if (!a || a.disabled) return;
    const x = rows[Number(a.dataset.a)];
    const v = await promptSheet({ title: cap(DAY.format(new Date(`${x.o.date}T12:00:00`))), label: 'Montant', value: String(fromMinor(x.amount, cur)), mode: 'decimal', max: 15,
      check: v => { const r = readAmount(v, cur); return r.error || (/** @type {number} */ (r.amount) > 0 ? null : 'Indique un montant.'); } });
    if (v == null) return;
    x.amount = /** @type {number} */ (readAmount(v, cur).amount);
    paint();
  };
  $('[data-go]', s.el).onclick = async () => {
    const n = rows.filter(x => x.on).length;
    const ok = await settleDues(rows.map(x => ({ d: x.o, ok: x.on, ...(x.on && x.amount !== x.o.amount ? { tx: { amount: x.amount } } : {}) })), {
      onError: (/** @type {string} */ m) => { $('[data-err]', s.el).innerHTML = noticeHTML(esc(m)); buzz(14); },
    });
    if (!ok) return;
    buzz(12);
    s.close();
    afterSheets(() => toast(n ? `${name} : ${n} jour${n > 1 ? 's' : ''} noté${n > 1 ? 's' : ''}` : `${name} : semaine passée`));
  };
  return s;
}
