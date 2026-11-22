// Une échéance (D18, revue le 2026-11-12) : sa page, et la feuille d'une nouvelle. Une page et non plus une feuille
// (2026-11-12) : c'est un endroit qu'on consulte et qu'on règle (D9). Regarder d'abord, modifier ensuite. En haut, ses
// fois — réglées, passées, en retard, à venir — dans une bande d'onglets qu'on parcourt comme les périodes du Journal
// (toucher un onglet, ou glisser la fois choisie) ; la fois choisie dit son état et ses actions (Confirmer, Passer,
// Remettre à régler, voir l'opération ; d'avance, seulement la prochaine). Dessous, sa règle en une ligne (« 35 000 F ·
// chaque mois le 1er · MTN MoMo · Loyer » ; sur une fois d'une règle d'avant : « À cette date : … »), puis Modifier,
// Arrêter, et « Regrouper avec … » quand elle a une jumelle (D18, 2026-11-20 : la même à un montant près ; une nouvelle
// jumelle demande à la création « Ajouter au montant de … ? »). « Modifier » ouvre le formulaire sur la page : la bande reste en haut, ses fois à venir se
// repeignent en direct (en pointillé ; celles qui sont réglées ou en retard ne changent pas : cadenas), un résumé dit
// ce qui changera et « Annuler les changements » remet les valeurs enregistrées ; Retour referme le formulaire.
// Une échéance terminée (plus rien à régler ni à venir) se lit
// seulement : ni Modifier, ni Arrêter ; « Reconduire » y ouvre une nouvelle échéance (indépendante),
// préremplie de sa règle la plus récente, type et catégorie figés, première date à partir d'aujourd'hui. Une nouvelle échéance s'ouvre dans une feuille, sur le formulaire
// (créer, c'est saisir). Planifier n'est pas saisir (D14) : elle se crée dans Budget, jamais dans la saisie. Champs :
// type (Dépense · Revenu · Virement ; figé dès qu'une fois est réglée), nom, montant, catégorie, portefeuille (et arrivée
// d'un virement), « Quand ? » (D18 revu le 2026-11-18 : un calendrier, les jours touchés et leur répétition,
// when-sheet.js), fin (jamais, une date, un nombre de fois : celui de toute l'échéance).
// Modifier vaut à partir d'aujourd'hui, les retards gardent leurs valeurs (le domaine coupe la règle ; ses règles
// successives restent une seule échéance) ; « Arrêter » ne touche jamais les opérations déjà notées. Un seul geste pour
// finir (2026-11-13, avec l'utilisateur ; avant : Arrêter et Supprimer) : sans rien de réglé ni de retard, elle disparaît
// (rien à garder) ; sinon plus de dates à partir d'aujourd'hui, ses retards restent à régler, puis elle rejoint les terminées.
// Une règle arrêtée ne se modifie plus : sa ligne de règle et « Arrêtée le … », ses retards se règlent un par un.
import {
  account, accounts, category, scheduleById, scheduleNext, schedules, createDue, updateDue, stopDue, dueStopErases,
  dueOccurrences, dueHead, dueRoot, dueTimes, dueSettled, previewDueUpdate, confirmDue, skipDue, unskipDue, budgetReport, settings,
  available, endedDues, dueChainIds, transactions, dueMerge, mergeDues, twinOfNew, addToDue,
} from '../core/store.js';
import { assigned } from '../core/assign.js';
import { money, esc, shortDate, yearDate, dayLabel, today, parseAmount, currencyOf, symbol } from '../core/format.js';
import { icon } from '../core/icons.js';
import { openSheet, seg, wireSeg, setSeg, buzz, toast, noticeHTML, chip, confirmSheet, menuSheet, afterSheets, reducedMotion, fitText, $, $$ } from '../core/ui.js';
import { pickAccount, pickDate, pickCategory, fillsHTML, openFillOf } from './pickers.js';
import { pickWhen, whenPhrase } from './when-sheet.js';
import { busyDates, monthlyHabit } from '../domain/when.js';
import { confirmWeekOr } from './week-sheet.js';
import { renewalOf, addDays } from '../domain/dues.js';
import { openIncomeSheet } from './budget-sheet.js';
import { openAccountSheet } from './accounts.js';
import { openOperation } from './history.js';

/** @typedef {import('../domain/dues.js').DueView} DueView */
/** @typedef {import('../domain/dues.js').Schedule} Schedule */
/** @typedef {import('../domain/dues.js').EndedDue} EndedDue */

const TYPES = [['expense', 'Dépense'], ['income', 'Revenu'], ['transfer', 'Virement']];
const ENDS = [['never', 'Jamais'], ['date', 'Une date'], ['times', 'En plusieurs fois']];
/** Unités d'un rythme libre (D18, revu le 2026-11-11). */
/** @type {Record<string, [string, (n: number) => string]>} */
const WORDS = {
  day: ['Chaque jour', n => `Tous les ${n} jours`], week: ['Chaque semaine', n => `Toutes les ${n} semaines`],
  month: ['Chaque mois', n => `Tous les ${n} mois`], year: ['Chaque année', n => `Tous les ${n} ans`],
};
/** @type {Record<string, string>} */
const KIND_WORD = { expense: 'une dépense', income: 'un revenu', transfer: 'un virement' };
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

/** Ce qu'on dit d'un rythme : « Chaque mois », « Tous les 23 jours », « Une seule fois ». @param {string|null} every @param {number} [interval] */
export function rhythmLabel(every, interval = 1) {
  const w = every ? WORDS[every] : null;
  if (!w) return 'Une seule fois';
  return interval > 1 ? w[1](interval) : w[0];
}
/** Une date courte, avec l'année quand ce n'est pas celle d'aujourd'hui : « 19 nov », « 3 juil 2027 ». @param {string} d */
export const dayShort = d => (d.slice(0, 4) === today().slice(0, 4) ? shortDate(d) : yearDate(d));
/** @param {string} x */
const low = x => x.charAt(0).toLowerCase() + x.slice(1);
/**
 * Ce qu'on dit d'une échéance terminée : « Finie le 3 sept », « Arrêtée · dernière fois le 12 oct », « Réglée d'avance ·
 * dernière fois le 12 déc » (sa dernière date, payée d'avance, est encore à venir).
 * @param {EndedDue} x
 */
export function endedLabel(x) {
  if (x.stopped) return x.last ? `Arrêtée · dernière fois le ${dayShort(x.last)}` : 'Arrêtée avant sa première fois';
  return x.last && x.last > today() ? `Réglée d’avance · dernière fois le ${dayShort(x.last)}` : `Finie le ${dayShort(x.endedOn)}`;
}
/** L'adresse de la page d'une échéance (une de ses règles), ouverte sur une de ses fois. @param {string} id @param {string|null} [at] */
export const dueHref = (id, at = null) => `#/mois/echeance?e=${encodeURIComponent(id)}${at ? `&at=${at}` : ''}`;

