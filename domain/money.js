// Montants : entiers dans la plus petite unité de la devise, jamais de virgule flottante en stockage ni en calcul.
// La saisie est lue comme une chaîne décimale exacte ; une division s'arrondit au plus proche, demi vers le pair.

/**
 * Division entière arrondie au plus proche, demi vers le pair (arrondi bancaire).
 * @param {number} a entier
 * @param {number} b entier non nul
 * @returns {number}
 */
export function divRound(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('divRound : entiers attendus');
  if (b === 0) throw new Error('Division par zéro');
  const neg = (a < 0) !== (b < 0);
  const A = Math.abs(a), B = Math.abs(b);
  let q = Math.floor(A / B);
  const r = A - q * B;
  if (r * 2 > B || (r * 2 === B && q % 2 === 1)) q += 1;
  return neg ? -q : q;
}

/**
 * Chaîne décimale (« 12500 », « 12,5 », « 0.75 », « -3 ») → entier en plus petite unité, arrondi demi vers le pair
 * si la chaîne a plus de décimales que la devise. Renvoie null si illisible.
 * @param {string} str
 * @param {number} dec décimales de la devise
 * @returns {number|null}
 */
export function decimalToMinor(str, dec) {
  const m = /^\s*([+-]?)(\d*)(?:[.,](\d*))?\s*$/.exec(String(str ?? ''));
  if (!m || (!m[2] && !m[3])) return null;
  const neg = m[1] === '-';
  const int = m[2] || '0';
  const frac = m[3] || '';
  const kept = (frac + '0'.repeat(dec)).slice(0, dec);
  const rest = frac.slice(dec);
  let v = Number(int) * 10 ** dec + Number(kept || '0');
  if (!Number.isSafeInteger(v)) return null;
  if (rest && /[1-9]/.test(rest)) {
    const first = Number(rest[0]);
    const tail = /[1-9]/.test(rest.slice(1));
    if (first > 5 || (first === 5 && (tail || v % 2 === 1))) v += 1;
  }
  return neg ? -v : v;
}

/**
 * Plus grand montant accepté, en plus petite unité de la devise (ROADMAP étape 2, entrées farfelues) : 999 999 999 999,
 * soit près de mille milliards de francs. Au-delà, les sommes risqueraient de dépasser la précision des nombres.
 */
export const MAX_AMOUNT = 999_999_999_999;

/**
 * Est-ce un montant valide pour une opération (entier strictement positif, au plus MAX_AMOUNT) ?
 * @param {any} v
 */
export const isPositiveAmount = v => Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT;

/**
 * L'expression divise-t-elle par zéro (« 500÷0 ») ? Tant que c'est le cas, le calcul n'a pas de sens : la saisie le dit
 * au lieu d'afficher un résultat (taper un autre chiffre après le 0 lève le problème).
 * @param {string} expr
 */
export function dividesByZero(expr) {
  const tokens = String(expr ?? '').match(/\d+(?:[.,]\d*)?|[+−×÷-]/g) || [];
  return tokens.some((t, i) => t === '÷' && i + 1 < tokens.length && /^[\d.,]+$/.test(tokens[i + 1]) && !/[1-9]/.test(tokens[i + 1]));
}

/**
 * Expression du pavé calculatrice (« 25÷2 », « 1,01+3×2 », opérateurs + − × ÷, × et ÷ prioritaires) → entier en plus
 * petite unité de la devise. Calcul exact en fractions (BigInt), un seul arrondi à la fin, demi vers le pair (ADR 0001).
 * Un opérateur final est ignoré ; une division par zéro garde le membre de gauche.
 * @param {string} expr nombres en unités affichées, virgule ou point décimal
 * @param {number} dec décimales de la devise
 * @returns {number}
 */
export function evalAmount(expr, dec) {
  const tokens = String(expr ?? '').match(/\d+(?:[.,]\d*)?|[+−×÷-]/g) || [];
  if (tokens.length && /^[+−×÷-]$/.test(tokens[tokens.length - 1])) tokens.pop();
  if (!tokens.length) return 0;
  /** @typedef {[bigint, bigint]} Frac numérateur, dénominateur > 0 */
  /** @param {bigint} a @param {bigint} b @returns {bigint} */
  const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; };
  /** @param {bigint} n @param {bigint} d @returns {Frac} */
  const red = (n, d) => { const g = gcd(n, d); return [n / g, d / g]; };
  /** @param {string} t @returns {Frac} */
  const parse = t => { const [i, f = ''] = t.split(/[.,]/); return red(BigInt(i + f || '0'), 10n ** BigInt(f.length)); };
  /** @param {Frac} a @param {Frac} b @param {string} o @returns {Frac} */
  const op = (a, b, o) => {
    if (o === '+') return red(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
    if (o === '−' || o === '-') return red(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
    if (o === '×') return red(a[0] * b[0], a[1] * b[1]);
    if (b[0] === 0n) return a;
    const n = a[0] * b[1], d = a[1] * b[0];
    return d < 0n ? red(-n, -d) : red(n, d);
  };
  /** @type {Frac[]} */ const vals = [];
  /** @type {string[]} */ const ops = [];
  const prec = (/** @type {string} */ o) => (o === '×' || o === '÷' ? 2 : 1);
  const apply = () => { const b = /** @type {Frac} */ (vals.pop()), a = /** @type {Frac} */ (vals.pop()) || [0n, 1n]; vals.push(op(a, b, /** @type {string} */ (ops.pop()))); };
  for (const t of tokens) {
    if (/^[+−×÷-]$/.test(t)) {
      if (!vals.length) vals.push([0n, 1n]);
      while (ops.length && prec(ops[ops.length - 1]) >= prec(t)) apply();
      ops.push(t);
    } else vals.push(parse(t));
  }
  while (ops.length && vals.length >= 2) apply();
  const [n, d] = vals[0] || [0n, 1n];
  // valeur × 10^dec, arrondie au plus proche, demi vers le pair
  const N = n * 10n ** BigInt(dec);
  const neg = N < 0n;
  const A = neg ? -N : N;
  let q = A / d;
  const r = A - q * d;
  if (r * 2n > d || (r * 2n === d && q % 2n === 1n)) q += 1n;
  const out = Number(neg ? -q : q);
  return Number.isSafeInteger(out) ? out : (neg ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
}
