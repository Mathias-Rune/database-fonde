create table project_folders (
  id uuid primary key default gen_random_uuid(), folder_key text not null unique, name text not null,
  parent_folder_id uuid references project_folders(id) on delete set null,
  color text not null default 'gray', sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (parent_folder_id is null or parent_folder_id <> id)
);

create table project_folder_assignments (
  project_id uuid primary key references projects(id) on delete cascade,
  folder_id uuid not null references project_folders(id) on delete cascade
);

create table workflow_statuses (
  id uuid primary key default gen_random_uuid(), status_key text not null unique,
  entity_type text not null check (entity_type in ('project', 'application', 'task')),
  label text not null, color text not null default 'gray', base_status text not null,
  sort_order integer not null default 0, is_system boolean not null default false,
  is_active boolean not null default true, created_at timestamptz not null default now()
);

create table project_status_assignments (
  project_id uuid primary key references projects(id) on delete cascade,
  status_id uuid not null references workflow_statuses(id) on delete restrict
);
create table application_status_assignments (
  application_id uuid primary key references applications(id) on delete cascade,
  status_id uuid not null references workflow_statuses(id) on delete restrict
);
create table task_status_assignments (
  task_id uuid primary key references project_tasks(id) on delete cascade,
  status_id uuid not null references workflow_statuses(id) on delete restrict
);

create index project_folders_parent_idx on project_folders(parent_folder_id, sort_order);
create index workflow_statuses_entity_idx on workflow_statuses(entity_type, sort_order);

insert into workflow_statuses (status_key, entity_type, label, color, base_status, sort_order, is_system) values
 ('project-idea','project','Idé','gray','idea',10,true), ('project-planning','project','Planlægning','blue','planning',20,true),
 ('project-active','project','Aktivt','green','active',30,true), ('project-completed','project','Afsluttet','purple','completed',40,true),
 ('project-cancelled','project','Annulleret','red','cancelled',50,true),
 ('application-candidate','application','Kandidat','gray','candidate',10,true), ('application-planned','application','Planlagt','blue','planned',20,true),
 ('application-drafting','application','Under udarbejdelse','yellow','drafting',30,true), ('application-submitted','application','Indsendt','purple','submitted',40,true),
 ('application-awarded','application','Bevilget','green','awarded',50,true), ('application-rejected','application','Afvist','red','rejected',60,true),
 ('application-withdrawn','application','Trukket tilbage','orange','withdrawn',70,true),
 ('task-todo','task','Ikke startet','gray','todo',10,true), ('task-in-progress','task','I gang','blue','in_progress',20,true),
 ('task-blocked','task','Blokeret','red','blocked',30,true), ('task-done','task','Færdig','green','done',40,true)
on conflict (status_key) do nothing;

create or replace view project_overview as
select p.id, p.project_key, p.name, p.description, p.status, p.owner_member_id, p.starts_on, p.ends_on,
 p.estimated_budget, p.currency, p.updated_at, owner.display_name as owner_name,
 pf.id as folder_id, pf.name as folder_name, ws.id as workflow_status_id,
 coalesce(ws.label, p.status) as workflow_status_label, coalesce(ws.color, 'gray') as workflow_status_color,
 (select count(*) from applications a where a.project_id=p.id) as application_count,
 (select count(*) from applications a where a.project_id=p.id and a.status='awarded') as awarded_application_count,
 (select coalesce(sum(a.awarded_amount),0) from applications a where a.project_id=p.id and a.status='awarded') as awarded_amount,
 (select count(*) from project_tasks t where t.project_id=p.id and t.status<>'done') as open_task_count,
 (select min(t.due_on) from project_tasks t where t.project_id=p.id and t.status<>'done') as next_task_due_on
from projects p left join team_members owner on owner.id=p.owner_member_id
left join project_folder_assignments pfa on pfa.project_id=p.id left join project_folders pf on pf.id=pfa.folder_id
left join project_status_assignments psa on psa.project_id=p.id left join workflow_statuses ws on ws.id=psa.status_id;

create or replace view application_pipeline as
select a.id, a.application_key, a.project_id, p.name as project_name, a.status, a.requested_amount,
 a.awarded_amount, a.currency, a.submitted_on, a.decision_expected_on, a.updated_at,
 pr.id as program_id, pr.program_name, f.id as foundation_id, f.name as foundation_name,
 d.id as deadline_id, d.closes_on, ws.id as workflow_status_id,
 coalesce(ws.label,a.status) as workflow_status_label, coalesce(ws.color,'gray') as workflow_status_color
from applications a join projects p on p.id=a.project_id join programs pr on pr.id=a.program_id
join foundations f on f.id=pr.foundation_id left join deadlines d on d.id=a.deadline_id
left join application_status_assignments asa on asa.application_id=a.id left join workflow_statuses ws on ws.id=asa.status_id;
