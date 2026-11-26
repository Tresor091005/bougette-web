// Le vocabulaire de Bougette (2026-11-24, avec l'utilisateur) : les mots des notions de l'app, à un seul endroit. Un
// écran n'écrit jamais ces mots en dur : il les prend ici (tools/check-words.mjs le vérifie à chaque `npm run check`).
// Renommer une notion, c'est changer une ligne de TERMS : les articles, l'élision et les accords suivent.
//
// Les noms internes ne changent pas avec les mots : `due` / `schedule` (le code, les événements `schedule.*`) et
// `reserve` (`reserve.*`) restent, car le journal des vraies données est fait de ces événements.
//
// Usage : `${DUE.New}` → « Nouvelle opération programmée » ; `${DUE.This} est déjà réglé${DUE.e}` → « Cette opération
// programmée est déjà réglée » ; `${RES.count(3)}` → « 3 dépenses prévues » ; `${money(x)} ${DUE.ofMany} à payer`.
// Sans dépendance : le domaine (messages d'erreur) et les écrans s'en servent.

/**
 * @typedef {{ one: string, many: string, fem: boolean }} TermDef one : le singulier ; many : le pluriel ; fem : féminin
 */

/** Les notions et leur nom à l'écran. */
export const TERMS = {
  /**
   * Ce qu'on programme pour une date : ce qui revient (loyer, Canal Box, salaire) comme ce qui n'arrive qu'une fois ;
   * interne `due` / `schedule`, D18. « Programmée » depuis le 2026-11-26 (avec l'utilisateur ; avant : « récurrente »,
   * qui promettait une répétition alors qu'une seule fois est acceptée ; « planifiée » écarté : trop proche de « prévue »).
   */
  due: { one: 'opération programmée', many: 'opérations programmées', fem: true },
  /** L'argent préparé à l'avance pour une dépense connue, grosse ou lointaine : interne `reserve`, D17. */
  reserve: { one: 'dépense prévue', many: 'dépenses prévues', fem: true },
};

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);
const vowel = (/** @type {string} */ s) => /^[aeiouyhàâéèêëîïôöûü]/i.test(s);

/** Toutes les formes d'un mot. @param {TermDef} d */
export function term(d) {
  const v = vowel(d.one), f = d.fem;
  const forms = {
    /** opération programmée */ one: d.one,
    /** opérations programmées */ many: d.many,
    /** Opération programmée */ One: cap(d.one),
    /** Opérations programmées */ Many: cap(d.many),
    /** une opération programmée */ a: `${f ? 'une' : 'un'} ${d.one}`,
    /** l'opération programmée, la dépense prévue */ the: v ? `l’${d.one}` : `${f ? 'la' : 'le'} ${d.one}`,
    /** les opérations programmées */ theMany: `les ${d.many}`,
    /** d'opération programmée, de dépense prévue */ of: `${v ? 'd’' : 'de '}${d.one}`,
    /** d'opérations programmées */ ofMany: `${v ? 'd’' : 'de '}${d.many}`,
    /** de l'opération programmée, de la dépense prévue */ ofThe: v ? `de l’${d.one}` : f ? `de la ${d.one}` : `du ${d.one}`,
    /** des opérations programmées */ ofTheMany: `des ${d.many}`,
    /** cette opération programmée, ce paiement, cet achat */ this: `${f ? 'cette' : v ? 'cet' : 'ce'} ${d.one}`,
    /** ces opérations programmées */ these: `ces ${d.many}`,
    /** nouvelle opération programmée, nouveau paiement, nouvel achat */ new: `${f ? 'nouvelle' : v ? 'nouvel' : 'nouveau'} ${d.one}`,
    /** ton opération programmée, ta dépense prévue */ your: `${f && !v ? 'ta' : 'ton'} ${d.one}`,
    /** tes opérations programmées */ yourMany: `tes ${d.many}`,
    /** sa dépense prévue, son opération programmée */ its: `${f && !v ? 'sa' : 'son'} ${d.one}`,
    /** ses … */ itsMany: `ses ${d.many}`,
    /** autre opération programmée (« une autre », « aucune autre ») */ other: `autre ${d.one}`,
    /** aucune opération programmée, aucun paiement */ none: `${f ? 'aucune' : 'aucun'} ${d.one}`,
    /** accord de l'adjectif ou du participe : réglé${e} → réglée */ e: f ? 'e' : '',
    /** pronom sujet : elle / il */ she: f ? 'elle' : 'il',
    /** pronom complément : la / le (clos-la) */ her: f ? 'la' : 'le',
    /** prête / prêt, close / clos… : un adjectif au bon genre, fém. donné à part pour les irréguliers */
    adj: (/** @type {string} */ masc, /** @type {string} */ fem = masc + 'e') => f ? fem : masc,
    /** « 1 opération programmée », « 3 opérations programmées » */
    count: (/** @type {number} */ n) => `${n} ${n > 1 ? d.many : d.one}`,
  };
  /** @type {Record<string, any>} */
  const out = { ...forms };
  // la même forme avec une majuscule : DUE.The, DUE.This, DUE.New, DUE.A, DUE.None, DUE.Your…
  for (const [k, val] of Object.entries(forms)) if (typeof val === 'string' && k !== 'e' && k[0] === k[0].toLowerCase()) out[cap(k)] = cap(val);
  return /** @type {typeof forms & { A: string, The: string, TheMany: string, Of: string, This: string, These: string, New: string, Your: string, YourMany: string, Its: string, None: string, She: string, Other: string }} */ (out);
}

/** Opération programmée (interne : due, schedule). */
export const DUE = term(TERMS.due);
/** Dépense prévue (interne : reserve). */
export const RES = term(TERMS.reserve);
