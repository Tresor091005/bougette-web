-- 012 : plusieurs jours par échéance (D18 revu le 2026-11-18, « Quand ? » un seul calendrier). days : les autres jours de
-- départ, en décalages de jours depuis start_on (JSON trié d'entiers > 0, ex. [1,4] = lundi, mardi, vendredi si
-- start_on est un lundi) ; NULL = un seul jour, comme avant. Avec une répétition, ils tiennent dans la première période ;
-- sans répétition, ce sont des dates choisies. Une colonne NULL est absente de l'empreinte : les anciens journaux ne
-- changent pas.
ALTER TABLE schedules ADD COLUMN days TEXT;
