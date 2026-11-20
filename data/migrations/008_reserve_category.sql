-- 008 : catégorie d'une réserve (D17, revu le 2026-11-10) : la catégorie de la dépense quand on l'utilise (l'assurance
-- moto → Frais financiers › Assurance). Utiliser une réserve = une dépense depuis le portefeuille d'épargne.
-- Colonne facultative : NULL, elle est absente de l'empreinte d'état.
ALTER TABLE reserves ADD COLUMN category_id TEXT;
