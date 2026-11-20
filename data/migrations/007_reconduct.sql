-- 007 : historique et « Reconduire » (D11, D17, revu le 2026-11-10) à la place de « Se répète » pour les réserves.
-- reserves.from_id / budgets.from_id : la réserve ou le budget d'avant, quand celui-ci a été reconduit (lien entre les
-- fois successives). reserves.uses : identifiants des opérations qui l'ont utilisée (JSON), pour dire si l'une a été
-- supprimée depuis. reserves.repeats reste (toujours 0 désormais) pour les journaux déjà écrits.
-- Colonnes facultatives : NULL, elles sont absentes de l'empreinte d'état.
ALTER TABLE reserves ADD COLUMN from_id TEXT;
ALTER TABLE reserves ADD COLUMN uses TEXT;
ALTER TABLE budgets ADD COLUMN from_id TEXT;
