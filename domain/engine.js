// Moteur : commandes → événements scellés → projection, sur une copie de l'état.
// La couche de données écrit ensuite les événements et les lignes touchées dans une seule transaction,
// et ne remplace l'état courant par la copie qu'après succès.
import { decide } from './commands.js';
import { seal, readEvent } from './events.js';
import { apply, cloneState, emptyState } from './projection.js';

/** @typedef {import('./projection.js').State} State */
/** @typedef {import('./commands.js').Command} Command */
/** @typedef {import('./commands.js').Ctx} Ctx */
/** @typedef {import('./events.js').StoredEvent} StoredEvent */
/** @typedef {import('./events.js').NewEvent} NewEvent */
/**
 * @typedef {{
 *   ctx: (cmd: Command|null) => Ctx,
 *   meta: (cmd: Command|null, e: NewEvent) => { id: string, at: string, device: string }
 * }} Env
 */

/**
 * Applique un événement stocké (format mis à jour à la lecture) et avance la tête.
 * @param {State} s
 * @param {StoredEvent} stored
 */
export function applyStored(s, stored) {
  apply(s, readEvent(stored));
  s.head = { seq: stored.seq, hash: stored.hash, at: stored.at };
}

/**
 * Rejoue des événements stockés depuis zéro.
 * @param {StoredEvent[]} events
 * @returns {State}
 */
export function replayStored(events) {
  const s = emptyState();
  for (const e of events) applyStored(s, e);
  return s;
}

/**
 * Scelle et applique des événements déjà décidés (conversion des anciennes données, import).
 * @param {State} next copie de travail (modifiée)
 * @param {NewEvent[]} news
 * @param {Env} env
 * @returns {Promise<StoredEvent[]>}
 */
export async function appendNew(next, news, env) {
  const out = [];
  for (const e of news) {
    const stored = await seal(e, next.head, env.meta(null, e));
    applyStored(next, stored);
    out.push(stored);
  }
  return out;
}

/**
 * Exécute des commandes dans l'ordre sur une copie de l'état. Tout ou rien : la première erreur interrompt.
 * @param {State} state
 * @param {Command[]} cmds
 * @param {Env} env
 * @returns {Promise<{ next: State, events: StoredEvent[] }>}
 */
/**
 * L'état après des commandes, sans rien écrire ni sceller : un aperçu (la page d'une échéance montre ce qu'une
 * modification ferait avant qu'on l'enregistre). Lève l'erreur du domaine si une commande est refusée.
 * @param {State} state @param {Command[]} cmds @param {Ctx} ctx @param {string} at
 * @returns {State}
 */
export function simulate(state, cmds, ctx, at) {
  const next = cloneState(state);
  for (const cmd of cmds) {
    for (const e of decide(next, cmd, ctx)) apply(next, { seq: next.head.seq + 1, id: '', type: e.type, v: 1, at, device: '', data: e.payload });
  }
  return next;
}

export async function execute(state, cmds, env) {
  const next = cloneState(state);
  const events = [];
  for (const cmd of cmds) {
    for (const e of decide(next, cmd, env.ctx(cmd))) {
      const stored = await seal(e, next.head, env.meta(cmd, e));
      applyStored(next, stored);
      events.push(stored);
    }
  }
  return { next, events };
}