/** Le rythme avec son jour : « chaque mois le 1er », « toutes les 2 semaines le lundi », « une seule fois ». @param {Schedule} x */
function rhythmPhrase(x) {
  if (x.days?.length) return low(whenPhrase({ start: x.start, days: x.days, every: x.every, interval: x.interval || 1 }));
  if (!x.every) return 'une seule fois';
  const words = low(rhythmLabel(x.every, x.interval)), d = Number(x.start.slice(8, 10));
  if (x.every === 'week') return `${words} le ${WEEKDAY.format(new Date(`${x.start}T12:00:00`))}`;
  if (x.every === 'month') return `${words} le ${d === 1 ? '1er' : d}`;
  if (x.every === 'year') return `${words} le ${shortDate(x.start)}`;
  return words;
}
/**
 * La règle en une ligne (D18, revu le 2026-11-12) : « 35 000 F · chaque mois le 1er · MTN MoMo · Loyer » (et « en 4
 * fois », « jusqu'au … »). total : le nombre de fois de toute l'échéance. @param {Schedule} x @param {number|null} total
 */
function ruleLine(x, total) {
  const parts = [dueMoney(x), rhythmPhrase(x)];
  parts.push(x.kind === 'transfer' ? `${account(x.wallet)?.name || '…'} → ${account(x.to || '')?.name || '…'}` : account(x.wallet)?.name || '…');
  if (x.kind !== 'transfer') parts.push(category(x.category || '')?.name || '…');
  if (x.every && total) parts.push(`en ${total} fois`);
  if (x.every && x.end) parts.push(`jusqu’au ${dayShort(x.end)}`);
  return parts.join(' · ');
}

/** Le nom d'une échéance : son nom, sinon sa catégorie, sinon « Vers … » pour un virement. @param {{ note: string, kind: string, to: string|null, category: string|null }} d */
export function dueTitle(d) {
  if (d.note) return d.note;
  if (d.kind === 'transfer') return `Vers ${account(d.to || '')?.name || '…'}`;
  return category(d.category || '')?.name || 'Échéance';
}
/** Le montant d'une échéance, signé comme dans le Journal (une rentrée en +). @param {{ kind: string, amount: number, currency: string }} d */
export const dueMoney = d => (d.kind === 'income' ? money(d.amount, { cur: d.currency, sign: true }) : money(d.amount, { cur: d.currency }));

/** Peut-on encore modifier cette règle (ni arrêtée, ni continuée par une autre) ? @param {string} id */
export function canEditDue(id) {
  const r = scheduleById(id);
  if (!r) return false;
  return !r.stopped && !schedules().some(x => x.from === id);
}

/**
 * Confirmer d'un toucher (D18) : l'opération est enregistrée avec les valeurs de l'échéance ; déjà comptée dans
 * Disponible, on le dit. Comme une opération notée : une rentrée propose ensuite de la répartir (D11), de l'argent mis
 * de côté donne une destination à l'argent arrivé (D17).
 * @param {import('../domain/dues.js').Due} d @param {(o: any) => any} openEntry @returns {Promise<boolean>}
 */
export async function confirmNow(d, openEntry) {
  const counted = budgetReport().dues.some(x => x.key === d.key);
  const ok = await confirmDue(d);
  if (!ok) return false;
  buzz(12);
  const name = dueTitle(d);
  toast(d.kind === 'income' ? `${name} : reçu` : counted ? `${name} : noté · Disponible ne change pas, c’était prévu` : `${name} : noté`);
  if (d.kind === 'transfer' && account(d.to || '')?.savings) assigned();
  const w = account(d.wallet);
  if (d.kind === 'income' && w && !w.excluded && !w.savings && w.currency === settings().currency) {
    setTimeout(() => afterSheets(() => openIncomeSheet({ amount: d.amount, cur: w.currency, available: available(), walletId: w.id, openEntry, openAccountSheet })), 400);
  }
  return true;
}
/** Passer une fois (elle ne compte pas cette fois-ci). @param {import('../domain/dues.js').Due} d */
export async function skipNow(d) {
  if (!(await skipDue(d))) return false;
  buzz(8);
  toast(`${dueTitle(d)} : passée`);
  return true;
}

/**
 * Une nouvelle échéance (le « + » d'Échéances) : une feuille, sur le formulaire (créer, c'est saisir). preset : valeurs de
 * départ (Répéter dans la fiche d'une opération ; again : la reconduction d'une échéance terminée, type et
 * catégorie figés ; say : la phrase d'en-tête, comme pour le versement d'une épargne). onCreated : la nouvelle, une fois créée. Une échéance qui existe s'ouvre dans sa page (dueHref).
 * @param {{ preset?: Record<string, any>|null, openEntry?: (o: any) => any, onCreated?: (d: Schedule) => void }} [o]
 */
export function openDueSheet({ preset = null, openEntry = () => {}, onCreated = () => {} } = {}) {
  const c = dueContent({ r: null, preset, openEntry });
  const s = openSheet(`<div class="acc-sheet due-sheet editing"><h2 class="sheet-title" data-title>${preset?.again ? 'Reconduire l’échéance' : 'Nouvelle échéance'}</h2>${c.html}</div>`, { label: 'Échéance' });
  c.mount(s.el, { done: (_, made) => { s.close(); if (made) afterSheets(() => onCreated(made)); } });
  return s;
}

/**
 * Reconduire une échéance terminée (2026-11-13) : la feuille d'une nouvelle échéance, indépendante, préremplie de sa règle
 * la plus récente (renewalOf) ; un portefeuille archivé laisse la place au premier courant. Créée, sa page s'ouvre.
 * @param {Schedule} r (la tête de l'échéance terminée) @param {string|null} last (sa dernière date) @param {any} ctx
 */
function renewDue(r, last, ctx) {
  const p = renewalOf(r, today(), last);
  const live = (/** @type {string|null} */ id) => (id && account(id) && !account(id)?.archived ? id : null);
  openDueSheet({
    preset: { ...p, accountId: live(p.accountId), toAccountId: live(p.toAccountId), every: p.every || '', again: true },
    openEntry: ctx.openEntry,
    onCreated: d => ctx.go(dueHref(d.id)),
  });
}

/**
 * @typedef {{ refresh: () => void, editing: () => boolean, leaveEdit: () => boolean, at: () => string|null }} DueApi
 */
/**
 * La page ouverte : de quoi repeindre ses fois sans perdre le formulaire ; keep : redessinée par elle-même (enregistrée,
 * arrêtée, changée en profondeur), la même fois reste choisie.
 * @type {{ head: string, root: string, editable: boolean, ended: boolean, keep: boolean, api: DueApi, ctx: any }|null}
 */
let page = null;

