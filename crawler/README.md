# Foundation Intelligence Engine

Production-minded MVP for evidence-backed foundation discovery, scraping, extraction, and AI-ready funder profiles.

The system accepts one or more foundation seed URLs, crawls the domain politely, ranks relevant pages and PDFs, extracts source-grounded claims, identifies funded-project evidence, detects open calls with date logic, estimates grant sizes from observed grants, and writes structured outputs.

## Why This Design

This is built around traceability rather than automation theater. Extractors emit claims with `evidenceSnippet`, `sourceUrl`, `extractionMethod`, `isExplicit`, `confidence`, and `status`. The interpretation layer then builds a profile from those claims, while preserving uncertainty and source records for later assistant answers like “why is this foundation a fit?”

The MVP uses rule-based extraction for dates, money, deadlines, and grant observations. The `llm_assisted_placeholder` method is reserved in the type model, but no field depends on an LLM by default. A future LLM pass should classify or summarize already-grounded evidence, not invent missing facts.

## Project Structure

```text
src/
  cli/                 CLI entrypoint
  config/              Environment config
  crawl/               Polite same-domain crawler, PDF ingestion, relevance scoring
  db/                  Postgres and JSON-file repositories
  extract/             Claims, open call, grant/project extraction
  interpret/           Profile builder, conflict handling, grant estimation
  output/              AI-ready JSON, Markdown summary, CSV export
  taxonomy/            Extendable normalized focus area taxonomy
  types/               Shared TypeScript domain types
  utils/               Text, URL, hash, logging helpers
sql/schema.sql         Relational schema for Postgres/Supabase
examples/seeds.txt     Example foundation seed URLs
```

## Setup

```bash
cp .env.example .env
npm install
npm run typecheck
```

Optional Postgres setup:

```bash
createdb foundation_intelligence
psql "$DATABASE_URL" -f sql/schema.sql
```

Local JSON-backed run:

```bash
npm run crawl -- --seeds https://www.tuborgfondet.dk --max-pages 20 --out data/outputs/tuborg
```

Postgres-backed run:

```bash
npm run crawl -- --seeds https://www.tuborgfondet.dk,https://www.tryghed.dk --max-pages 25 --persist postgres
```

Outputs per foundation:

- `<slug>.json`: machine-readable profile for future AI workflows
- `<slug>.md`: concise human-readable research summary
- `<slug>.claims.json`: raw evidence-backed claims
- `foundations.csv`: lightweight comparison export

## Architecture Notes

### Discovery Layer

`FoundationCrawler` accepts seed URLs, normalizes links, stays on-domain, observes robots.txt by default, rate-limits requests, retries transient failures, deduplicates content hashes, discovers PDFs, and prioritizes URLs with relevant words in Danish and English.

The relevance scorer combines:

- URL patterns
- title and heading keywords
- body keyword occurrences
- PDF file type
- date and grant amount signals

### Extraction Layer

Extractors are intentionally conservative:

- `claims.ts` extracts identity, focus, target group, application-process, amount, and date claims.
- `projects.ts` extracts funded-project candidates from award/support language plus nearby money/year/name/recipient signals.
- `openCalls.ts` detects call-like snippets and classifies them using current date logic.
- `pdf.ts` parses PDF text and treats PDF sources like first-class crawled sources.

Every claim keeps source URL, evidence snippet, extraction method, explicit/inferred flag, confidence, and status.

### Open Call Logic

Calls are classified as:

- `open`: future deadline or rolling deadline
- `upcoming`: reserved for future extension when open dates are found
- `closed`: recently expired deadline or explicit closed language
- `historical`: old deadline or archive-like evidence
- `unclear`: call-like evidence without enough date/status support

The system avoids treating old announcements as active calls. Missing call evidence becomes `not_found`, not `closed`.

### Grant Size Estimation

`estimateGrantSize` only infers a grant range when at least three grant amount observations exist. It calculates min, max, median, mean, sample size, currency, and observed year span. With fewer than three observations, it leaves the estimate unknown and adds a caveat.

### Schema Design

The relational model separates:

- `foundations`: interpreted current profile
- `foundation_sources`: crawled source documents and relevance metadata
- `foundation_claims`: evidence-backed atomic claims
- `funded_projects`: historical grant/project observations
- `open_calls`: call records with status, deadlines, eligibility, and confidence
- `document_chunks`: embeddings-ready chunks for future semantic search

`document_chunks.embedding` is `jsonb` in the MVP so local Postgres works without requiring `pgvector`. In Supabase/Postgres with pgvector, migrate that column to `vector(1536)` or your embedding dimension.

### Future AI Integration

The JSON output is designed so an internal assistant can ground answers in:

- normalized focus categories
- raw source labels
- project-level history
- observed grant amount statistics
- open call records
- source excerpts and claim evidence
- uncertainties and confidence scores

Good future additions:

- LLM-assisted classification over extracted snippets
- embeddings generation for `document_chunks`
- per-foundation scraping rules
- scheduled recrawls
- admin review UI for conflicts and low-confidence claims
- stronger table extraction for annual reports

## Example Run

After installing dependencies:

```bash
npm run sample
```

The sample scans two Danish foundation websites with a small page budget. Because live websites change, results should be inspected in `data/outputs/sample` rather than assumed stable. The crawler logs which pages were crawled, their relevance scores, extracted claim counts, project candidates, open-call candidates, and profile confidence.

## Assumptions and TODOs

- The MVP favors recall for candidate funded projects, then confidence scores and evidence snippets make review possible.
- PDF extraction is text-based; scanned PDFs need OCR in a production version.
- Date extraction currently handles numeric dates and years. Danish/English month-name deadlines should be expanded.
- Conflict detection is deliberately simple and flags suspicious multi-value fields for review.
- Robots.txt is obeyed by default; confirm your user-agent and contact email before production crawling.
- LLM usage should be added as a grounded interpretation pass, not as the primary source of facts.
