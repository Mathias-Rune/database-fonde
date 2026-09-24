create table if not exists project_documents (
  id uuid primary key default gen_random_uuid(),
  document_key text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  application_id uuid,
  task_id uuid,
  title text not null,
  document_url text not null,
  document_type text not null default 'google_doc'
    check (document_type in ('google_doc', 'google_sheet', 'google_slide', 'other')),
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (application_id, project_id) references applications(id, project_id) on delete cascade,
  foreign key (task_id, project_id) references project_tasks(id, project_id) on delete cascade
);

create index if not exists project_documents_project_idx
  on project_documents(project_id, created_at desc);
