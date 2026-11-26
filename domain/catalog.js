// Catalogue des icônes de catégorie (Phosphor Icons, licence MIT) : nom Phosphor, libellé et mots-clés en français,
// rangés par rubriques. Le domaine refuse toute icône hors de cette liste ; tools/build-icons.mjs n'embarque que
// celles-ci (graisse duotone) et les icônes d'interface. Table de migration des anciens emoji et des anciennes
// icônes dessinées à la main (itérations 1 et 2) vers l'icône la plus proche.

/** @typedef {{ name: string, label: string, words: string }} CatalogIcon */
/** @typedef {{ title: string, icons: CatalogIcon[] }} CatalogSection */

/** @type {[string, [string, string, string][]][]} */
const RAW = [
  ['Repas et courses', [
    ['fork-knife', 'Repas', 'manger restaurant nourriture cantine'],
    ['bowl-food', 'Plat', 'riz bol soupe manger'],
    ['bowl-steam', 'Plat chaud', 'soupe sauce bouillie'],
    ['cooking-pot', 'Marmite', 'cuisine sauce gaz'],
    ['hamburger', 'Fast-food', 'burger snack'],
    ['pizza', 'Pizza', 'snack'],
    ['bread', 'Pain', 'boulangerie baguette'],
    ['egg', 'Œufs', 'oeuf petit déjeuner'],
    ['fish', 'Poisson', 'marché poisson fumé'],
    ['carrot', 'Légumes', 'marché carotte'],
    ['orange-slice', 'Fruits', 'orange mangue ananas'],
    ['pepper', 'Piment', 'condiments épices'],
    ['grains', 'Céréales', 'maïs mil riz farine'],
    ['cookie', 'Biscuits', 'gâteau goûter'],
    ['cake', 'Gâteau', 'anniversaire pâtisserie'],
    ['ice-cream', 'Glace', 'dessert'],
    ['coffee', 'Café', 'thé boisson'],
    ['beer-bottle', 'Bière', 'boisson bar buvette'],
    ['wine', 'Vin', 'boisson alcool'],
    ['martini', 'Cocktail', 'bar sortie boisson'],
    ['shopping-cart', 'Courses', 'supermarché marché provisions'],
    ['basket', 'Panier', 'marché courses'],
    ['storefront', 'Boutique', 'magasin commerce vente'],
  ]],
  ['Transport', [
    ['bus', 'Bus', 'transport car'],
    ['car', 'Voiture', 'auto transport'],
    ['taxi', 'Taxi', 'transport course'],
    ['motorcycle', 'Moto', 'zem taxi-moto transport'],
    ['scooter', 'Scooter', 'moto zem livraison'],
    ['bicycle', 'Vélo', 'bicyclette'],
    ['train', 'Train', 'transport rail'],
    ['airplane-tilt', 'Avion', 'voyage vol billet'],
    ['boat', 'Bateau', 'pirogue traversée'],
    ['gas-pump', 'Carburant', 'essence station gasoil'],
    ['gas-can', 'Bidon', 'essence carburant'],
    ['steering-wheel', 'Permis', 'conduite auto-école'],
    ['tire', 'Pneu', 'vulcanisateur réparation'],
    ['truck', 'Camion', 'déménagement livraison'],
    ['road-horizon', 'Route', 'péage voyage'],
    ['map-pin', 'Lieu', 'adresse voyage'],
    ['suitcase-rolling', 'Voyage', 'valise vacances'],
  ]],
  ['Maison et factures', [
    ['house', 'Maison', 'logement loyer'],
    ['house-line', 'Logement', 'loyer maison'],
    ['buildings', 'Immeuble', 'appartement loyer'],
    ['key', 'Clé', 'loyer caution location'],
    ['lightning', 'Électricité', 'courant facture sbee cie senelec'],
    ['lightbulb', 'Lumière', 'ampoule électricité'],
    ['drop', 'Eau', 'facture soneb sodeci'],
    ['fire', 'Gaz', 'bouteille cuisine charbon'],
    ['plug', 'Prise', 'électricité recharge'],
    ['solar-panel', 'Solaire', 'panneau énergie'],
    ['fan', 'Ventilateur', 'climatisation'],
    ['shower', 'Douche', 'salle de bain eau'],
    ['washing-machine', 'Lessive', 'linge pressing'],
    ['broom', 'Ménage', 'nettoyage entretien'],
    ['couch', 'Meubles', 'salon canapé'],
    ['bed', 'Lit', 'chambre matelas'],
    ['hammer', 'Travaux', 'bricolage chantier'],
    ['wrench', 'Réparation', 'entretien dépannage'],
    ['paint-roller', 'Peinture', 'travaux'],
    ['potted-plant', 'Plantes', 'jardin'],
    ['tree', 'Jardin', 'arbre'],
    ['trash', 'Ordures', 'poubelle déchets'],
    ['receipt', 'Facture', 'reçu ticket'],
  ]],
  ['Téléphone et internet', [
    ['cell-signal-high', 'Crédit', 'réseau téléphone forfait unités'],
    ['phone', 'Appels', 'téléphone'],
    ['wifi-high', 'Internet', 'wi-fi box données'],
    ['sim-card', 'Carte SIM', 'puce'],
    ['globe', 'Web', 'internet en ligne'],
    ['laptop', 'Ordinateur', 'pc portable'],
    ['headphones', 'Écouteurs', 'casque audio'],
    ['television', 'Télévision', 'tv canal abonnement'],
    ['radio', 'Radio', 'poste'],
    ['envelope-simple', 'Courrier', 'poste lettre'],
  ]],
  ['Santé et soins', [
    ['heartbeat', 'Santé', 'médecin soins'],
    ['heart', 'Cœur', 'santé amour'],
    ['first-aid-kit', 'Pharmacie', 'soins trousse'],
    ['pill', 'Médicaments', 'pharmacie comprimé'],
    ['syringe', 'Vaccin', 'piqûre injection'],
    ['bandaids', 'Pansement', 'soins blessure'],
    ['stethoscope', 'Médecin', 'consultation docteur'],
    ['hospital', 'Hôpital', 'clinique urgence'],
    ['tooth', 'Dentiste', 'dents'],
    ['eyeglasses', 'Lunettes', 'opticien vue'],
    ['thermometer', 'Fièvre', 'malade'],
    ['barbell', 'Sport', 'musculation salle'],
    ['person-simple-run', 'Course', 'sport jogging'],
    ['scissors', 'Coiffure', 'coiffeur barbier tresses'],
    ['sparkle', 'Beauté', 'soins esthétique'],
    ['drop-half', 'Cosmétiques', 'crème soins beauté'],
  ]],
  ['Famille et entourage', [
    ['users', 'Famille', 'parents proches'],
    ['users-three', 'Groupe', 'association tontine amis'],
    ['user', 'Personne', 'quelqu’un'],
    ['baby', 'Bébé', 'enfant biberon couches'],
    ['baby-carriage', 'Poussette', 'bébé enfant'],
    ['gift', 'Cadeau', 'présent offrande'],
    ['hand-heart', 'Don', 'aide solidarité'],
    ['hands-praying', 'Prière', 'religion offrande quête'],
    ['church', 'Église', 'religion quête dîme'],
    ['mosque', 'Mosquée', 'religion zakat'],
    ['confetti', 'Fête', 'cérémonie mariage baptême'],
    ['balloon', 'Anniversaire', 'fête enfant'],
    ['flower-lotus', 'Fleurs', 'deuil cérémonie'],
    ['paw-print', 'Animaux', 'chien chat vétérinaire'],
    ['dog', 'Chien', 'animal'],
    ['cat', 'Chat', 'animal'],
  ]],
  ['Loisirs', [
    ['music-notes', 'Musique', 'concert sortie'],
    ['microphone-stage', 'Concert', 'spectacle musique'],
    ['guitar', 'Instrument', 'musique guitare'],
    ['film-slate', 'Cinéma', 'film'],
    ['popcorn', 'Ciné', 'cinéma sortie'],
    ['ticket', 'Billet', 'spectacle entrée'],
    ['game-controller', 'Jeux vidéo', 'console'],
    ['dice-five', 'Jeux', 'loterie pari'],
    ['soccer-ball', 'Football', 'sport match'],
    ['basketball', 'Basket', 'sport'],
    ['swimming-pool', 'Piscine', 'baignade'],
    ['tent', 'Camping', 'excursion'],
    ['island', 'Vacances', 'plage voyage'],
    ['umbrella-simple', 'Parapluie', 'parasol plage assurance protection mutuelle'],
    ['camera', 'Photo', 'appareil'],
    ['palette', 'Art', 'peinture dessin'],
    ['book-bookmark', 'Lecture', 'livre roman'],
    ['puzzle-piece', 'Jouets', 'jeu enfant'],
    ['mask-happy', 'Spectacle', 'théâtre sortie'],
  ]],
  ['Vêtements', [
    ['t-shirt', 'Habillement', 'vêtements habits'],
    ['dress', 'Robe', 'pagne couture vêtements'],
    ['pants', 'Pantalon', 'vêtements'],
    ['sneaker', 'Chaussures', 'baskets'],
    ['boot', 'Bottes', 'chaussures'],
    ['high-heel', 'Talons', 'chaussures'],
    ['baseball-cap', 'Casquette', 'chapeau'],
    ['handbag', 'Sac', 'sac à main maroquinerie'],
    ['backpack', 'Sac à dos', 'école cartable'],
    ['sunglasses', 'Lunettes de soleil', 'accessoire'],
    ['watch', 'Montre', 'accessoire'],
    ['diamond', 'Bijoux', 'or bague collier'],
    ['needle', 'Couture', 'tailleur retouche'],
    ['coat-hanger', 'Pressing', 'cintre vêtements'],
  ]],
  ['Études et travail', [
    ['book-open', 'Éducation', 'école études livres'],
    ['books', 'Livres', 'fournitures bibliothèque'],
    ['graduation-cap', 'Diplôme', 'université inscription'],
    ['student', 'Élève', 'école scolarité'],
    ['chalkboard-teacher', 'Cours', 'répétiteur professeur'],
    ['exam', 'Examen', 'concours frais'],
    ['pencil-simple', 'Fournitures', 'stylo crayon cahier'],
    ['notebook', 'Cahier', 'fournitures'],
    ['briefcase', 'Travail', 'salaire emploi bureau'],
    ['desktop', 'Bureau', 'ordinateur'],
    ['printer', 'Impression', 'photocopie'],
    ['toolbox', 'Outils', 'artisan métier'],
    ['hard-hat', 'Chantier', 'btp ouvrier'],
    ['calculator', 'Comptabilité', 'calcul'],
    ['certificate', 'Papiers', 'administration certificat'],
    ['newspaper', 'Journal', 'presse abonnement'],
    ['package', 'Colis', 'livraison envoi'],
  ]],
  ['Argent', [
    ['coins', 'Pièces', 'monnaie'],
    ['handshake', 'Prêt', 'dette accord remboursement'],
    ['credit-card', 'Carte', 'paiement carte bancaire'],
    ['chart-line-up', 'Placement', 'investissement bourse'],
    ['trend-up', 'Bénéfice', 'gain revenu'],
    ['percent', 'Intérêts', 'taux commission frais'],
    ['cash-register', 'Ventes', 'commerce caisse recette'],
    ['tray-arrow-down', 'Rentrée', 'revenu entrée argent'],
  ]],
  ['Divers', [
    ['dots-three', 'Autre', 'divers'],
    ['tag', 'Étiquette', 'divers achat'],
    ['star', 'Favori', 'important'],
    ['shopping-bag', 'Achats', 'shopping sac'],
    ['sun', 'Soleil', 'été'],
    ['leaf', 'Nature', 'écologie'],
    ['recycle', 'Recyclage', 'récupération'],
    ['smiley', 'Plaisir', 'envie'],
    ['question', 'Inconnu', 'à classer'],
  ]],
];

