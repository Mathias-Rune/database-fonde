create table if not exists project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_member_id uuid references team_members(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_comment_mentions (
  comment_id uuid not null references project_comments(id) on delete cascade,
  member_id uuid not null references team_members(id) on delete cascade,
  primary key (comment_id, member_id)
);

create index if not exists project_comments_project_idx on project_comments(project_id, created_at desc);
create index if not exists project_comment_mentions_member_idx on project_comment_mentions(member_id);
