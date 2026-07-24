# Dansk Fondsdatabase

Dette er en kurateret database over danske fonde, fondslignende filantropiske aktører samt relevante kommunale og lokale puljer for Sustainarys arbejde.

## Kurateringsprofil

En fond eller pulje medtages, når Sustainary realistisk kan være ansøger, og mindst ét centralt spor matcher:

- unge som primær målgruppe
- demokratisk deltagelse, civilsamfund eller fællesskaber
- social innovation og unges handlekraft
- praktisk klimaindsats eller grøn omstilling for unge

Brede støtteområder er ikke i sig selv nok. Forsknings-, sundheds-, kulturarvs- og bygningspuljer uden et tydeligt match fravælges for at reducere støj i scanninger og alerts.

Kommunale puljer medtages, når Sustainary eller et konkret ungedrevet projekt realistisk kan søge, og når geografiske, organisatoriske og aldersmæssige adgangskrav fremgår tydeligt af programdataene.

## Indhold

- `data/fonde_seed.csv` - kurateret startliste med fonde, kilde-URL og tjekdato.
- `data/discovery_sources.csv` - brede officielle oversigtssider, der bruges til at finde helt nye puljer og udbydere.
- `data/discovery_results.csv` - seneste discovery-fund; disse markeres som usikre, indtil de er verificeret.

Discovery-scanneren besøger hvert kandidatlink og scorer konkrete puljesignaler, ansøgningsmulighed, åben/lukket status, aktuel deadline, målgruppe og kontaktperson. Kun fund med status `qualified` sendes i Fondsblik; kategorisider, lukkede opslag og tvivlstilfælde gemmes som `review` eller `rejected`.
- `data/programs_seed.csv` - konkrete puljer/ansøgningsmuligheder under fondene.
- `data/deadlines_seed.csv` - friststatus, gentagelse og fristnoter for puljerne.
- `database/schema.sql` - SQLite-schema for databasen.
- `database/import_seed.sql` - importscript, der bygger databasen fra CSV.
- `outputs/fonds_database.sqlite` - genereret SQLite-database.
- `server.mjs` - lokal server med API'er til kildekontrol og manuel scraper-review.
- `crawler/` - den grundige TypeScript-crawler; build-output og crawlprofiler genereres lokalt.

## Byg databasen

```bash
sqlite3 outputs/fonds_database.sqlite < database/import_seed.sql
```

## Start frontend

Kun paa din egen computer:

Nemmest på Mac: dobbeltklik på `Start fondsdatabase.command`.

```bash
node server.mjs
```

Del paa samme lokale netvaerk:

Nemmest på Mac: dobbeltklik på `Start fondsdatabase netvaerk.command`.

```bash
HOST=0.0.0.0 PORT=8001 node server.mjs
```

Send derefter linket med din computers lokale IP-adresse, for eksempel:

```text
http://192.168.0.40:8001/
```

Modtageren skal vaere paa samme WiFi/netvaerk, og din computer skal vaere taendt med serveren kørende. Hvis linket ikke aabner, kan macOS firewall skulle tillade indgaaende forbindelser til Node.

## Kildekontrol og manuel scraper-review

Din eksisterende kildekontrol og scraper er bevaret sammen med den nye call-scanner. De har forskellige roller:

- `scripts/check_foundation_sources.mjs` kontrollerer om fondenes kendte URL'er svarer og markerer poster, der kræver gennemgang.
- `scripts/fond_scraper.mjs` udtrækker frister, beløb, kontaktoplysninger samt formål/kriterier og lægger usikre ændringer i en manuel reviewkø.
- `scripts/scan_fund_calls.mjs` leder specifikt efter aktuelle opslag under de kuraterede programmer.
- `scripts/discover_funding_calls.mjs` leder bredere efter helt nye relevante muligheder.

Kør kildekontrollen lokalt:

```bash
node scripts/check_foundation_sources.mjs --dry-run
```

Kør den eksisterende scraper:

```bash
node scripts/fond_scraper.mjs
```

Brugerfladens knapper til kildeopdatering, scraperkørsel og manuel godkendelse kræver, at appen er startet med `node server.mjs`.