/** La page d'une échéance (#/mois/echeance?e=<une de ses règles>&at=<une de ses fois>), ouverte depuis Plan. */
export const duePage = {
  /** @param {HTMLElement} app @param {any} ctx */
  render(app, ctx) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const id = q.get('e') || '';
    const head = id ? scheduleById(dueHead(id)) : null;
    if (!head) { page = null; ctx.back('#/mois'); return; }
    const end = endedDues().find(x => x.head === head.id) || null;
    const root = dueRoot(head.id);
    const at = (page && page.keep && page.root === root && page.api.at()) || q.get('at');
    const c = dueContent({ r: head, at, openEntry: ctx.openEntry, ended: end, renew: () => renewDue(head, end?.last || null, ctx) });
    app.innerHTML = `<div class="screen due-page no-tabs">
      <div class="topbar"><div class="left"><button class="iconbtn edge-l" data-back aria-label="Retour">${icon('caret-left')}</button>
        <h1 class="title sm due-title" data-title>${esc(c.title)}</h1></div></div>
      <div class="due-sheet">${c.html}</div>
    </div>`;
    const redraw = () => { if (page) page.keep = true; ctx.refresh(); };
    // supprimée : onData revient à Budget (elle n'existe plus) ; sinon la page se redessine (en lecture, sa nouvelle tête)
    const api = c.mount(app, { done: what => { if (what !== 'deleted') redraw(); } });
    page = { head: head.id, root, editable: c.editable, ended: !!end, keep: false, api, ctx };
    $('[data-back]', app).onclick = () => { if (!api.leaveEdit()) ctx.back('#/mois'); };
    fitText(app, '.due-title', 18);
  },
  /** Une donnée a changé : ses fois se repeignent (le formulaire reste) ; changée en profondeur, la page se redessine. */
  onData() {
    if (!page) return;
    const head = scheduleById(dueHead(page.head));
    if (!head) { const { ctx } = page; page = null; ctx.back('#/mois'); return; }
    const end = endedDues().some(x => x.head === head.id);
    const editable = !end && canEditDue(head.id);
    if (head.id !== page.head || editable !== page.editable || end !== page.ended) {
      if (!page.api.editing()) { page.keep = true; page.ctx.refresh(); }
      return;
    }
    page.api.refresh();
  },
  /** Retour Android : pendant qu'on modifie, le formulaire se referme (les valeurs enregistrées reviennent). */
  back() { return !!page && page.api.leaveEdit(); },
};

/**
 * Le contenu d'une échéance : ses fois, sa règle en une ligne, ses actions et le formulaire. Une échéance qui existe
 * (r : sa tête) s'ouvre en lecture dans sa page ; une nouvelle, sur le formulaire, dans une feuille. html va dans un
 * élément de classe due-sheet ; mount() le branche (le titre [data-title] est cherché dans tout l'élément donné) et
 * appelle done() après 'created' (avec la nouvelle), 'saved', 'stopped' ou 'deleted'. ended : une échéance terminée, en
 * lecture seule ; renew : « Reconduire » (sa page ; pas quand sa catégorie est archivée).
 * preset.again : une reconduction, type et catégorie figés.
 * @param {{ r: Schedule|null, preset?: Record<string, any>|null, at?: string|null, openEntry: (o: any) => any, ended?: EndedDue|null, renew?: (() => void)|null }} o
 */
