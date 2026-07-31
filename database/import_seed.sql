.read database/schema.sql
.read database/scraping_schema.sql
.mode csv
.import --skip 1 data/fonde_seed.csv foundations
.import --skip 1 data/programs_seed.csv programs

CREATE TEMP TABLE program_eligibility_import (
  program_id TEXT, eligibility_summary TEXT, cvr_requirement TEXT, cvr_notes TEXT,
  geography_scope TEXT, country_code TEXT, region TEXT, municipality TEXT, local_area TEXT,
  amount_model TEXT, amount_min TEXT, amount_max TEXT, amount_currency TEXT, amount_notes TEXT,
  source_url TEXT, last_checked TEXT, verification_status TEXT
);
.import --skip 1 data/program_eligibility_seed.csv program_eligibility_import
INSERT INTO program_eligibility (
  program_id, eligibility_summary, cvr_requirement, cvr_notes, geography_scope, country_code,
  region, municipality, local_area, amount_model, amount_min, amount_max, amount_currency,
  amount_notes, source_url, last_checked, verification_status
)
SELECT program_id, eligibility_summary, cvr_requirement, NULLIF(cvr_notes, ''), geography_scope,
  NULLIF(country_code, ''), NULLIF(region, ''), NULLIF(municipality, ''), NULLIF(local_area, ''),
  amount_model, CAST(NULLIF(amount_min, '') AS REAL), CAST(NULLIF(amount_max, '') AS REAL),
  amount_currency, NULLIF(amount_notes, ''), source_url, NULLIF(last_checked, ''), verification_status
FROM program_eligibility_import;
DROP TABLE program_eligibility_import;

.import --skip 1 data/program_applicants_seed.csv program_applicants
.import --skip 1 data/program_exclusions_seed.csv program_exclusions
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
SELECT 'Imported eligibility profiles' AS metric, COUNT(*) AS value FROM program_eligibility;
SELECT 'Imported applicant rules' AS metric, COUNT(*) AS value FROM program_applicants;
SELECT 'Imported exclusions' AS metric, COUNT(*) AS value FROM program_exclusions;
SELECT 'Imported deadlines' AS metric, COUNT(*) AS value FROM deadlines;
SELECT 'Imported call scan results' AS metric, COUNT(*) AS value FROM call_scan_results;
