import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  createProjectRepository,
  validateCommentInput,
  validateDocumentInput,
  validateApplicationInput,
  validateApplicationUpdate,
  validateProjectInput,
  validateProjectMemberInput,
  validateTaskInput,
  validateTeamMemberInput,
} from "./project_repository.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..");

async function fixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fonds-projects-"));
  const sqlitePath = path.join(tempDir, "test.sqlite");
  await execFileAsync("sqlite3", [sqlitePath, `
    PRAGMA foreign_keys = ON;
    CREATE TABLE foundations (foundation_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE programs (program_id TEXT PRIMARY KEY, foundation_id TEXT NOT NULL, program_name TEXT NOT NULL,
      FOREIGN KEY (foundation_id) REFERENCES foundations(foundation_id));
    CREATE TABLE deadlines (deadline_id TEXT PRIMARY KEY, program_id TEXT NOT NULL, closes_on TEXT,
      FOREIGN KEY (program_id) REFERENCES programs(program_id));
    INSERT INTO foundations VALUES ('fond-1', 'Testfonden');
    INSERT INTO programs VALUES ('program-1', 'fond-1', 'Testpuljen');
    INSERT INTO deadlines VALUES ('deadline-1', 'program-1', '2027-01-31');
  `]);
  const repository = createProjectRepository({ sqlitePath, cwd: rootDir });
  await repository.initialize();
  return { tempDir, sqlitePath, repository };
}

test("validation rejects invalid project dates and negative amounts", () => {
  assert.equal(validateProjectInput({ name: "Projekt", starts_on: "2027-02-01", ends_on: "2027-01-01" }).ok, false);
  assert.equal(validateApplicationInput({ project_id: "p", program_id: "pr", requested_amount: -1 }).ok, false);
  assert.equal(validateTaskInput({ project_id: "p", title: "Opgave", due_on: "31/1/2027" }).ok, false);
  assert.equal(validateDocumentInput({ project_id: "p", title: "Dokument", document_url: "javascript:alert(1)" }).ok, false);
});

