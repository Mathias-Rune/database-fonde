# Kanonisk Postgres-database

Denne branch etablerer Postgres som den fremtidige primære database for både applikationen og crawleren. CSV og SQLite fortsætter midlertidigt som kompatible input/eksporter, mens læse- og skriveflows flyttes ét ad gangen i efterfølgende branches.

## Model

Skemaet er opdelt efter ansvar:

- `001_core.sql`: fonde, programmer, deadlines og søgeviews.
- `002_intelligence.sql`: crawlerkilder, claims, bevillinger, calls og dokumentchunks.
- `003_application.sql`: scannerfund, notifikationer og den eksisterende scraperhistorik.

Postgres bruger UUID som intern nøgle. De nuværende stabile CSV-nøgler bevares som `foundation_key`, `program_key` og `deadline_key`, så links og importer ikke afhænger af databasegenererede UUID'er.

## Opsætning

Fra `crawler/`:

```bash
export DATABASE_URL=postgres://brugernavn:kode@localhost:5432/foundation_intelligence
npm run db:migrate
npm run db:import-seed
npm run db:verify
```

`db:migrate` anvender kun migrationsfiler, som ikke allerede står i `schema_migrations`, og bruger en Postgres advisory lock mod samtidige migrationer.

GitHub Actions-workflowet `Canonical database` starter Postgres 16, kører importen to gange og verificerer derefter skema, rækkeantal og unikke websites.

`db:import-seed` indlæser:

- `data/fonde_seed.csv`
- `data/programs_seed.csv`
- `data/deadlines_seed.csv`
- `data/call_scan_results.csv`
- scraperhistorik fra `outputs/fonds_database.sqlite`

Importen er transaktionel og idempotent. Den opdaterer seed-ejede felter, men sletter ikke crawlerkilder, claims, bevillinger eller andre redaktionelle data. Hvis crawleren allerede har oprettet en fond med samme website, overtager seed-datasættets læsbare `foundation_key` den eksisterende UUID-post.

SQLite-importen bevarer eksisterende abonnementer, favoritter, events, run-, snapshot-, feltændrings- og notifikations-ID'er og justerer derefter Postgres-sekvenserne. Ukendte foundation-, program-, abonnement- eller run-relationer får hele transaktionen til at fejle; rækker springes ikke lydløst over.

## Crawler

Crawlerens Postgres-repository skriver nu profiler til de samme `foundations`-rækker som den kuraterede database ved at matche på det unikke website. Kuraterede identitetsfelter bevares, mens crawlerens profil-, kilde- og evidensfelter opdateres.

## Kontrolleret overgang

Denne branch ændrer ikke endnu frontendens læsning eller de lokale SQLite-jobs. Det er bevidst: produktionsdatabasen kan etableres og valideres, før applikationen skifter læsekilde. Næste databaseintegration bør være et read-only API fra Postgres med CSV/SQLite fallback; reviewskrivning hører til sin egen branch.
