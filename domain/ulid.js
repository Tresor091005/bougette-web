// ULID : 48 bits de temps (ms) + 80 bits aléatoires, en base 32 de Crockford (26 caractères, triable dans le temps).
// Monotone : deux identifiants dans la même milliseconde restent dans l'ordre (l'aléa est incrémenté).

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * @param {{ now?: () => number, random?: () => number }} [opts] horloge et aléa injectables (tests, démo déterministe)
 * @returns {() => string}
 */
export function createUlid({ now = () => Date.now(), random = () => Math.random() } = {}) {
  let lastTime = -1;
  /** @type {number[]} */
  let lastRand = [];
  return () => {
    let t = Math.floor(now());
    if (t < lastTime) t = lastTime; // l'horloge recule : on garde l'ordre
    let rand;
    if (t === lastTime) {
      rand = lastRand.slice();
      let i = rand.length - 1;
      while (i >= 0 && rand[i] === 31) { rand[i] = 0; i--; }
      if (i < 0) throw new Error('ULID : trop d’identifiants dans la même milliseconde');
      rand[i]++;
    } else {
      rand = Array.from({ length: 16 }, () => Math.floor(random() * 32) & 31);
    }
    lastTime = t;
    lastRand = rand;
    let time = '';
    for (let i = 0; i < 10; i++) { time = B32[t % 32] + time; t = Math.floor(t / 32); }
    return time + rand.map(r => B32[r]).join('');
  };
}

/**
 * Milliseconde encodée dans un ULID.
 * @param {string} id
 */
export function ulidTime(id) {
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + B32.indexOf(ch);
  return t;
}
