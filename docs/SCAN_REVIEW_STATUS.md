# Central scan-reviewstatus

Scannerfund gemmes nu via `/api/call-reviews` i stedet for browserens `localStorage`.

## Lagring

- Med `DATABASE_URL` opdaterer serveren den kanoniske Postgres-tabel `call_scan_results`.
- Uden `DATABASE_URL` gemmes overrides i `outputs/fonds_database.sqlite` i en separat tabel, som ikke slettes af seed-importen.
- Hver statusændring tilføjes til `call_scan_review_events` med tidligere status, ny status, tidspunkt, aktør og valgfri note.

`REVIEW_ACTOR` kan sættes til et redaktørnavn. Indtil login og roller implementeres på deres egen branch, er standarden `local_admin`.

`REVIEW_SQLITE_PATH` kan pege fallback-lagringen på en anden SQLite-fil, eksempelvis i integrationstests.

## Browsermigration

Ved første localhost-start sender frontenden eksisterende `fondsdb.scanReviewOverrides` til API'et. `localStorage`-nøglen slettes først, når alle værdier er gemt. Herefter hentes reviewstatus altid fra databasen.

## API

```text
GET  /api/call-reviews
POST /api/call-reviews
```

POST-body:

```json
{
  "scan_result_id": "eksempel-id",
  "review_status": "reviewed",
  "note": "Valgfri note"
}
```

Tilladte statusværdier er `new`, `reviewed` og `ignored`.
