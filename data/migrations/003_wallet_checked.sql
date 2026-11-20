-- 003 : vérification d'un portefeuille (D9). Date de la dernière vérification (« vérifié il y a… »), avec ou sans écart.
-- Colonne facultative : NULL tant que le portefeuille n'a jamais été vérifié, et pour les autres comptes.
ALTER TABLE accounts ADD COLUMN checked_at TEXT;