test("custom folders and statuses are relationally assigned to projects", async (t) => {
  const { tempDir, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const folder = await repository.createFolder({ name: "Klima", color: "green", parent_folder_id: null });
  const workflowStatus = await repository.createWorkflowStatus({
    entity_type: "project", label: "Afventer partner", color: "yellow", base_status: "planning",
  });
  const project = await repository.createProject(validateProjectInput({
    name: "Mappeprojekt", status: "planning", folder_id: folder.folder_id,
    workflow_status_id: workflowStatus.status_id,
  }));
  assert.equal(project.folder_name, "Klima");
  assert.equal(project.workflow_status_label, "Afventer partner");
  assert.equal(project.workflow_status_color, "yellow");
});

test("team members can own and participate in a project", async (t) => {
  const { tempDir, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const project = await repository.createProject(validateProjectInput({ name: "Teamprojekt" }));
  const owner = await repository.createTeamMember(validateTeamMemberInput({ display_name: "Projektleder", email: "leder@example.org" }));
  const contributor = await repository.createTeamMember(validateTeamMemberInput({ display_name: "Bidragyder" }));

  await repository.addProjectMember(project.project_id, validateProjectMemberInput({ member_id: contributor.member_id, role: "reviewer" }));
  const marketing = await repository.createTeamMember(validateTeamMemberInput({ display_name: "Marketing" }));
  await repository.addProjectMember(project.project_id, validateProjectMemberInput({ member_id: marketing.member_id, role: "Marketing" }));
  const updated = await repository.updateProject(project.project_id, validateProjectInput({
    name: project.name,
    status: "active",
    owner_member_id: owner.member_id,
    estimated_budget: 500000,
  }));

  assert.equal(updated.owner_name, "Projektleder");
  assert.equal(updated.status, "active");
  assert.deepEqual(updated.members.map((member) => member.role).sort(), ["Marketing", "owner", "reviewer"]);
});

test("project creation stores dashboard fields and first application together", async (t) => {
  const { tempDir, sqlitePath, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const owner = await repository.createTeamMember(validateTeamMemberInput({ display_name: "Ansvarlig" }));
  const input = validateProjectInput({
    name: "Grønt ungeprojekt", focus_area: "Grøn omstilling", owner_member_id: owner.member_id,
    initial_application: {
      program_id: "program-1", deadline_id: "deadline-1", status: "awarded",
      requested_amount: 125000, awarded_amount: 100000, submitted_on: "2026-09-15",
    },
  });
  assert.equal(input.ok, true);
  const project = await repository.createProject(input);
  assert.equal(project.focus_area, "Grøn omstilling");
  assert.equal(project.owner_name, "Ansvarlig");
  assert.equal(project.members.find((member) => member.member_id === owner.member_id)?.role, "owner");
  assert.equal(project.applications[0].foundation_name, "Testfonden");
  assert.equal(project.applications[0].closes_on, "2027-01-31");
  assert.equal(project.applications[0].requested_amount, 125000);
  assert.equal(project.applications[0].awarded_amount, 100000);
  assert.equal(project.applications[0].submitted_on, "2026-09-15");
  const bad = validateProjectInput({ name: "Forkert område", focus_area: "Andet" });
  assert.equal(bad.ok, false);
  await assert.rejects(repository.createProject(validateProjectInput({
    name: "Ugyldig pulje", initial_application: { program_id: "ukendt" },
  })));
  const { stdout } = await execFileAsync("sqlite3", [sqlitePath, "SELECT count(*) FROM projects WHERE name = 'Ugyldig pulje';"]);
  assert.equal(stdout.trim(), "0");
});

test("existing project databases gain the focus area column", async (t) => {
  const { tempDir, sqlitePath } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  await execFileAsync("sqlite3", [sqlitePath, "DROP VIEW project_overview; ALTER TABLE projects DROP COLUMN focus_area;"]);
  const reopened = createProjectRepository({ sqlitePath, cwd: rootDir });
  const project = await reopened.createProject(validateProjectInput({ name: "Eksisterende database", focus_area: "Unge og fællesskaber" }));
  assert.equal(project.focus_area, "Unge og fællesskaber");
});

test("application updates persist deadlines and append status history", async (t) => {
  const { tempDir, sqlitePath, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const project = await repository.createProject(validateProjectInput({ name: "Ansøgningsprojekt" }));
  const application = await repository.createApplication(validateApplicationInput({
    project_id: project.project_id,
    program_id: "program-1",
    status: "candidate",
  }));
  const updated = await repository.updateApplication(application.application_id, validateApplicationUpdate({
    status: "submitted",
    deadline_id: "deadline-1",
    requested_amount: 125000,
    decision_expected_on: "2027-04-01",
    change_note: "Ansøgning sendt",
  }));
  assert.equal(updated.status, "submitted");
  assert.equal(updated.deadline_id, "deadline-1");
  assert.ok(updated.submitted_on);

  const { stdout } = await execFileAsync("sqlite3", [sqlitePath, "SELECT previous_status || '>' || new_status FROM application_status_history ORDER BY history_id;"]);
  assert.deepEqual(stdout.trim().split("\n"), ["", "candidate>submitted"].filter(Boolean));
});

test("project, application and task form one relational project overview", async (t) => {
  const { tempDir, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));

  const projectInput = validateProjectInput({ name: "Unges grønne handlekraft", status: "planning", estimated_budget: 250000 });
  const project = await repository.createProject(projectInput);
  assert.equal(project.name, "Unges grønne handlekraft");

  const applicationInput = validateApplicationInput({
    project_id: project.project_id,
    program_id: "program-1",
    deadline_id: "deadline-1",
    status: "drafting",
    requested_amount: 100000,
  });
  await repository.createApplication(applicationInput);

  const partner = await repository.createTeamMember(validateTeamMemberInput({ display_name: "Projektpartner" }));
  const taskInput = validateTaskInput({ project_id: project.project_id, title: "Skriv projektbeskrivelse", priority: "high", assigned_to: partner.member_id });
  const task = await repository.createTask(taskInput);
  await repository.createTask(validateTaskInput({ project_id: project.project_id, parent_task_id: task.task_id, title: "Lav første udkast" }));
  await repository.createDocument(validateDocumentInput({
    project_id: project.project_id,
    title: "Projektbeskrivelse",
    document_url: "https://docs.google.com/document/d/test",
    document_type: "google_doc",
  }));
  await repository.createComment(validateCommentInput({
    project_id: project.project_id,
    author_member_id: partner.member_id,
    body: "Status er opdateret.",
    mentioned_member_ids: [partner.member_id],
  }));
  await repository.updateTaskStatus(task.task_id, "done");

  const detail = await repository.getProject(project.project_id);
  assert.equal(detail.application_count, 1);
  assert.equal(detail.applications[0].foundation_name, "Testfonden");
  const mainTask = detail.tasks.find((item) => item.task_id === task.task_id);
  const subtask = detail.tasks.find((item) => item.parent_task_id === task.task_id);
  assert.equal(mainTask.status, "done");
  assert.equal(mainTask.assignee_name, "Projektpartner");
  assert.ok(mainTask.completed_at);
  assert.equal(subtask.title, "Lav første udkast");
  assert.equal(detail.documents[0].title, "Projektbeskrivelse");
  assert.equal(detail.comments[0].body, "Status er opdateret.");
  assert.equal(detail.comments[0].mentions[0].display_name, "Projektpartner");
});

test("a deadline cannot be attached to an application for another program", async (t) => {
  const { tempDir, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  await execFileAsync("sqlite3", [path.join(tempDir, "test.sqlite"), `
    INSERT INTO programs VALUES ('program-2', 'fond-1', 'En anden pulje');
  `]);
  const project = await repository.createProject(validateProjectInput({ name: "Projekt" }));
  await assert.rejects(() => repository.createApplication(validateApplicationInput({
    project_id: project.project_id,
    program_id: "program-2",
    deadline_id: "deadline-1",
  })));
});

test("NGO project workflow supports status, time budget, editable tasks and recoverable deletion", async (t) => {
  const { tempDir, repository } = await fixture();
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const project = await repository.createProject(validateProjectInput({ name: "Fælles indsats", estimated_hours: 120, estimated_budget: 250000 }));
  assert.equal(project.estimated_hours, 120);
  const { statuses } = await repository.getProjectConfig();
  assert.deepEqual(statuses.filter(s=>s.entity_type==='task').map(s=>s.label), ['Started','In progress','Stuck','Done']);
  assert.ok(statuses.some(s=>s.label==='Ansøgningsfase'));
  const submitted = statuses.find(s=>s.label==='Applikation sendt til fond');
  const updated = await repository.updateProjectStatus(project.project_id, submitted.status_id);
  assert.equal(updated.workflow_status_label, 'Applikation sendt til fond');
  assert.equal(updated.estimated_budget, 250000);
  const task = await repository.createTask(validateTaskInput({ project_id:project.project_id, title:'Kommunikation', description:'Lav en kampagne', status:'in_progress' }));
  const child = await repository.createTask(validateTaskInput({ project_id:project.project_id, parent_task_id:task.task_id, title:'Skriv opslag' }));
  const edited = await repository.updateTaskDetails(task.task_id, {title:'Kommunikationsplan',description:'Målgruppe og budskaber',due_on:'2026-11-01'});
  assert.equal(edited.description, 'Målgruppe og budskaber');
  assert.equal(edited.status, 'in_progress');
  await repository.setProjectDeleted(project.project_id, true);
  assert.equal((await repository.listProjects()).length, 0);
  assert.equal(await repository.getProject(project.project_id), null);
  assert.equal((await repository.listDeletedProjects())[0].project_id, project.project_id);
  await repository.setProjectDeleted(project.project_id, false);
  const restored = await repository.getProject(project.project_id);
  assert.equal(restored.tasks.length, 2);
  assert.equal(restored.tasks.find(t=>t.task_id===child.task_id).parent_task_id, task.task_id);
  assert.equal(restored.workflow_status_label, 'Applikation sendt til fond');
});
