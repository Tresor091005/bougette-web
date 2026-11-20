-- 005 : portefeuille d'épargne (D17, ROADMAP 4a). Un réglage, pas un type : savings = 1 pour « C'est une épargne ».
-- spend_ok = 1 : dépenses directes permises (« Permettre les dépenses ») ; refusées sinon.
-- goal_amount / goal_on : objectif du portefeuille (montant, date facultative), purement indicatif.
-- emergency = 1 : rôle « Fonds d'urgence » (un seul portefeuille d'épargne à la fois).
-- Colonnes facultatives (NULL sinon) : rien n'est reconstruit, les empreintes des anciens journaux ne changent pas.
ALTER TABLE accounts ADD COLUMN savings INTEGER;
ALTER TABLE accounts ADD COLUMN spend_ok INTEGER;
ALTER TABLE accounts ADD COLUMN goal_amount INTEGER;
ALTER TABLE accounts ADD COLUMN goal_on TEXT;
ALTER TABLE accounts ADD COLUMN emergency INTEGER;
