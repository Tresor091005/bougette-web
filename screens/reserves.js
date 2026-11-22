// Épargne (D17, ROADMAP 4a) : la page d'UN portefeuille d'épargne (route #/epargne?w=<id>, ouverte depuis la section
// Épargne de Plan ; sans w, le premier). Pour ce portefeuille : solde, objectif (indicatif : où on en est, ce qu'il faut
// par mois), le verdict (D17 revu le 2026-11-20 : tout ce qui est prévu sur l'épargne tient-il ses réserves, sinon ce
// qui manque par mois ; le toucher ouvre le versement, ou « Programmer le versement »), réserves (barre, et si elle sera prête), épargne
// libre (aussi en mois de dépenses), « Nouvelle réserve », « Mettre de côté », « Réserves terminées » (historique). Une
// ligne, un geste (D0) : toucher une réserve ouvre son petit menu (selon son état : openReserveMenu) ; sa feuille ne
// garde que ses champs. Tout est une lecture ; les écritures passent par le magasin (commandes reserve.*, due.* et
// wallet.update).
import {
  account, savingsAccounts, savingsReport, emergencyAccount, monthlySpend, reserveById, createReserve,
  updateReserve, reduceReserve, closeReserve, updateAccount, countedAccounts, pref, closedReserves, reserveChain,
  reserveReconducted, reserveDeletedUses, reserveUses, category, settings, accounts, scheduleById, openReserves,
} from '../core/store.js';
import { openDueSheet, dueHref, dayShort } from './due-page.js';
import { money, esc, yearDate, today, readAmount, currencyOf, symbol, approx, approxUp, period } from '../core/format.js';
import { icon } from '../core/icons.js';
import { openSheet, seg, wireSeg, buzz, toast, switchHTML, noticeHTML, confirmSheet, menuSheet, afterSheets, fitText, chip, $, $$ } from '../core/ui.js';
import { accountPill, pickDate, pickCategory } from './pickers.js';
import { openAccountSheet } from './accounts.js';
import { opsHref } from './transactions.js';
import { openOperation } from './history.js';
import { addMonths, addDays, daysBetween } from '../domain/reserves.js';
import { resolve } from '../core/inbox.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML, fieldHTML, sheetHead, sheetActions, emptyState } from './parts.js';

/**
 * Ce que dit une réserve, en quelques mots (D17 revu le 2026-11-20, avec l'utilisateur : elle dit seulement si elle sera
 * prête, d'après la simulation de ce qui est prévu) : « Remplie » ; échue, en rouge ; prête à temps, rien ; « Prête
 * 6 mois trop tard » quand ce qui est prévu la remplit après sa date (revu le 2026-11-20), « Il manquera X » quand ça ne suffit jamais, en orange ; « Rien
 * de prévu » en rouge. @param {any} v
 */
/**
 * De combien une réserve sera prête trop tard (2026-11-20, avec l'utilisateur : « Prête le 2 févr 2028 » seul, personne
 * ne garde sa date en tête) : en jours sous deux semaines, en semaines sous deux mois, en mois au-delà, arrondi au-dessus.
 * @param {string} due @param {string} ready
 */
export function lateBy(due, ready) {
  const d = Math.max(1, daysBetween(due, ready));
  if (d < 14) return d > 1 ? `${d} jours` : '1 jour';
  if (d < 61) { const w = Math.ceil(d / 7); return `${w} semaines`; }
  return `${Math.ceil(d / 30.44)} mois`;
}

export function statusHTML(v) {
  const r = v.reserve, cur = r.currency;
  if (v.full) return 'Remplie';
  if (v.status === 'overdue') return `<span class="loss">Échue le ${dayShort(r.due)}</span>`;
  if (v.status === 'later') return `<span class="rs-warn">Prête ${lateBy(r.due, v.ready)} trop tard</span>`;
  if (v.status === 'short') return `<span class="rs-warn">Il manquera ${money(approx(v.short, cur), { cur })}</span>`;
  if (v.status === 'none') return '<span class="loss">Rien de prévu</span>';
  return '';
}
/** La barre d'une réserve prend la couleur de ce qu'elle dit (rouge, orange). @param {any} v */
export const barTone = v => (v.status === 'overdue' || v.status === 'none' ? ' over' : v.status === 'later' || v.status === 'short' ? ' warn' : '');

/** « Prête à temps » (sa date est dans le champ Échéance, juste dessous) ; ce qu'une réserve dit d'elle dans sa feuille. @param {any} v */
function reserveLine(v) {
  const r = v.reserve;
  if (v.status === 'overdue') return statusHTML(v);
  // en retard : « Prête le 2 févr 2028, 6 mois trop tard » (son échéance est dans le champ dessous)
  if (v.status === 'later') return `<span class="rs-warn">Prête le ${yearDate(v.ready)}, ${lateBy(r.due, v.ready)} trop tard</span>`;
  return `${v.status === 'ok' ? 'Prête à temps' : statusHTML(v)}${v.overdue ? ` · échue le ${yearDate(r.due)}` : ''}`;
}

/** Ligne d'une réserve terminée : la toucher ouvre son petit menu (ses opérations, Reconduire, son portefeuille). @param {any} x */
export const closedRowHTML = x => rowHTML({ attrs: `data-res-done="${x.id}"`, pill: `<span class="pill">${icon('check-circle')}</span>`,
  title: esc(x.name), sub: closedLine(x), end: `<span class="amt">${money(x.amount, { cur: x.currency })}</span>` });

