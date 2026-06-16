# Dansk Fondsdatabase

Dette er en startdatabase over danske fonde og fondslignende filantropiske aktorer, bygget til at kunne udvides systematisk.

## Indhold

- `data/fonde_seed.csv` - kurateret startliste med fonde, kilde-URL og tjekdato.
- `database/schema.sql` - SQLite-schema for databasen.
- `database/import_seed.sql` - importscript, der bygger databasen fra CSV.
- `outputs/fonds_database.sqlite` - genereret SQLite-database.

## Byg databasen

```bash
sqlite3 outputs/fonds_database.sqlite < database/import_seed.sql
```

## Start frontend

Nemmest paa Mac:

Dobbelklik paa `Start fondsdatabase.command`.

Hvis databasen skal deles paa samme WiFi/netvaerk, dobbelklik paa `Start fondsdatabase netvaerk.command`.

Kun paa din egen computer:

```bash
node server.mjs
```

Del paa samme lokale netvaerk:

```bash
HOST=0.0.0.0 PORT=8001 node server.mjs
```

Send derefter linket med din computers lokale IP-adresse, for eksempel:

```text
http://192.168.0.40:8001/
```

Modtageren skal vaere paa samme WiFi/netvaerk, og din computer skal vaere taendt med serveren kørende. Hvis linket ikke aabner, kan macOS firewall skulle tillade indgaaende forbindelser til Python.

## Automatisk opdatering

Branchen indeholder et GitHub Actions workflow, `.github/workflows/source-check.yml`, som kan koere automatisk hver mandag morgen eller startes manuelt fra GitHub under `Actions`.

Workflowet:

- laeser `data/fonde_seed.csv`
- tjekker `website`, `application_url` og `source_url` for hver fond
- skriver en rapport i `reports/source-check-report.json`
- opretter en pull request, hvis der er ændringer

Det er vigtigt: workflowet garanterer ikke, at alle fondsoplysninger er fagligt korrekte. Det kan opdage doede links, flyttede sider og records der skal gennemgaas. Endelige ændringer i støtteområder, frister og ansøgningskriterier bør stadig verificeres på fondens egen hjemmeside. Derfor ændrer standard-workflowet ikke CSV'en automatisk.

Koer samme tjek lokalt:

```bash
node scripts/check_foundation_sources.mjs --dry-run
```

Hvis du efter manuel vurdering vil opdatere `last_checked` og markere fejlede kilder som `needs_update`, kan du koere:

```bash
node scripts/check_foundation_sources.mjs --update-csv
sqlite3 outputs/fonds_database.sqlite < database/import_seed.sql
```

Frontendens `OPD`-knap koerer samme opdatering via den lokale `server.mjs`, genbygger SQLite-databasen og genindlaeser visningen.

## Fond-scraping

Branchen `webscraping` indeholder en første version af et fond-scraping værktøj.

Scraperen:

- opretter scraping-tabeller fra `database/scraping_schema.sql`
- henter HTML fra hver fonds `application_url`, `source_url` og `website`
- gemmer snapshots og content hashes
- udtrækker fire felter: ansøgningsfrister, beløbsrammer, kontaktoplysninger samt formål/kriterier
- sammenligner nye udtræk med senest godkendte værdier
- auto-godkender kun lavrisiko/høj-confidence ændringer
- markerer usikre eller væsentlige ændringer til manuel gennemgang
- gemmer versionshistorik i `foundation_field_changes`
- opretter et notifikationssammendrag i `scrape_notifications`

Kør scraperen lokalt:

```bash
node scripts/fond_scraper.mjs
```

Test kun de første fem fonde:

```bash
SCRAPER_LIMIT=5 node scripts/fond_scraper.mjs
```

I appen findes der et `Webscraping`-panel, hvor du kan køre scraperen og godkende eller afvise ændringer manuelt.

E-mail-notifikationer kan sendes fra køen med:

```bash
NOTIFICATION_EMAIL_TO=modtager@example.com node scripts/send_scrape_notifications.mjs
```

Det kræver at miljøet har `sendmail` eller at `SENDMAIL_PATH` peger på en kompatibel mail-kommando.

## Eksempelsoegninger

Find fonde inden for kultur:

```bash
sqlite3 outputs/fonds_database.sqlite "SELECT name, application_url FROM foundations WHERE support_areas LIKE '%Kultur%' ORDER BY name;"
```

Find fonde med lobende ansogning:

```bash
sqlite3 outputs/fonds_database.sqlite "SELECT name, deadline_model, application_url FROM foundations WHERE deadline_model LIKE '%Lobende%' ORDER BY name;"
```

## Foreslaaet naeste datamodel

Den nuvaerende version er bevidst enkel. Naar databasen skal goeres mere komplet, boer den udvides med tabeller for:

- `programs` - konkrete puljer/opslag under hver fond.
- `deadlines` - frister, aabningsdatoer og gentagelsesmønstre.
- `eligibility_rules` - hvem der kan soege, geografiske krav, CVR-krav og udelukkelser.
- `contacts` - kontaktpersoner, email og telefon.
- `grant_history` - tidligere bevillinger, belob og modtagere.
- `source_snapshots` - historik over hvornar data er hentet og fra hvilken kilde.

## Kildeprincip

Seed-data er baseret paa offentligt tilgaengelige fonds- og myndighedssider. Felterne `source_url`, `last_checked` og `verification_status` findes for at goere vedligeholdelsen sporbar. Ansogningsfrister og opslag skal altid valideres paa fondens egen hjemmeside foer brug.

Nyttige overordnede kilder:

- Civilstyrelsen: fondsmyndighed for ikke-erhvervsdrivende fonde.
- Erhvervsstyrelsen: fondstilsyn for erhvervsdrivende fonde.
- Legatbogen, Fonde.dk, LegatNet og Fondsmatch kan bruges som inspirations- og krydstjekskilder, men data boer ikke kopieres ukritisk fra kommercielle databaser.
