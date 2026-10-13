PRAGMA foreign_keys = ON;


CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  system_role TEXT NOT NULL DEFAULT 'member' CHECK (system_role IN ('admin', 'member', 'viewer')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

CREATE TABLE IF NOT EXISTS team_members (
  member_id TEXT PRIMARY KEY,
  member_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea', 'planning', 'active', 'completed', 'cancelled')),
  owner_member_id TEXT,
  starts_on TEXT,
  ends_on TEXT,
  estimated_budget REAL CHECK (estimated_budget IS NULL OR estimated_budget >= 0),
  currency TEXT NOT NULL DEFAULT 'DKK',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_member_id) REFERENCES team_members(member_id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'contributor',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, member_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES team_members(member_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_folders (
  folder_id TEXT PRIMARY KEY,
  folder_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  parent_folder_id TEXT,
  color TEXT NOT NULL DEFAULT 'gray',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_folder_id) REFERENCES project_folders(folder_id) ON DELETE SET NULL,
  CHECK (parent_folder_id IS NULL OR parent_folder_id <> folder_id)
);

CREATE TABLE IF NOT EXISTS project_folder_assignments (
  project_id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES project_folders(folder_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_statuses (
  status_id TEXT PRIMARY KEY,
  status_key TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'application', 'task')),
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'gray' CHECK (color IN ('gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink')),
  base_status TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_status_assignments (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  status_id TEXT NOT NULL REFERENCES workflow_statuses(status_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS application_status_assignments (
  application_id TEXT PRIMARY KEY REFERENCES applications(application_id) ON DELETE CASCADE,
  status_id TEXT NOT NULL REFERENCES workflow_statuses(status_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS task_status_assignments (
  task_id TEXT PRIMARY KEY REFERENCES project_tasks(task_id) ON DELETE CASCADE,
  status_id TEXT NOT NULL REFERENCES workflow_statuses(status_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deadlines_id_program_unique
  ON deadlines(deadline_id, program_id);

CREATE TABLE IF NOT EXISTS applications (
  application_id TEXT PRIMARY KEY,
  application_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  deadline_id TEXT,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'planned', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn')),
  requested_amount REAL CHECK (requested_amount IS NULL OR requested_amount >= 0),
  awarded_amount REAL CHECK (awarded_amount IS NULL OR awarded_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'DKK',
  submitted_on TEXT,
  decision_expected_on TEXT,
  external_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES programs(program_id) ON DELETE RESTRICT,
  FOREIGN KEY (deadline_id, program_id) REFERENCES deadlines(deadline_id, program_id) ON DELETE RESTRICT,
  UNIQUE (application_id, project_id)
);

CREATE TABLE IF NOT EXISTS project_tasks (
  task_id TEXT PRIMARY KEY,
  task_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  application_id TEXT,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to TEXT,
  due_on TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (application_id, project_id) REFERENCES applications(application_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_task_id, project_id) REFERENCES project_tasks(task_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES team_members(member_id) ON DELETE SET NULL,
  UNIQUE (task_id, project_id),
  CHECK (parent_task_id IS NULL OR parent_task_id <> task_id),
  CHECK ((status = 'done' AND completed_at IS NOT NULL) OR status <> 'done')
);

CREATE TABLE IF NOT EXISTS project_documents (
  document_id TEXT PRIMARY KEY,
  document_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  application_id TEXT,
  task_id TEXT,
  title TEXT NOT NULL,
  document_url TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'google_doc'
    CHECK (document_type IN ('google_doc', 'google_sheet', 'google_slide', 'other')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (application_id, project_id) REFERENCES applications(application_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (task_id, project_id) REFERENCES project_tasks(task_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES team_members(member_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS application_status_history (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL
    CHECK (new_status IN ('candidate', 'planned', 'drafting', 'submitted', 'awarded', 'rejected', 'withdrawn')),
  changed_by TEXT,
  note TEXT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES applications(application_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES team_members(member_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_members_member ON project_members(member_id);
CREATE INDEX IF NOT EXISTS idx_applications_project ON applications(project_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_program ON applications(program_id);
CREATE INDEX IF NOT EXISTS idx_applications_deadline ON applications(deadline_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_status ON project_tasks(project_id, status, due_on);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id, created_at);

CREATE TABLE IF NOT EXISTS project_comments (
  comment_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  author_member_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (author_member_id) REFERENCES team_members(member_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_comment_mentions (
  comment_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (comment_id, member_id),
  FOREIGN KEY (comment_id) REFERENCES project_comments(comment_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES team_members(member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_comments_project ON project_comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_comment_mentions_member ON project_comment_mentions(member_id);
CREATE INDEX IF NOT EXISTS idx_application_history_application ON application_status_history(application_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_project_folders_parent ON project_folders(parent_folder_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_workflow_statuses_entity ON workflow_statuses(entity_type, sort_order);

INSERT OR IGNORE INTO workflow_statuses (status_id, status_key, entity_type, label, color, base_status, sort_order, is_system) VALUES
  ('project-status-idea', 'project-idea', 'project', 'Idé', 'gray', 'idea', 10, 1),
  ('project-status-planning', 'project-planning', 'project', 'Planlægning', 'blue', 'planning', 20, 1),
  ('project-status-active', 'project-active', 'project', 'Aktivt', 'green', 'active', 30, 1),
  ('project-status-completed', 'project-completed', 'project', 'Afsluttet', 'purple', 'completed', 40, 1),
  ('project-status-cancelled', 'project-cancelled', 'project', 'Annulleret', 'red', 'cancelled', 50, 1),
  ('application-status-candidate', 'application-candidate', 'application', 'Kandidat', 'gray', 'candidate', 10, 1),
  ('application-status-planned', 'application-planned', 'application', 'Planlagt', 'blue', 'planned', 20, 1),
  ('application-status-drafting', 'application-drafting', 'application', 'Under udarbejdelse', 'yellow', 'drafting', 30, 1),
  ('application-status-submitted', 'application-submitted', 'application', 'Indsendt', 'purple', 'submitted', 40, 1),
  ('application-status-awarded', 'application-awarded', 'application', 'Bevilget', 'green', 'awarded', 50, 1),
  ('application-status-rejected', 'application-rejected', 'application', 'Afvist', 'red', 'rejected', 60, 1),
  ('application-status-withdrawn', 'application-withdrawn', 'application', 'Trukket tilbage', 'orange', 'withdrawn', 70, 1),
  ('task-status-todo', 'task-todo', 'task', 'Ikke startet', 'gray', 'todo', 10, 1),
  ('task-status-in-progress', 'task-in-progress', 'task', 'I gang', 'blue', 'in_progress', 20, 1),
  ('task-status-blocked', 'task-blocked', 'task', 'Blokeret', 'red', 'blocked', 30, 1),
  ('task-status-done', 'task-done', 'task', 'Færdig', 'green', 'done', 40, 1);

DROP VIEW IF EXISTS project_overview;
CREATE VIEW project_overview AS
SELECT p.project_id, p.project_key, p.name, p.description, p.status, p.owner_member_id, p.starts_on, p.ends_on,
       p.estimated_budget, p.currency, p.updated_at, owner.display_name AS owner_name,
       pf.folder_id, pf.name AS folder_name, ws.status_id AS workflow_status_id,
       COALESCE(ws.label, p.status) AS workflow_status_label, COALESCE(ws.color, 'gray') AS workflow_status_color,
       (SELECT COUNT(*) FROM applications a WHERE a.project_id = p.project_id) AS application_count,
       (SELECT COUNT(*) FROM applications a WHERE a.project_id = p.project_id AND a.status = 'awarded') AS awarded_application_count,
       (SELECT COALESCE(SUM(a.awarded_amount), 0) FROM applications a
          WHERE a.project_id = p.project_id AND a.status = 'awarded') AS awarded_amount,
       (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.project_id AND t.status <> 'done') AS open_task_count,
       (SELECT MIN(t.due_on) FROM project_tasks t WHERE t.project_id = p.project_id AND t.status <> 'done') AS next_task_due_on
FROM projects p
LEFT JOIN team_members owner ON owner.member_id = p.owner_member_id
LEFT JOIN project_folder_assignments pfa ON pfa.project_id = p.project_id
LEFT JOIN project_folders pf ON pf.folder_id = pfa.folder_id
LEFT JOIN project_status_assignments psa ON psa.project_id = p.project_id
LEFT JOIN workflow_statuses ws ON ws.status_id = psa.status_id;

DROP VIEW IF EXISTS application_pipeline;
CREATE VIEW application_pipeline AS
SELECT a.application_id, a.application_key, a.project_id, p.name AS project_name, a.status,
       a.requested_amount, a.awarded_amount, a.currency, a.submitted_on,
       a.decision_expected_on, a.updated_at, pr.program_id, pr.program_name,
       f.foundation_id, f.name AS foundation_name, d.deadline_id, d.closes_on,
       ws.status_id AS workflow_status_id, COALESCE(ws.label, a.status) AS workflow_status_label,
       COALESCE(ws.color, 'gray') AS workflow_status_color
FROM applications a
JOIN projects p ON p.project_id = a.project_id
JOIN programs pr ON pr.program_id = a.program_id
JOIN foundations f ON f.foundation_id = pr.foundation_id
LEFT JOIN deadlines d ON d.deadline_id = a.deadline_id
LEFT JOIN application_status_assignments asa ON asa.application_id = a.application_id
LEFT JOIN workflow_statuses ws ON ws.status_id = asa.status_id;