/** Ce que dit une réserve terminée : utilisée (et combien) ou close, et si une opération d'utilisation a été supprimée. @param {any} r */
function closedLine(r) {
  const cur = r.currency;
  const used = r.mode === 'once' ? r.uses.length || r.used ? `Utilisée le ${yearDate(r.closed)}` : `Close le ${yearDate(r.closed)}`
    : r.used ? `${money(r.used, { cur })} utilisés · terminée le ${yearDate(r.closed)}` : `Close le ${yearDate(r.closed)}`;
  const gone = reserveDeletedUses(r).length;
  return `${used}${gone ? ` · <span class="loss">${gone > 1 ? `${gone} opérations supprimées depuis` : 'opération supprimée depuis'}</span>` : ''}`;
}

/** Ce que dit l'objectif d'un portefeuille. @param {any} g @param {string} cur */
function goalLine(g, cur) {
  if (g.reached) return g.over ? `Objectif atteint, ${money(g.over, { cur })} de plus` : 'Objectif atteint';
  if (g.passed) return `Date passée, objectif atteint à ${g.pct} %`;
  // ce qu'il faut faire d'abord (le pourcentage est dans l'anneau autour de l'icône)
  return g.need ? `${money(approxUp(g.need, cur), { cur })} par mois jusqu’au ${yearDate(g.on)}` : `Objectif ${money(g.amount, { cur })}`;
}
/** Anneau fin autour de l'icône du portefeuille : où en est l'objectif. @param {string} pill @param {any} g */
/**
 * L'anneau d'une épargne à réserves (2026-11-20, avec l'utilisateur : sans anneau elle paraissait pauvre) : calculé, ce qui
 * est de côté pour toutes ses réserves sur ce qu'elles visent en tout ; un repère, pas un objectif (ni date ni conseil).
 * null sans réserve. @param {any} rep savingsReport
 */
export function reservesRing(rep) {
  if (!rep.reserves.length) return null;
  const saved = rep.reserves.reduce((n, v) => n + v.saved, 0), target = rep.reserves.reduce((n, v) => n + v.target, 0);
  return { pct: target ? Math.floor((saved * 100) / target) : 100, saved, target, label: 'Mis de côté' };
}
/** « encore 165 000 F sur 230 000 F », ou « tout est de côté ». @param {any} ring reservesRing @param {string} cur */
const restHTML = (ring, cur) => (ring.saved >= ring.target ? 'tout est de côté' : `encore ${money(ring.target - ring.saved, { cur })} sur ${money(ring.target, { cur })}`);
export const goalRing = (pill, g) => (g ? `<span class="goal-ring${g.pct >= 100 ? ' done' : ''}" style="--p:${Math.min(100, g.pct)}" role="img" aria-label="${g.label || 'Objectif'} : ${Math.min(100, g.pct)} %">${pill}</span>` : pill);

/**
 * Ligne d'une réserve ouverte : ce qu'elle dit (statusHTML) sur une ligne dessous, la barre de ce qui est de côté (sans repère, D17
 * revu le 2026-11-20 : la plus proche servie d'abord, une réserve lointaine peut être à 0 % alors que le plan est tenu),
 * dessous « 10 500 F / 15 000 F · pour le 20 déc » (2026-11-20, avec l'utilisateur : sa date se lit à côté de « Prête 4 mois
 * trop tard » ou « Il manquera … »). Toujours touchable.
 * Pas le nom de son portefeuille (2026-11-22, avec l'utilisateur : il faisait passer la ligne sur deux lignes ; son menu
 * mène au portefeuille).
 * @param {any} v vue de la réserve (savingsReport)
 */
export function reserveRowHTML(v) {
  const rv = v.reserve, cur = rv.currency;
  // ce qu'elle dit sur sa propre ligne, dessous (2026-11-20, avec l'utilisateur : à droite du nom, coincé ; on lit de haut
  // en bas : quoi, où on en est, ce qui va se passer) ; à temps, pas de ligne
  const stage = statusHTML(v);
  return `<div class="row mrow rs-row"><button type="button" class="mrow-go" data-res="${rv.id}">
    ${chip(rv.category ? category(rv.category) : null)}
    <span class="main"><span class="l1"><span class="t">${esc(rv.name)}</span></span>
      <span class="bar rs-bar${barTone(v)}"><i style="width:${v.pct}%"></i></span>
      <span class="l2"><span class="s">${money(v.saved, { cur })} / ${money(v.target, { cur })} · pour le ${dayShort(rv.due)}</span></span>
      ${stage ? `<span class="l3 rs-stage">${stage}</span>` : ''}</span></button></div>`;
}

/**
 * Utiliser une réserve (D17 ; revu le 2026-11-19 : chacun fait ce qu'il veut de son argent) : la dépense s'ouvre,
 * remplie. En plusieurs fois : toujours, quel que soit ce qui est de côté pour elle. En une fois : seulement si
 * l'épargne a de quoi la payer entièrement ; sinon on dit ce qui manque.
 * @param {string} id @param {(o: any) => any} openEntry
 */
async function useReserve(id, openEntry) {
  const r = reserveById(id);
  if (!r || r.closed) return;
  const v = savingsReport(r.wallet).reserves.find(x => x.reserve.id === id);
  if (!v) return;
  const bal = savingsReport(r.wallet).balance;
  if (r.mode === 'once' && bal < v.target) {
    toast(`${r.name} se paie en une fois : il faut ${money(v.target, { cur: r.currency })}, il y a ${money(Math.max(0, bal), { cur: r.currency })} sur ${account(r.wallet)?.name || 'l’épargne'}.`);
    return;
  }
  openEntry({ type: 'expense', reserveId: r.id, copy: { type: 'expense', amount: r.mode === 'once' ? v.target : 0, accountId: r.wallet, categoryId: r.category || null } });
}

/**
 * Une réserve en une fois remplie (2026-11-19, avec l'utilisateur) : « Tu la dépenses quand ? » — maintenant (Utiliser), le
 * jour de son échéance, ou une autre date (son échéance change : pas d'échéance de dépense en plus, un seul chemin) ; la
 * cloche le rappelle ce jour-là.
 * @param {string} id @param {(o: any) => any} openEntry
 */
