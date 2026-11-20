-- 004 : budgets par répartition (D11 revu) et portefeuille « hors du total ».
-- Un budget a une date de début et de fin (comprises) et peut se répéter ; les anciens budgets mensuels (budget.set)
-- gardent ces colonnes à NULL et se lisent comme un budget qui se répète chaque mois (src/domain/budgets.js).
-- Un portefeuille hors du total (off_total = 1) ne compte ni dans le total ni dans Disponible ; NULL sinon.
-- Colonnes facultatives : rien n'est reconstruit, les empreintes des anciens journaux ne changent pas.
ALTER TABLE budgets ADD COLUMN start_on TEXT;
ALTER TABLE budgets ADD COLUMN end_on TEXT;
ALTER TABLE budgets ADD COLUMN repeats INTEGER;
ALTER TABLE accounts ADD COLUMN off_total INTEGER;
