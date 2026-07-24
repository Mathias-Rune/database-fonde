# Step 1 MVP Guide

This is the smallest useful version of the Foundation Intelligence Engine.

It can:

- Take 1-2 foundation website URLs
- Crawl a small number of pages on each site
- Rank pages that look relevant
- Read HTML pages and PDFs when found
- Extract evidence-backed claims
- Detect possible open calls
- Extract possible funded project/grant examples
- Estimate typical grant size only when there are enough observed grant amounts
- Write machine-readable JSON, human-readable Markdown, and CSV output

It does not yet try to be perfect. It is built to be inspectable: every important result should point back to a URL and evidence snippet.

## Simple Project Structure

```text
Foundation Intelligence Engine
├── src/
│   ├── cli/            The command you run from Terminal
│   ├── config/         Settings from .env
│   ├── crawl/          Website crawling, PDF reading, page relevance scoring
│   ├── extract/        Finds claims, grant amounts, projects, open calls
│   ├── interpret/      Turns raw findings into one foundation profile
│   ├── output/         Writes JSON, Markdown, and CSV files
│   ├── db/             Saves to JSON files now, Postgres later
│   ├── taxonomy/       Normalized focus areas like youth, democracy, climate
│   ├── types/          Shared data shapes
│   └── utils/          Small helper functions
├── sql/schema.sql      Database table design
├── docs/STEP_1_MVP.md  This plain-English guide
├── README.md           Longer technical setup notes
└── data/outputs/       Where results are written
```

## Database Schema In Plain English

The database is designed like a research notebook with evidence.

### `foundations`

One row per foundation.

Stores the final profile:

- name
- website
- focus areas
- target groups
- typical grant size estimate
- open call status
- latest deadline
- confidence score
- notes

### `foundation_sources`

One row per crawled page or PDF.

Stores:

- source URL
- whether it was HTML or PDF
- page title
- when it was crawled
- relevance score
- short raw text excerpt

Why this matters: we can always see where information came from.

### `foundation_claims`

One row per extracted fact or possible fact.

Stores:

- claim type, for example `profile`, `grant`, `application`
- claim value
- evidence snippet
- source URL
- whether it was explicit or inferred
- confidence score
- status like `found`, `unclear`, or `conflicting`

Why this matters: the system does not just say “this foundation supports youth”. It keeps the evidence.

### `funded_projects`

One row per previously funded project candidate.

Stores:

- project name
- recipient organization
- year
- amount
- currency
- description
- themes
- source URL
- confidence

Why this matters: historical grants are what we use to estimate typical grant sizes and project fit.

### `open_calls`

One row per call/application opportunity found.

Stores:

- call status: `open`, `closed`, `historical`, `unclear`
- deadline
- rolling or fixed deadline
- thematic area
- eligibility
- source URL
- confidence

Why this matters: the assistant can later answer “which foundations have open calls now?”

### `document_chunks`

Prepared for future AI search.

Stores pieces of source documents that can later be embedded for semantic search.

## Which Files Do What

### Main run command

`src/cli/index.ts`

This is the entry point. It reads your command, loads settings, starts the pipeline, and writes results.

### Pipeline coordinator

`src/pipeline.ts`

This connects the steps:

1. Crawl pages
2. Extract claims
3. Extract funded projects
4. Detect open calls
5. Build profile
6. Save outputs

### Crawler

`src/crawl/crawler.ts`

Visits pages on the foundation website. It stays on the same domain, avoids obvious irrelevant files, respects robots.txt, slows itself down between requests, and finds PDF links.

### Relevance scoring

`src/crawl/relevance.ts`

Scores pages based on words like “støtte”, “ansøgning”, “grants”, “deadline”, “funded projects”, and similar terms.

### PDF reading

`src/crawl/pdf.ts`

Downloads and reads PDF text, then treats the PDF as a normal source.

### Claim extraction

`src/extract/claims.ts`

Looks for useful facts such as focus areas, target groups, application process text, dates, and grant amounts.

### Open call detection

`src/extract/openCalls.ts`

Looks for application deadlines and call language. It uses date logic so old announcements are not automatically treated as active calls.

### Funded project extraction

`src/extract/projects.ts`

Looks for evidence of previously funded projects and nearby amounts, years, recipients, and themes.

### Grant size estimation

`src/interpret/grantEstimation.ts`

Calculates min, max, median, mean, sample size, and currency. It only makes an estimate when there are at least 3 observed grant amounts.

### Profile builder

`src/interpret/profileBuilder.ts`

Combines all extracted evidence into one foundation profile with confidence and caveats.

### Outputs

`src/output/profileOutput.ts`

Writes:

- JSON for machines and future AI
- Markdown summary for humans
- claims JSON for inspection

## How To Run Locally

From Terminal:

```bash
cd /Users/thekid/Desktop/Foundations
npm install
npm run mvp
```

The results will appear here:

```text
/Users/thekid/Desktop/Foundations/data/outputs/mvp
```

You can open the `.md` files for easy reading.

You can open the `.json` files if you want to inspect the structured data.

## Run A Single Foundation

```bash
npm run crawl -- --seeds https://www.tuborgfondet.dk --max-pages 4 --out data/outputs/tuborg-test
```

Change the URL to test another foundation.

## What Is Already Working

- Small end-to-end crawl for 1-2 foundation websites
- Page relevance scoring
- HTML page extraction
- PDF text extraction when PDF links are found
- Evidence-backed claims
- Source URLs and snippets
- Confidence scores
- Basic focus area normalization
- Basic funded project extraction
- Basic grant amount extraction
- Grant size statistics when enough amounts are found
- Basic open call detection
- JSON, Markdown, and CSV output
- Postgres/Supabase-ready schema

## What Is Partially Working

- Funded project extraction works, but can be noisy when a website uses unusual layouts.
- Open call detection works for clear date/deadline language, but needs stronger handling of written month names like “15. maj 2026”.
- Foundation name detection works for normal domains, but some websites use slogan-like page titles.
- Conflict handling exists, but is basic.
- Postgres saving exists, but the default MVP run writes local files because that is simpler to start with.

## What Is Not Implemented Yet

- No frontend/admin screen yet
- No AI chat assistant yet
- No embeddings generation yet
- No OCR for scanned PDFs
- No deep table extraction from annual reports yet
- No scheduled recrawling yet
- No manual review workflow yet
- No LLM-assisted interpretation yet

## Current Principle

If the system is not sure, it should say so.

The goal is not to make the data look complete. The goal is to make it trustworthy.
