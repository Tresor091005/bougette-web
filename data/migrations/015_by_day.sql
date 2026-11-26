-- 015 : une règle par mois lue autrement que par son quantième (2026-11-25, avec l'utilisateur : tontines, associations,
-- église). by_day : 'weekday' (le Nᵉ même jour de la semaine que la première date : « le 2e lundi »), 'lastweekday'
-- (« le dernier vendredi ») ou 'lastday' (« le dernier jour ») ; NULL = le même quantième, comme avant. Seulement pour
-- une règle par mois d'un seul jour ; une dépense prévue préparée depuis elle garde sa lecture (la date de la fois
-- suivante). Une colonne NULL est absente de l'empreinte : les anciens journaux ne changent pas.
ALTER TABLE schedules ADD COLUMN by_day TEXT CHECK (by_day IS NULL OR by_day IN ('weekday', 'lastweekday', 'lastday'));
ALTER TABLE reserves ADD COLUMN by_day TEXT CHECK (by_day IS NULL OR by_day IN ('weekday', 'lastweekday', 'lastday'));