export async function askWhen(id, openEntry) {
  const r = reserveById(id);
  if (!r || r.closed) return;
  const v = savingsReport(r.wallet).reserves.find(x => x.reserve.id === id);
  const cur = r.currency;
  const k = await menuSheet({ title: `${esc(r.name)} est prête`, items: [
    { key: 'now', icon: 'arrow-right', label: 'Maintenant', note: `Tu notes la dépense de ${money(v ? v.target : r.amount - r.used, { cur })}, puis la réserve se ferme` },
    { key: 'keep', icon: 'calendar-check', label: `Le ${dayShort(r.due)}`, note: 'L’argent reste de côté jusque-là' },
    { key: 'date', icon: 'calendar-blank', label: 'À une autre date' },
  ] });
  if (!k) return;
  resolve(`res-ready-${id}`);
  if (k === 'now') afterSheets(() => useReserve(id, openEntry));
  else if (k === 'keep') toast(`Gardée pour le ${dayShort(r.due)}`);
  else afterSheets(async () => {
    const d = await pickDate({ current: r.due, future: true, min: today(), title: 'Tu la dépenses quand ?' });
    if (d && d !== r.due && (await updateReserve(r.id, { due: d }))) { buzz(12); toast(`Gardée pour le ${dayShort(d)}`); }
  });
}

/** Repousser une réserve : une nouvelle échéance. @param {any} r */
export async function pushReserve(r) {
  const d = await pickDate({ current: r.due > today() ? r.due : today(), future: true, min: today(), title: 'Nouvelle échéance' });
  if (!d) return;
  if (await updateReserve(r.id, { due: d })) { buzz(12); toast('Échéance repoussée'); }
}

/**
 * Clore une réserve, après confirmation : ce qui est dessus retourne aux autres. onClosed : après (refermer sa feuille).
 * @param {any} r @param {() => void} [onClosed]
 */
export async function closeReserveAsk(r, onClosed = () => {}) {
  const yes = await confirmSheet({
    title: `Clore ${esc(r.name)} ?`,
    text: 'Son argent va aux autres réserves ou à l’épargne libre. Tu pourras la reconduire depuis « Réserves terminées ».',
    yes: 'Clore',
  });
  if (!yes) return;
  afterSheets(async () => { if (await closeReserve(r.id)) { onClosed(); toast('Réserve close'); } });
}

/** Le Journal filtré sur une réserve, sur la période de ses utilisations (du mois de la première à celui de la dernière). @param {any} r */
export function reserveOpsHref(r) {
  const u = reserveUses(r);
  if (!u.length) return opsHref({ res: r.id });
  const ms = settings().monthStart;
  return opsHref({ res: r.id, from: period(u[0].date, ms).start, to: period(u[u.length - 1].date, ms).end });
}

/**
 * Petit menu d'une réserve (une ligne, un geste, D0), selon son état (revu le 2026-11-19, avec l'utilisateur : six actions
 * partout, c'était trop) : seulement ce qui sert maintenant, le geste le plus probable d'abord. En cours : Utiliser quand
 * c'est possible (en premier si elle est remplie, ou en plusieurs fois déjà utilisée), « Programmer le versement » quand
 * rien n'est prévu et que son épargne n'en a pas (une réserve n'a plus d'échéance à elle, D17 revu le 2026-11-20), ses
 * opérations, Modifier — Repousser et Clore sont dans Modifier (sa date ; un bouton en bas). Échue : Utiliser (si
 * possible), Repousser, Réduire (pas remplie, avec de l'argent), Clore. Terminée : Reconduire (si elle ne l'a pas été)
 * et ses opérations. Son portefeuille, seulement hors de sa page (atWallet).
 * @param {{ id: string, openEntry: (o: any) => any, go: (hash: string) => any, atWallet?: boolean }} o
 */
