import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSqliteFile, runSqlite, sqlString } from "./scripts/sqlite_utils.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "127.0.0.1";

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

async function ensureScrapingSchema() {
  await execSqliteFile(
    path.join(rootDir, "outputs", "fonds_database.sqlite"),
    path.join(rootDir, "database", "scraping_schema.sql"),
    { cwd: rootDir },
  );
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
  await ensureScrapingSchema();
  const dbPath = path.join(rootDir, "outputs", "fonds_database.sqlite");
  return runSqlite(
    dbPath,
    `SELECT
       c.change_id,
       c.foundation_id,
       f.name AS foundation_name,
       c.field_name,
       c.old_value,
       c.new_value,
       c.source_url,
       c.confidence,
       c.significance,
       c.validation_status,
       c.detected_at
     FROM foundation_field_changes c
     JOIN foundations f ON f.foundation_id = c.foundation_id
     WHERE c.validation_status = 'manual_review'
     ORDER BY c.detected_at DESC, c.change_id DESC
     LIMIT 100;`,
    { cwd: rootDir },
  );
}

async function listFoundationExtractedFields() {
  await ensureScrapingSchema();
  const dbPath = path.join(rootDir, "outputs", "fonds_database.sqlite");
  return runSqlite(
    dbPath,
    `SELECT foundation_id, field_name, field_value, source_url, confidence, updated_at
     FROM foundation_extracted_fields
     ORDER BY foundation_id, field_name;`,
    { cwd: rootDir },
  );
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
  await ensureScrapingSchema();
  const dbPath = path.join(rootDir, "outputs", "fonds_database.sqlite");
  const [change] = await runSqlite(
    dbPath,
    `SELECT * FROM foundation_field_changes WHERE change_id = ${Number(changeId)};`,
    { cwd: rootDir },
  );

  if (!change) {
    return { ok: false, message: "Change not found" };
  }

  if (decision === "approve") {
    const decisionNote = note || "Approved in local admin UI";
    await runSqlite(
      dbPath,
      `INSERT INTO foundation_extracted_fields (foundation_id, field_name, field_value, source_url, confidence, updated_at)
       VALUES (${sqlString(change.foundation_id)}, ${sqlString(change.field_name)}, ${sqlString(change.new_value)}, ${sqlString(change.source_url)}, ${change.confidence}, ${sqlString(new Date().toISOString())})
       ON CONFLICT(foundation_id, field_name) DO UPDATE SET
         field_value = excluded.field_value,
         source_url = excluded.source_url,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at;`,
      { cwd: rootDir },
    );
    await runSqlite(
      dbPath,
      `UPDATE foundation_field_changes SET validation_status = 'approved_manual', decided_at = ${sqlString(new Date().toISOString())}, decision_note = ${sqlString(decisionNote)} WHERE change_id = ${Number(changeId)};`,
      { cwd: rootDir },
    );
    return { ok: true, status: "approved_manual" };
  }

  const decisionNote = note || "Rejected in local admin UI";
  await runSqlite(
    dbPath,
    `UPDATE foundation_field_changes SET validation_status = 'rejected', decided_at = ${sqlString(new Date().toISOString())}, decision_note = ${sqlString(decisionNote)} WHERE change_id = ${Number(changeId)};`,
    { cwd: rootDir },
  );
  return { ok: true, status: "rejected" };
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
      sendJson(response, result.ok ? 200 : 404, result);
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

server.listen(port, host, () => {
  console.log(`Database fonde running at http://${host}:${port}/`);
});
