// Accueil (D3, D1 revu le 2026-11-21 avec l'utilisateur : la même structure dans les deux styles, celle essayée d'abord
// dans « Protofinance ») : une grille de tuiles, un chiffre par tuile (« 26 / 30 nov ») ; chaque style y garde ses
// couleurs, ses polices et ses coins (src/core/proto.css, .pf-*). Jusqu'où tient l'argent (src/domain/pace.js (runway)),
// Disponible, les dépenses du mois par semaine, le rythme face à d'habitude, les échéances à payer, les portefeuilles, la saisie.
import { settings, accounts, countedAccounts, balances, transactions, budgetReport, txCur, category } from '../core/store.js';
import { period, today, money, esc, parse, shortDate, stepOf } from '../core/format.js';
import { buzz, dockTip, reducedMotion, openSheet, $, $$ } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { runway, daysBetween, habitPace } from '../domain/pace.js';
import { unread } from '../core/inbox.js';
import { openInboxSheet } from './backup.js';
import { openEntry } from './entry.js';
import { openAccountSheet } from './accounts.js';
import { isMain, currentSpace } from '../core/spaces.js';
import { spaceAvatar } from '../core/avatar.js';
import { openSpacesSheet } from './spaces.js';

// L'ouverture (2026-11-21, avec l'utilisateur) : au premier rendu de l'accueil, ses tuiles se lèvent l'une après l'autre,
// comme l'écran Bienvenue ; une fois par ouverture de l'app, jamais avec « réduire les animations ». Verrouillée, l'app
// tient le mouvement en pause sous le code (proto.css, html.locked) : il se joue au déverrouillage. Passer à un autre
// espace (D19) est une ouverture : elles se lèvent de nouveau.
let risen = false;
window.addEventListener('bougette:space', () => { risen = false; });

const fmtHead = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
/** Un montant sans son symbole (la tuile dit « F » à part). @param {number} v */
const amt = v => esc(money(v)).replace(/\s*(F|FCFA)$/, '');

/**
 * La courbe du rythme (revue le 2026-11-23, avec l'utilisateur) : d'habitude en trait fin pointillé sur toute la période,
 * ce mois-ci en trait plein avec une aire légère dessous, un point sur aujourd'hui ; lissée (courbe de Bézier entre les
 * jours). big : la feuille du détail, avec la date de début, aujourd'hui et la fin dessous.
 * @param {ReturnType<typeof habitPace>} h @param {string} cls @param {{ big?: boolean, start?: string, end?: string, today?: string }} [o]
 */
