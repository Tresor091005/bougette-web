// blobatar 2.7.0 (licence MIT, voir LICENSE dans ce dossier) : dist/blob.js copié tel quel depuis le paquet npm, le rendu
// seul (sans dépendance, sans réseau). Ces types, écrits à la main, évitent de faire relire le fichier minifié.
export declare const blobatar: (name: string, opts?: {
  size?: number;
  background?: boolean | 'square' | 'circle' | 'squircle';
  hue?: number;
  tone?: number;
  traits?: Record<string, number>;
  normalize?: boolean;
  contrast?: boolean;
  [key: string]: unknown;
}) => string;
export declare const layout: (t: unknown) => unknown;
