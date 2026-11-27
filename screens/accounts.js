// Portefeuilles (D9) : vérifier que l'app dit vrai, et voir où est son argent. Page ouverte depuis Moi, avec un retour.
// En haut : retour, titre, loupe (nom et type), « Ranger » (icône : poignées, une croix pour finir) ; total ; une seule
// liste ; ligne = pastille, nom, son type, solde, bouton ⋯. Toucher la ligne = sa fiche (nom, type, identifiant, devise si
// permis, teinte, « Compter dans le total » (D11 : sinon hors du total et de Disponible) ; pour une épargne (D17,
// genre choisi à la création) : objectif, « Permettre les dépenses », « Fonds d'urgence » ; solde de
// départ seulement à la création) ; ⋯ = Vérifier le solde (« vérifié il y a… » dessous ; « C'est
// juste » ou le vrai montant, l'écart devient une opération « Non suivi »), Ajouter une opération, Virement, Voir ses
// opérations (le Journal filtré), Archiver, Supprimer (éteint s'il a des opérations). Archivés dépliés sur place en bas ; + flottant pour un
// nouveau portefeuille. Même modèle que Moi › Catégories. Soldes négatifs toujours refusés : pas de réglage ici.
import {
  accounts, allAccounts, account, balances, totalBalance, otherTotals, addAccount, updateAccount, reorderAccounts, checkWallet,
  deleteAccount, accountTxCount, currencyLockCount, settings, KIND_LABEL, openReserves,
} from '../core/store.js';
import { RES } from '../domain/words.js';
import { money, esc, symbol, readAmount, currencyOf, today, parse, iso, yearDate } from '../core/format.js';
import { icon } from '../core/icons.js';
import { openSheet, seg, wireSeg, buzz, toast, confirmSheet, menuSheet, countUp, splitAmount, noticeHTML, fitText, afterSheets, keypad, exprHTML, exprCharsHTML, enableReorder, wireArrange, arrangeBtnHTML, isArranging, fabHTML, switchHTML, $, $$ } from '../core/ui.js';
import { fold } from '../domain/suggest.js';
import { accountPill, pickCurrency, pickDate, noWalletsHTML, ACCOUNT_ICON } from './pickers.js';
import { opsHref } from './transactions.js';
import { topbarHTML, wireBack, rowHTML, sectionHTML, fieldHTML, sheetHead, sheetActions } from './parts.js';
import { amountSheet } from './amount-sheet.js';
import { editNote } from './entry/sheets.js';

const KIND_SEG = [['cash', 'Espèces'], ['emoney', 'Électronique'], ['bank', 'Banque']];
// le numéro (revu le 2026-11-19, avec l'utilisateur) : plus de champ à part ; pour distinguer deux comptes qui se
// ressemblent, on met la fin du numéro dans le nom (« MoMo 4521 ») : 4 chiffres au plus, pas les mêmes qu'un autre
// portefeuille du même type

