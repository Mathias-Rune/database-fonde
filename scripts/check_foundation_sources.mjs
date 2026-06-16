import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const csvPath = path.join(rootDir, "data", "fonde_seed.csv");
const reportDir = path.join(rootDir, "reports");
const reportPath = path.join(reportDir, "source-check-report.json");
const today = new Date().toISOString().slice(0, 10);
const timeoutMs = Number(process.env.SOURCE_CHECK_TIMEOUT_MS || 15000);
const dryRun = process.argv.includes("--dry-run");
const updateCsv = process.argv.includes("--update-csv") && !dryRun;

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

async function fetchWithTimeout(url) {
  if (!url) {
    return { ok: false, status: null, finalUrl: "", hash: "", error: "missing_url" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "database-fonde-source-check/1.0",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      hash: crypto.createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      hash: "",
      bytes: 0,
      error: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkFoundation(foundation) {
  const checks = {
    website: await fetchWithTimeout(foundation.website),
    application_url: await fetchWithTimeout(foundation.application_url),
    source_url: await fetchWithTimeout(foundation.source_url),
  };

  const failed = Object.entries(checks)
    .filter(([, result]) => !result.ok)
    .map(([field, result]) => ({
      field,
      status: result.status,
      error: result.error,
      url: foundation[field],
    }));

  return {
    foundation_id: foundation.foundation_id,
    name: foundation.name,
    checked_at: new Date().toISOString(),
    failed,
    checks,
  };
}

const csvText = await fs.readFile(csvPath, "utf8");
const { headers, records } = csvToObjects(csvText);
const results = [];

for (const foundation of records) {
  const result = await checkFoundation(foundation);
  results.push(result);

  if (updateCsv) {
    foundation.last_checked = today;
    if (result.failed.length > 0) {
      foundation.verification_status = "needs_update";
    } else if (foundation.verification_status === "needs_update") {
      foundation.verification_status = "to_verify";
    }
  }
}

const report = {
  generated_at: new Date().toISOString(),
  total_foundations: records.length,
  failed_foundations: results.filter((result) => result.failed.length > 0).length,
  dry_run: dryRun,
  updated_csv: updateCsv,
  results,
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (updateCsv) {
  await fs.writeFile(csvPath, toCsv(headers, records));
}

console.log(
  JSON.stringify(
    {
      total_foundations: report.total_foundations,
      failed_foundations: report.failed_foundations,
      report: path.relative(rootDir, reportPath),
      updated_csv: updateCsv,
    },
    null,
    2,
  ),
);

if (report.failed_foundations > 0 && process.env.FAIL_ON_SOURCE_ERRORS === "true") {
  process.exitCode = 1;
}