## Favoritter og alerts

Frontenden har lokal favoritfunktion og alert-indstillinger gemt i browserens `localStorage`.

Den kan vise alerts for:

- frister med konkret `closes_on` inden for ca. 14 dage
- nye fonde siden sidste indlæsning af databasen
- nye mulige calls/opslag fundet af fondsscanneren
- ændringer på fonde, brugeren har markeret som favorit

Knappen `Emailkladde` åbner en emailkladde via `mailto:` med de aktuelle alerts. Der findes også et backend-light job, som bruger SQLite-tabellerne `notification_subscriptions`, `favorite_foundations` og `notification_events`.

Opret eller opdater en lokal subscription og skriv en digest-fil:

```bash
NOTIFY_EMAIL=din@email.dk FAVORITE_FOUNDATION_IDS=tuborgfondet node scripts/send_notifications.mjs
```

Jobbet opretter events for frister inden for 14 dage, nye call-fund, nye fonde og opdateringer på favoritter. Digest-filer skrives som standard til `data/notification_digest_*.md`. Call-fund filtreres med en kvalitetsscore på minimum 40; det kan justeres:

```bash
NOTIFICATION_MIN_CALL_QUALITY=55 NOTIFY_EMAIL=din@email.dk node scripts/send_notifications.mjs
```

Hvis `SMTP_HOST` er sat, kan jobbet forsøge at sende email med Nodemailer:

```bash
SMTP_HOST=smtp.example.com SMTP_USER=brugernavn SMTP_PASS=kode SMTP_FROM=alerts@example.com NOTIFY_EMAIL=din@email.dk node scripts/send_notifications.mjs --send
```

Hvis Nodemailer ikke er installeret, skriver scriptet stadig digest-filen og fortæller, at email ikke blev sendt.

Frontenden har også et `Review fund`-panel. Det beregner en lokal kvalitetsscore for hvert scanresultat, prioriterer crawler-fund og fund med frist/dato, og lader brugeren markere fund som `reviewed` eller `ignored`. Reviewvalg gemmes lokalt i browseren indtil en backend/adminservice findes.

## Scan fondenes sider for nye calls

Kør den hurtige scanner manuelt:

```bash
node scripts/scan_fund_calls.mjs
sqlite3 outputs/fonds_database.sqlite < database/import_seed.sql
```

Scanneren læser `data/programs_seed.csv`, henter fondenes ansøgnings-/kildesider og skriver mulige call-fund til `data/call_scan_results.csv`. Frontenden læser filen og viser nye fund som alerts. Hurtig-scanneren bevarer eksisterende `crawler_*`-rækker og genbruger review-status for fund med samme ID, så et hurtigt scan ikke sletter deep-crawlerens arbejde.

Scanneren bruger flere fallback-lag for at reducere fetch-fejl:

- browserlignende headers og kort timeout
- fallback fra ansøgnings-URL til kilde-URL, website og få almindelige ansøgningsstier
- `curl` fallback med redirect, kompression og TLS-tolerance ved fetch-/serverfejl
- hårdt loft på antal URL-kandidater, så ét langsomt website ikke stopper hele scannet

Den lokale Codex automation `Scan fondscalls` er oprettet, men aktuelt sat på pause.

Kør deep scan med den importerede crawler:

```bash
cd crawler && npm ci && cd ..
node scripts/deep_scan_fund_calls.mjs
sqlite3 outputs/fonds_database.sqlite < database/import_seed.sql
```

Deep scan bruger `crawler/`-projektets Foundation Intelligence Engine. Den crawler hvert fondswebsite, scorer relevante sider, ekstraherer `openCalls` og merger fundene ind i `data/call_scan_results.csv` som `crawler_open_call`. Brug den sjældnere end den hurtige scanner, fordi den er mere grundig og langsommere.

Til test på en enkelt fond:

```bash
DEEP_SCAN_FOUNDATION_IDS=tuborgfondet DEEP_SCAN_MAX_PAGES=6 node scripts/deep_scan_fund_calls.mjs
```

Til en lille batch:

```bash
DEEP_SCAN_LIMIT=3 DEEP_SCAN_MAX_PAGES=4 node scripts/deep_scan_fund_calls.mjs
```

Når `DEEP_SCAN_LIMIT` bruges uden `DEEP_SCAN_FOUNDATION_IDS` eller `DEEP_SCAN_OFFSET`, roterer scriptet automatisk gennem fondene og gemmer næste startpunkt i `data/deep_scan_state.json`. Gamle crawler-rækker bevares for fonde uden for den aktuelle batch, mens crawler-rækker for de netop scannede fonde opdateres.

Til en bestemt batch-position:

```bash
DEEP_SCAN_OFFSET=6 DEEP_SCAN_LIMIT=3 DEEP_SCAN_MAX_PAGES=4 node scripts/deep_scan_fund_calls.mjs
```

Deep scan er bevidst sat op til små batches i automationen. Den underliggende crawler respekterer robots.txt, delays og sitemap-discovery, så fuld databasecrawl bør fordeles over flere kørsler eller målrettes favoritter/nye fonde.

## Ugentlig cloud-mail

Workflowet `.github/workflows/weekly-funding-digest.yml` kører i GitHub Actions mandag kl. 09.00 dansk tid. Det kræver ikke, at en lokal computer er tændt.

Jobbet:

1. tester scanner og digest-kode
2. scanner de kuraterede finansieringskilder
3. genopbygger SQLite-databasen
4. sammenligner fund og programmer med sidste leverede mail
5. genererer HTML-, tekst- og JSON-preview
6. sender mail via Resend, når secret er konfigureret

Mailen indeholder nye relevante calls, deadlines inden for 14/30/60 dage, ændrede eller lukkede programmer samt datakvalitet. Hvert fund har relevansscore, sikkerhedsscore, konkrete usikkerheder og link til kilden.

### GitHub-konfiguration

Tilføj følgende repository secret under `Settings → Secrets and variables → Actions`:

- `RESEND_API_KEY` - API-nøgle fra Resend

Følgende repository variables er valgfrie, fordi Sustainary-standarderne allerede er indbygget:

- `DIGEST_FROM` - standard `info@sustainary.org`
- `DIGEST_TO` - standard `mpv@sustainary.org,valdemar@sustainary.org,manuela@sustainary.org`
- `DIGEST_MIN_RELEVANCE` - standard `20`; discovery-fund mærkes særskilt og kræver kildeverificering.
- `DIGEST_MAX_DISCOVERY` - højst `20` nye discovery-fund pr. mail, så brede kilder ikke overtager hele Fondsblik.

Resend skal have `sustainary.org` verificeret med DNS-poster, før produktionsmail fra `info@sustainary.org` kan leveres. Uden `RESEND_API_KEY` kører workflowet sikkert i preview-mode og gemmer digest som GitHub Actions-artifact.

Kør lokalt i preview-mode:

```bash
npm test
node scripts/scan_fund_calls.mjs
node scripts/weekly_digest.mjs
```

Leveringshistorikken ligger i `data/weekly_digest_state.json` og opdateres først efter en vellykket mail. Dermed bliver samme fund ikke sendt som nyt igen.

## Eksempelsoegninger

Find fonde inden for kultur:

```bash
sqlite3 outputs/fonds_database.sqlite "SELECT name, application_url FROM foundations WHERE support_areas LIKE '%Kultur%' ORDER BY name;"
```

Find fonde med lobende ansogning:

```bash
sqlite3 outputs/fonds_database.sqlite "SELECT name, deadline_model, application_url FROM foundations WHERE deadline_model LIKE '%Lobende%' ORDER BY name;"
```

Find konkrete puljer der er markeret som lobende aabne:

```bash
sqlite3 outputs/fonds_database.sqlite "SELECT foundation_name, program_name, deadline_summary, application_url FROM program_search WHERE deadline_status = 'open' ORDER BY foundation_name;"
```

## Foreslaaet naeste datamodel

Den nuvaerende version har nu fond, pulje og frist som separate lag. Naar databasen skal goeres mere komplet, boer den udvides med tabeller for:

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