export async function openReserveMenu({ id, openEntry, go, atWallet = false }) {
  const r = reserveById(id);
  if (!r) return;
  const cur = r.currency;
  const rep = r.closed ? null : savingsReport(r.wallet);
  const view = rep ? rep.reserves.find(v => v.reserve.id === r.id) || null : null;
  const uses = reserveUses(r);
  const wallet = account(r.wallet);
  /** @type {{ key: string, icon: string, label: string, note?: string }[]} */
  const items = [];
  if (rep) {
    // Utiliser, seulement quand c'est possible : en une fois, quand l'épargne peut la payer entièrement ; en plusieurs fois, toujours
    const need = view ? view.target : r.amount - r.used;
    const use = r.mode !== 'once' || rep.balance >= need
      ? { key: 'use', icon: 'arrow-right', label: 'Utiliser', note: r.mode === 'once' ? `Tu notes la dépense de ${money(need, { cur })}, puis la réserve se ferme` : 'Une partie maintenant, le reste plus tard' } : null;
    if (view?.overdue) {
      if (use) items.push(use);
      items.push({ key: 'push', icon: 'calendar-blank', label: 'Repousser', note: 'Choisir une nouvelle date' });
      if (!view.full && view.saved > 0) items.push({ key: 'reduce', icon: 'arrow-down', label: `Réduire à ${money(view.saved, { cur })}`, note: 'Elle vise ce qui est déjà de côté' });
      items.push({ key: 'close', icon: 'x-circle', label: 'Clore', note: 'Son argent retourne à l’épargne' });
    } else {
      const useFirst = !!use && (!!view?.full || (r.mode !== 'once' && uses.length > 0));
      if (use && useFirst) items.push(use);
      if (view?.status === 'none' && !rep.versement.list.length) {
        items.push({ key: 'vers', icon: 'arrows-clockwise', label: 'Programmer le versement', note: rep.versement.gap ? `${money(rep.versement.gap, { cur })} par mois sur ${esc(wallet?.name || 'l’épargne')}` : `Chaque mois sur ${esc(wallet?.name || 'l’épargne')}` });
      }
      if (use && !useFirst) items.push(use);
    }
  }
  if (r.closed && !reserveReconducted(r.id)) items.push({ key: 'again', icon: 'arrows-clockwise', label: 'Reconduire', note: 'Même nom, même montant, même durée, à partir d’aujourd’hui' });
  if (uses.length === 1) items.push({ key: 'op', icon: 'receipt', label: 'Voir l’opération', note: `Le ${yearDate(uses[0].date)}` });
  else if (uses.length > 1) items.push({ key: 'ops', icon: 'list-bullets', label: 'Voir les opérations', note: `${uses.length} dépenses` });
  if (!r.closed && !view?.overdue) items.push({ key: 'edit', icon: 'pencil-simple', label: 'Modifier' });
  if (wallet && !atWallet) items.push({ key: 'wallet', icon: 'wallet', label: 'Aller au portefeuille', note: esc(wallet.name) });
  if (!items.length) return;
  // une seule chose à faire (2026-11-20, avec l'utilisateur : un menu d'une ligne, c'est un toucher pour rien) : on la fait
  const k = items.length === 1 ? items[0].key : await menuSheet({ title: esc(r.name), items });
  if (k === 'vers') afterSheets(() => scheduleVersement(r.wallet, openEntry));
  else if (k === 'use') afterSheets(() => useReserve(r.id, openEntry));
  else if (k === 'push') afterSheets(() => pushReserve(r));
  else if (k === 'reduce') afterSheets(async () => { if (view && (await reduceReserve(r.id, view.saved))) { buzz(12); toast('Montant réduit'); } });
  else if (k === 'close') afterSheets(() => closeReserveAsk(r));
  else if (k === 'edit') afterSheets(() => openReserveSheet({ id: r.id, openEntry }));
  else if (k === 'again') afterSheets(() => openReserveSheet({ from: r.id, openEntry }));
  else if (k === 'op') afterSheets(() => openOperation(uses[0].id));
  else if (k === 'ops') go(reserveOpsHref(r));
  else if (k === 'wallet') go(`#/epargne?w=${encodeURIComponent(r.wallet)}`);
}

/** Le portefeuille courant d'où part le versement : le premier compté dans le total, de la devise de l'épargne. @param {any} a */
const versementFrom = a => (countedAccounts().find(x => !x.savings && x.currency === a.currency)
  || accounts().find(x => !x.savings && !x.archived && x.currency === a.currency))?.id || null;

/**
 * Programmer le versement d'une épargne (D17 revu le 2026-11-20, avec l'utilisateur) : la feuille d'une échéance
 * préremplie — un virement du portefeuille courant vers l'épargne, chaque mois, à la prochaine date de début de période
 * (réglage), du manque (ce qu'il faudrait verser en plus de ce qui est prévu) ; tout se change, la personne met ce dont elle est sûre. Aucune réserve n'y est liée :
 * le versement confirmé se répartit, la plus proche d'abord.
 * @param {string} walletId @param {(o: any) => any} openEntry
 */
function scheduleVersement(walletId, openEntry) {
  const a = account(walletId);
  if (!a) return;
  const v = savingsReport(walletId).versement;
  openDueSheet({
    preset: {
      kind: 'transfer', amount: v.gap || 0, accountId: versementFrom(a), toAccountId: a.id, note: `Versement ${a.name}`.slice(0, 40),
      start: v.next, every: 'month', interval: 1,
      say: `Un virement vers ${a.name} chaque mois. Il remplit tes réserves, la plus proche d’abord. Le jour venu, tu le confirmes.`,
    },
    openEntry,
  });
}

/**
 * Les versements d'une épargne, touchés (le verdict) : la page du versement, pour l'augmenter ; un petit menu s'il y en a
 * plusieurs. @param {string} walletId @param {(h: string) => any} go
 */
async function openVersement(walletId, go) {
  const a = account(walletId);
  const list = a ? savingsReport(walletId).versement.list : [];
  if (!a || !list.length) return;
  if (list.length === 1) { go(dueHref(list[0].head)); return; }
  const cur = a.currency;
  const k = await menuSheet({ title: 'Tes versements', items: list.map(x => {
    const r = scheduleById(x.head);
    return { key: x.head, icon: 'arrows-clockwise', label: esc(r?.note || `Depuis ${account(x.from)?.name || '…'}`), note: `${money(x.amount, { cur })} · prochain le ${dayShort(x.date)}` };
  }) });
  if (k) go(dueHref(k));
}

/** La prochaine entrée prévue sur l'épargne, en quelques mots (« Versement de 20 000 F le 2 déc », « Revenu de … »). @param {any} f @param {string} cur */
const inflowLine = (f, cur) => (f ? `${f.kind === 'income' ? 'Revenu' : 'Versement'} de ${money(f.amount, { cur })} ${f.on < today() ? 'à confirmer' : `le ${dayShort(f.on)}`}` : '');

/**
 * Le verdict en tête de la page d'une épargne (D17 revu le 2026-11-20, avec l'utilisateur : « une échéance est une
 * échéance ») : tout ce qui est prévu sur l'épargne tient-il ses réserves datées ? Oui : « Tes échéances suffisent pour
 * tes réserves » (« tes autres réserves » quand l'une, trop proche ou échue, n'est pas prête : sa ligne le dit), et la
 * prochaine entrée prévue ; non : « Tes échéances ne suffisent pas : X de plus par mois » (orange), une flèche. Le toucher ouvre
 * le versement pour l'augmenter (un petit menu s'il y en a plusieurs) ; sans versement, « Programmer le versement »,
 * prérempli au manque, sauf quand rien ne manque. Sans réserve datée, pas de verdict (la ligne Programmer reste).
 * @param {any} a @param {any} rep
 */