function dueContent({ r, preset = null, at = null, openEntry, ended = null, renew = null }) {
  const t0 = today();
  // reconduire : on sait ce que c'est (son type et sa catégorie ne se choisissent pas)
  const again = !r && !!preset?.again;
  const cat0 = r && r.kind !== 'transfer' ? category(r.category || '') : null;
  const canRenew = !!r && !!ended && !!renew && (r.kind === 'transfer' || (!!cat0 && !cat0.archived));
  const editable = !ended && (!r || canEditDue(r.id));
  // « en N fois » : le nombre de fois de toute l'échéance (ses règles successives comprises), comme ses fois le disent
  const total0 = r ? dueTimes(r.id) : null;
  // une fois déjà réglée : le type ne change plus (pour un autre, une autre échéance) ; relu après chaque changement
  let settled = r ? dueSettled(r.id) : false;
  const next = r ? scheduleNext(r.id) : null;
  const firstWallet = accounts().find(a => !a.savings && !a.archived)?.id || accounts()[0]?.id || null;
  const f = {
    kind: r?.kind || preset?.kind || 'expense',
    amount: r?.amount || preset?.amount || 0,
    wallet: r?.wallet || preset?.accountId || firstWallet,
    to: r?.to || preset?.toAccountId || null,
    category: r?.category || preset?.categoryId || null,
    note: r?.note || preset?.note || '',
    // une règle commencée montre sa prochaine date (la première date d'une règle continuée est son jour d'ancrage)
    start: r ? (next?.date || r.start) : preset?.start || t0,
    every: r ? (r.every || '') : (preset?.every ?? 'month'),
    interval: r ? r.interval : (preset?.interval || 1),
    end: r ? r.end || null : preset?.end || null,
    times: r ? total0 : preset?.times || null,
    days: /** @type {number[]} */ (r?.days || preset?.days || []),
  };
  // les valeurs enregistrées : « Annuler les changements » y revient
  const f0 = { ...f };
  const endMode0 = f.times ? 'times' : f.end ? 'date' : 'never';
  let endMode = endMode0;
  // « Quand ? » (D18 revu le 2026-11-18) : ce qu'on a choisi dans le calendrier, sinon la règle telle qu'elle est ; une
  // nouvelle échéance sans date proposée attend qu'on touche ses jours
  /** @type {import('../domain/when.js').When|null} */
  let picked = null;
  const chosen0 = !!r || !!preset?.start;
  /** La règle de « Quand ? » telle qu'elle est enregistrée (une règle commencée : depuis son ancrage). */
  const whenNow = () => (r ? { start: r.start, days: r.days || [], every: r.every || null, interval: r.interval || 1 }
    : { start: f.start, days: f.days, every: f.every || null, interval: f.interval || 1 });
  // une échéance qui existe s'ouvre en lecture (ses fois, sa règle en une ligne) ; « Modifier » ouvre le formulaire
  let editing = !r;
  const cur = () => account(f.wallet)?.currency || 'XOF';
  const titleOf = () => f.note.trim() || (f.kind === 'transfer' ? `Vers ${account(f.to)?.name || '…'}` : category(f.category)?.name || 'Nouvelle échéance');
  const started = !!r && r.start < t0;
  const amt0 = f.amount ? String(f.amount / 10 ** currencyOf(cur()).dec) : '';
  const say = !r ? ''
    : ended ? `${endedLabel(ended)} : plus rien à régler.${canRenew ? '' : ' Pour recommencer, crée une nouvelle échéance.'}`
      // r est toujours la tête : non modifiable sans être terminée, elle est arrêtée avec des retards
      : !editable ? 'Arrêtée : règle ses retards un par un, ci-dessus ou dans Plan.' : '';

  // la réserve qu'elle remplit : la sienne, ou sa reconduite (une réserve close n'a plus de lien)
  const fill = r?.reserve ? openFillOf(r.reserve) : null;
  // ses jumelles (D18, « Regrouper », 2026-11-20) : les mêmes jours, depuis le même portefeuille, vers la même destination
  const merge = r && editable ? dueMerge(r.id) : null;
  const mates = merge ? [merge.keep, ...merge.others].filter(x => x.id !== r?.id) : [];
  const html = `${r ? '<div class="dv-bar" data-tabs></div><div class="dv" data-occs></div>' : ''}
    ${r ? `<div data-view>
      <p class="dv-rule" data-rule></p>
      ${say ? `<p class="muted rs-say">${esc(say)}</p>` : ''}
      ${fill ? `<div class="group plain rs-more">
        <button type="button" class="row" data-goreserve>${chip(category(fill.category || ''))}<div class="main"><div class="t">Aller à la réserve</div>${fillsHTML(fill.id)}</div></button></div>` : ''}
      ${editable ? `<div class="group plain rs-more">
        <button type="button" class="row" data-edit-go><span class="pill acc">${icon('pencil-simple')}</span><div class="main"><div class="t">Modifier</div><div class="s">Ce qui est déjà réglé ne change pas</div></div></button>
        <button type="button" class="row" data-stop><span class="pill">${icon('pause')}</span><div class="main"><div class="t">Arrêter</div><div class="s">Plus de dates à partir d’aujourd’hui</div></div></button>
      </div>` : ''}
      ${merge ? `<div class="group plain rs-more">
        <button type="button" class="row" data-merge><span class="pill">${icon('copy')}</span><div class="main"><div class="t wrap">Regrouper avec ${esc(mates.length > 1 ? `${mates.length} échéances jumelles` : dueTitle(mates[0]))}</div>
          <div class="s wrap">Les mêmes jours : une seule échéance de ${money(merge.amount, { cur: merge.keep.currency })}</div></div></button>
      </div>` : ''}
      ${canRenew ? `<div class="group plain rs-more">
        <button type="button" class="row" data-again><span class="pill acc">${icon('arrows-clockwise')}</span><div class="main"><div class="t">Reconduire</div><div class="s">Une nouvelle, pareille, dès sa prochaine date</div></div></button>
      </div>` : ''}
    </div>` : ''}
    ${editable ? `<div class="dv-edit" data-edit tabindex="-1"${editing ? '' : ' hidden'}>
      ${again ? '<p class="muted rs-say">Son type et sa catégorie ne changent pas. L’ancienne reste dans les terminées.</p>'
        : preset?.say ? `<p class="muted rs-say">${esc(preset.say)}</p>`
        : !r ? '<p class="muted rs-say">Ce qui revient : un loyer, un abonnement, un salaire. Rien n’est noté tout seul : le jour venu, tu confirmes.</p>'
        : started ? '<p class="muted rs-say">Les changements valent à partir d’aujourd’hui. Les fois réglées et les retards ne changent pas.</p>' : ''}
      <fieldset class="due-fields">
      <div class="field"><span>Type</span>${seg(TYPES, f.kind, `due-kind${settled || again ? ' locked' : ''}`)}<small class="field-note" data-kindnote${settled ? '' : ' hidden'}>Une fois est déjà réglée : le type ne change plus.</small></div>
      <label class="field"><span>Nom</span><input data-note maxlength="40" value="${esc(f.note)}" placeholder="Ex. Loyer, Canal Box, Salaire" autocomplete="off"></label>
      <label class="field"><span data-amtl>Montant</span><input data-amt inputmode="decimal" placeholder="0" autocomplete="off" value="${amt0}"></label>
      <div class="field" data-catf><span>Catégorie</span><button type="button" class="field-btn" data-cat${again ? ' aria-disabled="true"' : ''}><b data-catl></b>${icon(again ? 'lock-simple' : 'caret-right')}</button></div>
      <div class="field"><span data-wall-l>Portefeuille</span><button type="button" class="field-btn" data-wal><b data-wall></b>${icon('caret-right')}</button></div>
      <div class="field" data-tof><span>Vers</span><button type="button" class="field-btn" data-to><b data-tol></b>${icon('caret-right')}</button></div>
      <div class="field"><span>Quand ?</span><button type="button" class="field-btn when-btn" data-when><b data-whenl></b>${icon('calendar-blank')}</button></div>
      <div class="field" data-endf><span>Fin</span>${seg(ENDS, endMode, 'due-end')}
        <button type="button" class="field-btn due-endd" data-endd><b data-enddl></b>${icon('calendar-blank')}</button>
        <input class="due-times" data-times inputmode="numeric" placeholder="Nombre de fois, ex. 4" value="${f.times || ''}" autocomplete="off"></div>
      </fieldset>
      <div data-err></div>
      ${r ? '<div class="dv-sum" data-sum hidden></div><button type="button" class="link dv-undo" data-undo hidden>Annuler les changements</button>' : ''}
      <div class="sheet-actions"><button class="btn primary" data-save>${icon('check')}${r ? 'Enregistrer' : 'Créer l’échéance'}</button></div>
    </div>` : ''}`;

  return { html, title: r ? titleOf() : 'Nouvelle échéance', editable, mount };

  /** @param {HTMLElement} el @param {{ done: (what: string, made?: Schedule) => void }} o @returns {DueApi} */
  function mount(el, { done }) {
    const root = /** @type {HTMLElement} */ ($('.due-sheet', el));
    const ruleEl = $('[data-rule]', el), view = $('[data-view]', el), editBox = $('[data-edit]', el);

    /** La règle en une ligne : celle de la fois choisie (une fois d'une règle d'avant : « À cette date : »). @param {DueView|null} o */
    // une version d'avant qui se lit comme l'actuelle (une erreur corrigée en remodifiant) ne dit pas « À cette date »
    const paintRule = o => {
      if (!r || !ruleEl) return;
      const x = (o?.schedule && scheduleById(o.schedule)) || r;
      const old = x.id !== r.id && ruleLine(x, null) !== ruleLine(r, null);
      ruleEl.innerHTML = `${old ? '<span class="muted">À cette date : </span>' : ''}${esc(old ? ruleLine(x, null) : ruleLine(r, total0))}`;
    };
    // ses fois : repeintes à chaque changement (Confirmer ici, dans la saisie ou ailleurs) ; terminée, elles se lisent
    const occ = r ? occurrences($('[data-tabs]', el), $('[data-occs]', el), r.id, { at, openEntry, ro: !!ended, onSelect: paintRule }) : null;
    // l'aperçu et le résumé pendant qu'on modifie, le formulaire relu (type figé, prochaine date), les valeurs
    // enregistrées remises : branchés plus bas
    let onEdit = () => {};
    let sync = () => {};
    let reset = () => {};
    const setEditing = (/** @type {boolean} */ on) => {
      editing = on;
      if (view) view.hidden = on;
      if (editBox) editBox.hidden = !on;
      root.classList.toggle('editing', on);
      occ?.setEdit(on);
      if (!on) return;
      sync();
      onEdit();
      // le focus suit : le formulaire (sans ouvrir le clavier)
      editBox?.focus({ preventScroll: true });
    };

    if (editable) {
      const errEl = $('[data-err]', el), sumEl = $('[data-sum]', el), undoBtn = $('[data-undo]', el);
      const noteIn = /** @type {HTMLInputElement} */ ($('[data-note]', el)), amtIn = /** @type {HTMLInputElement} */ ($('[data-amt]', el));
      const timesIn = /** @type {HTMLInputElement} */ ($('[data-times]', el));
      const showErr = (/** @type {string} */ msg) => { errEl.innerHTML = noticeHTML(esc(msg)); buzz(14); };

      const paint = () => {
        $('[data-catf]', el).hidden = f.kind === 'transfer';
        $('[data-tof]', el).hidden = f.kind !== 'transfer';
        $('[data-wall-l]', el).textContent = f.kind === 'transfer' ? 'De' : f.kind === 'income' ? 'Arrive sur' : 'Portefeuille';
        $('[data-amtl]', el).textContent = `Montant (${symbol(cur())})`;
        $('[data-catl]', el).textContent = category(f.category)?.name || 'Choisir';
        $('[data-wall]', el).textContent = account(f.wallet)?.name || 'Choisir';
        $('[data-tol]', el).textContent = account(f.to)?.name || 'Choisir';
        $('[data-whenl]', el).textContent = picked ? whenPhrase(picked) : chosen0 ? whenPhrase(whenNow()) : 'Touche les jours';
        $('[data-endf]', el).hidden = !f.every;
        $('[data-endd]', el).hidden = endMode !== 'date';
        $('[data-enddl]', el).textContent = f.end ? dayShort(f.end) : 'Choisir';
        timesIn.hidden = endMode !== 'times';
        if (r) $('[data-title]', el).textContent = titleOf();
      };
      paint();
      // relu depuis le magasin (une fois confirmée ou passée depuis l'ouverture) : le type se fige, la prochaine date suit
      if (again) $$('.due-kind button', el).forEach(b => { b.disabled = true; });
      sync = () => {
        if (!r) return;
        settled = dueSettled(r.id);
        $('.due-kind', el).classList.toggle('locked', settled);
        $$('.due-kind button', el).forEach(b => { b.disabled = settled; });
        $('[data-kindnote]', el).hidden = !settled;
        if (!picked) f.start = f0.start = scheduleNext(r.id)?.date || f.start;
        paint();
      };
      sync();

      /** Les valeurs du formulaire, ou ce qui manque. @returns {{ data?: Record<string, any>, error?: string }} */
      const read = () => {
        const amount = amtIn.value.trim() ? parseAmount(amtIn.value, cur()) : 0;
        if (!amount || amount <= 0) return { error: 'Indique un montant.' };
        if (f.kind !== 'transfer' && !f.category) return { error: 'Choisis une catégorie.' };
        if (f.kind === 'transfer' && !f.to) return { error: 'Choisis le portefeuille d’arrivée.' };
        if (!picked && !chosen0) return { error: 'Choisis les jours dans « Quand ? ».' };
        const times = endMode === 'times' ? Number(timesIn.value) : null;
        if (f.every && endMode === 'times' && !(Number.isInteger(times) && /** @type {number} */ (times) >= 1)) return { error: 'Indique un nombre de fois.' };
        if (f.every && endMode === 'date' && !f.end) return { error: 'Choisis la dernière date.' };
        return { data: {
          kind: f.kind, amount, accountId: f.wallet, toAccountId: f.kind === 'transfer' ? f.to : null, categoryId: f.kind === 'transfer' ? null : f.category,
          note: f.note.trim(), start: f.start, every: f.every || null, interval: f.every ? f.interval : 1, days: f.days,
          end: f.every && endMode === 'date' ? f.end : null, times: f.every && endMode === 'times' ? times : null,
        } };
      };
      /** Ce qui a changé (la date seulement si on l'a touchée ; le rythme en entier : unité et intervalle). @param {Record<string, any>} data */
      const diff = data => {
        /** @type {Record<string, any>} */
        const changes = {};
        if (!r) return changes;
        const now = { kind: r.kind, amount: r.amount, accountId: r.wallet, toAccountId: r.to, categoryId: r.category, note: r.note, every: r.every, interval: r.every ? r.interval : 1, end: r.end, times: total0 };
        for (const k of /** @type {(keyof typeof now)[]} */ (Object.keys(now))) if ((data[k] ?? null) !== (now[k] ?? null)) changes[k] = data[k];
        if ('every' in changes || 'interval' in changes) { changes.every = data.every; changes.interval = data.interval; }
        if (picked) {
          changes.start = picked.start;
          if (JSON.stringify(picked.days) !== JSON.stringify(r.days || [])) changes.days = picked.days;
          changes.every = data.every; changes.interval = data.interval;
        }
        return changes;
      };
      /** Le formulaire a-t-il changé depuis les valeurs enregistrées (le montant lu, le nom sans espaces autour) ? */
      const dirty = () => !!picked || endMode !== endMode0 || noteIn.value.trim() !== f0.note.trim()
        || (amtIn.value.trim() ? parseAmount(amtIn.value, cur()) : 0) !== f0.amount
        || (endMode === 'times' && Number(timesIn.value || 0) !== (f0.times || 0))
        || /** @type {(keyof typeof f)[]} */ (['kind', 'wallet', 'to', 'category', 'every', 'interval', 'end']).some(k => (f[k] ?? null) !== (f0[k] ?? null));
      /** Le résumé avant d'enregistrer : à partir de quand, ce qui change, ce qui reste. @param {Record<string, any>} ch @param {DueView[]} preview @param {DueView[]} current */
      const summaryOf = (ch, preview, current) => {
        if (!r) return '';
        const name = (/** @type {string|null} */ x) => account(x || '')?.name || '…';
        const parts = [];
        if ('kind' in ch) parts.push(`${KIND_WORD[ch.kind]} au lieu d’${KIND_WORD[r.kind]}`);
        if ('amount' in ch) parts.push(`${money(ch.amount, { cur: cur() })} au lieu de ${money(r.amount, { cur: r.currency })}`);
        if (picked) { const a = low(whenPhrase(picked)), b = low(whenPhrase(whenNow())); parts.push(a === b ? a : `${a} au lieu de ${b}`); }
        if ('accountId' in ch) parts.push(`${f.kind === 'income' ? 'sur' : 'depuis'} ${name(ch.accountId)} au lieu de ${name(r.wallet)}`);
        if ('toAccountId' in ch && ch.toAccountId) parts.push(`vers ${name(ch.toAccountId)}${r.to ? ` au lieu de ${name(r.to)}` : ''}`);
        if ('categoryId' in ch && ch.categoryId) parts.push(`dans ${category(ch.categoryId)?.name || '…'}${r.category ? ` au lieu de ${category(r.category)?.name || '…'}` : ''}`);
        if ('note' in ch) parts.push(ch.note ? `nommée « ${ch.note} »` : 'sans nom');
        if ('times' in ch) parts.push(ch.times ? `en ${ch.times} fois${total0 ? ` au lieu de ${total0}` : ''}` : 'sans nombre de fois');
        if ('end' in ch) parts.push(ch.end ? `jusqu’au ${dayShort(ch.end)}` : 'sans date de fin');
        const first = preview.find(o => o.date >= t0 && (o.state === 'today' || o.state === 'soon'));
        let txt = `${first ? `À partir du ${dayShort(first.date)}` : 'Plus de date à venir'}${parts.length ? ` : ${parts.join(', ')}` : ''}.`;
        const lates = current.filter(o => o.state === 'late');
        if (lates.length) {
          const m = money(lates[0].amount, { cur: lates[0].currency });
          txt += lates.length > 1 ? ` Les ${lates.length} retards ${lates.every(o => o.amount === lates[0].amount) ? `restent à ${m}` : 'gardent leurs montants'}.` : ` Le retard reste à ${m}.`;
        }
        return txt;
      };
      // pendant qu'on modifie : les fois à venir repeintes (l'aperçu du domaine, sans rien écrire), le résumé, l'annulation
      let tick = 0;
      onEdit = () => {
        if (!r || !editing) return;
        clearTimeout(tick);
        tick = window.setTimeout(() => {
          const changed = dirty();
          undoBtn.hidden = !changed;
          const got = changed ? read() : {};
          const changes = got.data ? diff(got.data) : null;
          if (!changes || !Object.keys(changes).length) { occ?.setPreview(null); sumEl.hidden = true; return; }
          const p = previewDueUpdate(r.id, changes);
          occ?.setPreview(p.list);
          sumEl.hidden = false;
          sumEl.innerHTML = p.error ? noticeHTML(esc(p.error)) : esc(summaryOf(changes, p.list || [], occ ? occ.current() : []));
        }, 120);
      };
      const changed = () => { errEl.innerHTML = ''; paint(); onEdit(); };

      wireSeg($('.due-kind', el), v => {
        if (v === f.kind || again) return;
        f.kind = v;
        // une catégorie de dépense ne va pas à une rentrée (et inversement)
        if (f.category && category(f.category)?.type !== v) f.category = null;
        changed();
      });
      wireSeg($('.due-end', el), v => { endMode = v; changed(); });
      noteIn.oninput = () => { f.note = noteIn.value; changed(); };
      amtIn.oninput = () => onEdit();
      timesIn.oninput = () => onEdit();
      $('[data-cat]', el).onclick = async () => {
        if (again) return;
        const c = await pickCategory({ type: f.kind === 'income' ? 'income' : 'expense', current: f.category });
        if (c) { f.category = c; changed(); }
      };
      $('[data-wal]', el).onclick = async () => {
        const a = await pickAccount({ current: f.wallet, title: f.kind === 'transfer' ? 'De' : 'Portefeuille', spending: f.kind === 'expense' });
        if (a) { f.wallet = a; if (f.to === a || (f.to && account(f.to)?.currency !== account(a)?.currency)) f.to = null; changed(); }
      };
      $('[data-to]', el).onclick = async () => {
        const a = await pickAccount({ current: f.to, exclude: f.wallet, currency: cur(), title: 'Vers' });
        if (a) { f.to = a; changed(); }
      };
      // « Quand ? » (D18 revu le 2026-11-18) : un calendrier, les jours touchés et leur répétition
      $('[data-when]', el).onclick = async () => {
        // étape 4 : un point sous les jours des autres échéances ; « Chaque mois » pré-coché pour une catégorie mensuelle
        const busy = new Map([...busyDates(schedules(), r ? dueChainIds(r.id) : [], t0, addDays(t0, 800))].map(([d, xs]) => [d, xs.map(x => `${dueTitle(x)} · ${dueMoney(x)}`)]));
        const prefer = f.kind !== 'transfer' && monthlyHabit(transactions(), f.category, t0) ? 'month' : null;
        const w = await pickWhen({ when: picked || (chosen0 ? whenNow() : null), busy, prefer });
        if (!w) return;
        picked = w;
        f.start = w.start; f.days = w.days; f.every = w.every || ''; f.interval = w.interval;
        changed();
      };
      $('[data-endd]', el).onclick = async () => {
        const d = await pickDate({ current: f.end || f.start, title: 'Dernière date', future: true, min: f.start < t0 ? t0 : f.start });
        if (d) { f.end = d; changed(); }
      };
      // les valeurs enregistrées reviennent, l'aperçu s'efface (« Annuler les changements », ou Retour pendant qu'on modifie)
      reset = () => {
        Object.assign(f, f0);
        endMode = endMode0;
        picked = null;
        noteIn.value = f0.note; amtIn.value = amt0; timesIn.value = f0.times ? String(f0.times) : '';
        setSeg($('.due-kind', el), f.kind);
        setSeg($('.due-end', el), endMode);
        changed();
      };
      if (undoBtn) undoBtn.onclick = () => { buzz(6); reset(); };

      $('[data-save]', el).onclick = async () => {
        errEl.innerHTML = '';
        const got = read();
        if (!got.data) return showErr(/** @type {string} */ (got.error));
        if (!r) {
          // la jumelle d'une échéance qui existe (D18, 2026-11-20) : l'ajouter à son montant plutôt qu'en créer une autre
          const twin = again ? null : twinOfNew(got.data);
          if (twin) {
            const total = money(twin.amount + got.data.amount, { cur: twin.currency });
            const k = await menuSheet({ title: `Ajouter au montant de ${esc(dueTitle(twin))} ?`, items: [
              { key: 'add', icon: 'plus', label: 'Oui, ajouter', note: `${esc(dueTitle(twin))} tombe les mêmes jours : elle passe à ${total} à partir de sa prochaine fois` },
              { key: 'new', icon: 'copy', label: 'Non, créer quand même', note: 'Deux échéances les mêmes jours' },
            ] });
            if (!k) return;
            if (k === 'add') {
              if (!(await addToDue(twin.id, got.data, { onError: showErr }))) return;
              buzz(12);
              toast(`${dueTitle(twin)} : ${total}`);
              done('created', scheduleById(dueHead(twin.id)) || twin);
              return;
            }
          }
          const made = await createDue(got.data, { onError: showErr });
          if (!made) return;
          buzz(12);
          toast(again ? 'Échéance reconduite' : 'Échéance créée');
          done('created', made);
          return;
        }
        const changes = diff(got.data);
        if (!Object.keys(changes).length) { setEditing(false); return; }
        const ok = await updateDue(r.id, changes, { onError: showErr });
        if (!ok) return;
        buzz(12);
        toast('Échéance enregistrée');
        done('saved');
      };
    }

    // une échéance qui remplit une réserve : aller à la réserve (sa page d'épargne)
    const goRes = $('[data-goreserve]', el);
    if (goRes && fill) goRes.onclick = () => { buzz(6); location.hash = `#/epargne?w=${encodeURIComponent(fill.wallet)}`; };
    const againBtn = $('[data-again]', el);
    if (againBtn && renew) againBtn.onclick = () => { buzz(6); renew(); };
    const mergeBtn = $('[data-merge]', el);
    if (mergeBtn && r && merge) mergeBtn.onclick = () => afterSheets(async () => {
      const name = dueTitle(merge.keep);
      const lates = [merge.keep, ...merge.others].some(x => x.id !== merge.keep.id && dueOccurrences(x.id).some(o => o.state === 'late'));
      // celle qui n'a rien de réglé ni de retard disparaît en s'arrêtant (comme Arrêter le dit)
      const gone = merge.others.filter(x => dueStopErases(x.id)).length;
      const ends = merge.others.length > 1
        ? (gone === merge.others.length ? `les ${gone} autres disparaissent (rien n’y était réglé)` : `les ${merge.others.length} autres s’arrêtent`)
        : `${esc(dueTitle(merge.others[0]))} ${gone ? 'disparaît (rien n’y était réglé)' : 's’arrête'}`;
      const yes = await confirmSheet({
        title: 'Regrouper ces échéances ?',
        text: `${esc(name)} garde son nom et passe à ${money(merge.amount, { cur: merge.keep.currency })} à partir de sa prochaine fois ; ${ends}${lates ? ' (les retards restent à régler)' : ''}.`,
        yes: 'Regrouper',
      });
      if (!yes) return;
      const kept = await mergeDues(r.id);
      if (!kept) return;
      buzz(12);
      toast(`Regroupées : ${name}`);
      if (kept.id === r.id || dueRoot(kept.id) === dueRoot(r.id)) done('saved');
      else location.hash = dueHref(kept.id);
    });
    const editGo = $('[data-edit-go]', el);
    if (editGo) editGo.onclick = () => { buzz(6); setEditing(true); };
    const stop = $('[data-stop]', el);
    if (stop && r) stop.onclick = () => afterSheets(async () => {
      const late = occ ? occ.current().filter(o => o.state === 'late').length : 0;
      const erase = dueStopErases(r.id);
      const text = erase ? 'Rien n’y est encore réglé : elle disparaît.'
        : `Plus de dates à partir d’aujourd’hui. Ce qui est réglé reste.${late ? ` ${late > 1 ? `Ses ${late} retards restent` : 'Son retard reste'} à régler.` : ''} Elle ira ensuite dans les échéances terminées.`;
      const yes = await confirmSheet({ title: 'Arrêter cette échéance ?', text, yes: 'Arrêter' });
      if (yes && await stopDue(r.id)) { toast(erase ? 'Échéance retirée' : 'Échéance arrêtée'); done(erase ? 'deleted' : 'stopped'); }
    });
    return {
      refresh() { if (!occ) return; occ.refresh(); sync(); if (editing) onEdit(); },
      editing: () => editing,
      leaveEdit() { if (!r || !editing) return false; reset(); setEditing(false); return true; },
      at: () => (occ ? occ.selected() : null),
    };
  }
}

