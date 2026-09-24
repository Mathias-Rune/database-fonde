import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSqlite, sqlString } from "./scripts/sqlite_utils.mjs";
import { createAuthRepository, validateAccountInput, verifyPassword } from "./scripts/auth_repository.mjs";
import { createReviewRepository, validateReviewInput } from "./scripts/review_repository.mjs";
import { createScrapeReviewRepository, validateScrapeDecision } from "./scripts/scrape_review_repository.mjs";
import {
  createProjectRepository,
  validateCommentInput,
  validateDocumentInput,
  validateFolderInput,
  validateApplicationInput,
  validateApplicationUpdate,
  validateProjectInput,
  validateProjectMemberInput,
  validateTaskInput,
  validateTaskAssigneeInput,
  validateTeamMemberInput,
  validateWorkflowStatusInput,
} from "./scripts/project_repository.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "127.0.0.1";
const reviewRepository = createReviewRepository({
  sqlitePath: process.env.REVIEW_SQLITE_PATH
    ? path.resolve(process.env.REVIEW_SQLITE_PATH)
    : path.join(rootDir, "outputs", "fonds_database.sqlite"),
  cwd: rootDir,
});
const scraperSqlitePath = process.env.SCRAPER_SQLITE_PATH
  ? path.resolve(process.env.SCRAPER_SQLITE_PATH)
  : path.join(rootDir, "outputs", "fonds_database.sqlite");
