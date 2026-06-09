import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