/** Rubriques du catalogue, dans l'ordre d'affichage. @type {CatalogSection[]} */
// Retirées du choix le 2026-11-18 (avec l'utilisateur) : les icônes qui sont des signes fixes de l'app ne se prêtent pas
// aux catégories (billets, téléphone, banque : les types de portefeuille ; portefeuille, tirelire, coffre : l'épargne et
// les réserves ; poignée de pièces : la tontine à venir ; cadenas : ce qui ne change plus ; flèches : un virement ;
// bouclier : le fonds d'urgence et les sauvegardes ; balance : vérifier le solde). Une catégorie qui en a déjà une
// la garde : elles restent connues (RETIRED), seulement absentes de la grille et de la recherche.
/** @type {[string, string][]} */
const RETIRED = [['money', 'Espèces'], ['device-mobile', 'Téléphone'], ['wallet', 'Portefeuille'], ['bank', 'Banque'],
  ['piggy-bank', 'Épargne'], ['hand-coins', 'Tontine'], ['vault', 'Coffre'], ['lock-simple', 'Sécurité'],
  ['arrows-left-right', 'Échange'], ['shield-check', 'Assurance'], ['scales', 'Justice'], ['archive', 'Réserves']]; /* mot libre : l'icône archive, au sens de stock */
export const CATALOG = RAW.map(([title, list]) => ({ title, icons: list.map(([name, label, words]) => ({ name, label, words })) }));

