// Copie exacte : le journal complet en JSON Lines (une ligne d'en-tête, puis un événement canonique par ligne).
// À l'import, la chaîne d'empreintes est vérifiée avant tout rejeu.
import { canonical } from '../domain/canonical.js';
import { verifyChain } from '../domain/events.js';

/** @typedef {import('../domain/events.js').StoredEvent} StoredEvent */
/** @typedef {{ app: 'cauri', kind: 'journal', version: string, schema: number, events: number, head: string, state: string }} JournalHeader */

/**
 * @param {JournalHeader} header
 * @param {StoredEvent[]} events
 */
export function toJsonl(header, events) {
  const lines = [canonical(header)];
  for (const e of events) lines.push(canonical({ seq: e.seq, id: e.id, type: e.type, v: e.v, at: e.at, device: e.device, payload: JSON.parse(e.payload), prev_hash: e.prev_hash, hash: e.hash }));
  return lines.join('\n') + '\n';
}

export class ImportError extends Error {}

/**
 * Lit et vérifie un journal exporté : en-tête, numéros, chaîne d'empreintes, nombre d'événements, empreinte de tête.
 * @param {string} text
 * @param {{ schema?: number }} [opts] schema : version de schéma de cette app (un journal plus récent est refusé)
 * @returns {Promise<{ header: JournalHeader, events: StoredEvent[] }>}
 */
export async function parseJsonl(text, { schema = Infinity } = {}) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new ImportError('Copie vide.');
  /** @type {any} */
  let header;
  try { header = JSON.parse(lines[0]); } catch (e) { throw new ImportError('Ce n’est pas une copie de Bougette.'); }
  if (!header || header.app !== 'cauri' || header.kind !== 'journal') throw new ImportError('Ce n’est pas une copie de Bougette.');
  if (typeof header.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(header.version)) throw new ImportError('Copie abîmée : la version de l’app ne se lit pas.');
  if (!Number.isInteger(header.schema) || header.schema < 1) throw new ImportError('Copie abîmée : la version des données ne se lit pas.');
  if (header.schema > schema) throw new ImportError('Copie faite par une version plus récente de Bougette. Mets l’app à jour.');
  if (!Number.isInteger(header.events) || header.events < 0) throw new ImportError('Copie abîmée : le nombre de changements ne se lit pas.');
  if (typeof header.head !== 'string' || typeof header.state !== 'string' || !/^[0-9a-f]{64}$/.test(header.state)) throw new ImportError('Copie abîmée : son début ne se lit pas.');
  /** @type {StoredEvent[]} */
  const events = [];
  for (let i = 1; i < lines.length; i++) {
    /** @type {any} */
    let o;
    try { o = JSON.parse(lines[i]); } catch (e) { throw new ImportError(`Copie abîmée : la ligne ${i + 1} ne se lit pas.`); }
    if (!o || typeof o.type !== 'string' || typeof o.id !== 'string' || typeof o.hash !== 'string') throw new ImportError(`Copie abîmée : la ligne ${i + 1} est incomplète.`);
    if (!o.payload || typeof o.payload !== 'object' || Array.isArray(o.payload)) throw new ImportError(`Copie abîmée : la ligne ${i + 1} ne se lit pas.`);
    events.push({ seq: o.seq, id: o.id, type: o.type, v: o.v, at: o.at, device: o.device, payload: canonical(o.payload), prev_hash: typeof o.prev_hash === 'string' ? o.prev_hash : '', hash: o.hash });
  }
  if (header.events !== events.length) throw new ImportError(`Copie incomplète : ${header.events} changements annoncés, ${events.length} trouvés.`);
  const chain = await verifyChain(events);
  if (!chain.ok) throw new ImportError(`Copie abîmée (${chain.problem}).`);
  if (header.head !== chain.head) throw new ImportError('Copie modifiée ou abîmée.');
  return { header, events };
}