function verdictHTML(a, rep) {
  const v = rep.versement, cur = a.currency;
  const short = v.gap !== null && v.gap > 0;
  // le manque (revu le 2026-11-20, avec l'utilisateur : « Il manque X par mois » ne disait ni d'où il venait ni que la
  // ligne se touche) : une seule ligne, le constat puis ce que fait le toucher, une flèche ; sans versement, la même ligne
  // le programme (prérempli au manque), plus de ligne « Programmer » à part
  const program = !v.list.length && v.gap !== 0 && !short ? rowHTML({ cls: 'add-row', attrs: `data-vers-new="${a.id}"`, pill: `<span class="pill">${icon('arrows-clockwise')}</span>`,
    title: 'Programmer le versement', titleCls: 'wrap', sub: 'Un virement chaque mois vers cette épargne', subCls: 'wrap' }) : '';
  if (v.gap === null) return program ? `<div class="group plain rs-vers">${program}</div>` : '';
  if (short) {
    const attr = v.list.length ? `data-vers="${a.id}"` : `data-vers-new="${a.id}"`;
    return `<div class="group rs-vers">${rowHTML({ cls: 'rs-verdict', attrs: attr, pill: `<span class="pill" style="--c:var(--c3)">${icon('warning')}</span>`,
      title: `Tes échéances ne suffisent pas : ${money(v.gap, { cur })} de plus par mois`, titleCls: 'wrap rs-warn',
      sub: v.list.length ? 'Augmenter ton versement' : 'Programmer le versement', subCls: 'wrap', end: `<span class="end">${icon('caret-right')}</span>` })}</div>`;
  }
  // une réserve que le manque ne peut pas aider (trop proche, ou échue) et qui ne sera pas prête : on ne dit pas « tes réserves »
  const behind = rep.reserves.some((/** @type {any} */ x) => ['later', 'short', 'none', 'overdue'].includes(x.status));
  const sub = inflowLine(v.inflow, cur);
  const ok = { cls: 'rs-verdict', pill: `<span class="pill">${icon('check')}</span>`, title: `Tes échéances suffisent pour tes ${behind ? 'autres ' : ''}réserves`,
    titleCls: 'wrap', sub: sub ? esc(sub) : '', subCls: 'wrap' };
  // une flèche quand elle se touche (2026-11-20, avec l'utilisateur : comme la ligne du manque)
  return `<div class="group rs-vers">${v.list.length ? rowHTML({ ...ok, attrs: `data-vers="${a.id}"`, end: `<span class="end">${icon('caret-right')}</span>` })
    : rowHTML({ ...ok, tag: 'div', attrs: 'data-verdict' })}${program}</div>`;
}

/**
 * Lignes de réserves d'un écran (en cours : data-res, terminées : data-res-done) : une ligne, un geste (D0) — la
 * toucher ouvre son petit menu (openReserveMenu). go : la navigation de l'écran (ctx.go) ; sans elle, l'adresse change.
 * atWallet : sur la page de son épargne (pas de « Aller au portefeuille »).
 * @param {HTMLElement} root @param {(o: any) => any} openEntry @param {(hash: string) => any} [go] @param {{ atWallet?: boolean }} [o]
 */
export function wireReserveRows(root, openEntry, go = h => { location.hash = h; }, { atWallet = false } = {}) {
  $$('[data-res], [data-res-done]', root).forEach(b => (b.onclick = () => {
    buzz(6);
    openReserveMenu({ id: b.dataset.res || b.dataset.resDone || '', openEntry, go, atWallet });
  }));
}

