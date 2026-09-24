import { randomUUID } from "node:crypto";
import path from "node:path";
import { execSqliteFile, runSqlite, sqlString } from "./sqlite_utils.mjs";

const PROJECT_STATUSES = new Set(["idea", "planning", "active", "completed", "cancelled"]);
const APPLICATION_STATUSES = new Set(["candidate", "planned", "drafting", "submitted", "awarded", "rejected", "withdrawn"]);
const TASK_STATUSES = new Set(["todo", "in_progress", "blocked", "done"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const PROJECT_ROLES = new Set(["lead", "contributor", "reviewer"]);
const DOCUMENT_TYPES = new Set(["google_doc", "google_sheet", "google_slide", "other"]);
const STATUS_COLORS = new Set(["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink"]);
const ENTITY_BASE_STATUSES = {
  project: PROJECT_STATUSES,
  application: APPLICATION_STATUSES,
  task: TASK_STATUSES,
};

function cleanText(value, maxLength = 5000) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function cleanDate(value) {
  const cleaned = cleanText(value, 10);
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(Date.parse(`${cleaned}T00:00:00Z`))) return undefined;
  return cleaned;
}

function cleanAmount(value) {
  if (value === "" || value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function keyFrom(prefix, name) {
  const slug = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || prefix;
  return `${prefix}-${slug}-${randomUUID().slice(0, 8)}`;
}

function invalid(message) {
  return { ok: false, statusCode: 400, message };
}

export function validateProjectInput(body = {}) {
  const name = cleanText(body.name, 160);
  const status = cleanText(body.status, 24) || "idea";
  const startsOn = cleanDate(body.starts_on);
  const endsOn = cleanDate(body.ends_on);
  const estimatedBudget = cleanAmount(body.estimated_budget);
  if (!name) return invalid("Projektet skal have et navn");
  if (!PROJECT_STATUSES.has(status)) return invalid("Ugyldig projektstatus");
  if (startsOn === undefined || endsOn === undefined) return invalid("Datoer skal skrives som ÅÅÅÅ-MM-DD");
  if (startsOn && endsOn && endsOn < startsOn) return invalid("Slutdato må ikke ligge før startdato");
  if (estimatedBudget === undefined) return invalid("Budget skal være et positivt tal");
  return {
    ok: true,
    name,
    description: cleanText(body.description),
    status,
    owner_member_id: cleanText(body.owner_member_id, 80),
    starts_on: startsOn,
    ends_on: endsOn,
    estimated_budget: estimatedBudget,
    currency: cleanText(body.currency, 3)?.toUpperCase() || "DKK",
    folder_id: cleanText(body.folder_id, 80),
    workflow_status_id: cleanText(body.workflow_status_id, 80),
  };
}

export function validateApplicationInput(body = {}) {
  const projectId = cleanText(body.project_id, 80);
  const programId = cleanText(body.program_id, 120);
  const status = cleanText(body.status, 24) || "candidate";
  const requestedAmount = cleanAmount(body.requested_amount);
  if (!projectId || !programId) return invalid("Projekt og pulje skal vælges");
  if (!APPLICATION_STATUSES.has(status)) return invalid("Ugyldig ansøgningsstatus");
  if (requestedAmount === undefined) return invalid("Ansøgningsbeløbet skal være et positivt tal");
  return {
    ok: true,
    project_id: projectId,
    program_id: programId,
    deadline_id: cleanText(body.deadline_id, 120),
    status,
    requested_amount: requestedAmount,
    currency: cleanText(body.currency, 3)?.toUpperCase() || "DKK",
    notes: cleanText(body.notes),
    workflow_status_id: cleanText(body.workflow_status_id, 80),
  };
}

export function validateApplicationUpdate(body = {}) {
  const status = cleanText(body.status, 24);
  const requestedAmount = cleanAmount(body.requested_amount);
  const awardedAmount = cleanAmount(body.awarded_amount);
  const submittedOn = cleanDate(body.submitted_on);
  const decisionExpectedOn = cleanDate(body.decision_expected_on);
  if (!APPLICATION_STATUSES.has(status)) return invalid("Ugyldig ansøgningsstatus");
  if (requestedAmount === undefined || awardedAmount === undefined) return invalid("Beløb skal være positive tal");
  if (submittedOn === undefined || decisionExpectedOn === undefined) return invalid("Datoer skal skrives som ÅÅÅÅ-MM-DD");
  return {
    ok: true,
    status,
    deadline_id: cleanText(body.deadline_id, 120),
    requested_amount: requestedAmount,
    awarded_amount: awardedAmount,
    submitted_on: submittedOn,
    decision_expected_on: decisionExpectedOn,
    external_reference: cleanText(body.external_reference, 500),
    notes: cleanText(body.notes),
    changed_by: cleanText(body.changed_by, 80),
    change_note: cleanText(body.change_note, 1000),
    workflow_status_id: cleanText(body.workflow_status_id, 80),
  };
}

export function validateTeamMemberInput(body = {}) {
  const displayName = cleanText(body.display_name, 160);
  const email = cleanText(body.email, 254)?.toLowerCase() || null;
  if (!displayName) return invalid("Teammedlemmet skal have et navn");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid("Emailadressen er ugyldig");
  return { ok: true, display_name: displayName, email };
}

export function validateProjectMemberInput(body = {}) {
  const memberId = cleanText(body.member_id, 80);
  const role = cleanText(body.role, 80) || "contributor";
  if (!memberId) return invalid("Vælg et teammedlem");
  if (role.length < 2) return invalid("Rollen skal have mindst to tegn");
  return { ok: true, member_id: memberId, role };
}

export function validateFolderInput(body = {}) {
  const name = cleanText(body.name, 120);
  const color = cleanText(body.color, 20) || "gray";
  if (!name) return invalid("Mappen skal have et navn");
  if (!STATUS_COLORS.has(color)) return invalid("Ugyldig mappefarve");
  return { ok: true, name, color, parent_folder_id: cleanText(body.parent_folder_id, 80) };
}

export function validateWorkflowStatusInput(body = {}) {
  const entityType = cleanText(body.entity_type, 20);
  const label = cleanText(body.label, 80);
  const color = cleanText(body.color, 20) || "gray";
  const baseStatus = cleanText(body.base_status, 30);
  if (!ENTITY_BASE_STATUSES[entityType] || !label) return invalid("Vælg type og skriv et statusnavn");
  if (!ENTITY_BASE_STATUSES[entityType].has(baseStatus)) return invalid("Ugyldig statusgruppe");
  if (!STATUS_COLORS.has(color)) return invalid("Ugyldig statusfarve");
  return { ok: true, entity_type: entityType, label, color, base_status: baseStatus };
}

export function validateTaskInput(body = {}) {
  const projectId = cleanText(body.project_id, 80);
  const title = cleanText(body.title, 240);
  const status = cleanText(body.status, 24) || "todo";
  const priority = cleanText(body.priority, 24) || "medium";
  const dueOn = cleanDate(body.due_on);
  if (!projectId || !title) return invalid("Projekt og opgavetitel skal udfyldes");
  if (!TASK_STATUSES.has(status)) return invalid("Ugyldig opgavestatus");
  if (!TASK_PRIORITIES.has(priority)) return invalid("Ugyldig prioritet");
  if (dueOn === undefined) return invalid("Datoen skal skrives som ÅÅÅÅ-MM-DD");
  return {
    ok: true,
    project_id: projectId,
    application_id: cleanText(body.application_id, 80),
    parent_task_id: cleanText(body.parent_task_id, 80),
    title,
    description: cleanText(body.description),
    status,
    priority,
    assigned_to: cleanText(body.assigned_to, 80),
    due_on: dueOn,
    workflow_status_id: cleanText(body.workflow_status_id, 80),
  };
}

export function validateCommentInput(body = {}) {
  const projectId = cleanText(body.project_id, 80);
  const bodyText = cleanText(body.body, 4000);
  const mentionedMemberIds = Array.isArray(body.mentioned_member_ids)
    ? [...new Set(body.mentioned_member_ids.map((id) => cleanText(id, 80)).filter(Boolean))]
    : [];
  if (!projectId || !bodyText) return invalid("Projekt og kommentar skal udfyldes");
  return {
    ok: true,
    project_id: projectId,
    author_member_id: cleanText(body.author_member_id, 80),
    body: bodyText,
    mentioned_member_ids: mentionedMemberIds,
  };
}

export function validateTaskAssigneeInput(body = {}) {
  return { ok: true, assigned_to: cleanText(body.assigned_to, 80) };
}

export function validateDocumentInput(body = {}) {
  const projectId = cleanText(body.project_id, 80);
  const title = cleanText(body.title, 240);
  const documentUrl = cleanText(body.document_url, 2000);
  const documentType = cleanText(body.document_type, 30) || "google_doc";
  if (!projectId || !title || !documentUrl) return invalid("Projekt, titel og dokumentlink skal udfyldes");
  if (!DOCUMENT_TYPES.has(documentType)) return invalid("Ugyldig dokumenttype");
  try {
    const parsedUrl = new URL(documentUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return invalid("Dokumentlinket skal være en http- eller https-adresse");
  } catch {
    return invalid("Dokumentlinket er ugyldigt");
  }
  return {
    ok: true,
    project_id: projectId,
    application_id: cleanText(body.application_id, 80),
    task_id: cleanText(body.task_id, 80),
    title,
    document_url: documentUrl,
    document_type: documentType,
    created_by: cleanText(body.created_by, 80),
  };
}

export function createProjectRepository({ sqlitePath, cwd = process.cwd(), schemaPath } = {}) {
  const databasePath = path.resolve(sqlitePath);
  const migrationPath = schemaPath || path.resolve(cwd, "database", "project_management_schema.sql");
  let ready;

  function initialize() {
    ready ||= execSqliteFile(databasePath, migrationPath, { cwd });
    return ready;
  }

  async function query(sql) {
    await initialize();
    return runSqlite(databasePath, `PRAGMA foreign_keys = ON;\n${sql}`, { cwd });
  }

  return {
    initialize,

    async listProjects() {
      return query(`SELECT * FROM project_overview ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'idea' THEN 2 ELSE 3 END,
        updated_at DESC, name COLLATE NOCASE;`);
    },

    async listTeamMembers() {
      return query(`SELECT member_id, member_key, display_name, email, is_active
                    FROM team_members WHERE is_active = 1 ORDER BY display_name COLLATE NOCASE;`);
    },

    async getProjectConfig() {
      const [folders, statuses] = await Promise.all([
        query(`SELECT * FROM project_folders ORDER BY sort_order, name COLLATE NOCASE;`),
        query(`SELECT * FROM workflow_statuses WHERE is_active = 1 ORDER BY entity_type, sort_order, label COLLATE NOCASE;`),
      ]);
      return { folders, statuses };
    },

    async createFolder(input) {
      const folderId = randomUUID();
      await query(`INSERT INTO project_folders (folder_id, folder_key, name, parent_folder_id, color, sort_order)
        VALUES (${sqlString(folderId)}, ${sqlString(keyFrom("folder", input.name))}, ${sqlString(input.name)},
          ${sqlString(input.parent_folder_id)}, ${sqlString(input.color)},
          COALESCE((SELECT MAX(sort_order) + 10 FROM project_folders), 10));`);
      return (await query(`SELECT * FROM project_folders WHERE folder_id = ${sqlString(folderId)};`))[0];
    },

    async createWorkflowStatus(input) {
      const statusId = randomUUID();
      await query(`INSERT INTO workflow_statuses
        (status_id, status_key, entity_type, label, color, base_status, sort_order)
        VALUES (${sqlString(statusId)}, ${sqlString(keyFrom(`${input.entity_type}-status`, input.label))},
          ${sqlString(input.entity_type)}, ${sqlString(input.label)}, ${sqlString(input.color)},
          ${sqlString(input.base_status)}, COALESCE((SELECT MAX(sort_order) + 10 FROM workflow_statuses WHERE entity_type = ${sqlString(input.entity_type)}), 10));`);
      return (await query(`SELECT * FROM workflow_statuses WHERE status_id = ${sqlString(statusId)};`))[0];
    },

    async createTeamMember(input) {
      const memberId = randomUUID();
      const memberKey = keyFrom("member", input.display_name);
      await query(`INSERT INTO team_members (member_id, member_key, display_name, email)
                   VALUES (${sqlString(memberId)}, ${sqlString(memberKey)}, ${sqlString(input.display_name)}, ${sqlString(input.email)});`);
      return (await query(`SELECT member_id, member_key, display_name, email, is_active
                           FROM team_members WHERE member_id = ${sqlString(memberId)};`))[0];
    },

    async getProject(projectId) {
      const id = sqlString(projectId);
      const [projects, members, applications, tasks, documents, comments, commentMentions] = await Promise.all([
        query(`SELECT * FROM project_overview WHERE project_id = ${id};`),
        query(`SELECT tm.member_id, tm.display_name, tm.email, pm.role
               FROM project_members pm JOIN team_members tm ON tm.member_id = pm.member_id
               WHERE pm.project_id = ${id} ORDER BY tm.display_name;`),
        query(`SELECT * FROM application_pipeline WHERE project_id = ${id}
               ORDER BY CASE status WHEN 'drafting' THEN 0 WHEN 'planned' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END, updated_at DESC;`),
        query(`SELECT t.*, tm.display_name AS assignee_name, ws.status_id AS workflow_status_id,
                      COALESCE(ws.label, t.status) AS workflow_status_label, COALESCE(ws.color, 'gray') AS workflow_status_color
               FROM project_tasks t LEFT JOIN team_members tm ON tm.member_id = t.assigned_to
               LEFT JOIN task_status_assignments tsa ON tsa.task_id = t.task_id
               LEFT JOIN workflow_statuses ws ON ws.status_id = tsa.status_id
               WHERE t.project_id = ${id}
               ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
                        t.due_on IS NULL, t.due_on, t.created_at;`),
        query(`SELECT d.*, tm.display_name AS created_by_name
               FROM project_documents d LEFT JOIN team_members tm ON tm.member_id = d.created_by
               WHERE d.project_id = ${id} ORDER BY d.created_at DESC, d.title COLLATE NOCASE;`),
        query(`SELECT c.*, tm.display_name AS author_name
               FROM project_comments c LEFT JOIN team_members tm ON tm.member_id = c.author_member_id
               WHERE c.project_id = ${id} ORDER BY c.created_at DESC;`),
        query(`SELECT pcm.comment_id, pcm.member_id, tm.display_name
               FROM project_comment_mentions pcm JOIN team_members tm ON tm.member_id = pcm.member_id
               JOIN project_comments c ON c.comment_id = pcm.comment_id
               WHERE c.project_id = ${id} ORDER BY tm.display_name;`),
      ]);
      if (!projects[0]) return null;
      const mentionsByComment = new Map();
      commentMentions.forEach((mention) => {
        if (!mentionsByComment.has(mention.comment_id)) mentionsByComment.set(mention.comment_id, []);
        mentionsByComment.get(mention.comment_id).push(mention);
      });
      const commentsWithMentions = comments.map((comment) => ({ ...comment, mentions: mentionsByComment.get(comment.comment_id) || [] }));
      return { ...projects[0], members, applications, tasks, documents, comments: commentsWithMentions };
    },

    async createProject(input) {
      await initialize();
      const projectId = randomUUID();
      const projectKey = keyFrom("project", input.name);
      await query(`BEGIN; INSERT INTO projects (
        project_id, project_key, name, description, status, owner_member_id,
        starts_on, ends_on, estimated_budget, currency
      ) VALUES (
        ${sqlString(projectId)}, ${sqlString(projectKey)}, ${sqlString(input.name)}, ${sqlString(input.description)},
        ${sqlString(input.status)}, ${sqlString(input.owner_member_id)}, ${sqlString(input.starts_on)},
        ${sqlString(input.ends_on)}, ${input.estimated_budget ?? "NULL"}, ${sqlString(input.currency)}
      );
      INSERT INTO project_folder_assignments (project_id, folder_id)
        SELECT ${sqlString(projectId)}, ${sqlString(input.folder_id)} WHERE ${sqlString(input.folder_id)} IS NOT NULL;
      INSERT INTO project_status_assignments (project_id, status_id)
        SELECT ${sqlString(projectId)}, status_id FROM workflow_statuses
        WHERE status_id = ${sqlString(input.workflow_status_id)} AND entity_type = 'project';
      COMMIT;`);
      return this.getProject(projectId);
    },

    async updateProject(projectId, input) {
      const id = sqlString(projectId);
      await query(`BEGIN;
        UPDATE projects SET name = ${sqlString(input.name)}, description = ${sqlString(input.description)},
          status = ${sqlString(input.status)}, owner_member_id = ${sqlString(input.owner_member_id)},
          starts_on = ${sqlString(input.starts_on)}, ends_on = ${sqlString(input.ends_on)},
          estimated_budget = ${input.estimated_budget ?? "NULL"}, currency = ${sqlString(input.currency)},
          updated_at = CURRENT_TIMESTAMP
        WHERE project_id = ${id};
        UPDATE project_members SET role = 'contributor' WHERE project_id = ${id} AND role = 'owner';
        INSERT INTO project_members (project_id, member_id, role)
          SELECT ${id}, ${sqlString(input.owner_member_id)}, 'owner'
          WHERE ${sqlString(input.owner_member_id)} IS NOT NULL
          ON CONFLICT(project_id, member_id) DO UPDATE SET role = 'owner';
        DELETE FROM project_folder_assignments WHERE project_id = ${id};
        INSERT INTO project_folder_assignments (project_id, folder_id)
          SELECT ${id}, ${sqlString(input.folder_id)} WHERE ${sqlString(input.folder_id)} IS NOT NULL;
        DELETE FROM project_status_assignments WHERE project_id = ${id};
        INSERT INTO project_status_assignments (project_id, status_id)
          SELECT ${id}, status_id FROM workflow_statuses
          WHERE status_id = ${sqlString(input.workflow_status_id)} AND entity_type = 'project';
        COMMIT;`);
      return this.getProject(projectId);
    },

    async addProjectMember(projectId, input) {
      await query(`INSERT INTO project_members (project_id, member_id, role)
                   VALUES (${sqlString(projectId)}, ${sqlString(input.member_id)}, ${sqlString(input.role)})
                   ON CONFLICT(project_id, member_id) DO UPDATE SET role = excluded.role;`);
      return this.getProject(projectId);
    },

    async createApplication(input) {
      await initialize();
      const applicationId = randomUUID();
      const applicationKey = keyFrom("application", input.program_id);
      await query(`BEGIN;
        INSERT INTO applications (
          application_id, application_key, project_id, program_id, deadline_id,
          status, requested_amount, currency, notes
        ) VALUES (
          ${sqlString(applicationId)}, ${sqlString(applicationKey)}, ${sqlString(input.project_id)},
          ${sqlString(input.program_id)}, ${sqlString(input.deadline_id)}, ${sqlString(input.status)},
          ${input.requested_amount ?? "NULL"}, ${sqlString(input.currency)}, ${sqlString(input.notes)}
        );
        INSERT INTO application_status_history (application_id, previous_status, new_status)
        VALUES (${sqlString(applicationId)}, NULL, ${sqlString(input.status)});
        INSERT INTO application_status_assignments (application_id, status_id)
          SELECT ${sqlString(applicationId)}, status_id FROM workflow_statuses
          WHERE status_id = ${sqlString(input.workflow_status_id)} AND entity_type = 'application';
        COMMIT;`);
      return (await query(`SELECT * FROM application_pipeline WHERE application_id = ${sqlString(applicationId)};`))[0];
    },

    async updateApplication(applicationId, input) {
      const id = sqlString(applicationId);
      const todayExpression = input.status === "submitted" ? "COALESCE(submitted_on, CURRENT_DATE)" : sqlString(input.submitted_on);
      await query(`BEGIN;
        INSERT INTO application_status_history (application_id, previous_status, new_status, changed_by, note)
          SELECT application_id, status, ${sqlString(input.status)}, ${sqlString(input.changed_by)}, ${sqlString(input.change_note)}
          FROM applications WHERE application_id = ${id} AND status <> ${sqlString(input.status)};
        UPDATE applications SET status = ${sqlString(input.status)}, deadline_id = ${sqlString(input.deadline_id)},
          requested_amount = ${input.requested_amount ?? "NULL"}, awarded_amount = ${input.awarded_amount ?? "NULL"},
          submitted_on = ${todayExpression}, decision_expected_on = ${sqlString(input.decision_expected_on)},
          external_reference = ${sqlString(input.external_reference)}, notes = ${sqlString(input.notes)},
          updated_at = CURRENT_TIMESTAMP
        WHERE application_id = ${id};
        DELETE FROM application_status_assignments WHERE application_id = ${id};
        INSERT INTO application_status_assignments (application_id, status_id)
          SELECT ${id}, status_id FROM workflow_statuses
          WHERE status_id = ${sqlString(input.workflow_status_id)} AND entity_type = 'application';
        COMMIT;`);
      return (await query(`SELECT * FROM application_pipeline WHERE application_id = ${id};`))[0] || null;
    },

    async createTask(input) {
      await initialize();
      const taskId = randomUUID();
      const taskKey = keyFrom("task", input.title);
      const completedAt = input.status === "done" ? "CURRENT_TIMESTAMP" : "NULL";
      await query(`INSERT INTO project_tasks (
        task_id, task_key, project_id, application_id, parent_task_id, title,
        description, status, priority, assigned_to, due_on, completed_at
      ) VALUES (
        ${sqlString(taskId)}, ${sqlString(taskKey)}, ${sqlString(input.project_id)},
        ${sqlString(input.application_id)}, ${sqlString(input.parent_task_id)}, ${sqlString(input.title)},
        ${sqlString(input.description)}, ${sqlString(input.status)}, ${sqlString(input.priority)},
        ${sqlString(input.assigned_to)}, ${sqlString(input.due_on)}, ${completedAt}
      );
      INSERT INTO task_status_assignments (task_id, status_id)
        SELECT ${sqlString(taskId)}, status_id FROM workflow_statuses
        WHERE status_id = ${sqlString(input.workflow_status_id)} AND entity_type = 'task';`);
      return (await query(`SELECT * FROM project_tasks WHERE task_id = ${sqlString(taskId)};`))[0];
    },

    async updateTaskStatus(taskId, status, workflowStatusId = null) {
      if (!TASK_STATUSES.has(status)) return null;
      await query(`BEGIN; UPDATE project_tasks SET status = ${sqlString(status)},
        completed_at = CASE WHEN ${sqlString(status)} = 'done' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
        WHERE task_id = ${sqlString(taskId)};
        DELETE FROM task_status_assignments WHERE task_id = ${sqlString(taskId)};
        INSERT INTO task_status_assignments (task_id, status_id)
          SELECT ${sqlString(taskId)}, status_id FROM workflow_statuses
          WHERE status_id = ${sqlString(workflowStatusId)} AND entity_type = 'task';
        COMMIT;`);
      return (await query(`SELECT * FROM project_tasks WHERE task_id = ${sqlString(taskId)};`))[0] || null;
    },

    async updateTaskAssignee(taskId, assignedTo) {
      await query(`UPDATE project_tasks SET assigned_to = ${sqlString(assignedTo)}, updated_at = CURRENT_TIMESTAMP
                   WHERE task_id = ${sqlString(taskId)};`);
      return (await query(`SELECT * FROM project_tasks WHERE task_id = ${sqlString(taskId)};`))[0] || null;
    },

    async createComment(input) {
      const commentId = randomUUID();
      await query(`INSERT INTO project_comments (comment_id, project_id, author_member_id, body)
                   VALUES (${sqlString(commentId)}, ${sqlString(input.project_id)}, ${sqlString(input.author_member_id)}, ${sqlString(input.body)});`);
      for (const memberId of input.mentioned_member_ids) {
        await query(`INSERT OR IGNORE INTO project_comment_mentions (comment_id, member_id)
                     VALUES (${sqlString(commentId)}, ${sqlString(memberId)});`);
      }
      return (await query(`SELECT c.*, tm.display_name AS author_name
                           FROM project_comments c LEFT JOIN team_members tm ON tm.member_id = c.author_member_id
                           WHERE c.comment_id = ${sqlString(commentId)};`))[0];
    },

    async createDocument(input) {
      const documentId = randomUUID();
      await query(`INSERT INTO project_documents (
        document_id, document_key, project_id, application_id, task_id, title,
        document_url, document_type, created_by
      ) VALUES (
        ${sqlString(documentId)}, ${sqlString(keyFrom("document", input.title))}, ${sqlString(input.project_id)},
        ${sqlString(input.application_id)}, ${sqlString(input.task_id)}, ${sqlString(input.title)},
        ${sqlString(input.document_url)}, ${sqlString(input.document_type)}, ${sqlString(input.created_by)}
      );`);
      return (await query(`SELECT * FROM project_documents WHERE document_id = ${sqlString(documentId)};`))[0];
    },
  };
}
