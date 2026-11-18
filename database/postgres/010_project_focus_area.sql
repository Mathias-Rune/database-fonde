-- Keep the canonical project model aligned with the SQLite project form.
alter table projects add column if not exists focus_area text;
alter table projects add column if not exists estimated_hours numeric check (estimated_hours is null or estimated_hours >= 0);
alter table projects add column if not exists deleted_at timestamptz;

drop view if exists project_overview;
create view project_overview as
select p.id, p.project_key, p.name, p.description, p.focus_area, p.status, p.owner_member_id, p.starts_on, p.ends_on,
 p.estimated_budget, p.estimated_hours, p.deleted_at, p.currency, p.updated_at, owner.display_name as owner_name,
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