export function render(app, ctx) {
  const all = savingsAccounts().filter(a => !a.archived);
  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('w');
  const list = all.filter(a => a.id === (wanted && all.some(x => x.id === wanted) ? wanted : all[0]?.id));

  const walletHTML = a => {
    const r = savingsReport(a.id);
    const cur = a.currency;
    const rows = r.reserves.map(v => reserveRowHTML(v)).join('');
    // sous « Solde », ce qui reste à mettre de côté pour les réserves (2026-11-22, avec l'utilisateur : « 65 000 F / 230 000 F »
    // répétait le solde de droite dès que tout est dans les réserves ; le % seul, l'anneau le montre déjà)
    return sectionHTML({ cls: 'rs-wallet', body: `
      <div class="rs-head">${a.emergency ? monthsRing(accountPill(a), coveredMonths(a)) : goalRing(accountPill(a), r.goal || reservesRing(r))}<div class="main"><div class="t">Solde</div>
        <div class="s wrap">${a.emergency ? monthsLabel(coveredMonths(a)) : r.goal ? (r.goal.need && !r.goal.reached && !r.goal.passed ? `Objectif ${money(r.goal.amount, { cur })} : ` : '') + goalLine(r.goal, cur) : r.reserves.length ? `${r.reserves.length} réserve${r.reserves.length > 1 ? 's' : ''} · ${restHTML(reservesRing(r), cur)}` : '<span class="b-aside">Fixer un objectif</span>'}</div></div>
        <span class="amt">${money(r.balance, { cur })}</span>
        ${a.emergency || r.reserves.length ? '' : `<button type="button" class="iconbtn soft" data-goal="${a.id}" aria-label="Objectif de ${esc(a.name)}">${icon('pencil-simple')}</button>`}</div>
      ${a.emergency ? '' : verdictHTML(a, r)}
      ${a.emergency ? '' : `<div class="group" data-wallet="${a.id}">${rows}
        ${rowHTML({ tag: 'div', cls: 'rs-free', pill: `<span class="pill">${icon('coin')}</span>`, title: 'Épargne libre',
          sub: r.freeMonths !== null && r.free > 0 ? `${String(r.freeMonths).replace('.', ',')} mois de dépenses` : '', end: `<span class="amt${r.free < 0 ? ' loss' : ''}">${money(r.free, { cur })}</span>` })}
      </div>`}
      <div class="group plain rs-acts">${a.emergency ? '' : rowHTML({ cls: 'add-row', attrs: `data-new="${a.id}"`, pill: `<span class="pill">${icon('plus')}</span>`, title: 'Nouvelle réserve' })}
        ${rowHTML({ cls: 'add-row', attrs: `data-aside="${a.id}"`, pill: `<span class="pill">${icon('hand-coins')}</span>`, title: 'Mettre de côté' })}</div>
      ${a.emergency ? '<p class="muted b-note">Pour les coups durs. Il ne compte pas dans ton total et n’a pas de réserves. 3 mois de dépenses suffisent.</p>' : ''}
      ${(() => {
        const done = closedReserves(a.id).slice(0, 12);
        return done.length ? `<details class="rs-done"><summary>Réserves terminées <span class="muted">${done.length}</span></summary>
          <div class="group">${done.map(closedRowHTML).join('')}</div></details>` : '';
      })()}` });
  };

  app.innerHTML = `<div class="screen reserves no-tabs">
    ${topbarHTML({ title: list[0] ? esc(list[0].name) : 'Épargne' })}
    ${list.length ? list.map(walletHTML).join('') : sectionHTML({ body: emptyState('Pas encore de portefeuille d’épargne', { add: ['data-create', 'Créer un portefeuille d’épargne'] }) })}
  </div>`;

  wireBack(app, () => ctx.back('#/mois'));
  const create = $('[data-create]', app);
  if (create) create.onclick = () => { buzz(6); openAccountSheet(null, { savings: true }); };
  $$('[data-goal]', app).forEach(b => (b.onclick = () => { buzz(6); openGoalSheet(b.dataset.goal); }));
  $$('[data-new]', app).forEach(b => (b.onclick = () => { buzz(6); openReserveSheet({ wallet: b.dataset.new, openEntry: ctx.openEntry }); }));
  wireReserveRows(app, ctx.openEntry, ctx.go, { atWallet: true });
  $$('[data-vers-new]', app).forEach(b => (b.onclick = () => { buzz(6); scheduleVersement(b.dataset.versNew || '', ctx.openEntry); }));
  $$('[data-vers]', app).forEach(b => (b.onclick = () => { buzz(6); openVersement(b.dataset.vers || '', ctx.go); }));
  $$('[data-aside]', app).forEach(b => (b.onclick = () => {
    const to = account(b.dataset.aside);
    if (!to) return;
    buzz(6);
    const from = countedAccounts().find(x => !x.savings && x.currency === to.currency);
    ctx.openEntry({ type: 'transfer', accountId: from ? from.id : null, toAccountId: to.id });
  }));
  fitText(app, '.mrow .v', 12);
}

/**
 * Fonds d'urgence (revu le 2026-11-19, avec l'utilisateur) : un genre de portefeuille à part. On regarde seulement
 * combien de mois de dépenses il couvre (la moyenne des 3 derniers mois) : l'anneau se remplit jusqu'à 3 mois, vert
 * au-delà ; pas d'objectif à fixer. null : pas encore de dépenses à couvrir.
 * @param {any} a
 */
export function coveredMonths(a) {
  const spend = monthlySpend();
  return spend > 0 ? Math.floor((savingsReport(a.id).balance * 10) / spend) / 10 : null;
}
/** L'anneau des mois couverts autour de la pastille. @param {string} pill @param {number|null} m */
export const monthsRing = (pill, m) => goalRing(pill, { pct: m === null ? 0 : Math.max(0, Math.min(100, Math.round((m * 100) / 3))), label: '3 mois de dépenses' });
/** @param {number|null} m */
export const monthsLabel = m => (m === null ? 'Pas encore de dépenses à couvrir' : `${String(Math.max(0, m)).replace('.', ',')} mois de dépenses couverts`);

/** Objectif d'un portefeuille d'épargne : montant et date facultative ; indicatif, ne bloque rien. @param {string} walletId */
export function openGoalSheet(walletId) {
  const a = account(walletId);
  if (!a) return;
  const cur = a.currency;
  const spend = monthlySpend();
  const f = { amount: a.goal ? a.goal.amount : 0, on: a.goal ? a.goal.on : null, emergency: !!a.emergency };
  const dec = currencyOf(cur).dec;
  const s = openSheet(`<div class="acc-sheet">
    ${sheetHead({ title: `Objectif · ${esc(a.name)}` })}
    <p class="muted rs-say">Il ne bloque rien : il te montre où tu en es.</p>
    ${fieldHTML({ label: `Montant visé (${symbol(cur)})`, control: `<input data-amt inputmode="decimal" placeholder="0" autocomplete="off" value="${f.amount ? f.amount / 10 ** dec : ''}">` })}
    ${fieldHTML({ label: 'Date (facultative)', control: `<button type="button" class="field-btn" data-on><b data-onl></b>${icon('calendar-blank')}</button>` })}
    <div data-err></div>
    ${sheetActions(`<button class="btn primary" data-save>${icon('check')}Enregistrer</button>
      ${a.goal ? `<button class="btn ghost" data-clear>Retirer l’objectif</button>` : ''}`)}
  </div>`, { label: 'Objectif' });
  const el = s.el, amt = /** @type {HTMLInputElement} */ ($('[data-amt]', el)), errEl = $('[data-err]', el);
  const paint = () => {
    $('[data-onl]', el).textContent = f.on ? yearDate(f.on) : 'Sans date';
  };
  paint();
  $('[data-on]', el).onclick = async () => {
    const d = await pickDate({ current: f.on || today(), future: true, min: today(), title: 'Date de l’objectif' });
    if (d) { f.on = d; paint(); }
  };
  $('[data-save]', el).onclick = async () => {
    errEl.innerHTML = '';
    const v = readAmount(amt.value, cur);
    if (v.error || (amt.value.trim() && /** @type {number} */ (v.amount) <= 0)) { errEl.innerHTML = noticeHTML(esc(v.error || 'Ce montant n’est pas lisible.')); buzz(14); return; }
    const changes = { goal: v.amount ? { amount: v.amount, on: f.on } : null };
    const ok = await updateAccount(a.id, changes);
    if (ok) { buzz(12); s.close(); toast('Objectif enregistré'); }
  };
  const clear = $('[data-clear]', el);
  if (clear) clear.onclick = async () => { if (await updateAccount(a.id, { goal: null })) { buzz(8); s.close(); } };
}

