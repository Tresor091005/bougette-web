// Déclarations minimales pour le typage JSDoc (tsc --checkJs) : modules Node utilisés seulement sous Node.
declare module 'node:fs/promises' {
  export function readFile(path: URL | string, enc?: string): Promise<any>;
}
declare module 'node:module' {
  export function createRequire(url: string | URL): (id: string) => any;
}

// Globales posées sur window par l'appli (Android / Tauri les appellent depuis le natif).
interface Window {
  appBack: () => boolean;
  appQuickEntry: (...args: any[]) => any;
  appPaused: () => void;
  appResumed: () => void;
  BougetteAndroid?: any;
  BougetteFolder?: any;
  BougetteIcon?: any;
  BougetteUpdate?: any;
  appUpdate?: (json: string) => void;
  appFolderPicked?: (name: string) => void;
}
