// Une échéance (D18, revue le 2026-11-12) : sa page, et la feuille d'une nouvelle. Une page et non plus une feuille
// (2026-11-12) : c'est un endroit qu'on consulte et qu'on règle (D9). Regarder d'abord, modifier ensuite. En haut, ses
// fois — réglées, passées, en retard, à venir — dans une bande d'onglets qu'on parcourt comme les périodes du Journal
// (toucher un onglet, ou glisser la fois choisie) ; la fois choisie dit son état et ses actions (Confirmer, Passer,
// Changer le montant de cette fois seulement, Remettre à régler, voir l'opération ; d'avance,
// seulement la prochaine). Dessous, sa règle en une ligne (« 35 000 F ·
// chaque mois le 1er · MTN MoMo · Loyer » ; sur une fois d'une règle d'avant : « À cette date : … »), puis Modifier,
// Arrêter, et « Regrouper avec … » quand elle a une jumelle (D18, 2026-11-20 : la même à un montant près ; une nouvelle
// jumelle demande à la création « Ajouter au montant de … ? »). « Modifier » (2026-11-24, avec l'utilisateur : plus de formulaire
// déplié sous la page) ouvre la feuille de la création, préremplie de sa règle : un résumé dit ce qui changera et
// « Annuler les changements » remet les valeurs enregistrées ; enregistrée, la page se redessine ; fermée, rien ne change.
// Une échéance terminée (plus rien à régler ni à venir) se lit
// seulement : ni Modifier, ni Arrêter ; « Reconduire » y ouvre une nouvelle échéance (indépendante),
// préremplie de sa règle la plus récente, type et catégorie figés, première date à partir d'aujourd'hui.
// Une nouvelle échéance ne se crée plus ici (2026-11-26, avec l'utilisateur : une seule feuille de création, la saisie, dont
// la date décide — src/screens/entry.js et plan-create.js) : openDueSheet l'y envoie ; il garde la reconduction et la
// modification. Le formulaire a le format de la saisie (2026-11-24) : type (Dépense · Revenu · Virement ; figé dès qu'une fois est
// réglée), portefeuille en pastille (et arrivée d'un virement), grand montant et pavé maison, pastilles catégorie,
// « Quand ? » (D18 revu le 2026-11-18 : un calendrier, les jours touchés et leur répétition, when-sheet.js), fin (une
// petite feuille : jamais, une date, un nombre de fois : celui de toute l'échéance) et nom ; le bouton dit ce qui sera
// enregistré.
// Modifier vaut à partir d'aujourd'hui, les retards gardent leurs valeurs (le domaine coupe la règle ; ses règles
// successives restent une seule échéance) ; « Arrêter » ne touche jamais les opérations déjà notées. Un seul geste pour
// finir (2026-11-13, avec l'utilisateur ; avant : Arrêter et Supprimer) : sans rien de réglé ni de retard, elle disparaît
// (rien à garder) ; sinon plus de dates à partir d'aujourd'hui, ses retards restent à régler, puis elle rejoint les terminées.
// Une règle arrêtée ne se modifie plus : sa ligne de règle et « Arrêtée le … », ses retards se règlent un par un.
import { confirmWeekOr } from './week-sheet.js';
import { DUE, RES } from '../domain/words.js';
import {
  account, accounts, category, scheduleById, scheduleNext, schedules, createDue, updateDue, stopDue, dueStopErases,
  dueOccurrences, dueHead, dueRoot, dueTimes, dueSettled, previewDueUpdate, confirmDue, skipDue, unskipDue, adjustDue, budgetReport, settings,
  available, endedDues, transactions, dueMerge, mergeDues,
} from '../core/store.js';
import { assigned } from '../core/assign.js';
import { money, esc, shortDate, yearDate, dayLabel, today, currencyOf } from '../core/format.js';
import { icon, catIcon } from '../core/icons.js';
import {
  openSheet, seg, wireSeg, setSeg, buzz, toast, noticeHTML, chip, confirmSheet, afterSheets, reducedMotion, fitText, keypad, exprHTML, exprCharsHTML, shake, focusEnd, $, $$,
} from '../core/ui.js';
import { pickAccount, pickDate, pickCategory, fillsHTML, openFillOf, accountPill } from './pickers.js';
import { pickWhen, whenPhrase } from './when-sheet.js';
import { monthlyHabit, monthDay } from '../domain/when.js';
import { renewalOf } from '../domain/dues.js';
import { openIncomeSheet } from './budget-sheet.js';
import { openAccountSheet } from './accounts.js';
import { openOperation } from './history.js';
import { topbarHTML, wireBack, rowHTML, sheetHead, sheetActions } from './parts.js';
import { tapCaret, amountSheet } from './amount-sheet.js';
import { openEntry } from './entry.js';
import { editNote } from './entry/sheets.js';

/** @typedef {import('../domain/dues.js').DueView} DueView */
/** @typedef {import('../domain/dues.js').Schedule} Schedule */
/** @typedef {import('../domain/dues.js').EndedDue} EndedDue */

const TYPES = [['expense', 'Dépense'], ['income', 'Revenu'], ['transfer', 'Virement']];
const ENDS = [['never', 'Sans fin'], ['date', 'Jusqu’au'], ['times', 'Nombre de fois']];
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