// Fiche d'un portefeuille (création, ou toucher sa ligne). onSaved(portefeuille) : appelé après la création (ex. le + de
// saisie sans portefeuille enchaîne sur la saisie). excluded : un nouveau portefeuille proposé hors du total.
// Genre (D17, 2026-11-10) : courant ou épargne, choisi à la création et figé ensuite. savings : true / false quand
// l'intention est connue ; null (création) : une petite feuille le demande d'abord. Une épargne montre toujours ses
// champs (objectif et date, Permettre les dépenses, Fonds d'urgence) ; name / emergency / goal : préremplis.
export function openAccountSheet(id, { onSaved = null, excluded = false, savings = null, name: presetName = '', emergency = false, goal = null, intro = '' } = {}) {
  if (!id && savings === null) {
    const kind = (/** @type {string} */ k, /** @type {string} */ pill, /** @type {string} */ title, /** @type {string} */ sub) =>
      rowHTML({ attrs: `data-k="${k}"`, pill, title, sub, subCls: 'wrap', end: icon('caret-right') });
    const ask = openSheet(`${sheetHead({ title: 'Nouveau portefeuille' })}
      <div class="group plain">
        ${kind('0', `<span class="pill acc">${icon('wallet')}</span>`, 'Portefeuille courant', 'Espèces, Mobile Money, compte en banque : l’argent de tous les jours')}
        ${kind('1', `<span class="pill acc">${icon('piggy-bank')}</span>`, 'Épargne', `Livret, tirelire, compte épargne : mis à part, avec un objectif ou des ${RES.many}`)}
        ${accounts().some(x => x.emergency && !x.archived) ? '' : kind('2', accountPill({ kind: 'bank', savings: true, emergency: true }), 'Fonds d’urgence',
          'De quoi tenir en cas de coup dur, hors du total. 3 mois de dépenses suffisent.')}
      </div>`, { label: 'Nouveau portefeuille' });
    $$('[data-k]', ask.el).forEach(b => (b.onclick = () => {
      buzz(6);
      ask.close();
      const em = b.dataset.k === '2';
      afterSheets(() => openAccountSheet(null, { onSaved, excluded, savings: b.dataset.k !== '0', name: presetName || (em ? 'Fonds d’urgence' : ''), emergency: em, goal }));
    }));
    return;
  }
  const a = id ? account(id) : null;
  const st = settings();
  const locked = a ? currencyLockCount(a.id) : 0;
  const f = { kind: a?.kind || 'cash', currency: a?.currency || st.currency, counted: a ? !a.excluded : !excluded, savings: a ? !!a.savings : !!savings, spendOk: !!a?.spendOk,
    goalOn: a?.goal ? a.goal.on : null, emergency: a ? !!a.emergency : !!emergency };
  // un fonds d'urgence (2026-11-19) : un genre à part, hors du total, sans réserve, dépenses permises, sans objectif
  const em = f.emergency;
  // la fiche d'un portefeuille (2026-11-27, avec l'utilisateur : le grand montant prenait l'attention alors qu'il vaut presque
  // toujours 0, et disparaissait en modification) : comme celle d'une catégorie, un aperçu (le portefeuille tel qu'il se
  // lira dans la liste) puis des lignes, la même forme à la création et en modification. Le solde de départ est une ligne
  // qui ouvre la feuille montant ; en modification, le solde ne se change jamais à la main, la ligne ouvre la vérification.
  // Le bouton dit ce qui manque (le nom) ou ce qui sera fait.
  const hasGoal = f.savings && !em && !(a && openReserves(a.id).length); // pas d'objectif avec des dépenses prévues
  const caret = icon('caret-right');
  const s = openSheet(`<div class="acc-sheet acc-edit">
    <div class="e-head">${seg(KIND_SEG, f.kind, 'kind-seg')}
      <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
    ${intro ? `<p class="screen-help acc-intro">${esc(intro)}</p>` : ''}
    <div class="acc-pv"><span data-pv></span><div class="main"><div class="t" data-pvname></div><div class="s wrap" data-say></div></div><b class="w-bal" data-pvbal></b></div>
    ${fieldHTML({ label: 'Nom', control: '<button type="button" class="field-btn" data-name></button>' })}
    ${fieldHTML({ label: a ? 'Solde' : 'Solde de départ', control: '<button type="button" class="field-btn" data-bal></button>' })}
    ${fieldHTML({ label: 'Devise', note: locked ? `${locked} opération${locked > 1 ? 's' : ''} en ${esc(currencyOf(f.currency).long)} : la devise ne peut plus changer.` : '',
      control: `<button type="button" class="field-btn" data-cur ${locked ? 'aria-disabled="true"' : ''}><b data-curl></b>${icon(locked ? 'lock-simple' : 'caret-right')}</button>` })}
    ${hasGoal ? fieldHTML({ label: 'Objectif', control: '<button type="button" class="field-btn" data-goal></button>' }) : ''}
    ${em ? `<p class="field-note acc-emnote">Hors du total, sans ${RES.one}, dépenses permises. Bougette compte combien de mois de dépenses il couvre : 3 mois suffisent.</p>`
      : `<div class="group plain acc-total"><button type="button" class="row" data-counted><div class="main"><div class="t">Compter dans le total</div>
      <div class="s wrap" data-countedl></div></div>${switchHTML(f.counted)}</button>
      ${f.savings ? `<button type="button" class="row" data-spend><div class="main"><div class="t">Permettre les dépenses</div>
      <div class="s wrap" data-spendl></div></div>${switchHTML(f.spendOk)}</button>` : ''}</div>`}
    <div data-err></div>
    ${sheetActions('<button type="button" class="btn primary go" data-save><span class="lbl" data-savel></span></button>')}
  </div>`, { label: 'Portefeuille' });
  const el = s.el;
  const errEl = $('[data-err]', el), sayEl = $('[data-say]', el);
  const saveBtn = /** @type {HTMLButtonElement} */ ($('[data-save]', el)), saveLbl = $('[data-savel]', el);
  const nameBtn = $('[data-name]', el);
  // le solde de départ (création) ; l'objectif, dans sa feuille montant
  let balance = 0, goalAmount = a?.goal ? a.goal.amount : goal || 0;
  let name = a?.name || presetName;

  /** Ce que veut dire « Compter dans le total », sous l'interrupteur et dans l'aperçu. */
  const countedText = () => (!f.counted ? 'Ni dans le total ni dans Disponible' : f.savings ? 'Dans le total, pas dans Disponible' : 'Dans le total et dans Disponible');
  /** Le bouton : sans nom, il le réclame (éteint) et la ligne du nom s'entoure ; sinon ce qui sera fait, et à la création le solde. */
  function paintSave() {
    const lack = name.trim() ? '' : 'Donne un nom';
    const verb = a ? 'Enregistrer' : em ? 'Créer le fonds d’urgence' : f.savings ? 'Ajouter l’épargne' : 'Ajouter le portefeuille';
    saveLbl.innerHTML = lack ? esc(lack)
      : `${icon('check')}<span class="go-t">${verb}</span>${a ? '' : `<span class="go-c">· ${balance ? esc(money(balance, { cur: f.currency })) : 'à zéro'}</span>`}`;
    saveBtn.disabled = !!lack;
    saveBtn.classList.toggle('need', !!lack);
    nameBtn.classList.toggle('ask', !!lack);
  }

  function paint() {
    const c = currencyOf(f.currency);
    const named = !!name.trim();
    // l'aperçu : le portefeuille tel qu'il se lira dans la liste ; sans nom, ce qu'on crée, en gris
    $('[data-pv]', el).innerHTML = accountPill({ kind: f.kind, savings: f.savings, emergency: em }, 'lg');
    const pvn = $('[data-pvname]', el);
    pvn.textContent = named ? name.trim() : em ? 'Fonds d’urgence' : f.savings ? 'Nouvelle épargne' : 'Nouveau portefeuille';
    pvn.classList.toggle('muted', !named);
    const shown = a ? balances()[a.id] || 0 : balance;
    const pvb = $('[data-pvbal]', el);
    pvb.textContent = money(shown, { cur: f.currency });
    pvb.classList.toggle('loss', shown < 0);
    sayEl.innerHTML = `<span class="muted">${em ? 'Hors du total' : countedText()}</span>`;
    // un exemple en gris tant qu'il n'y a pas de nom, comme la fiche d'une catégorie
    nameBtn.innerHTML = `<b${named ? '' : ' class="muted"'}>${esc(named ? name.trim() : f.savings ? 'Ex. Livret, Tirelire' : 'Ex. Orange Money, Wave')}</b>${caret}`;
    $('[data-bal]', el).innerHTML = `<b>${esc(money(shown, { cur: f.currency }))}</b>${caret}`;
    $('[data-curl]', el).textContent = `${c.long} · ${c.name}`;
    const gb = $('[data-goal]', el); // absent quand l'épargne a des dépenses prévues (pas d'objectif avec elles)
    // l'objectif et sa date sur une seule ligne, comme depuis la page de l'épargne (2026-11-27, avec l'utilisateur) : un
    // montant sans date se peut, une date sans montant jamais
    if (gb) gb.innerHTML = `<b${goalAmount ? '' : ' class="muted"'}>${goalAmount ? esc(`${money(goalAmount, { cur: f.currency })} · ${f.goalOn ? `pour le ${yearDate(f.goalOn)}` : 'sans date'}`) : 'Aucun'}</b>${caret}`;
    for (const [sel, on] of /** @type {[string, boolean][]} */ ([['[data-counted]', f.counted], ['[data-spend]', f.spendOk]])) {
      const x = $(`${sel} .switch`, el);
      if (!x) continue;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    }
    const cl = $('[data-countedl]', el);
    if (cl) cl.textContent = countedText();
    const sl = $('[data-spendl]', el);
    if (sl) sl.textContent = f.spendOk ? `Toute dépense, avec ou sans ${RES.one}` : `Seulement ${RES.itsMany}`;
    paintSave();
  }
  paint();
  const err = (/** @type {string} */ text) => {
    errEl.innerHTML = noticeHTML(text);
    buzz(14);
  };
  $('[data-close]', el).onclick = () => { buzz(6); s.close(); };
  wireSeg($('.kind-seg', el), v => { f.kind = v; paint(); });
  nameBtn.onclick = async () => {
    buzz(6);
    const v = await editNote(name, { title: 'Nom', placeholder: f.savings ? 'Ex. Livret, Tirelire' : 'Ex. Orange Money, Wave', max: 28,
      help: 'Deux comptes qui se ressemblent ? Ajoute la fin du numéro : « MoMo 4521 ».' });
    if (v != null) { name = v; errEl.innerHTML = ''; paint(); }
  };
  const ct = $('[data-counted]', el);
  if (ct) ct.onclick = () => { f.counted = !f.counted; buzz(8); paint(); };
  const spendBtn = $('[data-spend]', el);
  if (spendBtn) spendBtn.onclick = () => { f.spendOk = !f.spendOk; buzz(8); paint(); };
  // le solde : à la création, la feuille montant (comme avant le 2026-11-26) ; en modification, la vérification (il ne se change jamais à la main)
  $('[data-bal]', el).onclick = async () => {
    buzz(6);
    if (a) { await openCheckSheet(a); paint(); return; }
    const res = await amountSheet({ title: 'Solde de départ', question: 'Combien as-tu dessus aujourd’hui ?', value: balance, cur: f.currency, zero: true,
      button: v => (v ? `Partir de ${money(v, { cur: f.currency })}` : 'Partir de zéro') });
    if (res && 'amount' in res) { balance = res.amount; paint(); }
  };
  const goalBtn = $('[data-goal]', el);
  if (goalBtn) goalBtn.onclick = async () => {
    buzz(6);
    // la même feuille que « Objectif » sur la page de l'épargne : le montant au pavé, la date en gélule (facultative)
    const res = await amountSheet({ title: 'Objectif', question: 'Il ne bloque rien : il te montre où tu en es.', value: goalAmount, cur: f.currency,
      date: { value: f.goalOn, title: 'Date de l’objectif', none: 'Sans date' },
      button: v => `Viser ${money(v, { cur: f.currency })}`, remove: goalAmount ? 'Retirer l’objectif' : '' });
    if (!res) return;
    if ('remove' in res) { goalAmount = 0; f.goalOn = null; }
    else if ('amount' in res) { goalAmount = res.amount; f.goalOn = res.date || null; }
    paint();
  };
  $('[data-cur]', el).onclick = async () => {
    buzz(6);
    if (locked) { toast(`${locked} opération${locked > 1 ? 's' : ''} en ${currencyOf(f.currency).long} : la devise ne peut plus changer.`); return; }
    const c = await pickCurrency({ current: f.currency, title: 'Devise du portefeuille' });
    if (c) {
      // le solde de départ garde ce qu'on lit quand la devise change de décimales
      balance = Math.round(balance * 10 ** (currencyOf(c).dec - currencyOf(f.currency).dec));
      f.currency = c; paint();
    }
  };

  $('[data-save]', el).onclick = async () => {
    errEl.innerHTML = '';
    const full = name.trim().replace(/\s+/g, ' ');
    if (!full) return err('Donne-lui un nom.');
    if (allAccounts().some(x => x.id !== a?.id && x.name.toLowerCase() === full.toLowerCase())) return err('Un portefeuille porte déjà ce nom.');
    // la fin du numéro dans le nom (revu le 2026-11-20, avec l'utilisateur : on ne limite pas ce qu'il écrit) : on compare
    // ses 4 derniers chiffres au plus à ceux d'un autre portefeuille du même type et genre, pour bien les distinguer
    const last4 = (/** @type {string} */ n) => /\s(\d+)$/.exec(n)?.[1].slice(-4) || null;
    const tail = last4(full);
    if (tail && f.kind !== 'cash') {
      const same = accounts().find(x => x.id !== a?.id && !x.archived && x.kind === f.kind && !!x.savings === !!f.savings && !!x.emergency === !!em && last4(x.name) === tail);
      if (same) return err(`${same.name} finit déjà par ${tail}.`);
    }
    const ident = '';
    /** @type {Record<string, any>} */
    const patch = { name: full, kind: f.kind, ident, excluded: em ? true : !f.counted };
    if (!a) patch.savings = f.savings; // le genre : à la création seulement
    // fonds d'urgence : son genre, fixé à la création (hors du total, dépenses permises, sans objectif)
    if (em) { if (!a) patch.emergency = true; patch.spendOk = true; }
    // épargne (D17) : objectif (vide = aucun), dépenses
    else if (f.savings) {
      patch.spendOk = f.spendOk;
      // une épargne qui a des réserves n'a pas d'objectif (2026-11-20) : la pastille n'y est pas, on n'y touche pas
      if (goalBtn) patch.goal = goalAmount ? { amount: goalAmount, on: f.goalOn } : null;
    }
    // nouveau portefeuille : son solde de départ est une écriture « opening » dans la même commande. Un portefeuille
    // existant ne change pas de solde ici : on le vérifie (D9).
    let created = null;
    if (!a) {
      if (!(created = await addAccount({ ...patch, currency: f.currency, balance }))) return;
    } else if (!(await updateAccount(a.id, locked ? patch : { ...patch, currency: f.currency }))) return;
    buzz(12);
    s.close();
    if (created && onSaved) afterSheets(() => onSaved(created));
    else toast(a ? 'Portefeuille enregistré' : f.savings ? 'Épargne ajoutée' : 'Portefeuille ajouté');
  };
}