function habitCurve(h, cls, { big = false, start = '', end = '', today: now = '' } = {}) {
  if (!h.months && !h.now) return '';
  const W = big ? 320 : 140, H = big ? 120 : 58, pad = 4;
  const n = Math.max(2, h.curveUsual.length);
  const max = Math.max(1, ...h.curveUsual, ...h.curveNow) * 1.08;
  const x = (/** @type {number} */ i) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (/** @type {number} */ v) => H - pad - (v / max) * (H - 2 * pad);
  /** une courbe lissée par les points (Catmull-Rom vers Bézier, sans dépasser) @param {number[]} c */
  const path = c => {
    const p = c.map((v, i) => [x(i), y(v)]);
    if (p.length < 2) return p.length ? `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}` : '';
    let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, y0] = p[i - 1] || p[i], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2] || p[i + 1];
      const c1 = [x1 + (x2 - x0) / 6, Math.min(Math.max(y1 + (y2 - y0) / 6, Math.min(y1, y2)), Math.max(y1, y2))];
      const c2 = [x2 - (x3 - x1) / 6, Math.min(Math.max(y2 - (y3 - y1) / 6, Math.min(y1, y2)), Math.max(y1, y2))];
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    return d;
  };
  const last = h.curveNow.length - 1;
  const nowLine = path(h.curveNow);
  const area = h.curveNow.length > 1 ? `${nowLine} L${x(last).toFixed(1)},${(H - pad).toFixed(1)} L${x(0).toFixed(1)},${(H - pad).toFixed(1)} Z` : '';
  const gid = `hg-${cls}`;
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent-text)" stop-opacity=".38"/><stop offset="1" stop-color="var(--accent-text)" stop-opacity="0"/></linearGradient></defs>
    <line class="base" x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}"/>
    ${big ? `<line class="tick" x1="${x(last).toFixed(1)}" x2="${x(last).toFixed(1)}" y1="${pad}" y2="${H - pad}"/>` : ''}
    ${h.months ? `<path class="usual" d="${path(h.curveUsual)}"/>` : ''}
    ${area ? `<path class="area" d="${area}" fill="url(#${gid})"/>` : ''}
    <path class="now" d="${nowLine}"/>
    <circle class="dot" cx="${x(last).toFixed(1)}" cy="${y(h.curveNow[last] || 0).toFixed(1)}" r="${big ? 4 : 3}"/>
  </svg>${big ? (() => {
    // « aujourd'hui » sous le point du jour (caché trop près d'un bord, où la date du début ou de la fin le dit)
    const at = (x(last) / W) * 100;
    return `<div class="hb-axis"><span>${esc(start)}</span>${at > 18 && at < 82 ? `<span class="today" style="left:${at.toFixed(1)}%">${esc(now)}</span>` : ''}<span>${esc(end)}</span></div>`;
  })() : ''}`;
}

/** Le détail du rythme : les deux chiffres, la courbe en grand, d'où vient « d'habitude ». @param {ReturnType<typeof habitPace>} h @param {string} day @param {string} cur @param {{ start: string, end: string, today: string }} dates */
function openHabitSheet(h, day, cur, dates) {
  openSheet(`<div class="acc-sheet hb-sheet">
    <h2 class="sheet-title">Ce mois-ci face à d’habitude</h2>
    <div class="hb-nums"><div><span class="hb-l"><i class="hb-k now"></i>Ce mois-ci, au ${esc(day)}</span><b>${esc(money(h.now, { cur }))}</b></div>
      <div><span class="hb-l"><i class="hb-k usual"></i>D’habitude, au ${esc(day)}</span><b>${h.months ? esc(money(h.usual, { cur })) : '—'}</b></div></div>
    ${habitCurve(h, 'hb-curve', { big: true, ...dates })}
    <p class="field-note">${h.months ? `D’habitude : la moyenne de ${h.months > 1 ? `tes ${h.months} derniers mois` : 'ton dernier mois'}, au même jour. ` : 'Pas encore de mois complet pour comparer : reviens le mois prochain. '}Toutes tes dépenses notées, échéances comprises, sans les prévues.</p>
  </div>`, { label: 'Rythme' });
}

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
  // le rythme face à d'habitude (2026-11-23, avec l'utilisateur : l'anneau « F / jour » se lisait comme ce qu'on a le droit
  // de dépenser) : dépensé depuis le début de la période, face à la moyenne des 3 d'avant au même jour
  const habit = habitPace({ moves, today: t, current: p, previous: [1, 2, 3].map(k => period(t, st.monthStart, -k)) });
  const habitV = habit.pct == null ? '—' : `${habit.pct > 0 ? '+' : habit.pct < 0 ? '−' : ''}${Math.abs(habit.pct)} %`;
  const habitS = habit.pct == null ? (habit.months ? 'Rien d’habitude à cette date' : 'Pas encore d’habitude')
    : `${habit.pct > 0 ? 'de plus' : habit.pct < 0 ? 'de moins' : 'comme'} que d’habitude`;

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

      <button type="button" class="pf-t habit" data-habit><span class="pf-l">Rythme<i>:</i></span>
        ${habitCurve(habit, 'pf-curve')
          ? `<b class="pf-v sm${habit.pct != null && habit.pct > 10 ? ' warn' : ''}">${habitV}</b>${habitCurve(habit, 'pf-curve')}`
          // rien à tracer encore : le chiffre en bas, comme À payer à côté (2026-11-24, avec l'utilisateur)
          : `<span class="pf-row"><b class="pf-v">${habitV}</b></span>`}
        <span class="pf-s pf-say">${esc(habitS)}</span></button>

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
  $('[data-habit]', app).onclick = () => { buzz(6); openHabitSheet(habit, day(t), main, { start: shortDate(p.start), end: shortDate(p.end), today: 'aujourd’hui' }); };
  $('[data-inbox]', app).onclick = () => { buzz(6); openInboxSheet(); };
  // la tête de l'espace (D19, 2026-11-21) : un toucher ouvre la liste des espaces
  $('[data-spaces]', app).onclick = () => { buzz(6); openSpacesSheet({ go: h => { location.hash = h; } }); };
  const nw = $('[data-new-wallet]', app);
  if (nw) nw.onclick = () => { buzz(6); openAccountSheet(null, { savings: false }); };
  // premier jour (D10) : la bulle invite à la première dépense, une fois un portefeuille créé
  dockTip(accounts().length && !all.some(x => x.type === 'expense' && !x.planned) ? 'Ajoute ta première dépense' : null);
}
