create table if not exists program_eligibility (
  program_id uuid primary key references programs(id) on delete cascade,
  eligibility_summary text not null,
  cvr_requirement text not null default 'unknown'
    check (cvr_requirement in ('required', 'not_required', 'conditional', 'unknown')),
  cvr_notes text,
  geography_scope text not null default 'unknown'
    check (geography_scope in ('national', 'regional', 'municipal', 'local', 'international', 'mixed', 'unknown')),
  country_code text,
  region text,
  municipality text,
  local_area text,
  amount_model text not null default 'unknown'
    check (amount_model in ('fixed', 'range', 'maximum', 'minimum', 'indicative_range', 'project_budget_cap', 'variable', 'unknown')),
  amount_min numeric check (amount_min is null or amount_min >= 0),
  amount_max numeric check (amount_max is null or amount_max >= 0),
  amount_currency text not null default 'DKK',
  amount_notes text,
  source_url text not null,
  last_checked date,
  verification_status text not null default 'to_verify'
    check (verification_status in ('source_checked', 'to_verify', 'needs_update')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_min is null or amount_max is null or amount_min <= amount_max)
);

create table if not exists program_applicants (
  program_id uuid not null references programs(id) on delete cascade,
  applicant_category text not null
    check (applicant_category in ('association', 'organization', 'institution', 'ngo', 'researcher', 'artist', 'individual', 'project_group', 'workplace', 'other')),
  label text not null,
  eligibility_status text not null default 'eligible'
    check (eligibility_status in ('eligible', 'conditional', 'ineligible', 'unknown')),
  conditions text,
  primary key (program_id, applicant_category, label)
);

create table if not exists program_exclusions (
  exclusion_id text primary key,
  program_id uuid not null references programs(id) on delete cascade,
  exclusion_type text not null
    check (exclusion_type in ('applicant', 'activity', 'cost', 'geography', 'application_route', 'other')),
  description text not null,
  source_url text not null,
  last_checked date,
  verification_status text not null default 'to_verify'
    check (verification_status in ('source_checked', 'to_verify', 'needs_update')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists program_eligibility_cvr_idx on program_eligibility(cvr_requirement);
create index if not exists program_eligibility_geography_idx on program_eligibility(geography_scope, municipality);
create index if not exists program_eligibility_amount_idx on program_eligibility(amount_min, amount_max);
create index if not exists program_applicants_category_idx on program_applicants(applicant_category, eligibility_status);
create index if not exists program_exclusions_program_idx on program_exclusions(program_id, exclusion_type);

create or replace view structured_program_search as
select p.program_key as program_id,
       p.program_name,
       f.foundation_key as foundation_id,
       f.name as foundation_name,
       e.eligibility_summary,
       e.cvr_requirement,
       e.geography_scope,
       e.country_code,
       e.region,
       e.municipality,
       e.local_area,
       e.amount_model,
       e.amount_min,
       e.amount_max,
       e.amount_currency,
       e.amount_notes,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'category', a.applicant_category,
           'label', a.label,
           'status', a.eligibility_status,
           'conditions', a.conditions
         ) order by a.label)
         from program_applicants a where a.program_id = p.id
       ), '[]'::jsonb) as applicants,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'type', x.exclusion_type,
           'description', x.description
         ) order by x.exclusion_id)
         from program_exclusions x where x.program_id = p.id
       ), '[]'::jsonb) as exclusions,
       e.source_url,
       e.last_checked,
       e.verification_status
from programs p
join foundations f on f.id = p.foundation_id
join program_eligibility e on e.program_id = p.id;
