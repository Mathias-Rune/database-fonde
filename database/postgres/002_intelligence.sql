create table if not exists foundation_sources (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references foundations(id) on delete cascade,
  source_url text not null,
  source_type text not null check (source_type in ('html', 'pdf', 'other')),
  page_title text,
  crawled_at timestamptz not null,
  content_hash text not null,
  relevance_score numeric not null default 0,
  raw_text_excerpt text,
  created_at timestamptz not null default now(),
  unique(foundation_id, source_url, content_hash)
);

create table if not exists foundation_claims (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references foundations(id) on delete cascade,
  claim_type text not null,
  claim_key text not null,
  claim_value text not null,
  evidence_snippet text not null,
  source_url text not null,
  source_id uuid references foundation_sources(id) on delete set null,
  extraction_method text not null,
  is_explicit boolean not null default true,
  confidence numeric not null check (confidence between 0 and 1),
  status text not null check (status in ('found', 'not_found', 'unclear', 'conflicting', 'inferred_low_confidence')),
  created_at timestamptz not null default now()
);

create table if not exists funded_projects (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references foundations(id) on delete cascade,
  project_name text,
  recipient_organization text,
  year integer,
  amount numeric,
  currency text,
  description text,
  raw_theme_labels text[] not null default '{}',
  normalized_themes text[] not null default '{}',
  target_groups text[] not null default '{}',
  geography text[] not null default '{}',
  source_url text not null,
  source_id uuid references foundation_sources(id) on delete set null,
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table if not exists open_calls (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references foundations(id) on delete cascade,
  title text,
  status text not null check (status in ('open', 'upcoming', 'closed', 'historical', 'unclear')),
  thematic_area text,
  eligibility text,
  opens_at timestamptz,
  closes_at timestamptz,
  rolling_deadline boolean not null default false,
  summary text,
  source_url text not null,
  source_id uuid references foundation_sources(id) on delete set null,
  confidence numeric not null check (confidence between 0 and 1),
  last_verified_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  foundation_id uuid not null references foundations(id) on delete cascade,
  source_id uuid references foundation_sources(id) on delete cascade,
  source_url text not null,
  chunk_index integer not null,
  content text not null,
  content_hash text not null,
  token_estimate integer,
  embedding jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(source_id, chunk_index)
);

create index if not exists foundation_sources_lookup_idx on foundation_sources(foundation_id, crawled_at desc);
create index if not exists foundation_claims_lookup_idx on foundation_claims(foundation_id, claim_type, claim_key);
create index if not exists funded_projects_foundation_year_idx on funded_projects(foundation_id, year);
create index if not exists open_calls_status_closes_idx on open_calls(status, closes_at);
create index if not exists document_chunks_foundation_idx on document_chunks(foundation_id);
