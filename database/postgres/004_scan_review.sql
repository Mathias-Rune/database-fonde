alter table call_scan_results
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists review_note text;

create table if not exists call_scan_review_events (
  event_id bigint generated always as identity primary key,
  scan_result_id text not null references call_scan_results(scan_result_id) on delete cascade,
  previous_status text not null check (previous_status in ('new', 'reviewed', 'ignored')),
  review_status text not null check (review_status in ('new', 'reviewed', 'ignored')),
  reviewed_at timestamptz not null default now(),
  reviewed_by text not null,
  review_note text
);

create index if not exists call_scan_review_events_scan_idx
  on call_scan_review_events(scan_result_id, reviewed_at desc);
