# Review af scannerfund – 27. juli 2026

## Resultat

De 73 ureviderede fund med `scan_status=found` er gennemgået mod deres officielle kilder. Den ene yderligere post med `review_status=new` er en teknisk `crawler_error` og er med vilje ikke behandlet som et fund.

- 40 fund (54,8 %) er markeret `reviewed`.
- 33 fund (45,2 %) er markeret `ignored`.

Beslutningerne ligger i `data/call_scan_review_decisions.csv` og kan indlæses idempotent i både PostgreSQL og SQLite. Hver ændring registreres gennem review-repositoriet og får dermed en audit event.

## Kriterier

- `reviewed`: direkte ansøgningsportal, aktuel pulje- eller programside, officiel frist/status eller nødvendig ansøgningsvejledning.
- `ignored`: navigationslink, dublet, link til en anden pulje, historisk bevilling, strategi, udvalg, projektarkiv eller generisk emneside uden et konkret opslag.

Hver beslutning har en kort begrundelse. Vurderingen siger, om scannerfundet er nyttigt som finansieringssignal; den er ikke en fuld strukturering af eligibility, geografi, CVR-krav eller beløbsgrænser. Det hører til næste selvstændige trin.

## Datakvalitetsfund

Den største fejlkilde er brede nøgleord i links. Ord som `pulje`, `ansøg` og `uddeling` rammer også navigation, relaterede puljer og historiske bevillinger. Frederiksberg Kommune havde 9 ignorerede fund ud af 10, primært fordi én puljeside linker til kommunens øvrige puljer. VELUX FONDEN og VILLUM FONDEN gav tilsvarende generiske programområder og strategisider i stedet for konkrete opslag.

Disse mønstre bør bruges som regressionscases, når scannerens relevansregler senere forbedres:

- Ignorér fragmentlinks som `#main-content`.
- Nedprioritér oversigter over tidligere eller bevilgede projekter.
- Kræv programmatch, når en side linker til flere forskellige puljer.
- Skeln mellem et aktuelt opslag og et generisk uddelingsområde.
- Saml dubletter, når kun URL-fragmenter eller matchtypen er forskellig.

## Kontroller

- Præcis 73 beslutninger og 73 unikke scan-id'er.
- Fuld dækning af alle poster med `scan_status=found` og `review_status=new`.
- Ingen beslutning for den tekniske crawlerfejl.
- Kun de tilladte statustyper `reviewed` og `ignored`.
- Ikke-tomme begrundelser og en dokumenteret reviewdato.
- Idempotent indlæsning: en gentagelse opretter ikke ekstra audit events.

## Anvendelse

Kontrollér beslutningsfilen uden at skrive til databasen:

```bash
npm run review:scan-findings:check
```

Indlæs i den lokale SQLite-database:

```bash
REVIEW_ACTOR=redaktoer npm run review:scan-findings
```

Indlæs i PostgreSQL:

```bash
DATABASE_URL=postgresql://... REVIEW_ACTOR=redaktoer npm run review:scan-findings
```

Scriptet stopper, hvis et scan-id mangler i databasen. Ved gentagen kørsel bevares auditloggen uden dubletter, så længe status og note er uændret.
