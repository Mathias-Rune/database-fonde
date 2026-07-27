import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReviewRepository, validateReviewInput } from "./review_repository.mjs";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultDecisionPath = path.join(rootDir, "data", "call_scan_review_decisions.csv");
const defaultScanPath = path.join(rootDir, "data", "call_scan_results.csv");
const defaultSqlitePath = path.join(rootDir, "outputs", "fonds_database.sqlite");

export function parseCsv(text) {
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
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  return dataRows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

export async function loadReviewData({
  decisionPath = defaultDecisionPath,
  scanPath = defaultScanPath,
} = {}) {
  const [decisionText, scanText] = await Promise.all([
    fs.readFile(decisionPath, "utf8"),
    fs.readFile(scanPath, "utf8"),
  ]);
  return { decisions: parseCsv(decisionText), scans: parseCsv(scanText) };
}

export function validateDecisionCoverage(decisions, scans) {
  const errors = [];
  const ids = new Set();
  const foundScans = scans.filter((scan) => scan.scan_status === "found" && scan.review_status === "new");
  const foundIds = new Set(foundScans.map((scan) => scan.scan_result_id));

  for (const decision of decisions) {
    if (ids.has(decision.scan_result_id)) errors.push(`Dubleret beslutning: ${decision.scan_result_id}`);
    ids.add(decision.scan_result_id);
    if (!foundIds.has(decision.scan_result_id)) errors.push(`Beslutning matcher ikke et nyt fund: ${decision.scan_result_id}`);
    const validation = validateReviewInput({
      scan_result_id: decision.scan_result_id,
      review_status: decision.review_status,
      note: decision.review_note,
    });
    if (!validation.ok) errors.push(`${decision.scan_result_id}: ${validation.message}`);
    if (!decision.review_note?.trim()) errors.push(`Reviewnote mangler: ${decision.scan_result_id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decision.reviewed_at)) {
      errors.push(`Ugyldig reviewed_at: ${decision.scan_result_id}`);
    }
  }

  for (const scan of foundScans) {
    if (!ids.has(scan.scan_result_id)) errors.push(`Nyt fund mangler beslutning: ${scan.scan_result_id}`);
  }
  if (decisions.length !== 73) errors.push(`Forventede 73 beslutninger, fandt ${decisions.length}`);
  if (foundScans.length !== 73) errors.push(`Forventede 73 nye scannerfund, fandt ${foundScans.length}`);

  const counts = decisions.reduce((result, decision) => {
    result[decision.review_status] = (result[decision.review_status] || 0) + 1;
    return result;
  }, {});
  return { ok: errors.length === 0, errors, counts, total: decisions.length };
}

export async function applyReviewDecisions(decisions, {
  databaseUrl = process.env.DATABASE_URL,
  sqlitePath = defaultSqlitePath,
  actor = process.env.REVIEW_ACTOR || "scanner_review_2026_07_27",
  cwd = rootDir,
} = {}) {
  const repository = createReviewRepository({ databaseUrl, sqlitePath, actor, cwd });
  let applied = 0;
  try {
    for (const decision of decisions) {
      const input = validateReviewInput({
        scan_result_id: decision.scan_result_id,
        review_status: decision.review_status,
        note: decision.review_note,
      });
      if (!input.ok) throw new Error(`${decision.scan_result_id}: ${input.message}`);
      const result = await repository.update(input);
      if (!result) throw new Error(`Scannerfundet findes ikke i databasen: ${decision.scan_result_id}`);
      applied += 1;
    }
  } finally {
    await repository.close();
  }
  return { applied, backend: databaseUrl ? "postgres" : "sqlite" };
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const { decisions, scans } = await loadReviewData();
  const validation = validateDecisionCoverage(decisions, scans);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ ok: true, ...validation }, null, 2));
    return;
  }
  const result = await applyReviewDecisions(decisions, {
    sqlitePath: path.resolve(readOption("--sqlite") || defaultSqlitePath),
  });
  console.log(JSON.stringify({ ok: true, ...validation, ...result }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
