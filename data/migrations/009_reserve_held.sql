-- 009 : répartition enregistrée (D17, revu le 2026-11-10). held : ce qui est mis de côté pour la réserve, décidé quand
-- l'argent arrive (reserve.allocated) ; il ne bouge plus tout seul. NULL = 0 (absent de l'empreinte d'état).
-- La colonne pinned (« Montant fixé », retiré) reste pour les journaux déjà écrits ; accounts.alloc aussi.
ALTER TABLE reserves ADD COLUMN held INTEGER;
