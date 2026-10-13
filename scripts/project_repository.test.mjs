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
