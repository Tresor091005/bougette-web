// Google Drive, dossier caché de l'app (D21) : appDataFolder, que seule Bougette peut lire et écrire, invisible dans le
// Drive de la personne (qui peut seulement le supprimer, dans les réglages du Drive). Ni serveur à nous, ni copie
// ailleurs : l'app parle directement à l'API de Google avec un jeton d'accès limité à ce dossier (drive.appdata).
// Les fichiers : « bougette-spaces.json » (la liste des espaces du compte), puis un « space-<id>.bgj » par espace (son
// journal, compressé et chiffré, D16) ; leur tête (numéro, empreinte) est rangée dans appProperties, lisible sans
// télécharger le fichier.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,modifiedTime,size,appProperties';

export class DriveError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) { super(message); this.status = status; }
}

/** @typedef {{ id: string, name: string, modifiedTime: string, size?: string, appProperties?: Record<string, string> }} DriveFile */

/**
 * @param {(refresh: boolean) => Promise<string>} token un jeton d'accès (refresh : le précédent a été refusé)
 * @param {typeof fetch} [fetchImpl]
 */
export function makeDrive(token, fetchImpl = (...a) => fetch(...a)) {
  /** @param {string} url @param {RequestInit} [init] */
  async function call(url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      const t = await token(attempt > 0);
      let res;
      try {
        res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
      } catch (e) {
        throw new DriveError('Pas de connexion à internet.', 0);
      }
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json())?.error?.message || ''; } catch (e) { /* sans détail */ }
        // 403 : souvent l'API Drive pas activée dans le projet Google Cloud, ou un quota ; le détail de Google est gardé
        throw new DriveError(res.status === 401 ? 'Google refuse l’accès : relie ton compte.' : `Google Drive répond ${res.status}${msg ? ' : ' + msg : ''}.`, res.status);
      }
      return res;
    }
  }

  /** @param {Record<string, any>} meta @param {string} text */
  function multipart(meta, text) {
    const b = 'bougette' + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`;
    return { body, headers: { 'Content-Type': `multipart/related; boundary=${b}` } };
  }

  return {
    /** Le compte (nom, e-mail). @returns {Promise<{ name: string, email: string }>} */
    async about() {
      const r = await (await call(`${API}/about?fields=user(displayName,emailAddress)`)).json();
      return { name: r.user?.displayName || '', email: r.user?.emailAddress || '' };
    },
    /** Les fichiers du dossier de l'app. @returns {Promise<DriveFile[]>} */
    async list() {
      /** @type {DriveFile[]} */
      const out = [];
      let page = '';
      do {
        const q = new URLSearchParams({ spaces: 'appDataFolder', fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', ...(page ? { pageToken: page } : {}) });
        const r = await (await call(`${API}/files?${q}`)).json();
        out.push(...(r.files || []));
        page = r.nextPageToken || '';
      } while (page);
      return out;
    },
    /** Les métadonnées d'un fichier (sa tête, avant d'écrire par-dessus). @param {string} id @returns {Promise<DriveFile>} */
    async meta(id) {
      return (await call(`${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`)).json();
    },
    /** Le texte d'un fichier. @param {string} id */
    async read(id) {
      return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
    },
    /** Crée un fichier dans le dossier de l'app. @param {string} name @param {string} text @param {Record<string, string>} [props] @returns {Promise<DriveFile>} */
    async create(name, text, props = {}) {
      const m = multipart({ name, parents: ['appDataFolder'], appProperties: props }, text);
      return (await call(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: 'POST', ...m })).json();
    },
    /** Remplace le contenu d'un fichier. @param {string} id @param {string} text @param {Record<string, string>} [props] @returns {Promise<DriveFile>} */
    async update(id, text, props = {}) {
      const m = multipart({ appProperties: props }, text);
      return (await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=${FIELDS}`, { method: 'PATCH', ...m })).json();
    },
    /** Supprime un fichier. @param {string} id */
    async remove(id) {
      await call(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
/** @typedef {ReturnType<typeof makeDrive>} Drive */

/** Un faux Drive en mémoire (tests), partagé entre plusieurs « appareils » ; onRead : un geste glissé pendant une lecture. @returns {Drive & { files: Map<string, DriveFile & { text: string }>, onRead: ((f: any) => Promise<void>)|null }} */
export function memoryDrive() {
  /** @type {Map<string, DriveFile & { text: string }>} */
  const files = new Map();
  let n = 0, clock = 0;
  const pub = (/** @type {any} */ f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: String(f.text.length), appProperties: { ...f.appProperties } });
  return {
    files,
    onRead: null,
    async about() { return { name: 'Test', email: 'test@example.com' }; },
    async list() { return [...files.values()].map(pub); },
    async meta(id) { const f = files.get(id); if (!f) throw new DriveError('introuvable', 404); return pub(f); },
    async read(id) { const f = files.get(id); if (!f) throw new DriveError('introuvable', 404); if (this.onRead) await this.onRead(f); return f.text; },
    async create(name, text, props = {}) {
      const f = { id: 'f' + (++n), name, text, appProperties: { ...props }, modifiedTime: new Date(Date.UTC(2026, 10, 20, 0, 0, ++clock)).toISOString() };
      files.set(f.id, f);
      return pub(f);
    },
    async update(id, text, props = {}) {
      const f = files.get(id);
      if (!f) throw new DriveError('introuvable', 404);
      Object.assign(f, { text, appProperties: { ...f.appProperties, ...props }, modifiedTime: new Date(Date.UTC(2026, 10, 20, 0, 0, ++clock)).toISOString() });
      return pub(f);
    },
    async remove(id) { files.delete(id); },
  };
}
