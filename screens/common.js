// Morceaux d'écran partagés : ligne d'opération et son origine, état vide.
import { account, accounts, category, accCur, checkBalance, deleteTx, restoreTx, reserveOfEntry, txById, savingsReport, scheduleById } from '../core/store.js';
import { UNTRACKED } from '../domain/defaults.js';
import { chip, confirmSheet, toast } from '../core/ui.js';
import { openOperation } from './history.js';
import { accountPill } from './pickers.js';
import { icon, catIcon } from '../core/icons.js';
/** L'icône d'où vient une opération : une réserve prend celle de sa catégorie (2026-11-18 : la tirelire, c'est l'épargne). @param {any} o */
export const originIcon = o => (o.cat && category(o.cat) ? catIcon(/** @type {any} */ (category(o.cat)).icon) : icon(o.icon));
import { money, esc, dayLabel, shortDate } from '../core/format.js';

/** La note que pose une vérification du solde sur l'écart qu'elle note (wallet.check). */
export const CHECK_NOTE = 'Écart constaté en vérifiant le solde';
/**
 * D'où vient une opération (2026-11-13, avec l'utilisateur) : le geste qui l'a créée ailleurs que dans la saisie — une
 * échéance confirmée (la fois réglée), une réserve utilisée, une vérification du solde (l'écart, en « Non suivi ») ;
 * null pour une saisie ordinaire. name : ce qu'on lit ; href : la page où ça se règle. @param {any} t
 * @returns {{ kind: 'due'|'reserve'|'check', icon: string, name: string, label: string, href?: string, reserve?: any, cat?: string|null }|null}
 */
export function originOf(t) {
  if (!t) return null;
  if (t.schedule) {
    const r = scheduleById(t.schedule);
    const name = r?.note || (r?.kind === 'transfer' ? `Vers ${account(r.to || '')?.name || '…'}` : category(r?.category || '')?.name) || 'Échéance';
    return { kind: 'due', icon: 'calendar-check', name, label: `Échéance ${name}${t.due ? ` · fois du ${shortDate(t.due)}` : ''}`,
      href: `#/mois/echeance?e=${encodeURIComponent(t.schedule)}${t.due ? `&at=${t.due}` : ''}` };
  }
  const res = t.type === 'expense' ? reserveOfEntry(t.id) : null;
  if (res) return { kind: 'reserve', icon: 'piggy-bank', cat: res.category || null, name: res.name, label: `Réserve ${res.name}`, reserve: res };
  if (t.categoryId && (t.categoryId === UNTRACKED.expense || t.categoryId === UNTRACKED.income)) {
    return { kind: 'check', icon: 'check-circle', name: 'Vérification du solde', label: `Vérification du solde · ${account(t.accountId)?.name || '?'}`, href: '#/portefeuilles' };
  }
  return null;
}
/** La note n'est-elle que ce que dit déjà l'origine (le nom de l'échéance, la note d'une vérification) ? @param {any} t @param {any} o */
export const noteIsOrigin = (t, o) => {
  const n = (t.note || '').trim().toLowerCase();
  return !!o && !!n && (n === o.name.toLowerCase() || (o.kind === 'check' && n === CHECK_NOTE.toLowerCase()));
};

