// Accueil du style Proto (D1, 2026-11-17, avec l'utilisateur ; essayé d'abord dans « Protofinance ») : une grille de tuiles carrées, un chiffre
// par tuile (« 26 / 30 NOV »), nuit, bleu ardoise et crème. Les mêmes données que l'accueil Carnet (home.js) :
// le fil du mois (src/domain/pace.js (runway)), Disponible, les dépenses du mois par semaine, le rythme par jour,
// les échéances à payer, les portefeuilles, et la saisie.
import { settings, countedAccounts, balances, transactions, budgetReport, txCur, category } from '../core/store.js';
import { period, today, money, esc, parse, shortDate, stepOf } from '../core/format.js';
import { buzz, dockTip, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { runway, daysBetween } from '../domain/pace.js';
import { unread } from '../core/inbox.js';
import { openInboxSheet } from './backup.js';
import { openEntry } from './entry.js';
import { isMain, currentSpace } from '../core/spaces.js';

const fmtHead = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
/** Un montant sans son symbole (la tuile dit « F » à part). @param {number} v */
const amt = v => esc(money(v)).replace(/\s*(F|FCFA)$/, '');

export function render(app, { go }) {
  const st = settings();
  const main = st.currency;
  const t = today();
  const p = period(t, st.monthStart);
  const moves = transactions().filter(x => txCur(x) === main);
  const report = budgetReport();
  const run = runway({ base: report.total - report.toPay, moves, today: t, period: p, step: stepOf(main) });
  const day = (/** @type {string} */ d) => String(Number(d.slice(8)));
  const end = shortDate(p.end).toUpperCase();
  const hide = !!st.discreet;

  // tuile bleue : jusqu'où tient l'argent
  const hold = run.state === 'whole' ? { v: day(p.end), d: `/ ${end}` }
    : run.state === 'short' ? { v: day(run.until), d: `/ ${end}` }
      : run.state === 'empty' ? { v: '0', d: 'tout engagé' }
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

  // seulement les portefeuilles comptés dans le total (2026-11-18, avec l'utilisateur) ; les autres restent dans Portefeuilles
  const wallets = countedAccounts().filter(a => !a.archived);
  const bal = balances();
  const head = isMain() ? 'Bougette' : currentSpace().name;

  app.innerHTML = `<div class="screen home pf-home">
    <div class="pf-top">
      <span class="pf-brand">${icon('squares-four')}${esc(head)}</span>
      <span class="pf-date">${esc(fmtHead.format(parse(t)).replace(/\./g, ''))}</span>
      <button type="button" class="iconbtn round bell" data-inbox aria-label="Notifications">${icon('bell')}${unread() ? '<i class="dot" aria-hidden="true"></i>' : ''}</button>
    </div>
    <div class="pf-grid">
      <button type="button" class="pf-t blue" data-go="#/mois"><span class="pf-l">Ton argent tient<i>:</i></span>
        <span class="pf-row"><b class="pf-v">${hold.v}</b><span class="pf-d">${hold.d}</span></span></button>
      <button type="button" class="pf-t" data-go="#/mois"><span class="pf-l">Disponible<i>:</i></span>
        <span class="pf-row"><b class="pf-v sm${report.available < 0 ? ' loss' : ''}">${hide ? '•••' : amt(report.available)}</b><span class="pf-d">F</span></span></button>

      <button type="button" class="pf-t w tall" data-go="#/operations"><span class="pf-l">Dépenses · ${esc(p.label)}<i>${perWeek.map((_, i) => `<em class="${i === nowWeek ? 'on' : ''}">S${i + 1}</em>`).join(' ')}</i></span>
        <span class="pf-row"><span class="pf-col"><span class="pf-s">${esc(shortDate(t).toUpperCase())}</span><b class="pf-v">${hide ? '•••' : amt(spent)}</b></span>
          <span class="pf-bars" aria-hidden="true">${perWeek.map((v, i) => `<i class="${i === nowWeek ? 'on' : ''}" style="height:${Math.max(4, Math.round((v / maxW) * 100))}%"></i>`).join('')}</span></span></button>

      <div class="pf-t ring">
        <svg viewBox="0 0 104 104" aria-hidden="true"><circle cx="52" cy="52" r="46" class="trk"/><circle cx="52" cy="52" r="46" class="arc" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - ratio)).toFixed(1)}" transform="rotate(-90 52 52)"/></svg>
        <span class="pf-ring"><b>${run.state === 'unknown' || hide ? '—' : amt(Math.round(run.rate))}</b><span>F / jour</span></span></div>

      <button type="button" class="pf-t" data-go="#/mois/echeances"><span class="pf-l">À payer<i>:</i></span>
        <span class="pf-row"><b class="pf-v">${dues.length}</b><span class="pf-d">${hide ? '' : `/ ${amt(report.toPay)} F`}</span></span>
        <span class="pf-s pf-next">${next ? esc(`${dueName} · ${shortDate(next.date)}`) : 'Rien d’ici la fin du mois'}</span></button>

      <button type="button" class="pf-t w list" data-go="#/portefeuilles"><span class="pf-l">Portefeuilles<i>${wallets.length}</i></span>
        ${wallets.slice(0, 4).map(a => `<span class="pf-wl"><span>${esc(a.name)}</span><span>${hide ? '•••' : amt(bal[a.id] || 0)}</span></span>`).join('')}</button>

      <button type="button" class="pf-t w stone" data-new><span class="pf-arr">${icon('arrow-up-right')}</span>
        <span class="pf-row"><b class="pf-v md">Nouvelle<br>opération</b><span class="pf-d">6 touchers</span></span></button>
    </div>
  </div>`;

  $$('[data-go]', app).forEach(b => (b.onclick = () => { buzz(6); go(b.dataset.go); }));
  $('[data-new]', app).onclick = () => { buzz(8); openEntry(); };
  $('[data-inbox]', app).onclick = () => { buzz(6); openInboxSheet(); };
  dockTip(null);
}