/** Le rythme avec son jour : « chaque mois le 1er », « chaque mois le 2e lundi », « tous les 2 mois le dernier jour », « toutes les 2 semaines le lundi », « une seule fois ». @param {Schedule} x */
function rhythmPhrase(x) {
  if (x.days?.length) return low(whenPhrase({ start: x.start, days: x.days, every: x.every, interval: x.interval || 1 }));
  if (!x.every) return 'une seule fois';
  const words = low(rhythmLabel(x.every, x.interval));
  if (x.every === 'week') return `${words} le ${WEEKDAY.format(new Date(`${x.start}T12:00:00`))}`;
  if (x.every === 'month') return `${words} le ${monthDay(x.start, x.by)}`;
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
  return category(d.category || '')?.name || DUE.One;
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
 * Une nouvelle échéance (le « + » d'Échéances) : la saisie, ouverte pour programmer (2026-11-26, avec l'utilisateur : une
 * seule feuille de création, sa date décide ; src/screens/entry.js, plan = preset). preset : valeurs de départ (Répéter dans
 * la fiche d'une opération, versement d'une épargne) ; again : la reconduction d'une échéance terminée, qui garde cette
 * feuille-ci (type et catégorie figés). onCreated : la nouvelle, une fois créée. Une échéance qui existe s'ouvre dans sa page (dueHref).
 * r : modifier une échéance qui existe (2026-11-24, avec l'utilisateur : « Modifier » de sa page ouvre cette feuille,
 * préremplie de sa règle) ; onSaved : enregistrée. Fermée sans enregistrer, rien ne change.
 * @param {{ r?: Schedule|null, preset?: Record<string, any>|null, openEntry?: (o: any) => any, onCreated?: (d: Schedule) => void, onSaved?: () => void }} [o]
 */
export function openDueSheet({ r = null, preset = null, openEntry: open = null, onCreated = () => {}, onSaved = () => {} } = {}) {
  // une nouvelle : la saisie (2026-11-26, avec l'utilisateur : une seule feuille pour noter et programmer, sa date décide)
  if (!r && !preset?.again) return (open || openEntry)({ plan: preset || {}, onCreated });
  const c = dueForm({ r, preset });
  // pas de titre (2026-11-24, avec l'utilisateur : « Nouvelle opération programmée », trop long) : le nom, tapé en haut, en tient lieu
  // comme la saisie : quelque chose de changé, un toucher sur le fond fait trembler la feuille, Retour ou glisser demande
  let dirty = () => false;
  const s = openSheet(`<div class="acc-sheet due-sheet">${c.html}</div>`, { label: r ? `Modifier ${DUE.the}` : preset?.again ? `Reconduire ${DUE.the}` : DUE.New,
    beforeClose: reason => (!dirty() ? true : reason === 'scrim' ? 'stay' : 'ask') });
  ({ dirty } = c.mount(s.el, { done: (what, made) => {
    s.close();
    if (made) afterSheets(() => onCreated(made));
    if (what === 'saved') afterSheets(onSaved);
  } }));
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
 * @typedef {{ refresh: () => void, at: () => string|null }} DueApi
 */
/**
 * La page ouverte : de quoi repeindre ses fois ; keep : redessinée par elle-même (enregistrée, arrêtée, changée en
 * profondeur), la même fois reste choisie.
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
      ${topbarHTML({ title: esc(c.title), cls: 'due-title', attrs: 'data-title' })}
      <div class="due-sheet">${c.html}</div>
    </div>`;
    const redraw = () => { if (page) page.keep = true; ctx.refresh(); };
    // supprimée : onData revient à Budget (elle n'existe plus) ; sinon la page se redessine (en lecture, sa nouvelle tête)
    const api = c.mount(app, { done: what => { if (what !== 'deleted') redraw(); } });
    page = { head: head.id, root, editable: c.editable, ended: !!end, keep: false, api, ctx };
    wireBack(app, () => ctx.back('#/mois'));
    fitText(app, '.due-title', 18);
  },
  /** Une donnée a changé : ses fois se repeignent ; changée en profondeur, la page se redessine. */
  onData() {
    if (!page) return;
    const head = scheduleById(dueHead(page.head));
    if (!head) { const { ctx } = page; page = null; ctx.back('#/mois'); return; }
    const end = endedDues().some(x => x.head === head.id);
    const editable = !end && canEditDue(head.id);
    if (head.id !== page.head || editable !== page.editable || end !== page.ended) { page.keep = true; page.ctx.refresh(); return; }
    page.api.refresh();
  },
};

/**
 * Le contenu de la page d'une échéance (r : sa tête) : ses fois, sa règle en une ligne et ses actions. html va dans un
 * élément de classe due-sheet ; mount() le branche et appelle done() après 'saved' (Modifier, dans une feuille ;
 * Regrouper), 'stopped' ou 'deleted'. ended : une échéance terminée, en lecture seule ; renew : « Reconduire » (pas
 * quand sa catégorie est archivée).
 * @param {{ r: Schedule, at?: string|null, openEntry: (o: any) => any, ended?: EndedDue|null, renew?: (() => void)|null }} o
 */
function dueContent({ r, at = null, openEntry, ended = null, renew = null }) {
  const cat0 = r.kind !== 'transfer' ? category(r.category || '') : null;
  const canRenew = !!ended && !!renew && (r.kind === 'transfer' || (!!cat0 && !cat0.archived));
  const editable = !ended && canEditDue(r.id);
  // « en N fois » : le nombre de fois de toute l'échéance (ses règles successives comprises), comme ses fois le disent
  const total0 = dueTimes(r.id);
  const title = r.note.trim() || (r.kind === 'transfer' ? `Vers ${account(r.to || '')?.name || '…'}` : category(r.category || '')?.name || DUE.New);
  const say = ended ? `${endedLabel(ended)} : plus rien à régler.${canRenew ? '' : ` Pour recommencer, crée ${DUE.adj('un', 'une')} ${DUE.new}.`}`
    // r est toujours la tête : non modifiable sans être terminée, elle est arrêtée avec des retards
    : !editable ? 'Arrêtée : règle ses retards un par un, ci-dessus ou dans Plan.' : '';

  // la réserve qu'elle remplit : la sienne, ou sa reconduite (une réserve close n'a plus de lien)
  const fill = r.reserve ? openFillOf(r.reserve) : null;
  // un virement vers une épargne (un versement, 2026-11-25, avec l'utilisateur : les liens dans les deux sens) : « Remplit
  // l'épargne X » ouvre la page de l'épargne, qui liste ses versements
  const sav = r.kind === 'transfer' && r.to ? account(r.to) : null;
  const fills = sav && sav.savings && !sav.archived ? sav : null;
  // ses jumelles (D18, « Regrouper », 2026-11-20) : les mêmes jours, depuis le même portefeuille, vers la même destination
  const merge = editable ? dueMerge(r.id) : null;
  const mates = merge ? [merge.keep, ...merge.others].filter(x => x.id !== r.id) : [];
  const html = `<div class="dv-bar" data-tabs></div><div class="dv" data-occs></div>
    <p class="dv-rule" data-rule></p>
    ${say ? `<p class="muted rs-say">${esc(say)}</p>` : ''}
    ${fills ? `<div class="group plain rs-more">
      ${rowHTML({ attrs: 'data-gosav', pill: accountPill(fills), title: `Remplit l’épargne ${esc(fills.name)}`, titleCls: 'wrap', end: `<span class="end">${icon('caret-right')}</span>` })}</div>` : ''}
    ${fill ? `<div class="group plain rs-more">
      <button type="button" class="row" data-goreserve>${chip(category(fill.category || ''))}<div class="main"><div class="t">${RES.The}</div>${fillsHTML(fill.id)}</div></button></div>` : ''}
    ${editable ? `<div class="group plain rs-more">
      ${rowHTML({ attrs: 'data-edit-go', pill: `<span class="pill acc">${icon('pencil-simple')}</span>`, title: 'Modifier', sub: 'Ce qui est déjà réglé ne change pas' })}
      ${rowHTML({ attrs: 'data-stop', pill: `<span class="pill">${icon('pause')}</span>`, title: 'Arrêter', sub: 'Plus de dates à partir d’aujourd’hui' })}
    </div>` : ''}
    ${merge ? `<div class="group plain rs-more">
      ${rowHTML({ attrs: 'data-merge', pill: `<span class="pill">${icon('copy')}</span>`, title: `Regrouper avec ${esc(mates.length > 1 ? `${mates.length} ${DUE.many} ${DUE.adj('jumeaux', 'jumelles')}` : dueTitle(mates[0]))}`,
        titleCls: 'wrap', sub: `Les mêmes jours : ${DUE.adj('un seul', 'une seule')} ${DUE.one} de ${money(merge.amount, { cur: merge.keep.currency })}`, subCls: 'wrap' })}
    </div>` : ''}
    ${canRenew ? `<div class="group plain rs-more">
      ${rowHTML({ attrs: 'data-again', pill: `<span class="pill acc">${icon('arrows-clockwise')}</span>`, title: 'Reconduire', sub: 'Une nouvelle, pareille, dès sa prochaine date' })}
    </div>` : ''}`;

  return { html, title, editable, mount };

  /** @param {HTMLElement} el @param {{ done: (what: string) => void }} o @returns {DueApi} */
  function mount(el, { done }) {
    const ruleEl = $('[data-rule]', el);
    /** La règle en une ligne : celle de la fois choisie (une fois d'une règle d'avant : « À cette date : »). @param {DueView|null} o */
    // une version d'avant qui se lit comme l'actuelle (une erreur corrigée en remodifiant) ne dit pas « À cette date »
    const paintRule = o => {
      const x = (o?.schedule && scheduleById(o.schedule)) || r;
      const old = x.id !== r.id && ruleLine(x, null) !== ruleLine(r, null);
      ruleEl.innerHTML = `${old ? '<span class="muted">À cette date : </span>' : ''}${esc(old ? ruleLine(x, null) : ruleLine(r, total0))}`;
    };
    // ses fois : repeintes à chaque changement (Confirmer ici, dans la saisie ou ailleurs) ; terminée, elles se lisent
    const occ = occurrences($('[data-tabs]', el), $('[data-occs]', el), r.id, { at, openEntry, ro: !!ended, onSelect: paintRule });

    // une échéance qui remplit une réserve : le menu de la réserve, le même partout (2026-11-25)
    const goRes = $('[data-goreserve]', el);
    if (goRes && fill) goRes.onclick = () => { buzz(6); import('./reserves.js').then(R => R.openReserveMenu({ id: fill.id, openEntry, go: h => { location.hash = h; } })); };
    const goSav = $('[data-gosav]', el);
    if (goSav && fills) goSav.onclick = () => { buzz(6); location.hash = `#/epargne?w=${encodeURIComponent(fills.id)}`; };
    const againBtn = $('[data-again]', el);
    if (againBtn && renew) againBtn.onclick = () => { buzz(6); renew(); };
    const mergeBtn = $('[data-merge]', el);
    if (mergeBtn && merge) mergeBtn.onclick = () => afterSheets(async () => {
      const name = dueTitle(merge.keep);
      const lates = [merge.keep, ...merge.others].some(x => x.id !== merge.keep.id && dueOccurrences(x.id).some(o => o.state === 'late'));
      // celle qui n'a rien de réglé ni de retard disparaît en s'arrêtant (comme Arrêter le dit)
      const gone = merge.others.filter(x => dueStopErases(x.id)).length;
      const ends = merge.others.length > 1
        ? (gone === merge.others.length ? `les ${gone} autres disparaissent (rien n’y était réglé)` : `les ${merge.others.length} autres s’arrêtent`)
        : `${esc(dueTitle(merge.others[0]))} ${gone ? 'disparaît (rien n’y était réglé)' : 's’arrête'}`;
      const yes = await confirmSheet({
        title: `Regrouper ${DUE.these} ?`,
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
    // Modifier (2026-11-24, avec l'utilisateur : plus de formulaire déplié sous la page) : la feuille de la création,
    // préremplie de sa règle ; enregistrée, la page se redessine ; fermée sans enregistrer, rien ne change
    const editGo = $('[data-edit-go]', el);
    if (editGo) editGo.onclick = () => { buzz(6); openDueSheet({ r, onSaved: () => done('saved') }); };
    const stop = $('[data-stop]', el);
    if (stop) stop.onclick = () => afterSheets(async () => {
      const late = occ.current().filter(o => o.state === 'late').length;
      const erase = dueStopErases(r.id);
      const text = erase ? 'Rien n’y est encore réglé : elle disparaît.'
        : `Plus de dates à partir d’aujourd’hui. Ce qui est réglé reste.${late ? ` ${late > 1 ? `Ses ${late} retards restent` : 'Son retard reste'} à régler.` : ''} ${DUE.She} ira ensuite dans ${DUE.theMany} ${DUE.adj('terminé')}s.`;
      const yes = await confirmSheet({ title: `Arrêter ${DUE.this} ?`, text, yes: 'Arrêter' });
      if (yes && await stopDue(r.id)) { toast(erase ? `${DUE.One} retiré${DUE.e}` : `${DUE.One} arrêté${DUE.e}`); done(erase ? 'deleted' : 'stopped'); }
    });
    return { refresh: () => occ.refresh(), at: () => occ.selected() };
  }
}

/**
 * Le formulaire d'une échéance, au format de la saisie (2026-11-24, avec l'utilisateur : plus de champs empilés ni de
 * montant au clavier du téléphone) : le type, le portefeuille comme un destinataire, le grand montant et le pavé maison,
 * des pastilles (catégorie, nom, « Quand ? », fin ; le nom s'écrit dans sa petite feuille, jamais en haut : 2026-11-26, avec l'utilisateur), et le bouton qui dit ce qui sera enregistré. Toujours dans
 * une feuille (openDueSheet). r null : une nouvelle (preset : ses valeurs de départ ; preset.again : une reconduction,
 * type et catégorie figés). r : une qui existe (sa tête, modifiable) : les changements valent à partir d'aujourd'hui,
 * le type est figé dès qu'une fois est réglée, un résumé dit ce qui changera et « Annuler les changements » remet les
 * valeurs enregistrées. mount() appelle done() après 'created' (avec la nouvelle), 'saved' ou 'unchanged'.
 * @param {{ r: Schedule|null, preset?: Record<string, any>|null }} o
 */
function dueForm({ r, preset = null }) {
  const t0 = today();
  // reconduire : on sait ce que c'est (son type et sa catégorie ne se choisissent pas)
  const again = !r && !!preset?.again;
  // « en N fois » : le nombre de fois de toute l'échéance (ses règles successives comprises)
  const total0 = r ? dueTimes(r.id) : null;
  // une fois déjà réglée : le type ne change plus (pour un autre, une autre échéance)
  const settled = r ? dueSettled(r.id) : false;
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
    /** @type {import('../domain/when.js').By|null} */
    by: r ? r.by : preset?.by || null,
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
  const whenNow = () => (r ? { start: r.start, days: r.days || [], every: r.every || null, interval: r.interval || 1, by: r.by }
    : { start: f.start, days: f.days, every: f.every || null, interval: f.interval || 1, by: f.by });
  const cur = () => account(f.wallet)?.currency || 'XOF';
  const started = !!r && r.start < t0;
  const html = `<div class="dv-edit" data-edit>
      <div class="dv-kind">${seg(TYPES, f.kind, `due-kind${settled || again ? ' locked' : ''}`)}${settled ? '<small class="field-note" data-kindnote>Une fois est déjà réglée : le type ne change plus.</small>' : ''}</div>
      <div class="dv-from" data-from></div>
      <div class="e-stage dv-stage"><div class="e-expr" data-expr aria-live="polite"></div><div class="e-say" data-say></div></div>
      <div class="e-meta dv-meta" data-row1 role="group" aria-label="Catégorie et nom"></div>
      <div class="e-meta dv-meta">
        <button type="button" class="mp" data-when>${icon('calendar-blank')}<span data-whenl></span></button>
        <button type="button" class="mp" data-endp>${icon('calendar-check')}<span data-endl></span></button>
      </div>
      <div data-pad></div>
      <div data-err></div>
      ${r ? '<div class="dv-sum" data-sum hidden></div><button type="button" class="link dv-undo" data-undo hidden>Annuler les changements</button>' : ''}
      ${sheetActions('<button type="button" class="btn primary go" data-save><span class="lbl" data-savel></span></button>')}
    </div>`;

  return { html, mount };

  /** @param {HTMLElement} el @param {{ done: (what: string, made?: Schedule) => void }} o @returns {{ dirty: () => boolean }} */
  function mount(el, { done }) {
    const box = /** @type {HTMLElement} */ ($('[data-edit]', el));
    const errEl = $('[data-err]', box), sumEl = $('[data-sum]', box), undoBtn = $('[data-undo]', box);
    const fromEl = $('[data-from]', box), exprEl = /** @type {HTMLElement} */ ($('[data-expr]', box)), sayEl = $('[data-say]', box);
    const row1 = $('[data-row1]', box), saveBtn = /** @type {HTMLButtonElement} */ ($('[data-save]', box)), saveLbl = $('[data-savel]', box);
    const kindSeg = $('.due-kind', box);
    const showErr = (/** @type {string} */ msg) => { errEl.innerHTML = noticeHTML(esc(msg)); buzz(14); };
    /** @type {ReturnType<typeof keypad>|null} */
    let pad = null;
    let padCur = '';
    /** Le grand montant, écrit en clair (calcul compris), comme dans la feuille montant. @param {string|null} [key] */
    const paintAmt = (key = null) => {
      const expr = pad ? pad.expr() : '';
      exprEl.innerHTML = pad && pad.caret() < expr.length ? exprCharsHTML(expr, { cur: cur(), caret: pad.caret() })
        : exprHTML(expr, { cur: cur(), typed: !!key && key !== 'del' && key !== 'caret' && key !== 'set' });
      exprEl.classList.toggle('income', f.kind === 'income');
      // la phrase d'en haut de la feuille passe sous le montant, en gris (2026-11-26, avec l'utilisateur)
      sayEl.innerHTML = expr && !f.amount ? '<span class="loss">Indique un montant.</span>'
        : again ? '<span class="muted">Son type et sa catégorie ne changent pas. L’ancienne reste dans les terminées.</span>'
          : started ? '<span class="muted">Les changements valent à partir d’aujourd’hui. Les fois réglées et les retards ne changent pas.</span>' : '';
      fitText(exprEl, '.e-expr', 24);
    };
    /** Ce qui manque encore pour enregistrer (le bouton l'écrit, éteint), une fois le montant tapé. */
    const missingKey = () => (f.kind !== 'transfer' && !f.category ? 'cat'
      : f.kind === 'transfer' && !f.to ? 'to'
        : !f.note.trim() ? 'name'
          : !picked && !chosen0 ? 'days' : '');
    const missing = () => ({ cat: 'Choisis une catégorie', to: 'Choisis le portefeuille d’arrivée', name: 'Donne un nom', days: 'Choisis les jours', '': '' })[missingKey()];
    /** Le bouton dit ce qui sera enregistré : « Créer 25 000 F · chaque mois » (le nom est dans sa pastille). */
    const paintSave = () => {
      const lack = f.amount ? missing() : '';
      const verb = r ? 'Enregistrer' : 'Créer';
      const tail = picked || chosen0 ? low(rhythmLabel(f.every || null, f.interval)) : '';
      saveLbl.innerHTML = lack ? esc(lack) : f.amount
        ? `${icon('check')}<span class="go-t">${verb} <small>${money(f.amount, { cur: cur() })}</small></span>${tail ? `<span class="go-c">· ${esc(tail)}</span>` : ''}`
        : `${icon('check')}<span class="go-t">${r ? verb : `${verb} ${DUE.the}`}</span>`;
      saveBtn.disabled = !f.amount || !!lack;
      saveBtn.classList.toggle('need', !!lack);
      // ce que le bouton réclame s'entoure (comme la saisie)
      const miss = f.amount ? missingKey() : '';
      for (const [k, sel] of /** @type {const} */ ([['cat', '[data-cat]'], ['to', '[data-to]'], ['name', '[data-namep]'], ['days', '[data-when]']])) $(sel, box)?.classList.toggle('ask', miss === k);
    };
    // Entrée (clavier) : le bouton touché en dernier dans le formulaire, sinon enregistrer ; éteint, il tremble
    const onEnter = () => {
      const fo = /** @type {HTMLElement|null} */ (document.activeElement);
      if (fo && fo !== saveBtn && box.contains(fo) && fo.matches('button')) { fo.click(); return; }
      if (!saveBtn.disabled) { saveBtn.click(); return; }
      if (pad?.hasOp()) pad.resolve();
      shake(saveBtn);
    };
    /** Le pavé suit la devise du portefeuille (touche décimale) : remonté quand elle change. */
    const mountPad = () => {
      if (pad && padCur === cur()) return;
      // une autre devise au nombre de décimales différent : le montant garde ce qu'on lit (25 000 F → 25 000 €)
      if (pad && padCur) f.amount = Math.round(f.amount * 10 ** (currencyOf(cur()).dec - currencyOf(padCur).dec));
      padCur = cur();
      const host = $('[data-pad]', box), fresh = /** @type {HTMLElement} */ (host.cloneNode(false));
      fresh.className = '';
      host.replaceWith(fresh);
      pad = keypad(fresh, {
        initial: f.amount, cur: padCur, onEnter,
        onChange: (/** @type {number} */ v, /** @type {string} */ _expr, /** @type {string} */ key) => { f.amount = v; errEl.innerHTML = ''; paintAmt(key); paintSave(); onEdit(); },
      });
    };
    /** Une pastille : remplie (set) ou en gris. @param {string} q @param {string} text @param {boolean} set */
    const pill = (q, text, set) => { const b = $(q, box); b.textContent = text; b.closest('.mp')?.classList.toggle('set', set); };
    /** Un portefeuille, comme un destinataire. @param {string|null} id @param {string} attr @param {string} lbl */
    const walletPill = (id, attr, lbl) => {
      const a = id ? account(id) : null;
      return `<button type="button" class="mp${a ? ' set' : ''}" ${attr} aria-label="${lbl} : ${a ? esc(a.name) : 'à choisir'}">${icon('wallet')}<span>${esc(a?.name || 'Choisir')}</span></button>`;
    };
    const paint = () => {
      const from = f.kind === 'transfer'
        ? `${walletPill(f.wallet, 'data-wal', 'De')}<span class="dv-arrow" aria-hidden="true">${icon('arrow-right')}</span>${walletPill(f.to, 'data-to', 'Vers')}`
        : walletPill(f.wallet, 'data-wal', f.kind === 'income' ? 'Arrive sur' : 'Portefeuille');
      // repeint seulement s'il change (le focus reste sur la pastille touchée)
      if (fromEl.innerHTML !== from) fromEl.innerHTML = from;
      // la catégorie en gélule de couleur (comme la saisie, cadenas en reconduction : absente pour un virement), puis le nom en pastille
      const c = category(f.category);
      const lock = again ? ' aria-disabled="true"' : '';
      const cat = f.kind === 'transfer' ? ''
        : c ? `<button type="button" class="sc on" data-cat style="--c:var(--${c.color || 'c0'})"${lock} aria-label="Catégorie : ${esc(c.name)}${again ? '' : ', changer'}">${catIcon(c.icon)}<span>${esc(c.name)}</span>${icon(again ? 'lock-simple' : 'caret-down')}</button>`
          : `<button type="button" class="sc more" data-cat${lock}>${icon('squares-four')}<span>Catégorie</span>${again ? icon('lock-simple') : ''}</button>`;
      const row = `${cat}<button type="button" class="mp${f.note.trim() ? ' set' : ''}" data-namep>${icon('text-align-left')}<span>${esc(f.note.trim() || 'Nom')}</span></button>`;
      if (row1.innerHTML !== row) row1.innerHTML = row;
      pill('[data-whenl]', picked ? whenPhrase(picked) : chosen0 ? whenPhrase(whenNow()) : 'Quand ?', !!picked || chosen0);
      $('[data-endp]', box).hidden = !f.every;
      pill('[data-endl]', endMode === 'times' ? `${f.times} fois` : endMode === 'date' ? (f.end ? `Jusqu’au ${dayShort(f.end)}` : 'Jusqu’au …') : 'Sans fin', endMode !== 'never');
      mountPad();
      paintAmt();
      paintSave();
    };
    // le type figé : une reconduction, ou une fois déjà réglée
    if (again || settled) $$('button', kindSeg).forEach(b => { b.disabled = true; });

    /** Les valeurs du formulaire, ou ce qui manque. @returns {{ data?: Record<string, any>, error?: string }} */
    const read = () => {
      const amount = f.amount;
      if (!amount || amount <= 0) return { error: 'Indique un montant.' };
      if (f.kind !== 'transfer' && !f.category) return { error: 'Choisis une catégorie.' };
      if (f.kind === 'transfer' && !f.to) return { error: 'Choisis le portefeuille d’arrivée.' };
      if (!f.note.trim()) return { error: 'Donne un nom.' };
      if (!picked && !chosen0) return { error: 'Choisis les jours dans « Quand ? ».' };
      const times = endMode === 'times' ? f.times : null;
      if (f.every && endMode === 'times' && !(Number.isInteger(times) && /** @type {number} */ (times) >= 1)) return { error: 'Indique un nombre de fois.' };
      if (f.every && endMode === 'date' && !f.end) return { error: 'Choisis la dernière date.' };
      return { data: {
        kind: f.kind, amount, accountId: f.wallet, toAccountId: f.kind === 'transfer' ? f.to : null, categoryId: f.kind === 'transfer' ? null : f.category,
        note: f.note.trim(), start: f.start, every: f.every || null, interval: f.every ? f.interval : 1, days: f.days, by: f.every === 'month' ? f.by : null,
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
        changes.by = picked.by || null;
        changes.every = data.every; changes.interval = data.interval;
      }
      return changes;
    };
    /** Le formulaire a-t-il changé depuis les valeurs enregistrées (le montant lu, le nom sans espaces autour) ? */
    const dirty = () => !!picked || endMode !== endMode0 || f.note.trim() !== f0.note.trim()
      || f.amount !== f0.amount
      || (endMode === 'times' && (f.times || 0) !== (f0.times || 0))
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
    // une échéance qui existe, pendant qu'on modifie : le résumé (l'aperçu du domaine, sans rien écrire), l'annulation
    let tick = 0;
    function onEdit() {
      if (!r) return;
      clearTimeout(tick);
      tick = window.setTimeout(() => {
        const changed = dirty();
        undoBtn.hidden = !changed;
        const got = changed ? read() : {};
        const changes = got.data ? diff(got.data) : null;
        if (!changes || !Object.keys(changes).length) { sumEl.hidden = true; return; }
        const p = previewDueUpdate(r.id, changes);
        sumEl.hidden = false;
        sumEl.innerHTML = p.error ? noticeHTML(esc(p.error)) : esc(summaryOf(changes, p.list || [], dueOccurrences(r.id)));
      }, 120);
    }
    const changed = () => { errEl.innerHTML = ''; paint(); onEdit(); };
    paint();

    wireSeg(kindSeg, v => {
      if (v === f.kind || again || settled) return;
      f.kind = v;
      // une catégorie de dépense ne va pas à une rentrée (et inversement)
      if (f.category && category(f.category)?.type !== v) f.category = null;
      changed();
    });
    // la catégorie et le nom : la rangée se repeint, un seul gestionnaire sur elle
    row1.onclick = async e => {
      const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-cat], [data-namep]'));
      if (!b) return;
      if (b.matches('[data-namep]')) {
        buzz(6);
        const v = await editNote(f.note, { title: 'Nom', placeholder: 'Ex. Loyer, Canal Box', max: 40 });
        if (v != null) { f.note = v; changed(); }
        return;
      }
      if (again) return;
      const c = await pickCategory({ type: f.kind === 'income' ? 'income' : 'expense', current: f.category });
      if (c) { f.category = c; changed(); }
    };
    // le portefeuille (et l'arrivée d'un virement) : ses pastilles sont repeintes, le toucher passe par leur rangée
    fromEl.onclick = async e => {
      const b = /** @type {HTMLElement} */ (e.target).closest('[data-wal], [data-to]');
      if (!b) return;
      buzz(6);
      if (b.matches('[data-wal]')) {
        const a = await pickAccount({ current: f.wallet, title: f.kind === 'transfer' ? 'De' : 'Portefeuille', spending: f.kind === 'expense' });
        if (a) { f.wallet = a; if (f.to === a || (f.to && account(f.to)?.currency !== account(a)?.currency)) f.to = null; changed(); }
        return;
      }
      const a = await pickAccount({ current: f.to, exclude: f.wallet, currency: cur(), title: 'Vers' });
      if (a) { f.to = a; changed(); }
    };
    tapCaret(exprEl, () => pad, cur, () => paintAmt('caret'));
    // « Quand ? » (D18 revu le 2026-11-18) : un calendrier, les jours touchés et leur répétition
    $('[data-when]', box).onclick = async () => {
      // « Chaque mois » pré-coché pour une catégorie mensuelle
      const prefer = f.kind !== 'transfer' && monthlyHabit(transactions(), f.category, t0) ? 'month' : null;
      const w = await pickWhen({ when: picked || (chosen0 ? whenNow() : null), prefer });
      if (!w) return;
      picked = w;
      f.start = w.start; f.days = w.days; f.every = w.every || ''; f.interval = w.interval; f.by = w.by || null;
      changed();
    };
    // la fin (jamais, une date, un nombre de fois) : une petite feuille
    $('[data-endp]', box).onclick = async () => {
      buzz(6);
      const got = await pickEnd({ mode: endMode, end: f.end, times: f.times, start: f.start, whole: !!r });
      if (!got) return;
      endMode = got.mode;
      if (got.mode === 'date') f.end = got.end;
      if (got.mode === 'times') f.times = got.times;
      changed();
    };
    // « Annuler les changements » : les valeurs enregistrées reviennent
    if (undoBtn) undoBtn.onclick = () => {
      buzz(6);
      Object.assign(f, f0);
      endMode = endMode0;
      picked = null;
      mountPad();
      pad?.set(f0.amount);
      setSeg(kindSeg, f.kind);
      changed();
    };

    saveBtn.onclick = async () => {
      errEl.innerHTML = '';
      if (pad?.hasOp()) pad.resolve();
      const got = read();
      if (!got.data) return showErr(/** @type {string} */ (got.error));
      if (!r) {
        // reconduire : une nouvelle opération, indépendante (la création ordinaire passe par la saisie, plan-create.js)
        const made = await createDue(got.data, { onError: showErr });
        if (!made) return;
        buzz(12);
        toast(`${DUE.One} reconduit${DUE.e}`);
        done('created', made);
        return;
      }
      const changes = diff(got.data);
      if (!Object.keys(changes).length) { done('unchanged'); return; }
      const ok = await updateDue(r.id, changes, { onError: showErr });
      if (!ok) return;
      buzz(12);
      toast(`${DUE.One} enregistré${DUE.e}`);
      done('saved');
    };
    return { dirty };
  }
}

/**
 * La fin d'une échéance qui se répète (2026-11-24, le formulaire au format de la saisie) : une petite feuille — Sans fin,
 * Jusqu'au (une date, à partir de la première date et jamais avant aujourd'hui), ou un nombre de fois (un compteur, au
 * moins 1 ; celui de toute l'échéance, compté depuis sa première date) ; le bouton dit ce qui sera retenu.
 * Résout { mode, end, times }, ou null (fermée).
 * @param {{ mode: string, end: string|null, times: number|null, start: string, whole: boolean }} o whole : une échéance
 *   qui existe (ses fois passées comptent)
 * @returns {Promise<{ mode: string, end: string|null, times: number|null }|null>}
 */
export function pickEnd({ mode, end, times, start, whole }) {
  return new Promise(resolve => {
    /** @type {{ mode: string, end: string|null, times: number|null }|null} */
    let out = null;
    const t0 = today();
    /** @type {number|null} */
    let n = times || null;
    let m = mode, d = end;
    const s = openSheet(`<div class="end-sheet">${sheetHead({ title: 'Fin' })}
      ${seg(ENDS, m, 'end-mode')}
      <div class="end-p" data-p></div>
      <button type="button" class="btn primary" data-ok></button></div>`, { label: 'Fin', onClose: () => resolve(out) });
    const host = $('[data-p]', s.el), ok = /** @type {HTMLButtonElement} */ ($('[data-ok]', s.el));
    const paint = () => {
      host.innerHTML = m === 'date'
        ? `<button type="button" class="field-btn" data-endd><b>${d ? esc(yearDate(d)) : 'Choisir la dernière date'}</b>${icon('calendar-blank')}</button>`
        : m === 'times'
          // le nombre de fois se tape (2026-11-24, avec l'utilisateur : plus simple qu'un compteur)
          ? `<label class="field end-n"><span class="sr">Nombre de fois</span><input data-times inputmode="numeric" maxlength="3" placeholder="Ex. 4" value="${n || ''}" autocomplete="off"></label>
            <p class="muted end-say">${whole ? `Toutes les fois de ${DUE.the}, depuis la première.` : 'Depuis la première date.'}</p>`
          : `<p class="muted end-say">${DUE.She} revient jusqu’à ce que tu l’arrêtes.</p>`;
      paintOk();
      const dateBtn = $('[data-endd]', host);
      if (dateBtn) dateBtn.onclick = async () => {
        buzz(6);
        const x = await pickDate({ current: d || start, title: 'Dernière date', future: true, min: start < t0 ? t0 : start });
        if (x) { d = x; paint(); }
      };
      const inp = /** @type {HTMLInputElement|null} */ ($('[data-times]', host));
      if (inp) {
        // seulement des chiffres ; le bouton suit sans redessiner le champ (il garde le clavier)
        inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 3); n = Number(inp.value) || null; paintOk(); };
        inp.onkeydown = e => { if (e.key === 'Enter') ok.click(); };
        setTimeout(() => focusEnd(inp), 120);
      }
    };
    /** Le bouton dit ce qui sera gardé ; éteint tant qu'il manque la date ou le nombre. */
    const paintOk = () => {
      const miss = (m === 'date' && !d) || (m === 'times' && !n);
      const label = m === 'date' ? (d ? `Jusqu’au ${yearDate(d)}` : 'Choisis la dernière date') : m === 'times' ? (n ? `${n} fois` : 'Indique le nombre de fois') : 'Sans fin';
      ok.innerHTML = `${miss ? '' : icon('check')}${esc(label)}`;
      ok.disabled = miss;
    };
    paint();
    wireSeg($('.end-mode', s.el), v => { m = v; paint(); });
    ok.onclick = () => {
      if (ok.disabled) return;
      out = { mode: m, end: m === 'date' ? d : null, times: m === 'times' ? n : null };
      buzz(10);
      s.close();
    };
  });
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
  const firstOpen = (/** @type {DueView[]} */ xs) => xs.find(o => o.state === 'late' || o.state === 'today' || o.state === 'soon') || xs[xs.length - 1] || null;
  /** @type {DueView|null} */
  let sel = (at && list.find(o => o.date === at)) || firstOpen(list);
  let enter = 0;
  const paint = () => {
    const xs = list;
    // la fois choisie se retrouve par sa date (les fois relues sont d'autres objets)
    if (!sel || !xs.includes(sel)) sel = (sel && xs.find(o => o.date === sel?.date)) || firstOpen(xs);
    if (!sel) { tabsHost.innerHTML = ''; cardHost.innerHTML = ''; onSelect(null); return; }
    const on = sel, i0 = xs.indexOf(on);
    // la prochaine : la seule qui se confirme d'avance (les retards, dans n'importe quel ordre)
    const next = list.find(o => o.state === 'today' || o.state === 'soon') || null;
    const focused = tabsHost.contains(document.activeElement) || cardHost.contains(document.activeElement);
    // un repère « aujourd'hui » entre le passé et l'à-venir (quand il y a l'un et l'autre)
    const t = today(), cut = xs.findIndex(o => o.date >= t);
    tabsHost.innerHTML = xs.length > 1 ? `<div class="ops-tabs dv-tabs" role="tablist" aria-label="Les fois de ${DUE.this}">${xs.map((o, i) => `${i === cut && cut > 0 ? '<span class="dv-now" aria-hidden="true">aujourd’hui</span>' : ''}<button type="button" role="tab" id="${uid}-${i}" class="ops-tab dv-tab ${o.state}${o === on ? ' on' : ''}" aria-selected="${o === on}" aria-controls="${uid}-card" tabindex="${o === on ? 0 : -1}" data-occ="${esc(o.key)}">${o.state === 'done' ? icon('check') : o.state === 'skipped' ? icon('skip-forward') : ''}${dayShort(o.date)}</button>`).join('')}</div>` : '';
    cardHost.innerHTML = `<div class="dv-card${enter && !reducedMotion() ? (enter > 0 ? ' from-r' : ' from-l') : ''}" id="${uid}-card" role="tabpanel" tabindex="-1"${xs.length > 1 ? ` aria-labelledby="${uid}-${i0}"` : ''} data-card>${cardHTML(on, { ro, next, before: list.slice(0, list.findIndex(o => o.key === on.key)).reverse().find(o => o.state === 'today' || o.state === 'soon') || null })}</div>`;
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
    const xs = list, i = xs.findIndex(o => o.key === sel?.key), j = i + dir;
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
      const xs = list, j = xs.findIndex(o => o.key === b.dataset.occ), i = xs.findIndex(o => o.key === sel?.key);
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
    // « Confirmer » (d'avance : « Confirmer maintenant ») : la saisie préremplie s'ouvre par-dessus (on vérifie, on change le portefeuille, la catégorie, le montant)
    // la page ; en revenant, on retrouve la page
    // Confirmer (2026-11-24, avec l'utilisateur) : la saisie préremplie ; plusieurs fois à régler la même semaine : la
    // feuille de la semaine (les cocher, changer un jour)
    click('[data-other]', () => afterSheets(() => (d.needsWallet ? openEntry({ due: d }) : confirmWeekOr(d, () => openEntry({ due: d })))));
    // « Changer le montant » (2026-11-24, avec l'utilisateur : « c'est juste une occurrence ») : cette fois seulement,
    // sans regarder le solde (Confirmer, lui, peut être refusé) ; « Revenir à … » remet celui de la règle
    click('[data-amount]', () => afterSheets(() => changeAmount(d)));
    click('[data-skip]', () => skipNow(d));
    click('[data-unskip]', async () => { if (d.schedule && await unskipDue(d.schedule, d.date)) toast(`${dueTitle(d)} : à régler de nouveau`); });
    click('[data-op]', () => d.entry && openOperation(d.entry));
  };
  paint();
  return {
    /** Après un changement : les fois relues, la même date choisie. */
    refresh() { list = dueOccurrences(id); paint(); },
    /** Les fois telles qu'elles sont. */
    current: () => list,
    /** La date de la fois choisie. */
    selected: () => (sel ? sel.date : null),
  };
}

/**
 * Une fois : sa date, son montant, son état et ce qu'on peut en faire (terminée : seulement regarder ;
 * d'avance, seulement la prochaine).
 * before : la fois à régler juste avant celle-ci (« Confirme d’abord celle du … »).
 * @param {DueView} o @param {{ ro: boolean, next: DueView|null, before?: DueView|null }} c
 */
function cardHTML(o, { ro, next, before = null }) {
  const verb = o.kind === 'income' ? 'Reçue' : o.kind === 'transfer' ? 'Faite' : 'Payée';
  const days = Math.round((Date.parse(o.date) - Date.parse(today())) / 864e5);
  const open = o.state !== 'done' && o.state !== 'skipped';
  const when = o.state === 'late' ? 'En retard' : o.state === 'today' ? 'À régler' : days <= 1 ? 'À venir' : `Dans ${days} jours`;
  const state = o.state === 'done' ? `${verb} le ${dayShort(o.paidOn || o.date)}`
    : o.state === 'skipped' ? 'Passée : elle n’a pas compté'
      : o.paused ? `${when} · en pause : son portefeuille ou sa catégorie est archivé` : when;
  let acts = '';
  if (o.state === 'done') acts = `<button type="button" class="btn sm due-pass" data-op>${icon('arrow-right')}Voir l’opération</button>`;
  else if (ro) acts = '';
  else if (o.state === 'skipped') acts = `<button type="button" class="btn sm due-pass" data-unskip>${icon('arrow-counter-clockwise')}Remettre à régler</button>`;
  else {
    const now = o.state !== 'soon';
    // d'avance, seulement la prochaine : jamais la 4e avant la 2e
    const may = now || next?.key === o.key;
    // sa réserve est close : on choisit le portefeuille qui paie (la saisie préremplie)
    const ok = o.paused || !may ? '' : `<button type="button" class="btn sm due-ok" data-other>${icon('check')}${now ? 'Confirmer' : 'Confirmer maintenant'}</button>`;
    acts = `${ok}<button type="button" class="btn sm due-pass" data-skip>${now ? 'Passer' : 'Passer cette fois'}</button>
      <button type="button" class="link dv-other" data-amount>Changer le montant</button>
      ${!may && (before || next) ? `<p class="muted dv-note">Confirme d’abord celle du ${dayShort((before || next).date)}.</p>` : ''}`;
  }
  return `<div class="dv-l1"><span>${esc(dayLabel(o.date))}</span>${o.rank && o.times ? `<span>${o.rank} sur ${o.times}</span>` : ''}</div>
    <div class="dv-amt${o.kind === 'income' && open ? ' in' : ''}">${dueMoney(o)}${o.state === 'done' && o.currency === o.plannedCur && o.amount !== o.planned ? `<small class="dv-plan">· prévu ${money(o.planned, { cur: o.plannedCur })}</small>` : ''}</div>
    ${open && o.adjusted ? `<div class="dv-adj">Montant changé pour cette fois · d’habitude ${money(o.ruleAmount, { cur: o.currency })}</div>` : ''}
    <div class="dv-state ${o.state}">${state}${open && o.needsWallet ? (ro ? ` · ${RES.its} est ${RES.adj('clos', 'close')}` : ` · ${RES.its} est ${RES.adj('clos', 'close')} : choisis le portefeuille qui paie`) : ''}</div>
    <div class="dv-acts">${acts}</div>`;
}

/**
 * Un autre montant pour une seule fois (2026-11-24) : la feuille montant, sur la date de la fois ; aucun solde regardé.
 * @param {DueView} d
 */
async function changeAmount(d) {
  const cur = d.currency;
  const res = await amountSheet({
    title: dayLabel(d.date), question: 'Combien, cette fois-ci ?', value: d.amount, cur,
    button: v => (v === d.ruleAmount && d.adjusted ? `Revenir à ${money(v, { cur })}` : `Mettre ${money(v, { cur })} cette fois`),
    remove: d.adjusted ? `Revenir à ${money(d.ruleAmount, { cur })}` : '',
  });
  if (!res) return;
  const amount = 'remove' in res ? null : res.amount;
  if ((amount ?? d.ruleAmount) === d.amount) return;
  if (!(await adjustDue(d, amount))) return;
  buzz(10);
  toast(amount == null ? `${dueTitle(d)} : ${money(d.ruleAmount, { cur })} cette fois, comme d’habitude` : `${dueTitle(d)} : ${money(amount, { cur })} cette fois`);
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
