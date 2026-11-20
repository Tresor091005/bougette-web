// Cloche (D17, ROADMAP 4a) : ce que les réserves et les objectifs ont à dire, peu de messages pour qu'elle ne devienne pas
// un bruit de fond. Échéance dans 7 jours et réserve qui ne sera pas prête à temps (D17 revu le 2026-11-20 : d'après ce
// qui est prévu) ; réserve échue (Utiliser, Repousser, Clore depuis la page Épargne) ; « Rien de prévu » (une fois, au
// passage, pas chaque jour) ; réserve en une fois prête (une fois : « Tu la dépenses quand ? »), puis le rappel le jour
// de son échéance ; objectif atteint (une fois). Chaque message part de lui-même quand la situation est réglée. Lu à
// l'ouverture et après chaque changement des données.
import { savingsAccounts, savingsReport, pref } from './store.js';
import { money, shortDate, yearDate, approx, today } from './format.js';
import { notify, resolve, messages } from './inbox.js';

const KEY = /^(res-soon|res-due|res-late|res-ready|res-day|goal-ok|goal-off)-/;

export function checkReserves() {
  /** @type {Set<string>} */
  const live = new Set();
  // retards et objectifs déjà signalés : on ne répète pas (préférences du téléphone)
  const lateSeen = new Set(/** @type {string[]} */ (pref('lateSeen') || []));
  const goalSeen = new Set(/** @type {string[]} */ (pref('goalSeen') || []));
  const readySeen = new Set(/** @type {string[]} */ (pref('readySeen') || []));
  const goalOffSeen = new Set(/** @type {string[]} */ (pref('goalOffSeen') || []));
  const goalOffNow = new Set();
  const lateNow = new Set(), goalNow = new Set(), readyNow = new Set();
  for (const a of savingsAccounts()) {
    if (a.archived) continue;
    const r = savingsReport(a.id);
    const cur = a.currency;
    for (const v of r.reserves) {
      const res = v.reserve;
      if (v.overdue) {
        live.add(`res-due-${res.id}`);
        notify({ key: `res-due-${res.id}`, kind: 'warn', title: `${res.name} : date passée`, body: v.full ? 'Elle est remplie : utilise-la, repousse-la ou clos-la.' : `${money(v.saved, { cur, hide: false })} mis de côté sur ${money(v.target, { cur, hide: false })}. Utilise, repousse, réduis ou clos-la.`, action: { label: 'Voir', id: 'savings' } }, { every: 7 * 86400e3 });
        continue;
      }
      // en une fois et remplie (2026-11-19, avec l'utilisateur) : une fois, « Tu la dépenses quand ? » (Maintenant, le jour
      // de son échéance, une autre date) ; le jour de son échéance, le rappel
      if (res.mode === 'once' && v.full) {
        if (res.due === today()) {
          live.add(`res-day-${res.id}`);
          notify({ key: `res-day-${res.id}`, kind: 'warn', title: `${res.name} : c’est aujourd’hui`, body: 'Elle est prête : utilise-la.', action: { label: 'Utiliser', id: `use:${res.id}` } }, { every: 86400e3 });
        } else {
          readyNow.add(res.id);
          if (!readySeen.has(res.id)) {
            live.add(`res-ready-${res.id}`);
            notify({ key: `res-ready-${res.id}`, kind: 'info', title: `${res.name} est prête`, body: 'Tu la dépenses quand ? On te le rappellera ce jour-là.', action: { label: 'Choisir', id: `when:${res.id}` } });
          } else if (messages().some(m => m.key === `res-ready-${res.id}`)) live.add(`res-ready-${res.id}`);
        }
      }
      // dans 7 jours et pas prête à temps : muette quand ce qui est prévu la remplit à temps (2026-11-19) ; sinon le jour
      // où elle le sera, ce qui manquera à sa date, ou ce qui manque, rien n'étant prévu
      if (v.soon && v.status !== 'ok') {
        const body = v.status === 'later' ? `Elle ne sera prête que le ${v.ready.slice(0, 4) === today().slice(0, 4) ? shortDate(v.ready) : yearDate(v.ready)}.`
          : v.status === 'short' ? `Il manquera ${money(approx(v.short, cur), { cur, hide: false })}.` : `Il manque ${money(v.target - v.saved, { cur, hide: false })}, et rien de prévu.`;
        live.add(`res-soon-${res.id}`);
        notify({ key: `res-soon-${res.id}`, kind: 'warn', title: `${res.name} le ${shortDate(res.due)}`, body, action: { label: 'Voir', id: 'savings' } }, { every: 7 * 86400e3 });
      }
      // rien de prévu, une fois ; à 7 jours ou moins, le message d'au-dessus le dit déjà
      if (v.status === 'none' && !v.soon) {
        lateNow.add(res.id);
        if (!lateSeen.has(res.id)) {
          live.add(`res-late-${res.id}`);
          notify({ key: `res-late-${res.id}`, kind: 'warn', title: `${res.name} : rien de prévu`, body: `Il manque ${money(approx(v.target - v.saved, cur), { cur, hide: false })} : programme le versement de ${a.name}.`, action: { label: 'Voir', id: 'savings' } });
        } else if (messages().some(m => m.key === `res-late-${res.id}`)) live.add(`res-late-${res.id}`);
      }
    }
    // un ancien objectif sur une épargne qui a des réserves (2026-11-20 : l'un ou l'autre) : dit une fois qu'il n'est plus suivi
    if (a.goal && !a.emergency && r.reserves.length) {
      goalOffNow.add(a.id);
      if (!goalOffSeen.has(a.id)) {
        live.add(`goal-off-${a.id}`);
        notify({ key: `goal-off-${a.id}`, kind: 'info', title: `${a.name} : l’objectif n’est plus suivi`, body: 'Une épargne a des réserves ou un objectif. Pour un objectif, crée une autre épargne.', action: { label: 'Voir', id: 'savings' } });
      } else if (messages().some(m => m.key === `goal-off-${a.id}`)) live.add(`goal-off-${a.id}`);
    }
    if (r.goal?.reached) {
      goalNow.add(a.id);
      if (!goalSeen.has(a.id)) {
        live.add(`goal-ok-${a.id}`);
        notify({ key: `goal-ok-${a.id}`, kind: 'info', title: 'Objectif atteint', body: `${a.name} : ${money(r.goal.amount, { cur, hide: false })} mis de côté.`, action: { label: 'Voir', id: 'savings' } });
      } else if (messages().some(m => m.key === `goal-ok-${a.id}`)) live.add(`goal-ok-${a.id}`);
    }
  }
  pref('lateSeen', [...lateNow]);
  pref('readySeen', [...readyNow]);
  pref('goalOffSeen', [...goalOffNow]);
  pref('goalSeen', [...goalNow]);
  for (const m of messages()) if (KEY.test(m.key) && !live.has(m.key)) resolve(m.key);
}