// Archiver (le solde ne compte plus dans le total ; les opérations restent) ou désarchiver.
async function toggleArchive(a) {
  if (a.archived) { if (await updateAccount(a.id, { archived: false })) toast('Portefeuille désarchivé'); return; }
  const bal = balances()[a.id] || 0;
  const ok = await confirmSheet({
    title: `Archiver « ${esc(a.name)} » ?`,
    text: `Il disparaît des choix. Ses opérations restent dans le Journal.${bal && !a.excluded ? ` Son solde (${money(bal, { cur: a.currency })}) ne comptera plus dans le total.` : ''}`,
    yes: 'Archiver',
  });
  if (ok && (await updateAccount(a.id, { archived: true }))) toast('Portefeuille archivé');
}

// Menu ⋯ d'un portefeuille (D9) ; toucher la ligne ouvre la fiche (Modifier). Supprimer : seulement sans opération (sinon éteint, la raison dessous : on archive) ;
// garder au moins un portefeuille actif.
async function walletMenu(a, { openEntry, go }) {
  const active = accounts();
  const used = accountTxCount(a.id);
  const last = !a.archived && active.length <= 1;
  // un virement se fait entre deux portefeuilles de la même devise (D10)
  const peers = active.filter(x => x.id !== a.id && x.currency === a.currency).length;
  const k = await menuSheet({
    title: esc(a.name),
    items: [
      ...(a.archived ? [] : [
        { key: 'add', icon: 'plus', label: 'Ajouter une opération' },
        { key: 'move', icon: 'arrows-left-right', label: 'Virement depuis ce portefeuille', off: !peers, note: peers ? '' : `Il faut un autre portefeuille en ${esc(currencyOf(a.currency).long)}.` },
      ]),
      { key: 'ops', icon: 'clock-counter-clockwise', label: 'Voir ses opérations' },
      { key: 'arch', icon: 'archive', label: a.archived ? 'Désarchiver' : 'Archiver', off: last, note: last ? 'Garde au moins un portefeuille actif.' : '' },
      { key: 'del', icon: 'trash', label: 'Supprimer', danger: true, off: !!used || last, note: used ? 'Il a des opérations : archive-le plutôt.' : last ? 'Garde au moins un portefeuille actif.' : '' },
    ],
  });
  if (!k) return;
  afterSheets(async () => {
    if (k === 'add') openEntry({ accountId: a.id });
    else if (k === 'move') openEntry({ type: 'transfer', accountId: a.id });
    else if (k === 'ops') go(opsHref({ acc: a.id }));
    else if (k === 'arch') toggleArchive(a);
    else if (k === 'del') {
      const ok = await confirmSheet({ title: `Supprimer « ${esc(a.name)} » ?`, text: 'Il n’a aucune opération.', yes: 'Supprimer', danger: true });
      if (ok && (await deleteAccount(a.id))) toast('Portefeuille supprimé');
    }
  });
}

