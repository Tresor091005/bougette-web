// Cloche (D18) : une échéance du jour ou en retard, rentrées comprises (Confirmer reste à faire). Un message par
// échéance (une règle, ou une ancienne opération prévue), pas par date ; au-delà de trois, un seul message qui les compte
// (la cloche garde peu de messages : elle ne doit ni déborder ni se répéter). Un message déjà là n'est pas remis (lu ou
// non) ; il part de lui-même quand tout est réglé.
import { duesToLook, account, category, dueRoot, dueChainIds } from './store.js';
import { money, shortDate, today } from './format.js';
import { notify, resolve, messages } from './inbox.js';

const KEY = /^due-/;
const MAX = 3;

/** @param {import('../domain/dues.js').Due} d */
const title = d => d.note || (d.kind === 'transfer' ? `Vers ${account(d.to || '')?.name || '…'}` : category(d.category || '')?.name || 'Échéance');

export function checkDues() {
  const t = today();
  /** @type {Map<string, import('../domain/dues.js').Due[]>} */
  const byOne = new Map();
  for (const d of duesToLook()) {
    // une échéance : ses règles successives (une modification la coupe) comptent pour une, sous sa première règle (qui
    // ne change pas : modifier l'échéance ne remet pas son message)
    const k = d.schedule ? dueRoot(d.schedule) : `entry:${d.entry}`;
    byOne.set(k, [...(byOne.get(k) || []), d]);
  }
  /** @type {Set<string>} */
  const live = new Set();
  const has = (/** @type {string} */ key) => messages().some(m => m.key === key);
  if (byOne.size > MAX) {
    live.add('due-many');
    if (!has('due-many')) notify({ key: 'due-many', kind: 'warn', title: `${byOne.size} échéances à régler`, body: 'Confirme-les ou passe-les dans l’onglet Plan.', action: { label: 'Voir', id: 'dues' } });
  } else {
    for (const [k, list] of byOne) {
      const key = `due-${k}`;
      // un message déjà là sous une autre règle de la même échéance (avant : une clé par règle) reste le sien
      const old = k.startsWith('entry:') ? null : dueChainIds(k).map(x => `due-${x}`).find(x => x !== key && has(x));
      if (old) { live.add(old); continue; }
      live.add(key);
      if (has(key)) continue;
      const d = list[0], late = list.filter(x => x.date < t).length;
      const amount = money(d.amount, { cur: d.currency, hide: false });
      notify({
        key, kind: 'warn',
        title: late > 1 ? `${title(d)} : ${late} retards` : late ? `${title(d)} en retard` : `${title(d)} aujourd’hui`,
        body: late ? `${amount}, prévue le ${shortDate(d.date)} : confirme-la ou passe-la.` : `${amount} : confirme-la ou passe-la.`,
        action: { label: 'Voir', id: 'dues' },
      });
    }
  }
  for (const m of messages()) if (KEY.test(m.key) && !live.has(m.key)) resolve(m.key);
}
