// Épargne (D17, ROADMAP 4a) : la page d'UN portefeuille d'épargne (route #/epargne?w=<id>, ouverte depuis la section
// Épargne de Plan ; sans w, le premier). Pour ce portefeuille : solde et sa barre, objectif (indicatif : où on en est, ce
// qu'il faut par mois), le verdict (D17 revu le 2026-11-20 : tout ce qui est prévu sur l'épargne tient-il ses réserves, sinon ce
// qui manque par mois ; le toucher montre ses versements et « Ajouter un versement régulier »), réserves (barre, et si
// elle sera prête), épargne libre (aussi en mois de dépenses ; seulement avec des dépenses prévues, et non nulle),
// « Nouvelle réserve » et « Mettre de côté » (maintenant, ou plus tard : une fois ou chaque mois) côte à côte, « Réserves
// terminées » (historique). Pas de pastille (2026-11-26) : seules les catégories gardent leur icône. Pas de page à part (2026-11-25) : modifier une
// réserve recalcule le verdict sur place. Une
// ligne, un geste (D0) : toucher une réserve ouvre son petit menu (selon son état : openReserveMenu) ; sa feuille ne
// garde que ses champs. Tout est une lecture ; les écritures passent par le magasin (commandes reserve.*, due.* et
// wallet.update).
import {
  account, savingsAccounts, savingsReport, emergencyAccount, monthlySpend, reserveById, createReserve,
  updateReserve, closeReserve, updateAccount, countedAccounts, pref, closedReserves, reserveChain,
  reserveReconducted, reserveDeletedUses, reserveUses, category, settings, accounts, scheduleById, openReserves, shortfallWith, accountTxCount,
} from '../core/store.js';
import { openDueSheet, dueHref, dayShort } from './due-page.js';
import { money, esc, yearDate, today, currencyOf, approx, approxUp, period } from '../core/format.js';
import { icon, catIcon } from '../core/icons.js';
import { openSheet, buzz, toast, switchHTML, noticeHTML, confirmSheet, menuSheet, afterSheets, fitText, keypad, exprHTML, exprCharsHTML, shake, reducedMotion, $, $$ } from '../core/ui.js';
import { accountPill, pickDate, pickCategory } from './pickers.js';
import { editNote } from './entry/sheets.js';
import { openAccountSheet } from './accounts.js';
import { opsHref } from './transactions.js';
import { openOperation } from './history.js';
import { RES } from '../domain/words.js';
import { daysBetween, reconductDue } from '../domain/reserves.js';
import { amountSheet, tapCaret } from './amount-sheet.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML, sheetHead, sheetActions, emptyState } from './parts.js';

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

/**
 * La date d'une dépense prévue dans une liste (2026-11-25, avec l'utilisateur) : jj/mm/aa, une colonne de même largeur ;
 * sans date : rien (ni « En pause » ni tirets : elle n'a pas de date, tout court). @param {string|null|undefined} d
 */
export const numDate = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '');

/**
 * Ce que dit une réserve, en quelques mots (D17 revu le 2026-11-20, avec l'utilisateur : elle dit seulement si elle sera
 * prête, d'après la simulation de ce qui est prévu) : « Remplie » ; échue, en rouge ; prête à temps, rien ; « Prête
 * 6 mois trop tard » quand ce qui est prévu la remplit après sa date, « Il manquera X » quand ça ne suffit jamais, « Rien
 * de prévu », en orange ; sans date, rien (2026-11-26, avec l'utilisateur : ce n'est pas un souci). @param {any} v
 */
export function statusHTML(v) {
  const r = v.reserve, cur = r.currency;
  // remplie (2026-11-25, avec l'utilisateur : pousser à l'accomplissement, comme une opération programmée) : le jour J, à
  // utiliser (orange) ; sa date passée sans être utilisée, en retard (rouge : c'est déjà arrivé)
  if (v.full) return v.overdue ? `<span class="loss">À utiliser depuis le ${numDate(r.due)}</span>` : v.day ? '<span class="rs-warn">À utiliser aujourd’hui</span>' : 'Remplie';
  // sans date : rien à dire sur la ligne (2026-11-26, avec l'utilisateur), sa feuille dit que c'est un souhait
  if (v.status === 'paused') return '';
  if (v.status === 'overdue') return `<span class="loss">Date passée : ${dayShort(r.due)}</span>`;
  if (v.status === 'later') return `<span class="rs-warn">Prête ${lateBy(r.due, v.ready)} trop tard</span>`;
  if (v.status === 'short') return `<span class="rs-warn">Il manquera ${money(approx(v.short, cur), { cur })}</span>`;
  if (v.status === 'none') return '<span class="rs-warn">Rien de prévu</span>';
  return '';
}
/**
 * Les couleurs d'une dépense prévue (2026-11-25, avec l'utilisateur : un sens fixe, partout) : rouge = c'est déjà arrivé
 * (date passée sans être remplie) ; orange = ça va arriver si rien ne change (pas prête à temps : rien de prévu, prête trop
 * tard, il manquera) ; rien = à temps. Son épargne prend la plus grave (Plan, sa carte). @param {any} v
 * @returns {'loss'|'warn'|''}
 */
export const resTone = v => (v.status === 'overdue' || (v.full && v.overdue) ? 'loss'
  : v.status === 'none' || v.status === 'later' || v.status === 'short' || (v.full && v.day) ? 'warn' : '');
/** La barre d'une réserve prend la couleur de ce qu'elle dit (rouge, orange). @param {any} v */
export const barTone = v => ({ loss: ' over', warn: ' warn', '': '' })[resTone(v)];
/**
 * La couleur d'une épargne (2026-11-25, avec l'utilisateur) : la plus grave de ses dépenses prévues — rouge si l'une a sa
 * date passée, orange si l'une ne sera pas prête à temps ou s'il manque aux versements. @param {any} rep @returns {'loss'|'warn'|''}
 */
export const savTone = rep => {
  const t = rep.reserves.map(resTone);
  return t.includes('loss') ? 'loss' : t.includes('warn') || rep.versement?.gap > 0 ? 'warn' : '';
};

/** « Prête à temps » (sa date est dans le champ Échéance, juste dessous) ; ce qu'une réserve dit d'elle dans sa feuille. @param {any} v */
function reserveLine(v) {
  const r = v.reserve;
  if (v.status === 'overdue') return statusHTML(v);
  if (v.status === 'paused') return 'Pas de date, c’est un souhait.'; // court (2026-11-26, avec l'utilisateur : la suite n'apprenait rien)
  // en retard : « Prête le 2 févr 2028, 6 mois trop tard » (son échéance est dans le champ dessous)
  if (v.status === 'later') return `<span class="rs-warn">Prête le ${yearDate(v.ready)}, ${lateBy(r.due, v.ready)} trop tard</span>`;
  return `${v.status === 'ok' ? 'Prête à temps' : statusHTML(v)}${v.overdue && !v.full ? ` · date passée : ${yearDate(r.due)}` : ''}`;
}

