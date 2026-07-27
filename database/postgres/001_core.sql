create extension if not exists pgcrypto;

create table if not exists foundations (
  id uuid primary key default gen_random_uuid(),
  foundation_key text not null unique,
  name text not null,
  legal_type text,
  regulator text,
  country text not null default 'Danmark',
  city text,
  website text not null unique,
  application_url text,
  support_areas text,
  applicant_types text,
  deadline_model text,
  source_url text,
  last_checked date,
  verification_status text not null default 'to_verify'
    check (verification_status in ('source_checked', 'to_verify', 'needs_update')),
  language text,
  normalized_focus_areas text[] not null default '{}',
  raw_focus_area_labels text[] not null default '{}',
  target_groups text[] not null default '{}',
  geography text[] not null default '{}',
  support_types text[] not null default '{}',
  application_process_summary text,
  typical_grant_min numeric,
  typical_grant_max numeric,
  typical_grant_median numeric,
  typical_grant_mean numeric,
  typical_grant_currency text,
  typical_grant_sample_size integer not null default 0,
  typical_grant_observed_year_min integer,
  typical_grant_observed_year_max integer,
  open_call_status text not null default 'unclear',
  open_call_summary text,
  latest_deadline timestamptz,
  last_crawled_at timestamptz,
  profile_confidence numeric not null default 0 check (profile_confidence between 0 and 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  program_key text not null unique,
  foundation_id uuid not null references foundations(id) on delete cascade,
  program_name text not null,
  program_type text,
  support_areas text,
  applicant_types text,
  geography text,
  funding_use text,
  amount_range text,
  application_status text,
  deadline_summary text,
  application_url text,
  source_url text,
  last_checked date,
  verification_status text not null default 'to_verify'
    check (verification_status in ('source_checked', 'to_verify', 'needs_update')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deadlines (
  id uuid primary key default gen_random_uuid(),
  deadline_key text not null unique,
  program_id uuid not null references programs(id) on delete cascade,
  deadline_type text,
  status text not null default 'to_verify'
    check (status in ('open', 'closed', 'upcoming', 'to_verify')),
  opens_on date,
  closes_on date,
  recurrence text,
  summary text,
  last_checked date,
  verification_status text not null default 'to_verify'
    check (verification_status in ('source_checked', 'to_verify', 'needs_update')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists foundations_name_idx on foundations(name);
create index if not exists foundations_verification_idx on foundations(verification_status);
create index if not exists programs_foundation_idx on programs(foundation_id);
create index if not exists programs_verification_idx on programs(verification_status);
create index if not exists deadlines_program_idx on deadlines(program_id);
create index if not exists deadlines_status_closes_idx on deadlines(status, closes_on);

create or replace view foundation_search as
select foundation_key as foundation_id, name, city, legal_type, support_areas,
       applicant_types, deadline_model, application_url, verification_status
from foundations;

create or replace view program_search as
select p.program_key as program_id, p.program_name, p.program_type, p.application_status,
       p.deadline_summary, p.support_areas, p.applicant_types, p.geography,
       p.application_url, p.verification_status,
       f.foundation_key as foundation_id, f.name as foundation_name, f.city,
       d.deadline_type, d.status as deadline_status, d.closes_on,
       d.summary as deadline_detail
from programs p
join foundations f on f.id = p.foundation_id
left join deadlines d on d.program_id = p.id;
