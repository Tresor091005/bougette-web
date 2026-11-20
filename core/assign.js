// Argent à répartir (D11, 2026-11-09, revu le 2026-11-10) : « Plus tard » sur la feuille d'une rentrée ne veut pas dire
// « oublié ». C'est le rappel d'une DÉCISION pas encore prise, pas un montant restant (l'argent ne garde pas d'étiquette :
// on ne peut pas suivre ce qui reste d'une rentrée). Les rentrées laissées pour plus tard se cumulent dans UN message de
// la cloche (« 200 000 F arrivés le 9 nov. : tu n'as pas encore décidé quoi en faire », bouton « Répartir » vers Budget). Le message part de lui-même dès qu'une destination est donnée : un budget créé, ou
// de l'argent mis de côté (virement vers un portefeuille hors du total). Préférences du téléphone, pas le journal.
import { pref } from './store.js';
import { money, shortDate, today } from './format.js';
import { notify, resolve } from './inbox.js';

/** @typedef {{ amount: number, n: number, since: string }} ToAssign */

/** Une rentrée laissée pour plus tard. @param {number} amount (monnaie principale) */
export function remindLater(amount) {
  const cur = /** @type {ToAssign|null} */ (pref('toAssign'));
  const next = { amount: (cur?.amount || 0) + amount, n: (cur?.n || 0) + 1, since: cur?.since || today() };
  pref('toAssign', next);
  notify({
    key: 'assign', kind: 'warn', title: 'Argent à répartir',
    body: next.n > 1 ? `${money(next.amount, { hide: false })} arrivés depuis le ${shortDate(next.since)} : tu n’as pas encore décidé quoi en faire.`
      : `${money(next.amount, { hide: false })} arrivés le ${shortDate(next.since)} : tu n’as pas encore décidé quoi en faire.`,
    action: { label: 'Répartir', id: 'assign' },
  });
}

/** Une destination a été donnée : le rappel part. */
export function assigned() {
  if (!pref('toAssign')) return;
  pref('toAssign', null);
  resolve('assign');
}