/** Tous les noms d'icônes de catégorie. */
export const CATEGORY_ICON_NAMES = CATALOG.flatMap(s => s.icons.map(i => i.name));
const NAMES = new Set([...CATEGORY_ICON_NAMES, ...RETIRED.map(([n]) => n)]);
/** @type {Map<string, CatalogIcon>} */
const BY_NAME = new Map(/** @type {[string, CatalogIcon][]} */ ([...RETIRED.map(([name, label]) => [name, { name, label, words: '' }]), ...CATALOG.flatMap(s => s.icons.map(i => [i.name, i]))]));

/** @param {any} name */
export const isCatalogIcon = name => typeof name === 'string' && NAMES.has(name);
/** Libellé français d'une icône du catalogue. @param {string} name */
export const iconLabel = name => BY_NAME.get(name)?.label || name;

export const FALLBACK_ICON = 'dots-three';

/** @param {string} s */
export const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').trim();

/**
 * Recherche en français (libellé, mots-clés, nom anglais), sans accents ni casse. Requête vide : tout le catalogue.
 * @param {string} query
 * @returns {CatalogSection[]} rubriques non vides
 */
export function searchIcons(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return CATALOG;
  const hit = (/** @type {CatalogIcon} */ i) => {
    const hay = fold(`${i.label} ${i.words} ${i.name.replace(/-/g, ' ')}`).split(/\s+/);
    return words.every(w => hay.some(h => h.startsWith(w)));
  };
  return CATALOG.map(s => ({ title: s.title, icons: s.icons.filter(hit) })).filter(s => s.icons.length);
}