// « vérifié il y a… » (D9) : date de la dernière vérification, avec ou sans écart (montrée dans le menu ⋯).
export function checkedLabel(at) {
  if (!at) return 'Jamais vérifié';
  const n = Math.round((parse(today()).getTime() - parse(iso(new Date(at))).getTime()) / 86400000);
  if (n <= 0) return 'Vérifié aujourd’hui';
  if (n === 1) return 'Vérifié hier';
  if (n < 31) return `Vérifié il y a ${n} jours`;
  return n < 365 ? `Vérifié il y a ${Math.floor(n / 30)} mois` : 'Vérifié il y a plus d’un an';
}

// Ligne (D9) : pastille, nom, son type dessous, solde (toucher = sa fiche, Modifier) ; bouton ⋯ (actions) ; poignée pour
// ranger (visible seulement en mode « Ranger »). data-q : texte cherché par la loupe (nom et type, sans accents).
function walletRow(a, b) {
  // hors du total (D11) : listé quand même, marqué
  const sub = [a.savings ? (a.emergency ? 'Fonds d’urgence' : 'Épargne') : '', KIND_LABEL[a.kind], a.excluded && !a.emergency ? 'hors du total' : ''].filter(Boolean).join(' · ');
  // « mobile money » trouve aussi la monnaie électronique (MTN, Moov…)
  const words = `${a.name} ${KIND_LABEL[a.kind]}${a.kind === 'emoney' ? ' Mobile Money' : ''}`;
  return `<div class="row wrow${a.archived ? ' dim' : ''}"${a.archived ? '' : ` data-rid="${a.id}"`} data-q="${esc(fold(words))}">
    <button type="button" class="w-id" data-edit="${a.id}" aria-label="Modifier ${esc(a.name)}">${accountPill(a, 'lg')}
      <span class="main"><span class="t">${esc(a.name)}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</span>
      <b class="w-bal${b < 0 ? ' loss' : ''}">${money(b, { cur: a.currency })}</b></button>
    <button type="button" class="iconbtn soft w-more" data-menu="${a.id}" aria-label="${esc(a.name)} : actions">${icon('dots-three')}</button>
    ${a.archived ? '' : `<span class="handle" aria-label="Glisser pour ranger">${icon('dots-six-vertical')}</span>`}</div>`;
}

