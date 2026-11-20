-- 006 : réserves (D17, ROADMAP 4a) : charges préparées à l'avance, dans un portefeuille d'épargne.
-- amount : montant visé ; used : déjà utilisé (petit à petit) ; start_on : début du rythme ; due_on : échéance ;
-- mode : 'once' (utilisée d'un coup) ou 'gradual' (petit à petit) ; repeats : 0, ou tous les combien de mois elle repart
-- à sa clôture (1 = chaque mois, 12 = chaque année) ;
-- pinned : montant fixé par la personne (NULL = répartition automatique) ; closed_on : date de clôture.
-- accounts.alloc : façon de répartir d'un portefeuille d'épargne ('one' = une par une ; NULL = au rythme).
-- Une table vide et une colonne NULL sont absentes de l'empreinte d'état : celles des anciens journaux ne changent pas.
CREATE TABLE reserves (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  used INTEGER NOT NULL,
  currency TEXT NOT NULL,
  start_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('once', 'gradual')),
  repeats INTEGER NOT NULL,
  pinned INTEGER,
  closed_on TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reserves_wallet ON reserves(wallet_id);
ALTER TABLE accounts ADD COLUMN alloc TEXT;
