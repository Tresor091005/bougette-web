// Migrations SQL versionnées : NNN_nom.sql, numéro courant dans PRAGMA user_version, appliquées dans une transaction.
// Elles ne concernent que la structure (journal stable, projections jetables) ; les données viennent du journal.

/** @typedef {{ version: number, file: string }} Migration */

/** @type {Migration[]} */
export const MIGRATIONS = [
  { version: 1, file: '001_init.sql' },
  { version: 2, file: '002_category_parent.sql' },
  { version: 3, file: '003_wallet_checked.sql' },
  { version: 4, file: '004_budget_dates.sql' },
  { version: 5, file: '005_savings.sql' },
  { version: 6, file: '006_reserves.sql' },
  { version: 7, file: '007_reconduct.sql' },
  { version: 8, file: '008_reserve_category.sql' },
  { version: 9, file: '009_reserve_held.sql' },
  { version: 10, file: '010_schedules.sql' },
  { version: 11, file: '011_schedule_interval.sql' },
  { version: 12, file: '012_schedule_days.sql' },
  { version: 13, file: '013_schedule_amounts.sql' },
  { version: 14, file: '014_reserve_rhythm.sql' },
  { version: 15, file: '015_by_day.sql' },
];
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Texte d'une migration : fichier lu par Node, ou chargé par la WebView / Chrome (fichier embarqué, hors ligne).
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function migrationSql(file) {
  const url = new URL(file, import.meta.url);
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    return fs.readFile(url, 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Migration ${file} introuvable`);
  return res.text();
}
