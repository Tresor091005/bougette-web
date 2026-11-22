// Accueil (D3, D1 revu le 2026-11-21 avec l'utilisateur : la même structure dans les deux styles, celle essayée d'abord
// dans « Protofinance ») : une grille de tuiles, un chiffre par tuile (« 26 / 30 nov ») ; chaque style y garde ses
// couleurs, ses polices et ses coins (src/core/proto.css, .pf-*). Jusqu'où tient l'argent (src/domain/pace.js (runway)),
// Disponible, les dépenses du mois par semaine, le rythme par jour, les échéances à payer, les portefeuilles, la saisie.
import { settings, accounts, countedAccounts, balances, transactions, budgetReport, txCur, category } from '../core/store.js';
import { period, today, money, esc, parse, shortDate, stepOf } from '../core/format.js';
import { buzz, dockTip, reducedMotion, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { runway, daysBetween } from '../domain/pace.js';
import { unread } from '../core/inbox.js';
import { openInboxSheet } from './backup.js';
import { openEntry } from './entry.js';
import { openAccountSheet } from './accounts.js';
import { isMain, currentSpace } from '../core/spaces.js';
import { spaceAvatar } from '../core/avatar.js';
import { openSpacesSheet } from './spaces.js';

// L'ouverture (2026-11-21, avec l'utilisateur) : au premier rendu de l'accueil, ses tuiles se lèvent l'une après l'autre,
// comme l'écran Bienvenue ; une fois par ouverture de l'app, jamais avec « réduire les animations ». Verrouillée, l'app
// tient le mouvement en pause sous le code (proto.css, html.locked) : il se joue au déverrouillage.
let risen = false;

const fmtHead = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
/** Un montant sans son symbole (la tuile dit « F » à part). @param {number} v */
const amt = v => esc(money(v)).replace(/\s*(F|FCFA)$/, '');

export function render(app, { go }) {
  const st = settings();
  const main = st.currency;
  const t = today();
  const p = period(t, st.monthStart);
  const all = transactions();
  const moves = all.filter(x => txCur(x) === main);
  const report = budgetReport();
  const run = runway({ base: report.total - report.toPay, moves, today: t, period: p, step: stepOf(main) });
  const day = (/** @type {string} */ d) => String(Number(d.slice(8)));
  const end = shortDate(p.end);

  // tuile bleue : jusqu'où tient l'argent
  const hold = run.state === 'whole' ? { v: day(p.end), d: `/ ${end}` }
    : run.state === 'short' ? { v: day(run.until), d: `/ ${end}` }
      : run.state === 'empty' ? { v: '0', d: 'rien de libre' }
        : { v: '—', d: 'note tes dépenses' };

  // dépenses du mois, par semaine de la période (la semaine en cours en bleu)
  const weeks = Math.ceil(p.days / 7);
  const perWeek = Array(weeks).fill(0);
  let spent = 0;
  for (const m of moves) {
    if (m.type !== 'expense' || m.planned || m.date < p.start || m.date > p.end) continue;
    perWeek[Math.min(weeks - 1, Math.floor(daysBetween(p.start, m.date) / 7))] += m.amount;
    spent += m.amount;
  }
  const nowWeek = Math.max(0, Math.min(weeks - 1, Math.floor(daysBetween(p.start, t) / 7)));
  const maxW = Math.max(1, ...perWeek);

  // anneau : le rythme par jour ; plein quand l'argent tient tout le mois
  const C = 2 * Math.PI * 46;
  const ratio = run.state === 'unknown' ? 0 : run.ratio;

  // échéances à payer d'ici la fin du mois
  const dues = report.dues;
  const next = dues[0];
  const dueName = next ? (next.note || category(next.category || '')?.name || 'Échéance') : '';

  // seulement les portefeuilles comptés dans le total (2026-11-18, avec l'utilisateur) ; les autres restent dans Portefeuilles.
  // Aucun portefeuille (D10) : la tuile ouvre la fiche de création.
  const wallets = countedAccounts().filter(a => !a.archived);
  const anyWallet = accounts().some(a => !a.archived);
  const bal = balances();
  const head = isMain() ? 'Bougette' : currentSpace().name;
  const n = unread();

  const rise = !risen && !reducedMotion();
  risen = true;
  app.innerHTML = `<div class="screen home pf-home${rise ? ' pf-rise' : ''}">
    <div class="pf-top">
      <button type="button" class="pf-brand sp-go" data-spaces aria-label="Espace : ${esc(currentSpace().name)}, changer d’espace"><span class="pf-ava" aria-hidden="true">${spaceAvatar(currentSpace())}</span>${esc(head)}${icon('caret-down')}</button>
      <span class="pf-date">${esc(fmtHead.format(parse(t)).replace(/\./g, ''))}</span>
      <button type="button" class="iconbtn round bell" data-inbox aria-label="Notifications${n ? ` (${n} nouvelle${n > 1 ? 's' : ''})` : ''}">${icon('bell')}${n ? '<i class="dot" aria-hidden="true"></i>' : ''}</button>
    </div>
    <div class="pf-grid">
      <button type="button" class="pf-t blue" data-go="#/mois"><span class="pf-l">Ton argent tient<i>:</i></span>
        <span class="pf-row"><b class="pf-v">${hold.v}</b><span class="pf-d">${hold.d}</span></span></button>
      <button type="button" class="pf-t" data-go="#/mois"><span class="pf-l">Disponible<i>:</i></span>
        <span class="pf-row"><b class="pf-v sm${report.available < 0 ? ' loss' : ''}">${amt(report.available)}</b><span class="pf-d">F</span></span></button>

      <button type="button" class="pf-t w tall" data-go="#/operations"><span class="pf-l">Dépenses · ${esc(p.label)}<i>${perWeek.map((_, i) => `<em class="${i === nowWeek ? 'on' : ''}">S${i + 1}</em>`).join(' ')}</i></span>
        <span class="pf-row"><span class="pf-col"><span class="pf-s">${esc(shortDate(t))}</span><b class="pf-v">${amt(spent)}</b></span>
          <span class="pf-bars" aria-hidden="true">${perWeek.map((v, i) => `<i class="${i === nowWeek ? 'on' : ''}" style="height:${Math.max(4, Math.round((v / maxW) * 100))}%"></i>`).join('')}</span></span></button>

      <div class="pf-t ring">
        <svg viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="46" class="trk"/><circle cx="52" cy="52" r="46" class="arc" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - ratio)).toFixed(1)}" transform="rotate(-90 52 52)"/></svg>
        <span class="pf-ring"><b>${run.state === 'unknown' ? '—' : amt(Math.round(run.rate))}</b><span>F / jour</span></span></div>

      <button type="button" class="pf-t" data-go="#/mois/echeances"><span class="pf-l">À payer<i>:</i></span>
        <span class="pf-row"><b class="pf-v">${dues.length}</b><span class="pf-d">/ ${amt(report.toPay)} F</span></span>
        <span class="pf-s pf-next">${next ? esc(`${dueName} · ${shortDate(next.date)}`) : 'Rien d’ici la fin du mois'}</span></button>

      ${wallets.length ? `<button type="button" class="pf-t w list" data-go="#/portefeuilles"><span class="pf-l">Portefeuilles<i>${wallets.length}</i></span>
        ${wallets.slice(0, 4).map(a => `<span class="pf-wl"><span>${esc(a.name)}</span><span>${amt(bal[a.id] || 0)}</span></span>`).join('')}</button>`
      : anyWallet ? `<button type="button" class="pf-t w list" data-go="#/portefeuilles"><span class="pf-l">Portefeuilles<i>0</i></span>
        <span class="pf-wl"><span>Aucun compté dans le total</span><span>Voir</span></span></button>`
      : `<button type="button" class="pf-t w list" data-new-wallet><span class="pf-l">Portefeuilles<i>0</i></span>
        <span class="pf-wl"><span>Pas encore de portefeuille</span><span>Ajouter</span></span></button>`}

      <button type="button" class="pf-t w stone" data-new><span class="pf-arr">${icon('arrow-up-right')}</span>
        <span class="pf-row"><b class="pf-v md">Nouvelle<br>opération</b><span class="pf-d">6 touchers</span></span></button>
    </div>
  </div>`;

  $$('[data-go]', app).forEach(b => (b.onclick = () => { buzz(6); go(b.dataset.go); }));
  $('[data-new]', app).onclick = () => { buzz(8); openEntry(); };
  $('[data-inbox]', app).onclick = () => { buzz(6); openInboxSheet(); };
  // la tête de l'espace (D19, 2026-11-21) : un toucher ouvre la liste des espaces
  $('[data-spaces]', app).onclick = () => { buzz(6); openSpacesSheet({ go: h => { location.hash = h; } }); };
  const nw = $('[data-new-wallet]', app);
  if (nw) nw.onclick = () => { buzz(6); openAccountSheet(null, { savings: false }); };
  // premier jour (D10) : la bulle invite à la première dépense, une fois un portefeuille créé
  dockTip(accounts().length && !all.some(x => x.type === 'expense' && !x.planned) ? 'Ajoute ta première dépense' : null);
}
