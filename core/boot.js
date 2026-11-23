// Premier dessin (2026-11-22, avec l'utilisateur : l'ouverture laissait un écran noir) : un script ordinaire, lu pendant
// la lecture de la page, avant les modules de l'app. Il pose l'écran d'ouverture préparé par
// splash.js (la tête et le nom de l'espace qui s'ouvre) et le style du téléphone, pour qu'aucune image ne soit vide.
(() => {
  try {
    if (JSON.parse(localStorage.getItem('cauri:pref:style') || 'null') === 'proto') document.documentElement.dataset.style = 'proto';
    const html = localStorage.getItem('cauri:splash');
    if (html) { document.body.insertAdjacentHTML('beforeend', html); /** @type {any} */ (window).__splashAt = performance.now(); }
  } catch (e) { /* sans écran d'ouverture */ }
})();
