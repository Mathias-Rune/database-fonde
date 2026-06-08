-- Eksempler:
-- sqlite3 outputs/fonds_database.sqlite < scripts/search_examples.sql

.headers on
.mode column

SELECT name, city, deadline_model, application_url
FROM foundations
WHERE support_areas LIKE '%Kultur%'
ORDER BY name;

SELECT name, support_areas, application_url
FROM foundations
WHERE support_areas LIKE '%Børn%' OR support_areas LIKE '%unge%'
ORDER BY name;

SELECT verification_status, COUNT(*) AS foundations
FROM foundations
GROUP BY verification_status;
