// Valeurs par défaut de Bougette : portefeuilles, catégories, réglages (premier lancement et démo).
import { DEFAULT_FMT, currencyOf } from './format.js';

/** Types de portefeuille. Les identifiants (numéro Mobile Money, numéro de compte) ne concernent que emoney et bank. */
export const KINDS = ['cash', 'emoney', 'bank'];
/** @type {Record<string, string>} */
export const KIND_LABEL = { cash: 'Espèces', emoney: 'Monnaie électronique', bank: 'Banque' };

/**
 * Anciens portefeuilles par défaut. Le premier lancement n'en crée plus (D10) : ils ne servent qu'à convertir les
 * données v2 qui n'ont pas de liste de portefeuilles (src/domain/legacy.js), et de modèle à la démo.
 */
export const DEFAULT_WALLETS = [
  { id: 'cash', name: 'Espèces', subtype: 'cash' },
  { id: 'mtn', name: 'MTN MoMo', subtype: 'emoney' },
  { id: 'moov', name: 'Moov Money', subtype: 'emoney' },
  { id: 'bank', name: 'Banque', subtype: 'bank' },
];

// Catégories par défaut (v0.5) : les postes de la COICOP 2018 (nomenclature ONU des dépenses des ménages, celle des
// enquêtes EHCVM de l'UEMOA), adaptés à la vie en Afrique de l'Ouest. Deux niveaux : catégorie, puis sous-catégories
// facultatives (une dépense peut rester sur la catégorie). Icônes du catalogue Phosphor (D7) ; teintes c1…c10 (D8) :
// une sous-catégorie prend toujours la teinte de sa catégorie.
/** @typedef {[string, string, string, string, [string, string, string][]]} CatSpec [id, nom, icône, teinte, sous-catégories] */
/** @type {CatSpec[]} */
const EXPENSES = [
  ['food', 'Alimentation', 'fork-knife', 'c1', [
    ['food-market', 'Marché', 'basket'], ['food-shop', 'Boutique & supermarché', 'shopping-cart'],
    ['food-out', 'Maquis & restaurant', 'bowl-food'], ['food-drinks', 'Eau & boissons', 'coffee']]],
  ['transport', 'Transport', 'bus', 'c7', [
    ['transport-zem', 'Zem', 'motorcycle'], ['transport-taxi', 'Taxi & bus', 'taxi'], ['transport-fuel', 'Carburant', 'gas-pump'],
    ['transport-repair', 'Entretien véhicule', 'tire'], ['transport-trip', 'Voyage', 'suitcase-rolling']]],
  ['home', 'Logement', 'house', 'c4', [
    ['home-rent', 'Loyer', 'key'], ['home-power', 'Électricité', 'lightning'], ['home-water', 'Eau', 'drop'],
    ['home-gas', 'Gaz & charbon', 'fire'], ['home-repair', 'Réparations', 'hammer'], ['home-stuff', 'Équipement', 'couch'],
    ['home-help', 'Aide ménagère', 'broom']]],
  ['phone', 'Communication', 'cell-signal-high', 'c6', [
    ['phone-credit', 'Crédit & forfaits', 'cell-signal-high'], ['phone-internet', 'Internet', 'wifi-high'],
    ['phone-tv', 'Abonnement TV', 'television'], ['phone-device', 'Téléphone', 'phone']]],
  ['health', 'Santé', 'heartbeat', 'c5', [
    ['health-pharmacy', 'Pharmacie', 'first-aid-kit'], ['health-doctor', 'Consultation', 'stethoscope'],
    ['health-hospital', 'Hôpital & analyses', 'hospital']]],
  ['school', 'Éducation', 'book-open', 'c7', [
    ['school-fees', 'Scolarité', 'graduation-cap'], ['school-supplies', 'Fournitures', 'pencil-simple'],
    ['school-courses', 'Cours & formations', 'chalkboard-teacher']]],
  ['shop', 'Habillement', 't-shirt', 'c9', [
    ['shop-clothes', 'Vêtements', 't-shirt'], ['shop-shoes', 'Chaussures', 'sneaker'], ['shop-tailor', 'Tailleur', 'needle']]],
  ['care', 'Soins perso', 'sparkle', 'c3', [
    ['care-hair', 'Coiffure', 'scissors'], ['care-cosmetics', 'Cosmétiques', 'drop-half'], ['care-hygiene', 'Hygiène', 'shower']]],
  ['family', 'Famille & solidarité', 'users', 'c8', [
    ['family-send', 'Envois à la famille', 'hand-heart'], ['family-kids', 'Enfants', 'baby'],
    ['family-events', 'Cérémonies', 'confetti'], ['family-gifts', 'Dons & religion', 'hands-praying']]],
  ['fun', 'Loisirs', 'music-notes', 'c2', [
    ['fun-out', 'Sorties', 'ticket'], ['fun-sport', 'Sport', 'barbell'], ['fun-subs', 'Abonnements', 'film-slate'],
    ['fun-holiday', 'Vacances', 'island']]],
  ['fees', 'Frais financiers', 'percent', 'c10', [
    ['fees-momo', 'Frais Mobile Money', 'receipt'], ['fees-bank', 'Frais bancaires', 'credit-card'],
    ['fees-insurance', 'Assurance', 'umbrella-simple']]],
  ['other', 'Autre', 'dots-three', 'c10', []],
];
/** @type {CatSpec[]} */
const INCOMES = [
  ['salary', 'Salaire', 'briefcase', 'c8', [['salary-pay', 'Paie', 'briefcase'], ['salary-bonus', 'Primes', 'star']]],
  ['sales', 'Activité', 'cash-register', 'c2', [['sales-sales', 'Ventes', 'cash-register'], ['sales-services', 'Prestations', 'toolbox']]],
  ['gift', 'Argent reçu', 'gift', 'c5', [
    ['gift-family', 'Famille', 'users'], ['gift-diaspora', 'Diaspora', 'globe'], ['gift-gifts', 'Cadeaux', 'gift']]],
  ['otherin', 'Autre revenu', 'tray-arrow-down', 'c10', []],
];
/**
 * Catégories par défaut, dans l'ordre de création : chaque catégorie suivie de ses sous-catégories (parent : son id).
 * @type {{ id: string, name: string, icon: string, color: string, type: 'expense'|'income', parent: string|null }[]}
 */
