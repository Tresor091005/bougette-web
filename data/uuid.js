// Un identifiant tiré au hasard (uuid v4) et son contrôle. Il dessine la tête d'un espace (D19, revu le 2026-11-26, avec
// l'utilisateur) : chacun a la sienne, qui ne ressemble à celle d'aucun autre téléphone. Sans écran ni stockage.

/** Est-ce un uuid v4 ? @param {unknown} s @returns {s is string} */
export const isUuid4 = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

/**
 * Un uuid v4. randomUUID n'existe que sur une page sûre : sinon on le compose depuis 16 octets tirés au hasard.
 * @param {Crypto} [c]
 */
export function uuid4(c = globalThis.crypto) {
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