/** Les fois d'avant d'une réserve (reconduites l'une de l'autre) ; self : elle comprise. @param {string} id @param {boolean} [self] */
function historyHTML(id, self = false) {
  if (!id) return '';
  const chain = reserveChain(id).filter(x => (self || x.id !== id) && x.closed);
  if (!chain.length) return '';
  return `<div class="rs-hist"><span class="eyebrow">Les fois d’avant</span><div class="group plain">${chain.reverse().map(x => rowHTML({ tag: 'div',
    title: `${esc(x.name)} · ${money(x.amount, { cur: x.currency })}`, sub: closedLine(x) })).join('')}</div></div>`;
}

/**
 * Feuille d'une réserve terminée, ouverte depuis la fiche d'une opération qui l'a utilisée (ses lignes ouvrent son petit
 * menu) : ce qu'elle est devenue (utilisée, close, opération supprimée depuis), les fois d'avant, « Reconduire » (sauf si
 * elle l'a déjà été). Rien ne la rouvre.
 * @param {any} r @param {(o: any) => any} openEntry
 */
function openClosedSheet(r, openEntry) {
  const again = reserveReconducted(r.id);
  const s = openSheet(`<div class="acc-sheet rs-sheet">
    ${sheetHead({ title: esc(r.name) })}
    <p class="rs-say"><b>${money(r.amount, { cur: r.currency })}</b> visés · ${r.mode === 'once' ? 'en une fois' : 'en plusieurs fois'} · échéance le ${yearDate(r.due)}<br><span class="muted">${closedLine(r)}</span></p>
    ${historyHTML(r.id)}
    ${sheetActions(again ? '<p class="muted">Déjà reconduite.</p>' : `<button class="btn primary" data-again>${icon('arrow-counter-clockwise')}Reconduire</button>`)}
  </div>`, { label: 'Réserve terminée' });
  const b = $('[data-again]', s.el);
  if (b) b.onclick = () => { buzz(8); s.close(); afterSheets(() => openReserveSheet({ from: r.id, openEntry })); };
}

/**
 * Feuille d'une réserve : créer (wallet, ou from : reconduire une réserve terminée, préremplie et reliée à elle) ou
 * modifier (id). Ses champs seuls : portefeuille, nom, montant visé, échéance, paiement (en une fois ou en plusieurs
 * fois), catégorie de la dépense, puis Enregistrer ; une réserve existante rappelle aussi ce qui est mis de côté et les
 * fois d'avant. Ce qu'on fait d'elle est dans son petit menu (openReserveMenu) ; Clore est aussi en bas de cette feuille.
 * Une réserve terminée s'ouvre en lecture (openClosedSheet).
 * onSaved : appelé après un enregistrement.
 * @param {{ id?: string|null, wallet?: string|null, from?: string|null, openEntry: (o: any) => any, onSaved?: (() => void)|null }} o
 */
