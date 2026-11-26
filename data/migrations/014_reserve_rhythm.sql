-- 014 : le rythme d'une dépense prévue (2026-11-25, avec l'utilisateur : une dépense récurrente qui ne tombe pas dans
-- chaque mois devient une dépense prévue, qui garde son rythme pour proposer la fois suivante quand on l'utilise ; pas de
-- répétition automatique). every : l'unité, 'day', 'week', 'month' ou 'year' (NULL = sans rythme, comme avant) ;
-- interval : tous les combien (NULL = chaque), comme pour les échéances (011). Colonnes facultatives : NULL, elles sont
-- absentes de l'empreinte d'état, les anciens journaux ne changent pas.
ALTER TABLE reserves ADD COLUMN every TEXT CHECK (every IS NULL OR every IN ('day', 'week', 'month', 'year'));
ALTER TABLE reserves ADD COLUMN interval INTEGER CHECK (interval IS NULL OR interval >= 2);