/**
 * Les fois d'une échéance, dans sa page (D18, revue le 2026-11-12) : une bande d'onglets, une date chacun (coche si
 * réglée, en rouge si en retard), qu'on parcourt comme les périodes du Journal — toucher un onglet, ou glisser la fois
 * choisie vers la gauche (la suivante) ou vers la droite (la précédente) ; la fois choisie dit son état et ses actions.
 * Pendant qu'on modifie la règle : l'aperçu (ses fois si on enregistrait) — les fois à venir en pointillé, avec les
 * nouvelles valeurs ; réglées, passées et en retard avec un cadenas (elles ne changent pas) ; pas d'actions.
 * Un seul onglet est dans l'ordre de tabulation (les flèches passent aux autres) ; repeinte, la bande garde le focus.
 * @param {HTMLElement} tabsHost @param {HTMLElement} cardHost @param {string} id (une règle de l'échéance)
 * @param {{ at: string|null, openEntry: (o: any) => any, ro: boolean, onSelect: (o: DueView|null) => void }} o
 */
function occurrences(tabsHost, cardHost, id, { at, openEntry, ro, onSelect }) {
  const uid = `dv${Math.random().toString(36).slice(2, 8)}`;
  let list = dueOccurrences(id);
  /** @type {DueView[]|null} */
  let preview = null;
  let editing = false;
  const shown = () => (editing && preview ? preview : list);
  const firstOpen = (/** @type {DueView[]} */ xs) => xs.find(o => o.state === 'late' || o.state === 'today' || o.state === 'soon') || xs[xs.length - 1] || null;
  const locked = (/** @type {DueView} */ o) => o.state === 'done' || o.state === 'skipped' || o.state === 'late';
  /** @type {DueView|null} */
  let sel = (at && list.find(o => o.date === at)) || firstOpen(list);
  let enter = 0;
  const paint = () => {
    const xs = shown();
    // la fois choisie se retrouve par sa date (l'aperçu et les fois relues sont d'autres objets)
    if (!sel || !xs.includes(sel)) sel = (sel && xs.find(o => o.date === sel?.date)) || firstOpen(xs);
    if (!sel) { tabsHost.innerHTML = ''; cardHost.innerHTML = ''; onSelect(null); return; }
    const on = sel, i0 = xs.indexOf(on);
    // la prochaine : la seule qui se confirme d'avance (les retards, dans n'importe quel ordre)
    const next = list.find(o => o.state === 'today' || o.state === 'soon') || null;
    const focused = tabsHost.contains(document.activeElement) || cardHost.contains(document.activeElement);
    // un repère « aujourd'hui » entre le passé et l'à-venir (quand il y a l'un et l'autre)
    const t = today(), cut = xs.findIndex(o => o.date >= t);
    tabsHost.innerHTML = xs.length > 1 ? `<div class="ops-tabs dv-tabs" role="tablist" aria-label="Les fois de cette échéance">${xs.map((o, i) => {
      const lock = editing && locked(o), ahead = editing && !!preview && !locked(o);
      return `${i === cut && cut > 0 ? '<span class="dv-now" aria-hidden="true">aujourd’hui</span>' : ''}<button type="button" role="tab" id="${uid}-${i}" class="ops-tab dv-tab ${o.state}${o === on ? ' on' : ''}${ahead ? ' ahead' : ''}${lock ? ' locked' : ''}" aria-selected="${o === on}" aria-controls="${uid}-card" tabindex="${o === on ? 0 : -1}" data-occ="${esc(o.key)}">${lock ? icon('lock-simple') : o.state === 'done' ? icon('check') : o.state === 'skipped' ? icon('skip-forward') : ''}${dayShort(o.date)}</button>`;
    }).join('')}</div>` : '';
    cardHost.innerHTML = `<div class="dv-card${enter && !reducedMotion() ? (enter > 0 ? ' from-r' : ' from-l') : ''}" id="${uid}-card" role="tabpanel" tabindex="-1"${xs.length > 1 ? ` aria-labelledby="${uid}-${i0}"` : ''} data-card>${cardHTML(on, { ro, next, before: list.slice(0, list.findIndex(o => o.key === on.key)).reverse().find(o => o.state === 'today' || o.state === 'soon') || null, editing, preview: !!preview, locked: locked(on) })}</div>`;
    enter = 0;
    // repeinte (un onglet, Confirmer, un changement ailleurs) : le focus reste dans la bande
    if (focused) ($('.dv-tab.on', tabsHost) || $('[data-card]', cardHost))?.focus({ preventScroll: true });
    // l'onglet choisi au milieu de la bande (sans faire défiler la page)
    const bar = $('.dv-tabs', tabsHost), tab = $('.dv-tab.on', tabsHost);
    if (bar && tab) bar.scrollLeft = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
    wire(on);
    onSelect(on);
  };
  /** Aller à une fois voisine (dir 1 : la suivante) ; test : y en a-t-il une ? @param {number} dir @param {boolean} [test] */
  const go = (dir, test = false) => {
    const xs = shown(), i = xs.findIndex(o => o.key === sel?.key), j = i + dir;
    if (i < 0 || j < 0 || j >= xs.length) return false;
    if (test) return true;
    sel = xs[j];
    enter = Math.sign(dir);
    buzz(6);
    paint();
    return true;
  };
  /** @param {DueView} d */
  const wire = d => {
    $$('[data-occ]', tabsHost).forEach(b => (b.onclick = () => {
      const xs = shown(), j = xs.findIndex(o => o.key === b.dataset.occ), i = xs.findIndex(o => o.key === sel?.key);
      if (j >= 0 && j !== i) go(j - i);
    }));
    const bar = $('.dv-tabs', tabsHost);
    if (bar) bar.onkeydown = (/** @type {KeyboardEvent} */ e) => {
      const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!dir || !go(dir)) return;
      e.preventDefault();
      $('.dv-tab.on', tabsHost)?.focus();
    };
    swipeOn($('[data-card]', cardHost), go);
    const click = (/** @type {string} */ q, /** @type {() => any} */ fn) => { const b = $(q, cardHost); if (b) b.onclick = () => { buzz(6); fn(); }; };
    // plusieurs fois à régler cette semaine (le zem lundi, mardi, vendredi) : la feuille de la semaine (D18 revu)
    click('[data-ok]', () => confirmWeekOr(d, () => confirmNow(d, openEntry)));
    // « Autres valeurs » : la saisie préremplie s'ouvre par-dessus la page ; en revenant, on retrouve la page
    click('[data-other]', () => afterSheets(() => openEntry({ due: d })));
    click('[data-skip]', () => skipNow(d));
    click('[data-unskip]', async () => { if (d.schedule && await unskipDue(d.schedule, d.date)) toast(`${dueTitle(d)} : à régler de nouveau`); });
    click('[data-op]', () => d.entry && openOperation(d.entry));
  };
  paint();
  return {
    /** Après un changement : les fois relues, la même date choisie. */
    refresh() { list = dueOccurrences(id); paint(); },
    /** L'aperçu d'une modification (null : les fois telles qu'elles sont). @param {DueView[]|null} p */
    setPreview(p) { preview = p; paint(); },
    /** Modifier la règle (aperçu, cadenas, pas d'actions) ou la regarder. @param {boolean} on */
    setEdit(on) { editing = on; if (!on) preview = null; paint(); },
    /** Les fois telles qu'elles sont. */
    current: () => list,
    /** La date de la fois choisie. */
    selected: () => (sel ? sel.date : null),
  };
}

