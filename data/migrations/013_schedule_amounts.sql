-- 013 : un autre montant pour une seule fois (2026-11-24, avec l'utilisateur). amounts : sur la première règle d'une
-- échéance (celle qui ne change pas quand on la modifie), les fois au montant changé, en JSON canonique
-- {"AAAA-MM-JJ": montant} ; NULL = aucune, comme avant. Une colonne NULL est absente de l'empreinte : les anciens
-- journaux ne changent pas.
ALTER TABLE schedules ADD COLUMN amounts TEXT;
