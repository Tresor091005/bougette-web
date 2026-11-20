-- 010 : échéances et opérations récurrentes (D18, ROADMAP 4b). Une ligne = une règle (« Loyer, 35 000 F, le 1er de
-- chaque mois ») ; une échéance seule a every NULL. Les dates à venir sont calculées, jamais stockées.
-- kind : 'expense', 'income' ou 'transfer' ; wallet_id : le portefeuille d'où part (ou où arrive) l'argent ;
-- to_wallet_id : l'arrivée d'un virement ; category_id : la catégorie d'une dépense ou d'une rentrée ;
-- start_on : la première date ; every : 'week', 'month', 'quarter', 'half', 'year' ou NULL (une seule fois) ;
-- end_on : dernière date permise, times : nombre de fois (l'un ou l'autre, ou aucun) ; reserve_id : la réserve qui
-- paie une dépense, ou que remplit un virement (D17) ; stopped_on : « Arrêter », plus de dates à partir de ce jour ;
-- skips : les dates passées (« Passer »), JSON trié ; from_id : la règle d'avant, quand une modification la coupe ;
-- begins_on : la règle qui en continue une autre ne compte ses dates qu'à partir de ce jour (son jour d'ancrage reste
-- celui de la première date : le 31 reste le 31, le nombre de fois se compte depuis la première date).
-- entries.schedule_id / entries.due_on : l'opération qui confirme une date (sa règle et la date prévue).
-- Une table vide et une colonne NULL sont absentes de l'empreinte d'état : celles des anciens journaux ne changent pas.
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES accounts(id),
  to_wallet_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES accounts(id),
  note TEXT NOT NULL,
  start_on TEXT NOT NULL,
  every TEXT CHECK (every IS NULL OR every IN ('week', 'month', 'quarter', 'half', 'year')),
  end_on TEXT,
  times INTEGER,
  reserve_id TEXT,
  stopped_on TEXT,
  skips TEXT,
  from_id TEXT,
  begins_on TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX schedules_wallet ON schedules(wallet_id);
ALTER TABLE entries ADD COLUMN schedule_id TEXT;
ALTER TABLE entries ADD COLUMN due_on TEXT;
CREATE INDEX entries_schedule ON entries(schedule_id);