/**
 * Une fois : sa date, son montant, son état et ce qu'on peut en faire (terminée : seulement regarder ;
 * d'avance, seulement la prochaine ; pendant qu'on modifie : ce qui changera).
 * before : la fois à régler juste avant celle-ci (« Confirme d’abord celle du … »).
 * @param {DueView} o @param {{ ro: boolean, next: DueView|null, before?: DueView|null, editing: boolean, preview?: boolean, locked: boolean }} c
 */
function cardHTML(o, { ro, next, before = null, editing, preview = false, locked }) {
  const verb = o.kind === 'income' ? 'Reçue' : o.kind === 'transfer' ? 'Faite' : 'Payée';
  const days = Math.round((Date.parse(o.date) - Date.parse(today())) / 864e5);
  const open = o.state !== 'done' && o.state !== 'skipped';
  const when = o.state === 'late' ? 'En retard' : o.state === 'today' ? 'À régler' : days <= 1 ? 'À venir' : `Dans ${days} jours`;
  const state = o.state === 'done' ? `${verb} le ${dayShort(o.paidOn || o.date)}`
    : o.state === 'skipped' ? 'Passée : elle n’a pas compté'
      : o.paused ? `${when} · en pause : son portefeuille ou sa catégorie est archivé` : when;
  let acts = '';
  if (editing) {
    const note = !locked ? (preview ? 'Aperçu avec tes changements.' : '') : o.state === 'late' ? 'En retard : elle garde son montant.' : 'Déjà réglée : elle ne change pas.';
    acts = note ? `<p class="muted dv-note">${note}</p>` : '';
  }
  else if (o.state === 'done') acts = `<button type="button" class="btn sm due-pass" data-op>${icon('arrow-right')}Voir l’opération</button>`;
  else if (ro) acts = '';
  else if (o.state === 'skipped') acts = `<button type="button" class="btn sm due-pass" data-unskip>${icon('arrow-counter-clockwise')}Remettre à régler</button>`;
  else {
    const now = o.state !== 'soon';
    // d'avance, seulement la prochaine : jamais la 4e avant la 2e
    const may = now || next?.key === o.key;
    // sa réserve est close : on choisit le portefeuille qui paie (la saisie préremplie)
    const ok = o.paused || !may ? '' : `<button type="button" class="btn sm due-ok" ${o.needsWallet ? 'data-other' : 'data-ok'}>${icon('check')}${now ? 'Confirmer' : 'Confirmer maintenant'}</button>`;
    acts = `${ok}<button type="button" class="btn sm due-pass" data-skip>${now ? 'Passer' : 'Passer cette fois'}</button>
      ${o.paused || o.needsWallet || !may ? '' : '<button type="button" class="link dv-other" data-other>Autres valeurs</button>'}
      ${!may && (before || next) ? `<p class="muted dv-note">Confirme d’abord celle du ${dayShort((before || next).date)}.</p>` : ''}`;
  }
  return `<div class="dv-l1"><span>${esc(dayLabel(o.date))}</span>${o.rank && o.times ? `<span>${o.rank} sur ${o.times}</span>` : ''}</div>
    <div class="dv-amt${o.kind === 'income' && open ? ' in' : ''}">${dueMoney(o)}${o.state === 'done' && o.currency === o.plannedCur && o.amount !== o.planned ? `<small class="dv-plan">· prévu ${money(o.planned, { cur: o.plannedCur })}</small>` : ''}</div>
    <div class="dv-state ${o.state}">${state}${open && o.needsWallet ? (ro ? ' · sa réserve est close' : ' · sa réserve est close : choisis le portefeuille qui paie') : ''}</div>
    <div class="dv-acts">${acts}</div>`;
}

