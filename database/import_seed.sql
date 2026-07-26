.read database/schema.sql
.mode csv
.import --skip 1 data/fonde_seed.csv foundations
.import --skip 1 data/programs_seed.csv programs
.import --skip 1 data/deadlines_seed.csv deadlines
.import --skip 1 data/call_scan_results.csv call_scan_results

-- Bevar scraperhistorik for aktive fonde, men fjern rækker der er blevet
-- forældreløse, når den kuraterede fondsliste ændres.
DELETE FROM foundation_field_changes
WHERE foundation_id NOT IN (SELECT foundation_id FROM foundations);
DELETE FROM foundation_extracted_fields
WHERE foundation_id NOT IN (SELECT foundation_id FROM foundations);
DELETE FROM scrape_snapshots
WHERE foundation_id NOT IN (SELECT foundation_id FROM foundations);

SELECT 'Imported foundations' AS metric, COUNT(*) AS value FROM foundations;
SELECT 'Imported programs' AS metric, COUNT(*) AS value FROM programs;
SELECT 'Imported deadlines' AS metric, COUNT(*) AS value FROM deadlines;
SELECT 'Imported call scan results' AS metric, COUNT(*) AS value FROM call_scan_results;