// --- migration (itération 2 → 4) : emoji et icônes dessinées à la main → Phosphor ---

/** Emoji → icône la plus proche. Les variantes de présentation (FE0F) et les teintes de peau sont ignorées. */
/** @type {Record<string, string>} */
export const EMOJI_TO_ICON = {
  '🍚': 'bowl-food', '🍲': 'cooking-pot', '🍛': 'bowl-food', '🍜': 'bowl-steam', '🥘': 'cooking-pot', '🍗': 'fork-knife', '🍖': 'fork-knife',
  '🐟': 'fish', '🐠': 'fish', '🥖': 'bread', '🍞': 'bread', '🍌': 'orange-slice', '🥭': 'orange-slice', '🍊': 'orange-slice', '🍍': 'orange-slice',
  '🍎': 'orange-slice', '🥑': 'carrot', '🥕': 'carrot', '🍅': 'carrot', '🧅': 'carrot', '🌶': 'pepper', '🌽': 'grains', '🥜': 'grains', '🥚': 'egg',
  '🍔': 'hamburger', '🍕': 'pizza', '🍟': 'hamburger', '🍰': 'cake', '🎂': 'cake', '🧁': 'cake', '🍪': 'cookie', '🍦': 'ice-cream', '🍨': 'ice-cream',
  '☕': 'coffee', '🍵': 'coffee', '🍺': 'beer-bottle', '🍻': 'beer-bottle', '🍷': 'wine', '🍸': 'martini', '🍹': 'martini', '🥤': 'coffee',
  '🍽': 'fork-knife', '🛒': 'shopping-cart', '🧺': 'basket', '🏪': 'storefront', '🏬': 'storefront',
  '🚕': 'taxi', '🚖': 'taxi', '🛵': 'scooter', '🏍': 'motorcycle', '🚌': 'bus', '🚍': 'bus', '🚐': 'bus', '🚗': 'car', '🚙': 'car', '⛽': 'gas-pump',
  '✈': 'airplane-tilt', '🛫': 'airplane-tilt', '🚲': 'bicycle', '🚆': 'train', '🚂': 'train', '⛵': 'boat', '🚤': 'boat', '🛶': 'boat', '🚚': 'truck',
  '🧳': 'suitcase-rolling', '🗺': 'map-pin', '📍': 'map-pin',
  '🏠': 'house', '🏡': 'house', '🏢': 'buildings', '🏘': 'buildings', '💡': 'lightbulb', '⚡': 'lightning', '🔌': 'plug', '💧': 'drop', '🚰': 'drop',
  '🔥': 'fire', '🛋': 'couch', '🛏': 'bed', '🧹': 'broom', '🧼': 'broom', '🔑': 'key', '🗝': 'key', '🔨': 'hammer',
  '🔧': 'wrench', '🛠': 'toolbox', '🪴': 'potted-plant', '🌱': 'potted-plant', '🌳': 'tree', '🌴': 'tree', '🗑': 'trash', '🧾': 'receipt',
  '💰': 'money', '💵': 'money', '💶': 'money', '💴': 'money', '💷': 'money', '💸': 'money', '🪙': 'coins', '💳': 'credit-card', '🏦': 'bank',
  '📈': 'chart-line-up', '📊': 'chart-line-up', '🤝': 'handshake', '👛': 'wallet', '🐷': 'piggy-bank', '🏧': 'bank', '💹': 'trend-up',
  '💊': 'pill', '💉': 'syringe', '🩹': 'bandaids', '🩺': 'stethoscope', '🏥': 'hospital', '🦷': 'tooth', '👓': 'eyeglasses', '🌡': 'thermometer',
  '🤒': 'thermometer', '❤': 'heart', '💖': 'heart', '💕': 'heart', '🫀': 'heartbeat', '🏋': 'barbell', '🏃': 'person-simple-run',
  '💈': 'scissors', '✂': 'scissors', '💇': 'scissors', '💅': 'sparkle', '💄': 'sparkle', '🧴': 'drop-half',
  '👶': 'baby', '🍼': 'baby', '👪': 'users', '👨‍👩‍👧': 'users', '👨‍👩‍👧‍👦': 'users', '👫': 'users', '👥': 'users-three', '🧑': 'user', '👤': 'user',
  '🎁': 'gift', '🙏': 'hands-praying', '⛪': 'church', '🕌': 'mosque', '🎉': 'confetti', '🎊': 'confetti', '🎈': 'balloon', '💐': 'flower-lotus',
  '🌸': 'flower-lotus', '🐶': 'dog', '🐕': 'dog', '🐱': 'cat', '🐈': 'cat', '🐾': 'paw-print',
  '🎵': 'music-notes', '🎶': 'music-notes', '🎤': 'microphone-stage', '🎸': 'guitar', '🎬': 'film-slate', '🍿': 'popcorn', '🎟': 'ticket', '🎫': 'ticket',
  '🎮': 'game-controller', '🎲': 'dice-five', '⚽': 'soccer-ball', '🏀': 'basketball', '🏊': 'swimming-pool', '⛺': 'tent', '🏝': 'island', '🏖': 'umbrella-simple',
  '📷': 'camera', '📸': 'camera', '🎨': 'palette', '📖': 'book-open', '📚': 'books', '📕': 'book-bookmark', '🧩': 'puzzle-piece', '🎭': 'mask-happy',
  '📺': 'television', '📻': 'radio',
  '👗': 'dress', '👚': 't-shirt', '👕': 't-shirt', '👔': 't-shirt', '👖': 'pants', '👟': 'sneaker', '👞': 'sneaker', '👠': 'high-heel', '👢': 'boot',
  '🧢': 'baseball-cap', '👜': 'handbag', '👝': 'handbag', '🎒': 'backpack', '🕶': 'sunglasses', '⌚': 'watch', '💍': 'diamond', '💎': 'diamond', '🧵': 'needle',
  '🎓': 'graduation-cap', '🏫': 'student', '✏': 'pencil-simple', '🖊': 'pencil-simple', '📝': 'notebook', '📓': 'notebook', '💼': 'briefcase',
  '💻': 'laptop', '🖥': 'desktop', '🖨': 'printer', '🧰': 'toolbox', '👷': 'hard-hat', '🧮': 'calculator', '📰': 'newspaper', '📦': 'package',
  '📱': 'device-mobile', '📲': 'device-mobile', '☎': 'phone', '📞': 'phone', '📶': 'cell-signal-high', '🌐': 'globe', '✉': 'envelope-simple', '📧': 'envelope-simple',
  '🎧': 'headphones', '⭐': 'star', '🌟': 'star', '✨': 'sparkle', '🏷': 'tag', '🛍': 'shopping-bag', '🔒': 'lock-simple', '☀': 'sun', '🍃': 'leaf',
  '♻': 'recycle', '🙂': 'smiley', '😀': 'smiley', '😊': 'smiley', '❓': 'question', '🛡': 'shield-check', '☂': 'umbrella-simple', '🌂': 'umbrella-simple',
};

