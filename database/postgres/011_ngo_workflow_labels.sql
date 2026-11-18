update workflow_statuses set label = case status_key
 when 'project-idea' then 'Idea'
 when 'project-planning' then 'Ansøgningsfase'
 when 'project-active' then 'Development'
 when 'task-todo' then 'Started'
 when 'task-in-progress' then 'In progress'
 when 'task-blocked' then 'Stuck'
 when 'task-done' then 'Done' else label end
where is_system = true;
insert into workflow_statuses (status_key, entity_type, label, color, base_status, sort_order, is_system)
values ('project-submitted','project','Applikation sendt til fond','purple','planning',35,true)
on conflict (status_key) do nothing;