// Phrase sous le montant d'une vérification : ce qui sera noté si on valide (aussi la vérification depuis la saisie).
// L'écart se compte toujours contre le vrai solde de l'app ; sans autre opération, c'est le solde de départ qui change.
export function checkSayHTML(a, actual) {
  const gap = actual - (balances()[a.id] || 0);
  const amt = v => money(v, { cur: a.currency });
  return !gap ? 'C’est ce que dit Bougette.'
    : !accountTxCount(a.id) ? `Le solde de départ passera à <b>${amt(actual)}</b>.`
      : gap < 0 ? `Il manque <b>${amt(-gap)}</b> : noté « Non suivi » (dépense).` : `Il y a <b>${amt(gap)}</b> de plus : noté « Non suivi » (revenu).`;
}

// Vérifier un solde (D9) : « Combien as-tu vraiment dessus ? », pavé prérempli avec le solde de l'app. « C'est juste » note
// la vérification ; un autre montant la note aussi et corrige : le solde de départ si le portefeuille n'a pas d'autre
// opération, sinon l'écart devient une opération « Non suivi ». Résout 'ok', 'fixed', ou null (feuille fermée).
export function openCheckSheet(a) {
  return new Promise(resolve => {
    let out = null;
    // l'écart se compte toujours contre le vrai solde de l'app ; un solde déjà négatif (données anciennes) part de 0 au
    // pavé, et « C'est juste » n'apparaît que si le montant tapé est exactement ce solde
    const real = balances()[a.id] || 0;
    const known = Math.max(0, real);
    let actual = known;
    const s = openSheet(`<div class="check-sheet">
      <div class="e-head">${sheetHead({ title: esc(a.name), pill: accountPill(a) })}
        <button type="button" class="iconbtn soft close" data-close aria-label="Fermer">${icon('x')}</button></div>
      <p class="ck-q">Combien as-tu vraiment dessus ?</p>
      <div class="e-stage"><div class="e-expr" data-expr></div><div class="e-say" data-say></div></div>
      <div data-pad></div>
      <button type="button" class="btn primary" data-ok></button>
    </div>`, { label: `Vérifier ${a.name}`, onClose: () => resolve(out) });
    const exprEl = $('[data-expr]', s.el), say = $('[data-say]', s.el), ok = $('[data-ok]', s.el);
    const amt = v => money(v, { cur: a.currency });
    /** @type {ReturnType<typeof keypad>|null} */
    let pad = null;
    const paint = (v, expr = '', key = null) => {
      actual = v;
      // curseur déplacé (2026-11-18, comme la saisie) : les chiffres un à un, le curseur à sa place
      exprEl.innerHTML = pad && pad.caret() < expr.length ? exprCharsHTML(expr, { cur: a.currency, caret: pad.caret() })
        : exprHTML(expr, { cur: a.currency, typed: !!key && key !== 'del' && key !== 'caret' });
      const gap = actual - real;
      say.innerHTML = checkSayHTML(a, actual);
      ok.innerHTML = `${icon('check')}${gap ? `Corriger à ${amt(actual)}` : 'C’est juste'}`;
      fitText(exprEl, '.e-expr', 24);
    };
    pad = keypad($('[data-pad]', s.el), {
      initial: known, cur: a.currency, onChange: paint,
      // Entrée sur « Fermer » fait ce bouton-là, pas la vérification
      onEnter: () => { const f = /** @type {HTMLElement} */ (document.activeElement); if (f && f !== ok && s.el.contains(f) && f.matches('button')) f.click(); else ok.click(); },
    });
    paint(known, pad.expr());
    // toucher le montant place le curseur avant ou après le chiffre touché (comme dans la saisie, entry.js)
    exprEl.addEventListener('click', e => {
      if (!pad) return;
      const expr = pad.expr();
      if (!expr) return;
      if (pad.caret() >= expr.length) exprEl.innerHTML = exprCharsHTML(expr, { cur: a.currency, caret: expr.length });
      const x = /** @type {MouseEvent} */ (e).clientX;
      let best = expr.length, dist = Infinity;
      for (const c of /** @type {HTMLElement[]} */ ($$('.ch', exprEl))) {
        const r = c.getBoundingClientRect(), i = Number(c.dataset.i);
        for (const [edge, at] of [[r.left, i], [r.right, i + 1]]) {
          const dd = Math.abs(x - edge);
          if (dd < dist) { dist = dd; best = at; }
        }
      }
      buzz(4);
      pad.setCaret(best);
      paint(actual, pad.expr(), 'caret');
    });
    $('[data-close]', s.el).onclick = () => { buzz(6); s.close(); };
    ok.onclick = async () => {
      if (pad.hasOp()) pad.resolve();
      const gap = actual - real;
      if (!(await checkWallet(a.id, actual))) return;
      out = gap ? 'fixed' : 'ok';
      buzz(12);
      s.close();
    };
  });
}