const scrapeReviewRepository = createScrapeReviewRepository({
  sqlitePath: scraperSqlitePath,
  cwd: rootDir,
});
const projectRepository = createProjectRepository({ sqlitePath: scraperSqlitePath, cwd: rootDir });
const authRepository = createAuthRepository({ sqlitePath: scraperSqlitePath, cwd: rootDir });
const sessions = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".sqlite": "application/octet-stream",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function toCsv(headers, records) {
  const lines = [headers.map(csvEscape).join(",")];
  records.forEach((record) => {
    lines.push(headers.map((header) => csvEscape(record[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  const headers = rows.shift();
  return {
    headers,
    records: rows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])),
    ),
  };
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map((part) => { const [key, ...value] = part.trim().split("="); return [key, decodeURIComponent(value.join("="))]; }));
}

async function currentAccount(request) {
  const sessionId = parseCookies(request).session_id;
  const accountId = sessionId ? sessions.get(sessionId) : null;
  return accountId ? authRepository.getPublic(accountId) : null;
}

function setSession(response, accountId) {
  const sessionId = randomUUID();
  sessions.set(sessionId, accountId);
  response.setHeader("set-cookie", `session_id=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/`);
}

async function requireAuth(request, response) {
  const account = await currentAccount(request);
  if (!account) { sendJson(response, 401, { ok: false, message: "Log ind for at bruge projektstyringen", authenticated: false }); return null; }
  return account;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: rootDir, timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function runSourceUpdate({ dryRun = false } = {}) {
  const sourceCheckArgs = [path.join(rootDir, "scripts", "check_foundation_sources.mjs")];
  sourceCheckArgs.push(dryRun ? "--dry-run" : "--update-csv");
  const sourceCheck = await runCommand(process.execPath, sourceCheckArgs);

  let sqlite = { stdout: "" };
  if (!dryRun) {
    sqlite = await runCommand("sqlite3", [
      path.join(rootDir, "outputs", "fonds_database.sqlite"),
      ".read database/import_seed.sql",
    ]);
  }

  const reportText = await fs.readFile(path.join(rootDir, "reports", "source-check-report.json"), "utf8");
  const report = JSON.parse(reportText);

  return {
    ok: true,
    dry_run: dryRun,
    source_check: JSON.parse(sourceCheck.stdout),
    sqlite: sqlite.stdout.trim(),
    report,
  };
}

async function runScraper({ dryRun = false, limit = 0 } = {}) {
  const env = { ...process.env };
  if (limit) env.SCRAPER_LIMIT = String(limit);

  const args = [path.join(rootDir, "scripts", "fond_scraper.mjs")];
  if (dryRun) args.push("--dry-run");

  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { cwd: rootDir, env, timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

async function listScrapeChanges() {
  return scrapeReviewRepository.listPending();
}

async function listFoundationExtractedFields() {
  return scrapeReviewRepository.listApprovedFields();
}

async function updateFoundationVerification(foundationId, status) {
  const allowedStatuses = new Set(["source_checked", "to_verify", "needs_update"]);
  if (!foundationId || !allowedStatuses.has(status)) {
    return { ok: false, message: "Ugyldig fond eller status" };
  }

  const csvPath = path.join(rootDir, "data", "fonde_seed.csv");
  const csvText = await fs.readFile(csvPath, "utf8");
  const { headers, records } = csvToObjects(csvText);
  const foundation = records.find((record) => record.foundation_id === foundationId);

  if (!foundation) {
    return { ok: false, message: "Fonden blev ikke fundet" };
  }

  foundation.verification_status = status;
  foundation.last_checked = new Date().toISOString().slice(0, 10);
  await fs.writeFile(csvPath, toCsv(headers, records));

  await runSqlite(
    path.join(rootDir, "outputs", "fonds_database.sqlite"),
    `UPDATE foundations
     SET verification_status = ${sqlString(foundation.verification_status)},
         last_checked = ${sqlString(foundation.last_checked)}
     WHERE foundation_id = ${sqlString(foundation.foundation_id)};`,
    { cwd: rootDir },
  );

  return { ok: true, foundation };
}

async function decideScrapeChange(changeId, decision, note = "") {
  const input = validateScrapeDecision(changeId, decision, note);
  if (!input.ok) return input;
  const change = await scrapeReviewRepository.decide(input);
  if (!change) return { ok: false, statusCode: 409, message: "Ændringen er allerede behandlet eller findes ikke" };
  return { ok: true, status: change.validation_status, change };
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(rootDir, requestedPath));

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(file);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/auth/status") {
    const account = await currentAccount(request);
    sendJson(response, 200, { ok: true, authenticated: !!account, user: account, setupRequired: (await authRepository.countAccounts()) === 0 });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/setup") {
    try {
      if ((await authRepository.countAccounts()) > 0) { sendJson(response, 409, { ok: false, message: "Første konto er allerede oprettet" }); return; }
      const input = validateAccountInput(await readJsonBody(request));
      if (!input.ok) { sendJson(response, input.statusCode, input); return; }
      const account = await authRepository.createAccount(input); setSession(response, account.account_id);
      sendJson(response, 201, { ok: true, user: account });
    } catch (error) { sendJson(response, 400, { ok: false, message: error.message }); }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/login") {
    try {
      const body = await readJsonBody(request); const account = await authRepository.findByEmail(body.email);
      if (!account || !(await verifyPassword(String(body.password || ""), account.password_hash))) { sendJson(response, 401, { ok: false, message: "Email eller adgangskode er forkert" }); return; }
      setSession(response, account.account_id); sendJson(response, 200, { ok: true, user: await authRepository.getPublic(account.account_id) });
    } catch (error) { sendJson(response, 400, { ok: false, message: error.message }); }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
    const sessionId = parseCookies(request).session_id; if (sessionId) sessions.delete(sessionId);
    response.setHeader("set-cookie", "session_id=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/"); sendJson(response, 200, { ok: true }); return;
  }

  if (requestUrl.pathname.startsWith("/api/projects") || requestUrl.pathname.startsWith("/api/project-") || requestUrl.pathname.startsWith("/api/team-members") || requestUrl.pathname.startsWith("/api/tasks") || requestUrl.pathname.startsWith("/api/applications") || requestUrl.pathname.startsWith("/api/workflow-statuses")) {
    const account = await requireAuth(request, response);
    if (!account) return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/projects") {
    try {
      sendJson(response, 200, { ok: true, projects: await projectRepository.listProjects() });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/team-members") {
    try {
      sendJson(response, 200, { ok: true, members: await projectRepository.listTeamMembers() });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/project-config") {
    try {
      sendJson(response, 200, { ok: true, ...(await projectRepository.getProjectConfig()) });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/project-folders") {
    try {
      const input = validateFolderInput(await readJsonBody(request));
      if (!input.ok) return sendJson(response, input.statusCode, input);
      sendJson(response, 201, { ok: true, folder: await projectRepository.createFolder(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/workflow-statuses") {
    try {
      const input = validateWorkflowStatusInput(await readJsonBody(request));
      if (!input.ok) return sendJson(response, input.statusCode, input);
      sendJson(response, 201, { ok: true, status: await projectRepository.createWorkflowStatus(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/team-members") {
    try {
      const input = validateTeamMemberInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      sendJson(response, 201, { ok: true, member: await projectRepository.createTeamMember(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/projects/")) {
    try {
      const projectId = decodeURIComponent(requestUrl.pathname.slice("/api/projects/".length));
      const project = await projectRepository.getProject(projectId);
      sendJson(response, project ? 200 : 404, project ? { ok: true, project } : { ok: false, message: "Projektet blev ikke fundet" });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/projects") {
    try {
      const input = validateProjectInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      sendJson(response, 201, { ok: true, project: await projectRepository.createProject(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "PATCH" && /^\/api\/projects\/[^/]+$/.test(requestUrl.pathname)) {
    try {
      const projectId = decodeURIComponent(requestUrl.pathname.split("/")[3]);
      const input = validateProjectInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      const project = await projectRepository.updateProject(projectId, input);
      sendJson(response, project ? 200 : 404, project ? { ok: true, project } : { ok: false, message: "Projektet blev ikke fundet" });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && /^\/api\/projects\/[^/]+\/members$/.test(requestUrl.pathname)) {
    try {
      const projectId = decodeURIComponent(requestUrl.pathname.split("/")[3]);
      const input = validateProjectMemberInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      const project = await projectRepository.addProjectMember(projectId, input);
      sendJson(response, project ? 200 : 404, project ? { ok: true, project } : { ok: false, message: "Projektet blev ikke fundet" });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/applications") {
    try {
      const input = validateApplicationInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      sendJson(response, 201, { ok: true, application: await projectRepository.createApplication(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "PATCH" && /^\/api\/applications\/[^/]+$/.test(requestUrl.pathname)) {
    try {
      const applicationId = decodeURIComponent(requestUrl.pathname.split("/")[3]);
      const input = validateApplicationUpdate(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      const application = await projectRepository.updateApplication(applicationId, input);
      sendJson(response, application ? 200 : 404, application ? { ok: true, application } : { ok: false, message: "Ansøgningen blev ikke fundet" });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/tasks") {
    try {
      const input = validateTaskInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      sendJson(response, 201, { ok: true, task: await projectRepository.createTask(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "PATCH" && /^\/api\/tasks\/[^/]+\/assignee$/.test(requestUrl.pathname)) {
    try {
      const taskId = decodeURIComponent(requestUrl.pathname.split("/")[3]);
      const input = validateTaskAssigneeInput(await readJsonBody(request));
      const task = await projectRepository.updateTaskAssignee(taskId, input.assigned_to);
      sendJson(response, task ? 200 : 404, task ? { ok: true, task } : { ok: false, message: "Opgaven blev ikke fundet" });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/project-comments") {
    try {
      const input = validateCommentInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      sendJson(response, 201, { ok: true, comment: await projectRepository.createComment(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/project-documents") {
    try {
      const input = validateDocumentInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      sendJson(response, 201, { ok: true, document: await projectRepository.createDocument(input) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "PATCH" && /^\/api\/tasks\/[^/]+\/status$/.test(requestUrl.pathname)) {
    try {
      const taskId = decodeURIComponent(requestUrl.pathname.split("/")[3]);
      const body = await readJsonBody(request);
      const task = await projectRepository.updateTaskStatus(taskId, body.status, body.workflow_status_id);
      sendJson(response, task ? 200 : 400, task ? { ok: true, task } : { ok: false, message: "Ugyldig opgave eller status" });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/update-sources") {
    try {
      sendJson(response, 200, await runSourceUpdate());
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/update-sources-dry-run") {
    try {
      sendJson(response, 200, await runSourceUpdate({ dryRun: true }));
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/scrape/run") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, { ok: true, report: await runScraper({ dryRun: !!body.dry_run, limit: Number(body.limit || 0) }) });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || "",
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/scrape/changes") {
    try {
      sendJson(response, 200, { ok: true, changes: await listScrapeChanges() });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/foundations/extracted-fields") {
    try {
      sendJson(response, 200, { ok: true, fields: await listFoundationExtractedFields() });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/foundations/verification") {
    try {
      const body = await readJsonBody(request);
      const result = await updateFoundationVerification(body.foundation_id, body.status);
      sendJson(response, result.ok ? 200 : 400, result);
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/scrape/changes/decide") {
    try {
      const body = await readJsonBody(request);
      const result = await decideScrapeChange(body.change_id, body.decision, body.note);
      sendJson(response, result.ok ? 200 : (result.statusCode || 404), result);
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/call-reviews") {
    try {
      sendJson(response, 200, {
        ok: true,
        backend: reviewRepository.backend,
        reviews: await reviewRepository.list(),
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/call-reviews") {
    try {
      const input = validateReviewInput(await readJsonBody(request));
      if (!input.ok) {
        sendJson(response, input.statusCode, input);
        return;
      }
      const review = await reviewRepository.update(input);
      sendJson(
        response,
        review ? 200 : 404,
        review ? { ok: true, backend: reviewRepository.backend, review } : { ok: false, message: "Scannerfundet blev ikke fundet" },
      );
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end("Method not allowed");
    return;
  }

  await serveStatic(request, response);
});

await projectRepository.initialize();

server.listen(port, host, () => {
  console.log(`Database fonde running at http://${host}:${port}/`);
});

server.on("close", () => {
  void reviewRepository.close();
});