/**
 * Ligne d'une réserve terminée, sans pastille (2026-11-26, avec l'utilisateur : « Utilisée le … » le dit déjà) : la toucher
 * ouvre son petit menu (ses opérations, Reconduire, son portefeuille). @param {any} x
 */
export const closedRowHTML = x => rowHTML({ attrs: `data-res-done="${x.id}"`,
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
  // ce qu'il faut faire d'abord (le pourcentage est dans la barre, ou l'anneau autour de l'icône dans Plan)
  return g.need ? `${money(approxUp(g.need, cur), { cur })} par mois jusqu’au ${yearDate(g.on)}` : `Objectif ${money(g.amount, { cur })}`;
}
/**
 * Où en est une épargne à réserves (l'anneau de sa ligne dans Plan, la barre de sa carte et de sa page) : calculé, ce qui
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
/** Anneau fin autour de l'icône du portefeuille (sa ligne dans Plan) : où en est l'objectif. @param {string} pill @param {any} g */
export const goalRing = (pill, g) => (g ? `<span class="goal-ring${g.pct >= 100 ? ' done' : ''}" style="--p:${Math.min(100, g.pct)}" role="img" aria-label="${g.label || 'Objectif'} : ${Math.min(100, g.pct)} %">${pill}</span>` : pill);

/** Des mots qui ne se coupent pas (un montant, une date) : leurs espaces deviennent insécables. @param {string} t */
const nb = t => t.replace(/ /g, '\u00A0');

/**
 * Ligne d'une réserve ouverte (2026-11-26, avec l'utilisateur : moins d'icônes, plus d'information), de haut en bas : l'icône
 * de sa catégorie, nue (sa teinte, sans pastille), et son nom sur toute la largeur — rien à sa droite ; la barre de ce qui
 * est de côté (sans repère, D17 revu le 2026-11-20 : la plus proche servie d'abord, une réserve lointaine peut être à 0 %
 * alors que le plan est tenu ; blanche à temps, orange ou rouge comme ce qu'elle dit) ; « 18 000 F sur 30 000 F · 20 déc
 * 2026 », qui ne se coupe qu'à « · » ; dessous, ce qu'elle dit (statusHTML) seulement quand il y a quelque chose à dire
 * (un souci, « Remplie », sans date). Pas le nom de son portefeuille (2026-11-22 : son menu y mène). Toujours touchable.
 * @param {any} v vue de la réserve (savingsReport)
 */
export function reserveRowHTML(v) {
  const rv = v.reserve, cur = rv.currency;
  const cat = rv.category ? category(rv.category) : null;
  const level = nb(`${money(v.saved, { cur })} sur ${money(v.target, { cur })}${rv.due ? ' ·' : ''}`) + (rv.due ? ` ${nb(yearDate(rv.due))}` : '');
  const stage = statusHTML(v);
  return `<div class="row mrow rs-row"><button type="button" class="mrow-go" data-res="${rv.id}">
    <span class="rs-cat" style="--c:var(--${cat?.color || 'c0'})">${catIcon(cat ? cat.icon : 'dots-three')}</span>
    <span class="main"><span class="l1"><span class="t">${esc(rv.name)}</span></span>
      <span class="bar rs-bar${barTone(v)}"><i style="width:${v.pct}%"></i></span>
      <span class="l2"><span class="s">${level}</span></span>
      ${stage ? `<span class="l3 rs-stage">${stage}</span>` : ''}</span></button></div>`;
}

/**
 * Utiliser une réserve (D17 ; revu le 2026-11-19 : chacun fait ce qu'il veut de son argent) : la dépense s'ouvre,
 * remplie. En plusieurs fois : toujours, quel que soit ce qui est de côté pour elle. En une fois : seulement si
 * l'épargne a de quoi la payer entièrement ; sinon on dit ce qui manque. Quand la dépense la ferme (en une fois, ou
 * tout utilisé), « Reconduire … pour le … ? » (offerReconduct).
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
  // une fois la saisie redescendue (comme la feuille après un revenu)
  const onSaved = () => { if (reserveById(id)?.closed) setTimeout(() => afterSheets(() => offerReconduct(id, openEntry)), reducedMotion() ? 0 : 840); };
  openEntry({ type: 'expense', reserveId: r.id, onSaved, copy: { type: 'expense', amount: r.mode === 'once' ? v.target : 0, accountId: r.wallet, categoryId: r.category || null } });
}

/**
 * Utilisée et fermée (2026-11-25, avec l'utilisateur : pas de répétition automatique) : « Reconduire … ? », un toucher —
 * même nom, même montant, même catégorie, à la date de la fois suivante (reconductDue : par son rythme s'il en a un,
 * sinon la même durée qu'avant). Une épargne qui a un objectif passe par la feuille Reconduire (elle prévient).
 * @param {string} id @param {(o: any) => any} openEntry
 */
async function offerReconduct(id, openEntry) {
  const r = reserveById(id);
  if (!r || !r.closed || reserveReconducted(r.id)) return;
  const w = account(r.wallet);
  if (!w || w.archived) return;
  const due = reconductDue(r, today());
  const cur = r.currency;
  const yes = await confirmSheet({ title: `Reconduire ${esc(r.name)} pour le ${esc(dayShort(due))} ?`,
    text: `${money(r.amount, { cur })} à mettre de côté sur ${esc(w.name)}${r.every ? ', la fois suivante' : ''}. Tu pourras ${RES.her} modifier.`,
    yes: `Reconduire pour le ${esc(dayShort(due))}`, cancel: 'Non, merci' });
  if (!yes) return;
  if (w.goal && !openReserves(w.id).length) { afterSheets(() => openReserveSheet({ from: r.id, openEntry })); return; }
  const made = await createReserve({ wallet: w.id, name: r.name, amount: r.amount, due, mode: r.mode, category: r.category, from: r.id });
  if (made) { buzz(12); toast(`${RES.One} reconduit${RES.e} pour le ${dayShort(due)}`); }
}

/**
 * Clore une réserve, après confirmation : ce qui est dessus retourne aux autres. onClosed : après (refermer sa feuille).
 * @param {any} r @param {() => void} [onClosed]
 */
export async function closeReserveAsk(r, onClosed = () => {}) {
  // rien payé encore : elle est abandonnée, hors des terminées (D17 revu : la vitrine de ce que l'app a aidé à financer)
  const give = !r.used;
  const yes = await confirmSheet(give
    ? { title: `Abandonner ${esc(r.name)} ?`, text: `Son argent va aux autres ${RES.many} ou à l’épargne libre. ${RES.She} n’ira pas dans les ${RES.many} terminé${RES.e}s.`, yes: 'Abandonner' }
    : { title: `Clore ${esc(r.name)} ?`, text: `Son argent va aux autres ${RES.many} ou à l’épargne libre. Tu pourras ${RES.her} reconduire depuis « ${RES.Many} terminé${RES.e}s ».`, yes: 'Clore' });
  if (!yes) return;
  afterSheets(async () => { if (await closeReserve(r.id)) { onClosed(); toast(give ? `${RES.One} abandonné${RES.e}` : `${RES.One} ${RES.adj('clos', 'close')}`); } });
}

/** Le Journal filtré sur une réserve, sur la période de ses utilisations (du mois de la première à celui de la dernière). @param {any} r */
export function reserveOpsHref(r) {
  const u = reserveUses(r);
  if (!u.length) return opsHref({ res: r.id });
  const ms = settings().monthStart;
  return opsHref({ res: r.id, from: period(u[0].date, ms).start, to: period(u[u.length - 1].date, ms).end });
}

/**
 * Le menu d'une dépense prévue (2026-11-25, avec l'utilisateur : un seul menu, le même d'où qu'on y arrive — Plan, page
 * de l'épargne, cloche, fiche d'une opération, page d'une opération programmée). En cours : Utiliser, Modifier (montant,
 * date ou « Sans date » = en pause, nom, catégorie ; Abandonner ou Clore au bas de sa feuille), Voir l'épargne, Voir les
 * opérations. Terminée : Reconduire (si elle ne l'a pas été), Voir l'épargne, Voir les opérations. Repousser, Réduire,
 * Mettre en pause, Reprendre sont des modifications. Toujours montré, même d'une seule ligne (pas de saut d'office).
 * Voir l'épargne, seulement hors de sa page (atWallet).
 * fromTx : ouvert depuis la fiche de cette opération (elle n'est pas reproposée).
 * @param {{ id: string, openEntry: (o: any) => any, go: (hash: string) => any, atWallet?: boolean, fromTx?: string|null }} o
 */
export async function openReserveMenu({ id, openEntry, go, atWallet = false, fromTx = null }) {
  const r = reserveById(id);
  if (!r) return;
  const cur = r.currency;
  const rep = r.closed ? null : savingsReport(r.wallet);
  const view = rep ? rep.reserves.find(v => v.reserve.id === r.id) || null : null;
  const uses = reserveUses(r).filter(u => u.id !== fromTx);
  const wallet = account(r.wallet);
  /** @type {{ key: string, icon: string, label: string, note?: string, off?: boolean }[]} */
  const items = [];
  if (rep) {
    // Utiliser : en une fois, l'épargne doit pouvoir la payer entièrement (sinon la ligne dit ce qui manque) ; en plusieurs fois, toujours
    const need = view ? view.target : r.amount - r.used;
    const short = r.mode === 'once' && rep.balance < need;
    // pas assez pour la payer en une fois : Utiliser s'éteint, sa ligne dit pourquoi (2026-11-27, avec l'utilisateur : plus de message après coup)
    items.push({ key: 'use', icon: 'arrow-right', label: 'Utiliser', off: short, note: short
      ? `Il faut ${money(need, { cur })}, il y a ${money(Math.max(0, rep.balance), { cur })} sur ${esc(wallet?.name || 'l’épargne')}`
      : r.mode === 'once' ? `Tu notes la dépense de ${money(need, { cur })}, puis ${RES.the} se ferme` : 'Une partie maintenant, le reste plus tard' });
    items.push({ key: 'edit', icon: 'pencil-simple', label: 'Modifier', note: 'Montant, date ou sans date, nom, catégorie' });
  }
  if (r.closed && !reserveReconducted(r.id)) items.push({ key: 'again', icon: 'arrows-clockwise', label: 'Reconduire', note: `Même nom, même montant, pour le ${dayShort(reconductDue(r, today()))}` });
  if (wallet && !atWallet) items.push({ key: 'wallet', icon: 'piggy-bank', label: 'Voir l’épargne', note: esc(wallet.name) });
  if (uses.length === 1) items.push({ key: 'op', icon: 'receipt', label: 'Voir l’opération', note: `Le ${yearDate(uses[0].date)}` });
  else if (uses.length > 1) items.push({ key: 'ops', icon: 'list-bullets', label: 'Voir les opérations', note: `${uses.length} dépenses` });
  if (!items.length) return;
  const k = await menuSheet({ title: esc(r.name), items });
  if (k === 'use') afterSheets(() => useReserve(r.id, openEntry));
  else if (k === 'edit') afterSheets(() => openReserveSheet({ id: r.id, openEntry }));
  else if (k === 'again') afterSheets(() => openReserveSheet({ from: r.id, openEntry }));
  else if (k === 'op') afterSheets(() => openOperation(uses[0].id));
  else if (k === 'ops') go(reserveOpsHref(r));
  else if (k === 'wallet') go(`#/epargne?w=${encodeURIComponent(r.wallet)}`);
}

/** Le portefeuille courant d'où part le versement : le premier compté dans le total, de la devise de l'épargne. @param {any} a */
export const versementFrom = a => (countedAccounts().find(x => !x.savings && x.currency === a.currency)
  || accounts().find(x => !x.savings && !x.archived && x.currency === a.currency))?.id || null;

/**
 * Ajouter un versement régulier à une épargne (D17 revu le 2026-11-20 ; 2026-11-25, avec l'utilisateur : depuis la ligne
 * de ses versements ou Mettre de côté › Plus tard, jamais d'office) : la saisie ouverte pour programmer, préremplie (2026-11-26,
 * une seule feuille : sa phrase dit ce qui sera fait, « Quand ? » change le rythme) —
 * un virement du portefeuille courant vers l'épargne, chaque mois, à la prochaine date de début de période (réglage), du
 * manque (ce qu'il faudrait verser en plus de ce qui est prévu ; 0 sans manque) ; tout se change. On peut en avoir
 * plusieurs. Aucune réserve n'y est liée : le versement confirmé se répartit, la plus proche d'abord.
 * @param {string} walletId @param {(o: any) => any} openEntry
 */
function addVersement(walletId, openEntry) {
  const a = account(walletId);
  if (!a) return;
  const v = savingsReport(walletId).versement;
  openDueSheet({
    preset: {
      kind: 'transfer', amount: v.gap && v.gap > 0 ? v.gap : 0, accountId: versementFrom(a), toAccountId: a.id, note: `Versement ${a.name}`.slice(0, 40),
      start: v.next, every: 'month', interval: 1,
    },
    openEntry,
  });
}


/**
 * « Mettre de côté » (2026-11-25, avec l'utilisateur : une seule porte, Mettre de côté et les versements) : deux choix
 * (2026-11-26 : « Une fois plus tard » et « Chaque mois » ouvraient la même feuille, un doublon) — Maintenant (la saisie,
 * en virement vers l'épargne) ; Plus tard (la feuille d'une opération programmée, un virement vers l'épargne, chaque mois
 * et prérempli avec ce qui manque ; « Quand ? » la change en une seule fois). Toujours montré.
 * @param {string} walletId @param {(o: any) => any} openEntry
 */
export async function openAsideMenu(walletId, openEntry) {
  const a = account(walletId);
  if (!a) return;
  // une seule porte (2026-11-27, avec l'utilisateur : Maintenant et Plus tard ouvraient la même saisie) : un virement vers
  // l'épargne, passé, aujourd'hui ou à venir (la date décide) ; prérempli avec ce qui manque par mois, s'il manque quelque chose
  const gap = a.emergency ? null : savingsReport(walletId).versement.gap;
  openEntry({ type: 'transfer', accountId: versementFrom(a), toAccountId: a.id, amount: gap && gap > 0 ? gap : 0, aside: true });
}

/**
 * Les versements d'une épargne (la ligne d'état touchée, 2026-11-25, avec l'utilisateur : toujours la liste, même d'un
 * seul) : chacun ouvre sa page (pour le modifier ou l'arrêter), puis « Ajouter un versement régulier », prérempli avec ce
 * qui manque. @param {string} walletId @param {(h: string) => any} go @param {(o: any) => any} openEntry
 */
async function openVersements(walletId, go, openEntry) {
  const a = account(walletId);
  if (!a) return;
  const v = savingsReport(walletId).versement;
  const cur = a.currency;
  const k = await menuSheet({ title: v.list.length > 1 ? 'Tes versements' : v.list.length ? 'Ton versement' : 'Pas encore de versement', items: [
    ...v.list.map(x => {
      const r = scheduleById(x.head);
      return { key: x.head, icon: 'arrows-clockwise', label: esc(r?.note || `Depuis ${account(x.from)?.name || '…'}`), note: `${money(x.amount, { cur })} · prochain le ${dayShort(x.date)}` };
    }),
    { key: '+', icon: 'plus', label: 'Ajouter un versement régulier', note: v.gap && v.gap > 0 ? `${money(v.gap, { cur })} par mois : ce qui manque` : 'Un virement chaque mois vers cette épargne' },
  ] });
  if (k === '+') afterSheets(() => addVersement(a.id, openEntry));
  else if (k) go(dueHref(k));
}

/** La prochaine entrée prévue sur l'épargne, en quelques mots (« Versement de 20 000 F le 2 déc », « Revenu de … »). @param {any} f @param {string} cur */
const inflowLine = (f, cur) => (f ? `${f.kind === 'income' ? 'Revenu' : 'Versement'} de ${money(f.amount, { cur })} ${f.on < today() ? 'à confirmer' : `le ${dayShort(f.on)}`}` : '');

/**
 * Ce qui manque aux versements, en une phrase (le même mot partout : la ligne d'état, Plan, la carte ; 2026-11-25) :
 * sans aucun versement « Aucun versement : il faut X par mois », sinon « Tes versements ne suffisent pas : X de plus par
 * mois ». short : la forme courte de Plan et des cartes (« Il manque X par mois »). @param {any} v versement @param {string} cur
 */
export const gapText = (v, cur, short = false) => (!v.list.length ? `Aucun versement : il faut ${money(v.gap, { cur })} par mois`
  : short ? `Il manque ${money(v.gap, { cur })} par mois` : `Tes versements ne suffisent pas : ${money(v.gap, { cur })} de plus par mois`);

/**
 * La ligne d'état en tête de la page d'une épargne (D17 revu le 2026-11-20 ; 2026-11-25, avec l'utilisateur) : tout ce
 * qui est prévu sur l'épargne tient-il ses réserves datées ? Oui : « Tes versements suffisent pour tes réserves » (« tes
 * autres réserves » quand l'une, trop proche ou échue, n'est pas prête : sa ligne le dit), et la prochaine entrée prévue ;
 * non : « Tes versements ne suffisent pas : X de plus par mois » (orange). Sans réserve datée, pas de verdict : la ligne
 * dit seulement ses versements, s'il y en a. Une phrase, sans pastille (2026-11-26). Elle se touche toujours (une flèche) : la liste de ses versements et
 * « Ajouter un versement régulier » (openVersements). Rien ne s'ouvre de lui-même.
 * @param {any} a @param {any} rep
 */
function verdictHTML(a, rep) {
  const v = rep.versement, cur = a.currency;
  const n = v.list.length;
  const count = n ? `${n > 1 ? `${n} versements` : '1 versement'} de ${money(v.list.reduce((t, x) => t + x.amount, 0), { cur })} par mois` : '';
  const end = `<span class="end">${icon('caret-right')}</span>`;
  const attrs = `data-vers="${a.id}"`;
  if (v.gap === null) {
    return n ? `<div class="group plain rs-vers">${rowHTML({ cls: 'rs-verdict', attrs,
      title: n > 1 ? 'Tes versements' : 'Ton versement', titleCls: 'wrap', sub: esc(count), subCls: 'wrap', end })}</div>` : '';
  }
  if (v.gap > 0) {
    return `<div class="group plain rs-vers">${rowHTML({ cls: 'rs-verdict', attrs,
      title: gapText(v, cur), titleCls: 'wrap rs-warn',
      sub: n ? 'Voir tes versements, en ajouter un' : 'Ajouter un versement régulier', subCls: 'wrap', end })}</div>`;
  }
  // une réserve que le manque ne peut pas aider (trop proche, ou échue) et qui ne sera pas prête : on ne dit pas « tes réserves »
  const behind = rep.reserves.some((/** @type {any} */ x) => ['later', 'short', 'none', 'overdue'].includes(x.status));
  const sub = inflowLine(v.inflow, cur);
  return `<div class="group plain rs-vers">${rowHTML({ cls: 'rs-verdict', attrs,
    title: `Tes versements suffisent pour ${behind ? `tes autres ${RES.many}` : RES.yourMany}`, titleCls: 'wrap', sub: sub ? esc(sub) : '', subCls: 'wrap', end })}</div>`;
}

/** La ligne d'état touchée (data-vers) : ses versements. @param {HTMLElement} root @param {(h: string) => any} go @param {(o: any) => any} openEntry */
function wireVersements(root, go, openEntry) {
  $$('[data-vers]', root).forEach(b => (b.onclick = () => { buzz(6); openVersements(b.dataset.vers || '', go, openEntry); }));
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
    // l'en-tête (2026-11-26, avec l'utilisateur : la carte de « Toutes les épargnes », en grand) : « Solde », le solde, la
    // barre (mois couverts sur 3 pour le fonds d'urgence ; sinon de côté pour les réserves, ou l'objectif ; sa couleur comme
    // sur la carte), puis ce qui reste à mettre de côté, ce qu'il faut pour l'objectif ou les mois couverts. Pas de pastille :
    // le titre nomme déjà l'épargne.
    const m = a.emergency ? coveredMonths(a) : null;
    const gauge = a.emergency ? { pct: monthsPct(m), label: '3 mois de dépenses' } : r.goal || reservesRing(r);
    const tone = a.emergency ? '' : r.reserves.length ? savTone(r) : r.goal && r.goal.passed && !r.goal.reached ? 'warn' : '';
    const pct = gauge ? Math.max(0, Math.min(100, gauge.pct)) : 0;
    const bar = gauge ? `<span class="bar rs-gauge${tone === 'loss' ? ' over' : tone === 'warn' ? ' warn' : ''}" role="img" aria-label="${gauge.label || 'Objectif'} : ${pct} %"><i style="width:${pct}%"></i></span>` : '';
    // les deux actions côte à côte, deux colonnes égales (2026-11-26, avec l'utilisateur) ; le fonds d'urgence n'a que
    // « Mettre de côté », sur toute la largeur
    const act = (/** @type {string} */ attrs, /** @type {string} */ label) => `<button type="button" class="rs-act" ${attrs}>${label}</button>`;
    // « Épargne libre » seulement à côté de dépenses prévues et si elle n'est pas nulle (2026-11-26, avec l'utilisateur :
    // sans dépense prévue, c'est le solde, déjà dit ; à 0, elle ne dit rien) : le surplus une fois tout rempli
    return sectionHTML({ cls: 'rs-wallet', body: `
      <div class="rs-head"><div class="rs-top"><div class="main"><div class="t">Solde</div><div class="bp-big rs-big">${money(r.balance, { cur })}</div></div>
        ${a.emergency || r.reserves.length ? '' : `<button type="button" class="iconbtn soft" data-goal="${a.id}" aria-label="Objectif de ${esc(a.name)}">${icon('pencil-simple')}</button>`}</div>
        ${bar}
        <div class="s wrap">${a.emergency ? monthsLabel(m) : r.goal ? (r.goal.need && !r.goal.reached && !r.goal.passed ? `Objectif ${money(r.goal.amount, { cur })} : ` : '') + goalLine(r.goal, cur) : r.reserves.length ? `${RES.count(r.reserves.length)} · ${restHTML(reservesRing(r), cur)}` : '<span class="b-aside">Fixer un objectif</span>'}</div></div>
      ${verdictHTML(a, r)}
      ${a.emergency ? '' : `<div class="group rs-list" data-wallet="${a.id}">${rows}
        ${!r.reserves.length || !r.free ? '' : rowHTML({ tag: 'div', cls: 'rs-free', title: 'Épargne libre',
          sub: r.freeMonths !== null && r.free > 0 ? `${String(r.freeMonths).replace('.', ',')} mois de dépenses` : '', end: `<span class="amt${r.free < 0 ? ' loss' : ''}">${money(r.free, { cur })}</span>` })}
      </div>`}
      <div class="rs-acts${a.emergency ? ' one' : ''}">${a.emergency ? '' : act(`data-new="${a.id}"`, RES.New)}${act(`data-aside="${a.id}"`, 'Mettre de côté')}</div>
      ${a.emergency ? `<p class="muted b-note">Pour les coups durs. Il ne compte pas dans ton total et n’a pas ${RES.ofMany}. 3 mois de dépenses suffisent.</p>` : ''}
      ${(() => {
        // ses opérations dans le Journal, filtré sur cette épargne (2026-11-27, avec l'utilisateur) : une ligne comme celle
        // des terminées, avant elles (un lien direct ; les terminées allongent la page), sous les deux boutons
        const n = accountTxCount(a.id);
        return n ? `<a class="rs-ops" href="${opsHref({ acc: a.id })}">Ses opérations <span class="muted">${n}</span></a>` : '';
      })()}
      ${(() => {
        const done = closedReserves(a.id).slice(0, 12);
        return done.length ? `<details class="rs-done"><summary>${RES.Many} terminé${RES.e}s <span class="muted">${done.length}</span></summary>
          <div class="group plain">${done.map(closedRowHTML).join('')}</div></details>` : '';
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
  // la ligne d'état : la liste de ses versements, « Ajouter un versement régulier » ; Mettre de côté : ses trois choix
  wireVersements(app, ctx.go, ctx.openEntry);
  $$('[data-aside]', app).forEach(b => (b.onclick = () => { buzz(6); openAsideMenu(b.dataset.aside || '', ctx.openEntry); }));
  fitText(app, '.mrow .v', 12);
}

/**
 * Fonds d'urgence (revu le 2026-11-19, avec l'utilisateur) : un genre de portefeuille à part. On regarde seulement
 * combien de mois de dépenses il couvre (la moyenne des 3 derniers mois) : sa barre (son anneau dans Plan) se remplit
 * jusqu'à 3 mois ; pas d'objectif à fixer. null : pas encore de dépenses à couvrir.
 * @param {any} a
 */
export function coveredMonths(a) {
  const spend = monthlySpend();
  return spend > 0 ? Math.floor((savingsReport(a.id).balance * 10) / spend) / 10 : null;
}
/** Les mois couverts, en % des 3 mois qui suffisent (sa barre, son anneau). @param {number|null} m */
export const monthsPct = m => (m === null ? 0 : Math.max(0, Math.min(100, Math.round((m * 100) / 3))));
/** L'anneau des mois couverts autour de la pastille (sa ligne dans Plan). @param {string} pill @param {number|null} m */
export const monthsRing = (pill, m) => goalRing(pill, { pct: monthsPct(m), label: '3 mois de dépenses' });
/** @param {number|null} m */
export const monthsLabel = m => (m === null ? 'Pas encore de dépenses à couvrir' : `${String(Math.max(0, m)).replace('.', ',')} mois de dépenses couverts`);

/** Objectif d'un portefeuille d'épargne : montant et date facultative ; indicatif, ne bloque rien. @param {string} walletId */
export async function openGoalSheet(walletId) {
  const a = account(walletId);
  if (!a) return;
  const cur = a.currency;
  // la feuille montant (2026-11-24, avec l'utilisateur : le format de la saisie) : le montant visé au pavé, la date en gélule
  const res = await amountSheet({
    title: `Objectif · ${esc(a.name)}`, question: 'Il ne bloque rien : il te montre où tu en es.', value: a.goal ? a.goal.amount : 0, cur,
    date: { value: a.goal ? a.goal.on : null, title: 'Date de l’objectif', none: 'Sans date' },
    button: v => `Viser ${money(v, { cur })}`, remove: a.goal ? 'Retirer l’objectif' : '',
  });
  if (!res) return;
  if ('remove' in res) { if (await updateAccount(a.id, { goal: null })) toast('Objectif retiré'); return; }
  if (await updateAccount(a.id, { goal: { amount: res.amount, on: res.date } })) toast('Objectif enregistré');
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
    <p class="rs-say"><b>${money(r.amount, { cur: r.currency })}</b> visés · ${r.mode === 'once' ? 'en une fois' : 'en plusieurs fois'} · ${r.due ? `pour le ${yearDate(r.due)}` : 'sans date (en pause)'}<br><span class="muted">${closedLine(r)}</span></p>
    ${historyHTML(r.id)}
    ${sheetActions(again ? '<p class="muted">Déjà reconduite.</p>' : `<button class="btn primary" data-again>${icon('arrow-counter-clockwise')}Reconduire</button>`)}
  </div>`, { label: `${RES.One} terminé${RES.e}` });
  const b = $('[data-again]', s.el);
  if (b) b.onclick = () => { buzz(8); s.close(); afterSheets(() => openReserveSheet({ from: r.id, openEntry })); };
}

/**
 * Feuille d'une réserve : créer (wallet, ou from : reconduire une réserve terminée, préremplie et reliée à elle) ou
 * modifier (id). Au format de la saisie (2026-11-24, avec l'utilisateur : plus de champs empilés ni de montant visé au
 * clavier du téléphone), revu le 2026-11-26 (« on prend le même format que son Utiliser » : plus rien en titre, il ne
 * voit jamais ce qui est tapé en haut), dans l'ordre unique des feuilles : l'épargne en gélule (toujours ; verrouillée
 * quand on ne peut pas la changer), le grand montant visé et sa phrase dessous (ce que la dépense prévue demande à
 * l'épargne, la même lecture que le verdict de sa page), l'état d'une réserve existante, une rangée (la catégorie en
 * gélule de couleur, le nom en pastille : obligatoire), une rangée (date, en une fois ou en plusieurs fois), le pavé maison
 * (devise de l'épargne), le bouton qui dit ce qui sera fait et, éteint, ce qui manque, puis Clore (ou Abandonner) en lien
 * et les fois d'avant. Ce qu'on fait d'elle est dans son petit menu
 * (openReserveMenu). Une réserve terminée s'ouvre en lecture (openClosedSheet).
 * onSaved : appelé après un enregistrement.
 * onDone : appelé à la fermeture, vrai si une dépense prévue a été créée (la question « La préparer ? » garde sa saisie sinon).
 * @param {{ id?: string|null, wallet?: string|null, from?: string|null, openEntry: (o: any) => any, onSaved?: (() => void)|null, preset?: Record<string, any>|null, onDone?: ((created: boolean) => void)|null }} o
 */
export function openReserveSheet({ id = null, wallet = null, from = null, openEntry, onSaved = null, preset = null, onDone = null }) {
  const r = id ? reserveById(id) : null;
  if (r && r.closed) return openClosedSheet(r, openEntry);
  const prev = from ? reserveById(from) : null;
  const choices = savingsAccounts().filter(x => !x.archived && !x.emergency);
  let walletId = r ? r.wallet : prev ? prev.wallet : wallet || choices[0]?.id;
  const a = walletId ? account(walletId) : null;
  if (!a) {
    toast(savingsAccounts().some(x => !x.archived) ? `Le fonds d’urgence n’a pas ${RES.ofMany}. Crée une autre épargne pour ${RES.adj('eux', 'elles')}.` : 'Crée d’abord un portefeuille d’épargne.');
    return;
  }
  const canMove = !r && !prev && !wallet && choices.length > 1;
  const cur0 = a.currency;
  /** La devise de l'épargne choisie (le pavé la suit). */
  const cur = () => account(walletId)?.currency || cur0;
  const view = r ? savingsReport(walletId).reserves.find(v => v.reserve.id === r.id) : null;
  // reconduire : même nom, montant et utilisation ; la date de la fois suivante (par son rythme, sinon la même durée qu'avant)
  const prevDue = prev ? reconductDue(prev, today()) : null;
  const src = r || prev;
  // sans date = en pause (2026-11-24, avec l'utilisateur) : la pastille Date propose « Sans date » ; enlever la date
  // d'une datée la met en pause, en donner une à une en pause la reprend, créer sans date la fait naître en pause
  // preset (2026-11-27) : une dépense programmée qu'on prépare, depuis la question « La préparer ? » (son rythme suit dans keep)
  const pre = !r && !prev ? preset : null;
  const f = pre ? { name: pre.name || '', amount: pre.amount || 0, due: pre.due ?? null, mode: pre.mode || 'once', category: pre.category || null }
    // une nouvelle, partie de rien : sans date (2026-11-27, avec l'utilisateur ; avant : dans 3 mois, une date inventée) ;
    // reconduite : la date suivante ; depuis une dépense programmée (preset) : sa première fois
    : { name: src?.name || '', amount: src?.amount || 0, due: r ? r.due : prevDue, mode: src?.mode || 'once', category: src?.category || null };
  const verb = r ? 'Enregistrer' : prev ? 'Reconduire' : 'Prévoir';
  const s = openSheet(`<div class="rs-sheet rs-edit">
    <div class="dv-from"><button type="button" class="mp set" data-wal${canMove ? '' : ' aria-disabled="true"'}>${icon('piggy-bank')}<span data-wall></span>${canMove ? '' : icon('lock-simple')}</button></div>
    <div class="e-stage dv-stage"><div class="e-expr" data-expr aria-live="polite"></div><div class="e-say" data-say></div></div>
    ${view ? `<p class="rs-say"><b>${money(view.saved, { cur: cur0 })}</b> sur ${money(view.target, { cur: cur0 })}${r.used ? ` · ${money(r.used, { cur: cur0 })} déjà utilisés` : ''}<br><span class="muted">${reserveLine(view)}</span>${reserveDeletedUses(r).length ? `<br><span class="muted">${reserveDeletedUses(r).length > 1 ? `Des opérations faites avec ${RES.adj('lui', 'elle')} ont été supprimées` : `Une opération faite avec ${RES.adj('lui', 'elle')} a été supprimée`} : son argent est revenu dans ${RES.the}.</span>` : ''}</p>`
      : ''}
    <div class="e-meta" data-row1 role="group" aria-label="Catégorie et nom"></div>
    <div class="e-meta">
      <button type="button" class="mp" data-due>${icon('calendar-blank')}<span data-duel></span></button>
      <button type="button" class="mp set" data-mode></button>
    </div>
    <div data-pad></div>
    <div data-err></div>
    <button type="button" class="btn primary go" data-save><span class="lbl" data-savel></span></button>
    ${r ? `<button type="button" class="link rs-closeres" data-closeres>${r.used ? `Clore ${RES.the}` : `Abandonner ${RES.the}`}</button>` : ''}
    ${r ? historyHTML(r.id) : prev ? historyHTML(prev.id, true) : ''}
  </div>`, { label: RES.One, onClose: () => { if (onDone) onDone(created); } });
  let created = false;
  const el = s.el, errEl = $('[data-err]', el);
  const exprEl = /** @type {HTMLElement} */ ($('[data-expr]', el)), sayEl = $('[data-say]', el);
  const saveBtn = /** @type {HTMLButtonElement} */ ($('[data-save]', el)), saveLbl = $('[data-savel]', el);
  const showErr = (/** @type {string} */ msg) => { errEl.innerHTML = noticeHTML(esc(msg)); buzz(14); };
  /** @type {ReturnType<typeof keypad>|null} */
  let pad = null;
  let padCur = '';
  /**
   * La phrase sous le montant, par priorité : un calcul qui donne zéro ; l'intro (création, pas encore de montant) ; sans
   * date, ce que ça veut dire (en pause ; une réserve déjà en pause le dit au-dessus) ; sinon ce que ça demande à l'épargne
   * (le manque d'après, calculé comme le verdict de sa page : shortfallWith).
   * @param {string} expr
   */
  const sayHTML = expr => {
    if (expr && !f.amount) return '<span class="loss">Indique le montant visé.</span>';
    if (!r && !f.amount) return '<span class="muted">De l’argent mis de côté pour une dépense à venir.</span>';
    if (!f.due && (!r || r.due)) return '<span class="muted">Pas de date, c’est un souhait.</span>';
    if (!f.amount || !f.due) return '';
    // modifier sans toucher au montant, à la date ni au mode : rien de plus à dire (son état est juste dessous ; le manque de
    // l'épargne vient alors des autres, et se lirait à tort comme le sien)
    if (r && f.amount === r.amount && f.due === r.due && f.mode === r.mode) return '';
    const after = shortfallWith(walletId, { id: r ? r.id : null, amount: f.amount, due: f.due, mode: f.mode }).gap;
    if (after == null) return '';
    const name = esc(account(walletId)?.name || '');
    const m = (/** @type {number} */ v) => money(v, { cur: cur() });
    if (after === 0) return `<span class="muted">Ce qui est prévu sur ${name} suffit.</span>`;
    // ce qui manquera, et quoi faire (2026-11-26, avec l'utilisateur : « (500 F aujourd’hui) » ne disait rien d'utile ;
    // « pense à ajuster tes versements » est plus clair) : les versements s'il y en a, sinon ce qu'on met de côté à la main
    return `<span class="muted">Il manquera ${m(after)} par mois : pense à ajuster ${savingsReport(walletId).versement.list.length ? 'tes versements' : 'tes mises de côté'}.</span>`;
  };
  /** Ce qui manque, dans l'ordre de l'écran : '' quand tout y est. */
  const missing = () => (!f.category ? 'cat' : !f.name.trim() ? 'name' : '');
  /** Le bouton dit ce qui sera fait : « Prévoir 150 000 F · le 24 févr » (« · sans date ») ; éteint, ce qui manque. */
  const paintSave = () => {
    const miss = f.amount ? missing() : '';
    const lack = ({ cat: 'Choisis une catégorie', name: 'Donne un nom', '': '' })[miss];
    saveLbl.innerHTML = lack ? esc(lack) : f.amount
      ? `${icon('check')}<span class="go-t">${verb} <small>${money(f.amount, { cur: cur() })}</small></span><span class="go-c">${f.due ? `· le ${esc(dayShort(f.due))}` : '· sans date'}</span>`
      : `${icon('check')}<span class="go-t">${verb}</span>`;
    saveBtn.disabled = !f.amount || !!lack;
    saveBtn.classList.toggle('need', !!lack);
    // la pastille que le bouton réclame s'entoure (comme la saisie)
    for (const [k, sel] of /** @type {const} */ ([['cat', '[data-cat]'], ['name', '[data-namep]']])) $(sel, el)?.classList.toggle('ask', miss === k);
  };
  /** Le grand montant visé, écrit en clair (calcul compris), comme dans la feuille montant. @param {string|null} [key] */
  const paintAmt = (key = null) => {
    const expr = pad ? pad.expr() : '';
    exprEl.innerHTML = pad && pad.caret() < expr.length ? exprCharsHTML(expr, { cur: cur(), caret: pad.caret() })
      : exprHTML(expr, { cur: cur(), typed: !!key && key !== 'del' && key !== 'caret' && key !== 'set' });
    sayEl.innerHTML = sayHTML(expr);
    fitText(exprEl, '.e-expr', 24);
  };
  /** Le pavé suit la devise de l'épargne (touche décimale) : remonté quand elle change, le montant gardant ce qu'on lit. */
  const mountPad = () => {
    if (pad && padCur === cur()) return;
    if (pad && padCur) f.amount = Math.round(f.amount * 10 ** (currencyOf(cur()).dec - currencyOf(padCur).dec));
    padCur = cur();
    const host = $('[data-pad]', el), fresh = /** @type {HTMLElement} */ (host.cloneNode(false));
    host.replaceWith(fresh);
    pad = keypad(fresh, {
      initial: f.amount, cur: padCur,
      onEnter: () => {
        const fo = /** @type {HTMLElement|null} */ (document.activeElement);
        if (fo && fo !== saveBtn && el.contains(fo) && fo.matches('button')) { fo.click(); return; }
        if (!saveBtn.disabled) { saveBtn.click(); return; }
        if (pad?.hasOp()) pad.resolve();
        shake(saveBtn);
      },
      onChange: (/** @type {number} */ v, /** @type {string} */ _expr, /** @type {string} */ key) => { f.amount = v; errEl.innerHTML = ''; paintAmt(key); paintSave(); },
    });
  };
  const paint = () => {
    const c = f.category ? category(f.category) : null;
    // la catégorie en gélule de couleur (comme la saisie) puis le nom en pastille, à la gouttière (2026-11-26, avec l'utilisateur)
    $('[data-row1]', el).innerHTML = (c
      ? `<button type="button" class="sc on" data-cat style="--c:var(--${c.color || 'c0'})" aria-label="Catégorie : ${esc(c.name)}, changer">${catIcon(c.icon)}<span>${esc(c.name)}</span>${icon('caret-down')}</button>`
      : `<button type="button" class="sc more" data-cat>${icon('squares-four')}<span>Catégorie</span></button>`)
      + `<button type="button" class="mp${f.name.trim() ? ' set' : ''}" data-namep>${icon('text-align-left')}<span>${esc(f.name.trim() || 'Nom')}</span></button>`;
    $('[data-duel]', el).textContent = f.due ? `Pour le ${dayShort(f.due)}` : 'Sans date';
    $('[data-due]', el).classList.toggle('set', !!f.due);
    $('[data-mode]', el).innerHTML = f.mode === 'once' ? `${icon('coin')}<span>En une fois</span>` : `${icon('coins')}<span>En plusieurs fois</span>`;
    const wl = $('[data-wall]', el);
    if (wl) wl.textContent = account(walletId)?.name || '';
    mountPad();
    paintAmt();
    paintSave();
  };
  paint();
  tapCaret(exprEl, () => pad, cur, () => paintAmt('caret'));
  const changed = () => { errEl.innerHTML = ''; paint(); };
  const wal = $('[data-wal]', el);
  if (wal && canMove) wal.onclick = () => {
    buzz(6);
    const sh = openSheet(`${sheetHead({ title: 'Portefeuille d’épargne' })}<div class="group plain">${choices.map(x => rowHTML({ attrs: `data-w="${x.id}"`, pill: accountPill(x),
      title: esc(x.name), end: x.id === walletId ? icon('check') : '' })).join('')}</div>`, { label: 'Portefeuille d’épargne' });
    $$('[data-w]', sh.el).forEach(b => (b.onclick = () => { walletId = /** @type {HTMLElement} */ (b).dataset.w || walletId; buzz(6); sh.close(); changed(); }));
  };
  // en une fois ou en plusieurs fois : la pastille bascule
  $('[data-mode]', el).onclick = () => { buzz(6); f.mode = f.mode === 'once' ? 'gradual' : 'once'; changed(); };
  // la catégorie et le nom : la rangée se repeint, un seul gestionnaire sur elle
  $('[data-row1]', el).onclick = async e => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-cat], [data-namep]'));
    if (!b) return;
    buzz(6);
    if (b.matches('[data-cat]')) {
      const c = await pickCategory({ type: 'expense', current: f.category, title: 'Catégorie de la dépense' });
      if (c && c !== '*') { f.category = c; changed(); }
      return;
    }
    const v = await editNote(f.name, { title: 'Nom', placeholder: 'Ex. Assurance, Rentrée', max: 28 });
    if (v != null) { f.name = v; changed(); }
  };
  $('[data-due]', el).onclick = async () => {
    buzz(6);
    // une date, ou « Sans date » (en pause : hors du manque, servie après les datées)
    const d = await pickDate({ current: f.due, future: true, min: today(), title: 'Pour quand ?', none: 'Sans date' });
    if (d === '') { f.due = null; changed(); } else if (d) { f.due = d; changed(); }
  };
  // Clore (2026-11-19 : sorti du menu, sauf échue) : en bas de sa feuille, après confirmation
  const closeBtn = $('[data-closeres]', el);
  if (closeBtn && r) closeBtn.onclick = () => { buzz(8); closeReserveAsk(r, () => s.close()); };
  saveBtn.onclick = async () => {
    errEl.innerHTML = '';
    if (pad?.hasOp()) pad.resolve();
    if (!f.amount || f.amount <= 0) return showErr('Indique le montant visé.');
    if (!f.category) return showErr('Choisis la catégorie de la dépense.');
    if (!f.name.trim()) return showErr('Donne un nom.');
    const data = { name: f.name.trim(), amount: f.amount, due: f.due, mode: f.mode, category: f.category };
    if (!r) {
      // la première réserve d'une épargne qui a un objectif le retire (2026-11-20, avec l'utilisateur) : on prévient, sans
      // quitter le formulaire ; l'épargne suit ensuite ses réserves
      const w = account(walletId);
      let dropGoal = false;
      if (w?.goal && !openReserves(walletId).length) {
        const yes = await confirmSheet({ title: `${esc(w.name)} a un objectif`, text: `Son objectif de ${money(w.goal.amount, { cur: w.currency })}${w.goal.on ? ` pour le ${yearDate(w.goal.on)}` : ''} sera retiré : l’épargne suivra ${RES.yourMany}.`, yes: `Créer ${RES.the}` });
        if (!yes) return;
        dropGoal = true;
      }
      const ok = await createReserve({ wallet: walletId, ...data, ...(pre?.keep || {}), ...(prev ? { from: prev.id } : {}), ...(dropGoal ? { dropGoal: true } : {}) }, { onError: showErr });
      if (!ok) return;
      created = true;
      buzz(12); s.close();
      if (pre && w) toast(`${data.name} : préparée dans ${w.name}`, { label: 'Voir', run: () => { location.hash = `#/epargne?w=${encodeURIComponent(w.id)}`; } });
      else toast(prev ? `${RES.One} reconduit${RES.e}` : `${RES.One} créé${RES.e}`);
      return;
    }
    /** @type {Record<string, any>} */
    const changes = { ...data };
    const ok = await updateReserve(r.id, changes, { onError: showErr });
    if (!ok) return;
    buzz(12); s.close(); toast(`${RES.One} enregistré${RES.e}`);
    if (onSaved) afterSheets(onSaved);
  };
}