export function openReserveSheet({ id = null, wallet = null, from = null, openEntry, onSaved = null }) {
  const r = id ? reserveById(id) : null;
  if (r && r.closed) return openClosedSheet(r, openEntry);
  const prev = from ? reserveById(from) : null;
  const choices = savingsAccounts().filter(x => !x.archived && !x.emergency);
  let walletId = r ? r.wallet : prev ? prev.wallet : wallet || choices[0]?.id;
  const a = walletId ? account(walletId) : null;
  if (!a) {
    toast(savingsAccounts().some(x => !x.archived) ? 'Le fonds d’urgence n’a pas de réserves. Crée une autre épargne pour elles.' : 'Crée d’abord un portefeuille d’épargne.');
    return;
  }
  const canMove = !r && !prev && !wallet && choices.length > 1;
  const cur = a.currency, dec = currencyOf(cur).dec;
  const view = r ? savingsReport(walletId).reserves.find(v => v.reserve.id === r.id) : null;
  // reconduire : même nom, montant et utilisation ; l'échéance garde la durée d'avant, à partir d'aujourd'hui
  const prevDue = prev ? addDays(today(), Math.max(1, daysBetween(prev.start, prev.due))) : null;
  const src = r || prev;
  const f = { name: src?.name || '', amount: src?.amount || 0, due: r?.due || prevDue || addMonths(today(), 3), mode: src?.mode || 'once', category: src?.category || null };
  const s = openSheet(`<div class="acc-sheet rs-sheet">
    ${sheetHead({ title: r ? esc(r.name) : prev ? 'Reconduire la réserve' : 'Nouvelle réserve' })}
    ${view ? `<p class="rs-say"><b>${money(view.saved, { cur })}</b> sur ${money(view.target, { cur })}${r.used ? ` · ${money(r.used, { cur })} déjà utilisés` : ''}<br><span class="muted">${reserveLine(view)}</span>${reserveDeletedUses(r).length ? `<br><span class="muted">${reserveDeletedUses(r).length > 1 ? 'Des opérations faites avec elle ont été supprimées' : 'Une opération faite avec elle a été supprimée'} : son argent est revenu dans la réserve.</span>` : ''}</p>` : '<p class="muted rs-say">De l’argent mis de côté pour une dépense à venir.</p>'}
    ${fieldHTML({ label: 'Portefeuille d’épargne', control: `<button type="button" class="field-btn" data-wal${canMove ? '' : ' aria-disabled="true"'}><b data-wall></b>${canMove ? icon('caret-down') : ''}</button>` })}
    ${fieldHTML({ label: 'Nom', control: `<input data-name maxlength="28" value="${esc(f.name)}" placeholder="Ex. Assurance, Rentrée, Téléphone" autocomplete="off">` })}
    ${fieldHTML({ label: `Montant visé (${symbol(cur)})`, control: `<input data-amt inputmode="decimal" placeholder="0" autocomplete="off" value="${f.amount ? f.amount / 10 ** dec : ''}">` })}
    ${fieldHTML({ label: 'Échéance', control: `<button type="button" class="field-btn" data-due><b data-duel></b>${icon('calendar-blank')}</button>` })}
    ${fieldHTML({ label: 'Paiement', control: seg([['once', 'En une fois'], ['gradual', 'En plusieurs fois']], f.mode, 'rs-use') })}
    ${fieldHTML({ label: 'Catégorie de la dépense', control: `<button type="button" class="field-btn" data-cat><b data-catl></b>${icon('caret-right')}</button>`,
      note: 'Quand tu l’utilises, la dépense va dans cette catégorie.' })}
    <div data-err></div>
    ${r ? historyHTML(r.id) : prev ? historyHTML(prev.id, true) : ''}
    ${sheetActions(`<button class="btn primary" data-save>${icon('check')}${r ? 'Enregistrer' : 'Créer la réserve'}</button>
      ${r ? `<button type="button" class="btn ghost" data-closeres>${icon('x-circle')}Clore la réserve</button>` : ''}`)}
  </div>`, { label: 'Réserve' });
  const el = s.el, errEl = $('[data-err]', el), nameIn = /** @type {HTMLInputElement} */ ($('[data-name]', el)), amtIn = /** @type {HTMLInputElement} */ ($('[data-amt]', el));
  const showErr = msg => { errEl.innerHTML = noticeHTML(esc(msg)); buzz(14); };
  const paint = () => {
    $('[data-duel]', el).textContent = yearDate(f.due);
    const cl = f.category ? category(f.category)?.name || '' : ''; // le nom seul (unique, D13), comme partout
    $('[data-catl]', el).textContent = cl || 'Choisir';
    const wl = $('[data-wall]', el);
    if (wl) wl.textContent = account(walletId)?.name || '';
  };
  paint();
  amtIn.oninput = () => { errEl.innerHTML = ''; paint(); };
  const wal = $('[data-wal]', el);
  if (wal && canMove) wal.onclick = () => {
    const sh = openSheet(`${sheetHead({ title: 'Portefeuille d’épargne' })}<div class="group plain">${choices.map(x => rowHTML({ attrs: `data-w="${x.id}"`, pill: accountPill(x),
      title: esc(x.name), end: x.id === walletId ? icon('check') : '' })).join('')}</div>`, { label: 'Portefeuille d’épargne' });
    $$('[data-w]', sh.el).forEach(b => (b.onclick = () => { walletId = /** @type {HTMLElement} */ (b).dataset.w || walletId; buzz(6); sh.close(); paint(); }));
  };
  wireSeg($('.rs-use', el), v => { f.mode = v; paint(); });
  $('[data-cat]', el).onclick = async () => {
    const c = await pickCategory({ type: 'expense', current: f.category, title: 'Catégorie de la dépense' });
    if (c && c !== '*') { f.category = c; paint(); }
  };
  $('[data-due]', el).onclick = async () => {
    const d = await pickDate({ current: f.due, future: true, min: today(), title: 'Échéance' });
    if (d) { f.due = d; paint(); }
  };

  // Clore (2026-11-19 : sorti du menu, sauf échue) : en bas de sa feuille, après confirmation
  const closeBtn = $('[data-closeres]', el);
  if (closeBtn && r) closeBtn.onclick = () => { buzz(8); closeReserveAsk(r, () => s.close()); };
  $('[data-save]', el).onclick = async () => {
    errEl.innerHTML = '';
    const { amount, error } = readAmount(amtIn.value, cur);
    if (amount === undefined) return showErr(error);
    if (!f.category) return showErr('Choisis la catégorie de la dépense.');
    const data = { name: nameIn.value, amount, due: f.due, mode: f.mode, category: f.category };
    if (!r) {
      // la première réserve d'une épargne qui a un objectif le retire (2026-11-20, avec l'utilisateur) : on prévient, sans
      // quitter le formulaire ; l'épargne suit ensuite ses réserves
      const w = account(walletId);
      let dropGoal = false;
      if (w?.goal && !openReserves(walletId).length) {
        const yes = await confirmSheet({ title: `${esc(w.name)} a un objectif`, text: `Son objectif de ${money(w.goal.amount, { cur: w.currency })}${w.goal.on ? ` pour le ${yearDate(w.goal.on)}` : ''} sera retiré : l’épargne suivra tes réserves.`, yes: 'Créer la réserve' });
        if (!yes) return;
        dropGoal = true;
      }
      const ok = await createReserve({ wallet: walletId, ...data, ...(prev ? { from: prev.id } : {}), ...(dropGoal ? { dropGoal: true } : {}) }, { onError: showErr });
      if (!ok) return;
      buzz(12); s.close(); toast(prev ? 'Réserve reconduite' : 'Réserve créée');
      return;
    }
    /** @type {Record<string, any>} */
    const changes = { ...data };
    const ok = await updateReserve(r.id, changes, { onError: showErr });
    if (!ok) return;
    buzz(12); s.close(); toast('Réserve enregistrée');
    if (onSaved) afterSheets(onSaved);
  };
}

