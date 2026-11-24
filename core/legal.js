// Les textes d'« À propos » (2026-11-24, avec l'utilisateur) : la confidentialité, les conditions d'utilisation, les
// licences. Une seule source : l'app les affiche (hors ligne, src/screens/about.js) et la publication web en fait les pages
// publiques (tools/publish-web.mjs : confidentialite.html, conditions.html), avec le même dessin et la même date : changer
// un texte ici change les deux (penser à UPDATED). Du HTML simple, déjà échappé, sans lien (dans l'app un lien ouvrirait la
// page dans l'app elle-même ; le site rend cliquable myaccount.google.com/permissions).

export const SITE = 'https://tresor091005.github.io/bougette-web/';
export const UPDATED = '24 novembre 2026';
/** Le support : WhatsApp (pas de serveur, pas d'e-mail ; avec l'utilisateur). */
export const SUPPORT_WHATSAPP = '2290159130917';

/** @typedef {{ title: string, icon?: string, html: string }} LegalSection icon : son icône dans l'app */

/** @typedef {{ icon: string, lead: string, sections: LegalSection[] }} LegalDoc icon : celle de la page */

/** @type {LegalDoc} */
export const PRIVACY = {
  icon: 'shield-check',
  lead: 'Bougette n’a pas de serveur. Nous ne recevons, ne gardons et ne voyons aucune de tes données.',
  sections: [
    { title: 'Où sont tes données', icon: 'device-mobile', html: '<p>Sur ton appareil : dans l’app (Android) ou dans ton navigateur (version web).</p><p>Si tu lies un compte Google : aussi dans ton Google Drive, dans un dossier caché réservé à Bougette, compressées et chiffrées, pour les retrouver sur tes autres appareils.</p>' },
    { title: 'Ce que Bougette demande à Google', icon: 'cloud-check', html: '<p>Un seul accès : <b>drive.appdata</b>, lire et écrire les fichiers de Bougette dans son dossier caché. Bougette ne voit ni tes autres fichiers, ni ton mot de passe. Ton nom et ton adresse e-mail servent seulement à t’afficher quel compte est lié.</p>' },
    { title: 'Ce que nous ne faisons pas', icon: 'eye-slash', html: '<p>Pas de publicité, pas de suivi, pas de revente. Aucune donnée n’est partagée avec qui que ce soit : elles vont seulement de ton appareil à ton propre Drive.</p>' },
    { title: 'Quand tu nous écris', icon: 'lightbulb', html: '<p>« Signaler un problème » et « Proposer une idée » ouvrent WhatsApp avec un message prérempli : la version de l’app et le modèle de ton téléphone, jamais tes données. Tu choisis d’envoyer ou non.</p>' },
    { title: 'Supprimer tes données', icon: 'trash', html: '<ol><li><b>Dans l’app</b> : Moi › Google Drive › Délier cet appareil. Puis efface ce qui est gardé sur l’appareil : sur Android, Paramètres › Applications › Bougette › Stockage › Effacer les données (ou désinstalle l’app) ; dans le navigateur, efface les données du site.</li><li><b>Dans Google Drive</b> (sur le web) : Paramètres › Gérer les applications › Bougette › Supprimer les données d’application cachées.</li><li><b>Dans ton compte Google</b> : retire l’accès de Bougette sur myaccount.google.com/permissions.</li></ol>' },
  ],
};

/** @type {LegalDoc} */
export const TERMS = {
  icon: 'scales',
  lead: 'Bougette t’aide à suivre ton argent. En l’utilisant, tu acceptes ces quelques règles simples.',
  sections: [
    { title: 'Tes données t’appartiennent', icon: 'user', html: '<p>Tout ce que tu notes reste à toi : sur ton appareil, et sur ton Google Drive si tu le lies. Tu peux tout exporter ou tout effacer quand tu veux.</p>' },
    { title: 'L’app est fournie telle quelle', icon: 'info', html: '<p>Bougette est gratuite et faite avec soin, mais sans garantie : il peut y avoir des erreurs. Vérifie ce qui compte pour toi, et garde une sauvegarde (le lien avec Google Drive, ou un export).</p>' },
    { title: 'Ce n’est pas un conseil financier', icon: 'scales', html: '<p>Les chiffres, les rythmes et les propositions de Bougette t’aident à y voir clair. Ils ne remplacent pas l’avis d’un professionnel, et les décisions restent les tiennes.</p>' },
    { title: 'Ta sécurité', icon: 'lock-simple', html: '<p>Protège ton appareil et ton compte Google. Un code dans Bougette (Moi › Verrouillage) empêche quelqu’un qui aurait l’app ouverte d’exporter ou d’effacer tes données.</p>' },
    { title: 'Changements', icon: 'arrows-clockwise', html: '<p>Bougette évolue : ces règles peuvent changer avec elle. La date de mise à jour est en bas de cette page.</p>' },
  ],
};

/** Les licences de ce que Bougette embarque. @type {{ name: string, by: string, license: string }[]} */
export const LICENSES = [
  { name: 'Phosphor Icons', by: 'Helena Zhang et Tobias Fried', license: 'MIT' },
  { name: 'Solar Icons (style Proto)', by: '480 Design', license: 'CC BY 4.0' },
  { name: 'Geist', by: 'Vercel', license: 'SIL Open Font License 1.1' },
  { name: 'Share Tech Mono (style Proto)', by: 'Carrois Apostrophe', license: 'SIL Open Font License 1.1' },
  { name: 'blobatar (têtes des espaces)', by: 'blobatar', license: 'MIT' },
  { name: 'sql.js (version web)', by: 'sql.js', license: 'MIT' },
];