let showArchived = false, searching = false, allCurs = false;
window.addEventListener('bougette:space', () => { showArchived = searching = allCurs = false; });

// Autres devises sous le total (D10 : pas de conversion) : une pastille par devise, dans l'ordre des portefeuilles, sans
// « + » (on ne les additionne pas). Au-delà de 4, les 3 premières et « + N devises » qui déplie le reste sur place.
function otherCursHTML(others) {
  if (!others.length) return '';
  const shut = others.length > 4 && !allCurs;
  const n = others.length - 3;
  return `<div class="w-curs">${others.map((o, i) => `<span class="w-cur${o.amount < 0 ? ' loss' : ''}"${shut && i >= 3 ? ' hidden' : ''}>${money(o.amount, { cur: o.cur })}</span>`).join('')}
    ${others.length > 4 ? `<button type="button" class="w-cur more" data-curs aria-expanded="${allCurs}">${allCurs ? 'Moins' : `+ ${n} devise${n > 1 ? 's' : ''}`}</button>` : ''}</div>`;
}

// Page Portefeuilles (D9) : vérifier que l'app dit vrai, et voir où est son argent. Même modèle que Moi › Catégories :
// « Ranger » (icône : poignées, une croix pour finir), + flottant ; en plus, la loupe (nom et type).
export function render(app, ctx) {
  const bal = balances();
  const list = accounts();
  const archived = allAccounts().filter(a => a.archived);
  const total = totalBalance();
  const others = otherTotals();

  app.innerHTML = `<div class="screen accounts no-tabs has-fab">
    ${topbarHTML({ title: 'Portefeuilles', right: list.length ? `<button class="iconbtn" data-find aria-label="Chercher un portefeuille" aria-pressed="${searching}">${icon('magnifying-glass')}</button>${arrangeBtnHTML()}` : '' })}
    <div class="search w-find" data-findbox ${searching ? '' : 'hidden'}>${icon('magnifying-glass')}<input type="search" data-q placeholder="Chercher : nom, banque, mobile money…" autocomplete="off" enterkeyhint="search"></div>
    <section class="hero w-hero">
      <div class="eyebrow">Total</div>
      <div class="big${total < 0 ? ' neg' : ''}">${splitAmount(Math.abs(total), { key: 'acc-total', neg: total < 0 })}</div>
      ${otherCursHTML(others)}
    </section>
    ${list.length ? `<div class="group w-list" data-list>${list.map(a => walletRow(a, bal[a.id] || 0)).join('')}</div>
      <p class="muted pick-none" data-none hidden>Aucun portefeuille ne correspond.</p>` : noWalletsHTML()}
    ${archived.length ? sectionHTML({ attrs: 'data-archs', body: `
      <button class="arch-row" data-arch aria-expanded="${showArchived}"><span>Archivés</span><span class="n">${archived.length}${icon(showArchived ? 'caret-down' : 'caret-right')}</span></button>
      <div class="group" data-archlist${showArchived ? '' : ' hidden'}>${archived.map(a => walletRow(a, bal[a.id] || 0)).join('')}</div>` }) : ''}
  </div>
  ${list.length ? fabHTML('Nouveau portefeuille') : ''}`;

  const screen = $('.screen', app);
  const arrange = $('[data-arrange]', app);
  $$('[data-edit]', app).forEach(b => (b.onclick = () => { if (isArranging('wallets')) return; buzz(6); openAccountSheet(b.dataset.edit); }));
  $$('[data-menu]', app).forEach(b => (b.onclick = () => { buzz(6); walletMenu(account(b.dataset.menu), ctx); }));
  const add = $('[data-add]', app) || $('[data-new-wallet]', app);
  add.onclick = () => { buzz(6); openAccountSheet(null); };
  // page ouverte depuis Moi (D9) : le retour y ramène
  wireBack(app, () => ctx.back('#/reglages'));
  // « + N devises » / « Moins » : sur place, sans redessiner la page
  const curs = $('[data-curs]', app);
  if (curs) curs.onclick = () => {
    allCurs = !allCurs;
    buzz(6);
    $$('.w-curs .w-cur:not(.more)', app).forEach((c, i) => { c.hidden = !allCurs && i >= 3; });
    curs.setAttribute('aria-expanded', String(allCurs));
    const n = others.length - 3;
    curs.textContent = allCurs ? 'Moins' : `+ ${n} devise${n > 1 ? 's' : ''}`;
  };
  const arch = $('[data-arch]', app);
  // ouvrir ou fermer les archivés sur place (2026-11-27, avec l'utilisateur : redessiner toute la page faisait un flash)
  if (arch) arch.onclick = () => {
    showArchived = !showArchived;
    buzz(6);
    /** @type {HTMLElement} */ ($('[data-archlist]', app)).hidden = !showArchived;
    arch.setAttribute('aria-expanded', String(showArchived));
    $('.n', arch).innerHTML = `${$('[data-archlist]', app).children.length}${icon(showArchived ? 'caret-down' : 'caret-right')}`;
  };
  // loupe : filtre la liste par nom et par type (début des mots, sans accents)
  const find = $('[data-find]', app), box = $('[data-findbox]', app), q = $('input[data-q]', app);
  const filter = () => {
    const t = fold(q.value);
    let n = 0;
    $$('[data-list] [data-q]', app).forEach(r => { const on = !t || ` ${r.dataset.q}`.includes(` ${t}`); r.hidden = !on; n += on ? 1 : 0; });
    $('[data-none]', app).hidden = n > 0;
    const archs = $('[data-archs]', app);
    if (archs) archs.hidden = !!t;
  };
  if (find) find.onclick = () => {
    searching = !searching;
    buzz(6);
    box.hidden = !searching;
    find.setAttribute('aria-pressed', String(searching));
    if (searching) q.focus(); else { q.value = ''; filter(); }
  };
  if (q) q.addEventListener('input', filter);
  // entrer en rangement referme la loupe : on range la liste entière
  const closeFind = () => { if (!searching) return; searching = false; box.hidden = true; find.setAttribute('aria-pressed', 'false'); q.value = ''; filter(); };
  if (arrange) wireArrange(screen, arrange, 'wallets', on => { if (on) closeFind(); });
  // ranger (mode « Ranger », poignées) : l'ordre des portefeuilles actifs
  const dl = $('[data-list]', app);
  if (dl) enableReorder(dl, ids => reorderAccounts(ids));
  fitText(app, '.hero .big, .wrow .w-bal');
  countUp(app);
}