/** Anciennes icônes dessinées à la main (itérations 1 et 2) → Phosphor. */
/** @type {Record<string, string>} */
export const LEGACY_ICONS = {
  food: 'fork-knife', cart: 'shopping-cart', coffee: 'coffee', cake: 'cake', bus: 'bus', car: 'car', moto: 'motorcycle', fuel: 'gas-pump',
  plane: 'airplane-tilt', house: 'house', key: 'key', bolt: 'lightning', drop: 'drop', signal: 'cell-signal-high', wifi: 'wifi-high',
  phone: 'device-mobile', heart: 'heartbeat', pill: 'pill', people: 'users', bottle: 'baby', paw: 'paw-print', music: 'music-notes',
  tv: 'television', game: 'game-controller', ball: 'soccer-ball', bag: 'shopping-bag', shirt: 't-shirt', scissors: 'scissors', book: 'book-open',
  cap: 'graduation-cap', laptop: 'laptop', briefcase: 'briefcase', store: 'storefront', gift: 'gift', inbox: 'tray-arrow-down', cash: 'money',
  bank: 'bank', piggy: 'piggy-bank', trend: 'chart-line-up', receipt: 'receipt', donate: 'hand-heart', wrench: 'wrench', plant: 'potted-plant',
  umbrella: 'shield-check', tag: 'tag', dots: 'dots-three',
};
/** Catégories par défaut d'origine dont l'icône d'origine suit le choix de D7 (ex. Habillement : sac → t-shirt). */
/** @type {Record<string, [string, string]>} */
const DEFAULT_OVERRIDES = { shop: ['bag', 't-shirt'] };

