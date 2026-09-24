create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  member_key text not null unique,
  display_name text not null,
  email text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  project_key text not null unique,
  name text not null,
  description text,
  status text not null default 'idea'
    check (status in ('idea', 'planning', 'active', 'completed', 'cancelled')),
  owner_member_id uuid references team_members(id) on delete set null,
  starts_on date,
  ends_on date,
  estimated_budget numeric check (estimated_budget is null or estimated_budget >= 0),
  currency text not null default 'DKK',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  role text not null default 'contributor',
  created_at timestamptz not null default now(),
  primary key (project_id, team_member_id)
);

alter table deadlines
  add constraint deadlines_id_program_unique unique (id, program_id);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  application_key text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  program_id uuid not null references programs(id) on delete restrict,
  deadline_id uuid,
  status text not null default 'candidate'
    check (status in ('candidate', 'planned', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn')),
  requested_amount numeric check (requested_amount is null or requested_amount >= 0),
  awarded_amount numeric check (awarded_amount is null or awarded_amount >= 0),
  currency text not null default 'DKK',
  submitted_on date,
  decision_expected_on date,
  external_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (deadline_id, program_id) references deadlines(id, program_id) on delete restrict
);

create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  project_id uuid not null references projects(id) on delete cascade,
  application_id uuid,
  parent_task_id uuid,
  title text not null,
  description text,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'blocked', 'done')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  assigned_to uuid references team_members(id) on delete set null,
  due_on date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (application_id, project_id) references applications(id, project_id) on delete cascade,
  foreign key (parent_task_id, project_id) references project_tasks(id, project_id) on delete cascade,
  check (parent_task_id is null or parent_task_id <> id),
  check ((status = 'done' and completed_at is not null) or status <> 'done')
);

create table if not exists application_status_history (
  id bigint generated always as identity primary key,
  application_id uuid not null references applications(id) on delete cascade,
  previous_status text,
  new_status text not null
    check (new_status in ('candidate', 'planned', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn')),
  changed_by uuid references team_members(id) on delete set null,
  note text,
  changed_at timestamptz not null default now()
);

create index if not exists projects_status_idx on projects(status, updated_at desc);
create index if not exists project_members_member_idx on project_members(team_member_id);
create index if not exists applications_project_idx on applications(project_id, status);
create index if not exists applications_program_idx on applications(program_id);
create index if not exists applications_deadline_idx on applications(deadline_id);
create index if not exists project_tasks_project_status_idx on project_tasks(project_id, status, due_on);
create index if not exists project_tasks_assignee_idx on project_tasks(assigned_to, status);
create index if not exists application_status_history_application_idx
  on application_status_history(application_id, changed_at desc);

create or replace view project_overview as
select p.id, p.project_key, p.name, p.description, p.status, p.owner_member_id, p.starts_on, p.ends_on,
       p.estimated_budget, p.currency, p.updated_at,
       owner.display_name as owner_name,
       (select count(*) from applications a where a.project_id = p.id) as application_count,
       (select count(*) from applications a where a.project_id = p.id and a.status = 'awarded') as awarded_application_count,
       (select coalesce(sum(a.awarded_amount), 0) from applications a
          where a.project_id = p.id and a.status = 'awarded') as awarded_amount,
       (select count(*) from project_tasks t where t.project_id = p.id and t.status <> 'done') as open_task_count,
       (select min(t.due_on) from project_tasks t where t.project_id = p.id and t.status <> 'done') as next_task_due_on
from projects p
left join team_members owner on owner.id = p.owner_member_id;

create or replace view application_pipeline as
select a.id, a.application_key, a.project_id, p.name as project_name, a.status,
       a.requested_amount, a.awarded_amount, a.currency, a.submitted_on,
       a.decision_expected_on, a.updated_at, pr.id as program_id,
       pr.program_name, f.id as foundation_id, f.name as foundation_name,
       d.id as deadline_id, d.closes_on
from applications a
join projects p on p.id = a.project_id
join programs pr on pr.id = a.program_id
join foundations f on f.id = pr.foundation_id
left join deadlines d on d.id = a.deadline_id;
