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

Kun paa din egen computer:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Del paa samme lokale netvaerk:

```bash
python3 -m http.server 8001 --bind 0.0.0.0
```

Send derefter linket med din computers lokale IP-adresse, for eksempel:

```text
http://192.168.0.40:8001/
```

Modtageren skal vaere paa samme WiFi/netvaerk, og din computer skal vaere taendt med serveren kørende. Hvis linket ikke aabner, kan macOS firewall skulle tillade indgaaende forbindelser til Python.

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
