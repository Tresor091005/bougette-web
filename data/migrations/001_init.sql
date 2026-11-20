-- 001 : journal d'événements (source de vérité, ajout seul) et projections (jetables, reconstruites depuis le journal).
-- Une migration livrée est immuable : toute évolution passe par un nouveau fichier NNN_nom.sql.

CREATE TABLE events (
  seq        INTEGER PRIMARY KEY,          -- ordre local d'application
  id         TEXT NOT NULL UNIQUE,         -- ULID
  type       TEXT NOT NULL,
  v          INTEGER NOT NULL,             -- version du format de cet événement
  at         TEXT NOT NULL,                -- horodatage UTC de l'enregistrement
  device     TEXT NOT NULL,
  payload    TEXT NOT NULL,                -- JSON canonique
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL UNIQUE
);
CREATE INDEX events_at ON events(at);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ROLLBACK, 'events : journal en ajout seul'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ROLLBACK, 'events : journal en ajout seul'); END;

-- Informations locales (identifiant d'appareil, version des projections) : hors journal, hors empreinte.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Comptes : portefeuilles (wallet), catégories (expense / income), capitaux propres « Solde initial » (equity).
CREATE TABLE accounts (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('wallet', 'expense', 'income', 'equity')),
  subtype        TEXT,
  name           TEXT NOT NULL,
  currency       TEXT,
  identifier     TEXT NOT NULL DEFAULT '',
  icon           TEXT,
  emoji          TEXT,
  color          TEXT,
  sort           INTEGER NOT NULL,
  allow_negative INTEGER NOT NULL DEFAULT 0,
  archived_at    TEXT,
  deleted_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE entries (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'opening', 'adjustment')),
  occurred_on        TEXT NOT NULL,          -- date choisie par l'utilisateur (AAAA-MM-JJ, heure locale)
  status             TEXT NOT NULL CHECK (status IN ('posted', 'planned', 'void')),
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  voided_at          TEXT,
  void_reason        TEXT,
  status_before_void TEXT
);
CREATE INDEX entries_on ON entries(occurred_on);

-- Partie double : pour chaque écriture et chaque devise, SUM(amount) = 0 (vérifié à la projection et par l'intégrité).
CREATE TABLE postings (
  id         TEXT PRIMARY KEY,               -- entry_id#n
  entry_id   TEXT NOT NULL REFERENCES entries(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount     INTEGER NOT NULL,               -- plus petite unité de la devise, signé
  currency   TEXT NOT NULL
);
CREATE INDEX postings_entry ON postings(entry_id);
CREATE INDEX postings_account ON postings(account_id);

CREATE TABLE budgets (
  id         TEXT PRIMARY KEY,               -- « global » ou identifiant de catégorie
  account_id TEXT REFERENCES accounts(id),
  amount     INTEGER NOT NULL,
  currency   TEXT NOT NULL,
  valid_from TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- JSON canonique
);

-- Chronologie de chaque opération, dérivée des événements.
CREATE TABLE entry_history (
  id       TEXT PRIMARY KEY,                 -- seq:entry_id
  seq      INTEGER NOT NULL,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  at       TEXT NOT NULL,
  action   TEXT NOT NULL,                    -- recorded | amended | voided | restored | reset
  before   TEXT,
  after    TEXT
);
CREATE INDEX entry_history_entry ON entry_history(entry_id);
