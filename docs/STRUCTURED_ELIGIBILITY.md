# Struktureret eligibility

Step 4 flytter ansøgerkrav ud af brede tekstfelter og ind i en søgbar model på programniveau. Den eksisterende tekst i `programs` bevares som kompatibilitetslag.

## Datamodel

- `program_eligibility`: én profil pr. program med eligibility-resumé, CVR-status, geografisk afgrænsning og numeriske beløbsgrænser.
- `program_applicants`: normaliserede ansøgerkategorier med status `eligible`, `conditional`, `ineligible` eller `unknown` og eventuelle betingelser.
- `program_exclusions`: én række pr. dokumenteret udelukkelse med type, kilde og verificeringsstatus.

CVR-status bruger kun `required`, `not_required`, `conditional` og `unknown`. Hvis kilden ikke dokumenterer kravet klart, anvendes `unknown`; modellen må ikke udlede CVR-pligt alene ud fra ordet “forening”.

Beløb gemmes som `amount_min` og `amount_max` med valuta og en `amount_model`, der skelner mellem eksempelvis maksimum, interval, vejledende interval og loft over det samlede projektbudget. Det oprindelige tekstresumé bevares i `amount_notes`.

## Seeddata og import

De kuraterede data ligger i:

- `data/program_eligibility_seed.csv`
- `data/program_applicants_seed.csv`
- `data/program_exclusions_seed.csv`

SQLite-importen anvender en stagingtabel, så tomme beløbsfelter bliver `NULL` og ikke tom tekst. Postgres-importen er transaktionel og idempotent på samme måde som den eksisterende kanoniske import.

## Redaktionel regel

En profil kan være `source_checked`, selv om et enkelt felt som CVR er `unknown`: det betyder, at den kuraterede kilde er kontrolleret, men ikke dokumenterer kravet klart. Nye konkrete påstande skal altid have kilde, kontroldato og verificeringsstatus.
