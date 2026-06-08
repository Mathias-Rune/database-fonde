.read database/schema.sql
.mode csv
.import --skip 1 data/fonde_seed.csv foundations

SELECT 'Imported foundations' AS metric, COUNT(*) AS value FROM foundations;