// Ligne d'opération (revue le 2026-11-09) : à gauche ce que c'est — la catégorie en titre (pour un virement, le trajet
// « De → À », la pastille à flèches disant déjà « virement »), la note seule dessous (si elle ne répète pas le titre) ;
// à droite combien et d'où — le montant, le portefeuille en petit dessous (opts.wallet ; par défaut seulement si on en
// a plusieurs ; rien sous le montant d'un virement, son trajet est le titre). opts.date : date en sous-titre ; opts.when : texte
// à la place de la date (« Dans 2 jours ») ; opts.acc : le portefeuille regardé (un virement s'y affiche signé : + s'il
// y entre, − s'il en sort) ; opts.inGroup : la ligne est sous l'en-tête de sa catégorie (Journal regroupé
// par catégorie) : la date en titre, la note et le portefeuille dessous. Une opération annulée (t.void) est barrée et grisée (D6) ; une opération
// corrigée (t.amended) porte la marque crayon indigo.
export function txRow(t, opts = {}) {
  const cat = category(t.categoryId);
  const acc = account(t.accountId);
  const cur = accCur(t.accountId);
  // under : le portefeuille, en petit sous le montant (à droite : combien et d'où ; à gauche : quoi, et la note)
  let pill, title, sub, under = '';
  const showWallet = opts.wallet ?? accounts().length > 1;
  // d'où elle vient (2026-11-13) : en tête du sous-titre, son icône et son nom ; la note qui le répète s'efface
  const origin = originOf(t);
  const note = !noteIsOrigin(t, origin) && t.note && t.note.trim();
  if (opts.inGroup) {
    // l'en-tête du groupe dit déjà la catégorie : la pastille est celle du portefeuille, la date en titre
    pill = accountPill(acc);
    title = esc(dayLabel(t.date));
    const group = t.type === 'transfer' ? 'Virement' : cat?.name || '';
    const route = t.type === 'transfer' ? `${esc(acc?.name || '?')} → ${esc(account(t.toAccountId)?.name || '?')}` : '';
    if (t.type !== 'transfer' && showWallet) under = esc(acc?.name || '');
    sub = [note && note.toLowerCase() !== group.toLowerCase() ? esc(note) : '', route].filter(Boolean).join(' · ');
  } else if (t.type === 'transfer') {
    pill = `<span class="pill acc">${icon('arrows-left-right')}</span>`;
    // le trajet en titre (la pastille à flèches dit déjà « virement ») ; la note seule dessous, comme une dépense
    title = `${esc(acc?.name || '?')} → ${esc(account(t.toAccountId)?.name || '?')}`;
    sub = note && note.toLowerCase() !== 'virement' ? esc(note) : '';
  } else {
    pill = chip(cat);
    const name = cat?.name || 'Sans catégorie';
    title = esc(name);
    sub = note && note.toLowerCase() !== name.toLowerCase() ? esc(note) : '';
    if (showWallet) under = esc(acc?.name || '');
  }
  if (origin) sub = [`<span class="tx-res tx-origin" data-origin-kind="${origin.kind}">${originIcon(origin)}${esc(origin.name)}</span>`, sub].filter(Boolean).join(' · ');
  // sous-titre en morceaux joints par « · » (rien qui traîne quand la ligne n'a ni note ni portefeuille)
  const when = opts.when ? esc(opts.when) : opts.date ? (opts.dateLabel ? dayLabel(t.date) : shortDate(t.date)) : '';
  const state = t.void ? 'Annulée' : t.planned && !opts.when ? `<span class="tag-planned">${icon('clock')}Prévu</span>` : '';
  const fix = t.amended && !t.void ? `<span class="tag-fix">${icon('pencil-simple')}corrigée</span>` : '';
  sub = [state, when, sub, fix].filter(Boolean).join(' · ');
  const small = under ? `<small>${under}</small>` : '';
  const amt = t.type === 'income' ? `<span class="amt in">${money(t.amount, { sign: true, cur })}${small}</span>`
    : t.type === 'transfer' ? `<span class="amt move">${opts.acc === t.toAccountId ? money(t.amount, { sign: true, cur }) : opts.acc === t.accountId ? money(-t.amount, { cur }) : money(t.amount, { cur })}</span>`
      : `<span class="amt out">${money(-t.amount, { cur })}${small}</span>`;
  const row = `<button type="button" class="row${t.planned ? ' planned' : ''}${t.void ? ' void' : ''}" data-tx="${t.id}">${pill}
    <div class="main"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>${amt}</button>`;
  return row;
}

// Explication d'un solde qui deviendrait négatif (résultat de checkBalance) : { text, sub }.
export function balanceMessage(chk, { editing = false, deleting = false } = {}) {
  const a = account(chk.accountId);
  const name = esc(a?.name || '?');
  const m = v => money(v, { cur: a?.currency });
  // rentrée réduite, déplacée ou supprimée : on dit simplement où tomberait le solde
  if (!chk.debit) {
    const when = chk.kind === 'past' ? ` le ${shortDate(chk.date)}` : '';
    return { text: `${name} passerait à ${m(chk.after)}${when}.`, sub: 'Le solde ne peut pas passer sous zéro.' };
  }
  if (chk.kind === 'already') return { text: `${name} est déjà à ${m(chk.avail)}.`, sub: 'Note d’abord l’argent qui y est entré.' };
  if (chk.kind === 'now') return { text: chk.avail > 0 ? `Il ne reste que ${m(chk.avail)} dans ${name}.` : `Il n’y a plus rien dans ${name}.`, sub: deleting ? 'Le solde ne peut pas passer sous zéro.' : '' };
  return {
    text: `Le ${shortDate(chk.date)}, ${name} passerait à ${m(chk.after)}.`,
    sub: `Il ne restait que ${m(chk.avail)} ce jour-là.`,
  };
}

// « Annuler l'opération » (D6 : pas de « Supprimer » pour les opérations). Refusée (avec explication) si
// elle rendrait un solde négatif ; sinon elle quitte la liste (sauf réglage « Afficher les opérations annulées ») et un
// petit message propose « Rétablir » (commande entry.restore). Renvoie true si elle est annulée.
export async function voidOperation(t) {
  const chk = checkBalance(t, null);
  if (chk) {
    const m = balanceMessage(chk, { deleting: true });
    await confirmSheet({ title: 'Annulation impossible', text: `${m.text} ${m.sub}`, yes: 'Compris', cancel: false });
    return false;
  }
  const removed = await deleteTx(t.id);
  if (!removed) return false;
  toast('Opération annulée', { label: 'Rétablir', run: () => restoreOperation(t.id) });
  return true;
}

/**
 * Rétablir une opération supprimée. Une dépense sur réserve (D17) : la réserve repaie (se referme en une fois) ; la
 * répartition, calculée depuis le solde (revu le 2026-11-19), se refait d'elle-même.
 * @param {string} id @returns {Promise<boolean>}
 */
export async function restoreOperation(id) {
  return !!(await restoreTx(id));
}

export function emptyState(text, action = '', ic = 'logo') {
  return `<div class="empty"><div class="illu">${icon(ic)}</div><p>${text}</p>${action}</div>`;
}


// Gestion commune des listes d'opérations : appui → fiche de l'opération (D6). Annuler se fait depuis la fiche.
export function wireTxList(root) {
  root.addEventListener('click', e => {
    const r = e.target.closest('[data-tx]');
    if (!r) return;
    openOperation(r.dataset.tx);
  });
}