/**
 * Glisser la fois choisie (comme une période du Journal) : au-delà de 60 px, ou d'un geste vif, la fois d'à côté —
 * vers la gauche la suivante, vers la droite la précédente ; sans voisine, la carte résiste et revient. Un glisser
 * n'appuie pas sur le bouton sous le doigt.
 * @param {HTMLElement} card @param {(dir: number, test?: boolean) => boolean} go
 */
function swipeOn(card, go) {
  let swallow = false;
  card.addEventListener('click', e => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
  card.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY, t0 = performance.now();
    let mode = '', dx = 0;
    const set = (/** @type {number} */ x, anim = false) => {
      card.style.transition = anim ? 'transform .2s var(--spring)' : 'none';
      card.style.transform = x ? `translateX(${x}px)` : '';
    };
    const move = (/** @type {PointerEvent} */ ev) => {
      const mx = ev.clientX - x0, my = ev.clientY - y0;
      if (!mode) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) mode = 'h';
        else if (Math.abs(my) > 10) { done(); return; }
        else return;
      }
      dx = mx;
      set(go(dx < 0 ? 1 : -1, true) ? dx * 0.6 : dx * 0.15);
    };
    const up = () => {
      done();
      if (mode !== 'h') return;
      swallow = true;
      setTimeout(() => { swallow = false; }, 0);
      const fast = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.5;
      if ((Math.abs(dx) > 60 || (fast && Math.abs(dx) > 30)) && go(dx < 0 ? 1 : -1)) return;
      set(0, true);
    };
    function done() {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}
