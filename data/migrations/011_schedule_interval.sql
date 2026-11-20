-- 011 : un rythme libre pour les échéances (D18, revu le 2026-11-11) : « tous les 23 jours », « toutes les 2 semaines »,
-- « tous les 2 mois ». every : l'unité, 'day', 'week', 'month' ou 'year' ('quarter' et 'half' restent lisibles : les
-- journaux déjà écrits) ; interval : tous les combien (NULL = chaque). SQLite ne change pas une contrainte CHECK en
-- place : la table est refaite et ses lignes recopiées telles quelles.
-- Colonne facultative : NULL, elle est absente de l'empreinte d'état.
CREATE TABLE schedules_011 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES accounts(id),
  to_wallet_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES accounts(id),
  note TEXT NOT NULL,
  start_on TEXT NOT NULL,
  every TEXT CHECK (every IS NULL OR every IN ('day', 'week', 'month', 'quarter', 'half', 'year')),
  end_on TEXT,
  times INTEGER,
  reserve_id TEXT,
  stopped_on TEXT,
  skips TEXT,
  from_id TEXT,
  begins_on TEXT,
  created_at TEXT NOT NULL,
  interval INTEGER CHECK (interval IS NULL OR interval >= 2)
);
INSERT INTO schedules_011 (id, kind, amount, currency, wallet_id, to_wallet_id, category_id, note, start_on, every, end_on, times,
  reserve_id, stopped_on, skips, from_id, begins_on, created_at)
  SELECT id, kind, amount, currency, wallet_id, to_wallet_id, category_id, note, start_on, every, end_on, times,
    reserve_id, stopped_on, skips, from_id, begins_on, created_at FROM schedules;
DROP TABLE schedules;
ALTER TABLE schedules_011 RENAME TO schedules;
CREATE INDEX schedules_wallet ON schedules(wallet_id);