/**
 * Icône Phosphor la plus proche d'un emoji (ou null).
 * @param {string|null|undefined} emoji
 */
export function iconForEmoji(emoji) {
  if (!emoji) return null;
  const e = String(emoji).replace(/[︎️]/g, '').replace(/\p{Emoji_Modifier}/gu, '');
  if (EMOJI_TO_ICON[e]) return EMOJI_TO_ICON[e];
  // séquence (famille, profession…) : premier élément connu
  for (const part of e.split('‍')) if (EMOJI_TO_ICON[part]) return EMOJI_TO_ICON[part];
  return null;
}

/**
 * Icône du catalogue pour une catégorie existante : son emoji d'abord, sinon son ancienne icône, sinon dots-three.
 * @param {{ id?: string, icon?: string|null, emoji?: string|null }} c
 * @returns {string}
 */
export function migratedIcon(c) {
  if (c.emoji) return iconForEmoji(c.emoji) || FALLBACK_ICON;
  if (isCatalogIcon(c.icon)) return /** @type {string} */ (c.icon);
  const o = c.id ? DEFAULT_OVERRIDES[c.id] : null;
  if (o && o[0] === c.icon) return o[1];
  return (c.icon && LEGACY_ICONS[c.icon]) || FALLBACK_ICON;
}
