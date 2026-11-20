-- 002 : sous-catégories. Une catégorie peut avoir une catégorie parente (deux niveaux seulement, même type).
-- Colonne facultative : NULL pour une catégorie principale, et pour tout ce qui existait avant (aucune reconstruction).
ALTER TABLE accounts ADD COLUMN parent_id TEXT;
