// Mettre de côté après un revenu (parcours 4, décidé le 2026-11-25 avec l'utilisateur) : on ne le propose que si des
// réserves manquent d'argent pour être prêtes à temps ET que la marge de Plan après ce revenu (Disponible − habitudes
// estimées) est positive. Le montant proposé : le plus petit du revenu, de la marge positive et de ce qui manque,
// arrondi au-dessous au pas de la devise. Fonctions pures, sur les vues que donne savingsReport (src/domain/reserves.js).
import { stepOf } from './format.js';

/**
 * Ce qui manque à une réserve pour être prête à temps (0 si elle le sera, est pleine ou en pause) : à son échéance,
 * ce que le rejeu dit qu'il manquera (short) ; échue, ou sans rien de prévu qui la remplisse, tout ce qui reste à mettre.
 * @param {import('./reserves.js').ReserveView} v
 */
export function missingOfView(v) {
  if (v.full || ['full', 'paused', 'ok'].includes(v.status)) return 0;
  const rest = Math.max(0, v.target - v.saved);
  if (v.status === 'overdue') return rest;
  return v.short > 0 ? Math.min(v.short, rest) : rest;
}

/** Ce qui manque aux réserves d'une épargne. @param {import('./reserves.js').ReserveView[]} views */
export const missingOf = views => views.reduce((n, v) => n + missingOfView(v), 0);

/**
 * L'épargne vers laquelle mettre de côté : celle à qui il manque le plus (null si rien ne manque nulle part).
 * @param {{ wallet: string, reserves: import('./reserves.js').ReserveView[] }[]} reports
 * @returns {{ wallet: string, missing: number }|null}
 */
export function asideTarget(reports) {
  /** @type {{ wallet: string, missing: number }|null} */
  let best = null;
  for (const r of reports) {
    const missing = missingOf(r.reserves);
    if (missing > 0 && (!best || missing > best.missing)) best = { wallet: r.wallet, missing };
  }
  return best;
}

/**
 * Le montant à proposer de mettre de côté (0 : pas de proposition) : le plus petit du revenu, de la marge (positive) et
 * de ce qui manque, arrondi au-dessous au pas de la devise.
 * @param {{ amount: number, margin: number, missing: number, cur?: string }} o
 */
export function asideAmount({ amount, margin, missing, cur }) {
  if (!(amount > 0) || !(margin > 0) || !(missing > 0)) return 0;
  const step = stepOf(cur);
  return Math.floor(Math.min(amount, margin, missing) / step) * step;
}