export const DEFAULT_CATEGORIES = [...expand('expense', EXPENSES), ...expand('income', INCOMES)];
/** @param {'expense'|'income'} type @param {CatSpec[]} list */
function expand(type, list) {
  return list.flatMap(([id, name, icon, color, subs]) => [
    { id, name, icon, color, type, parent: /** @type {string|null} */ (null) },
    ...subs.map(([sid, sname, sicon]) => ({ id: sid, name: sname, icon: sicon, color, type, parent: /** @type {string|null} */ (id) })),
  ]);
}

/** Réglages et leurs valeurs par défaut (currency : monnaie principale, choisie au premier lancement). */
export const DEFAULT_SETTINGS = {
  currency: 'XOF',
  fmt: { ...DEFAULT_FMT },
  blockNegative: true, // refuser les soldes négatifs (exception possible par portefeuille)
  balancesSet: false, // l'utilisateur a indiqué au moins un solde
  monthStart: 1,
  discreet: false,
  haptics: true,
  onboarded: false,
  showVoided: false, // Journal : montrer les opérations annulées (barrées), pour un audit ponctuel
  /** @type {Record<string, number>} */
  steps: {}, // arrondi des estimations choisi, par devise, en plus petite unité (sinon celui de la table des devises)
};
/**
 * Réglages retirés de l'interface mais encore acceptés : un journal qui en contient reste lisible et rejouable,
 * sans effet sur l'affichage. theme : thème sombre seul depuis D1 (l'ancien réglage auto | light | dark est ignoré).
 */
export const LEGACY_SETTINGS = { theme: 'auto' };
export const SETTING_KEYS = [...Object.keys(DEFAULT_SETTINGS), ...Object.keys(LEGACY_SETTINGS)];

/**
 * Réglages complets d'un premier lancement pour une devise.
 * @param {string} currency
 */
export function initialSettings(currency) {
  // réglages d'affichage ajoutés après la v0.4 : valeur par défaut implicite, jamais écrite au premier lancement
  // (le premier événement d'un journal ne change pas, le journal de référence se régénère à l'identique)
  // theme reste écrit (valeur figée, sans effet) pour la même raison : le premier événement de la v0.4 le contient
  const { showVoided, steps, ...base } = DEFAULT_SETTINGS;
  return { ...base, ...LEGACY_SETTINGS, currency, fmt: { ...DEFAULT_FMT, dec: currencyOf(currency).dec } };
}

// Catégories « Non suivi » (D9) : l'écart constaté en vérifiant le solde d'un portefeuille (dépense ou entrée). Ce sont
// des catégories ordinaires, créées par la première vérification qui trouve un écart.
export const UNTRACKED = { expense: 'untracked', income: 'untracked-income' };
