import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const crawlerDir = path.join(root, "crawler");
const dataDir = path.join(root, "data");
const foundationsPath = path.join(dataDir, "fonde_seed.csv");
const programsPath = path.join(dataDir, "programs_seed.csv");
const scanResultsPath = path.join(dataDir, "call_scan_results.csv");
const deepOutputDir = path.join(dataDir, "crawler_profiles");
const deepScanStatePath = path.join(dataDir, "deep_scan_state.json");
const scannedAt = new Date().toISOString();
const maxPages = Number(process.env.DEEP_SCAN_MAX_PAGES || "8");
const scanLimit = Number(process.env.DEEP_SCAN_LIMIT || "0");
const explicitOffset = process.env.DEEP_SCAN_OFFSET ? Number(process.env.DEEP_SCAN_OFFSET) : null;
const limitFoundationIds = new Set(
  (process.env.DEEP_SCAN_FOUNDATION_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const scanHeaders = [
  "scan_result_id",
  "foundation_id",
  "program_id",
  "foundation_name",
  "program_name",
  "scan_url",
  "scan_status",
  "match_type",
  "discovered_title",
  "discovered_url",
  "excerpt",
  "contact_name",
  "contact_email",
  "contact_phone",
  "contact_source_url",
  "scanned_at",
  "review_status",
];

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

  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  const headers = rows.shift() || [];
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])),
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records) {
  return [
    scanHeaders.join(","),
    ...records.map((record) => scanHeaders.map((header) => csvEscape(record[header])).join(",")),
  ].join("\n") + "\n";
}

function isCrawlerRecord(record) {
  return String(record.match_type || "").startsWith("crawler_");
}

function preserveReviewStatuses(newRecords, existingRecords) {
  const existingById = new Map(existingRecords.map((record) => [record.scan_result_id, record]));
  return newRecords.map((record) => {
    const existing = existingById.get(record.scan_result_id);
    if (!existing?.review_status || existing.review_status === record.review_status) return record;
    return { ...record, review_status: existing.review_status };
  });
}

function stableId(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "foundation";
}

function normalizeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function chooseSeedUrl(foundation, program) {
  return normalizeUrl(
    program?.application_url ||
    program?.source_url ||
    foundation.application_url ||
    foundation.source_url ||
    foundation.website,
  );
}

function mapStatus(status) {
  if (status === "open" || status === "upcoming") return "found";
  if (status === "closed" || status === "historical") return "no_match";
  return "found";
}

function excerptForCall(call) {
  const parts = [
    `Crawler status: ${call.status}`,
    call.closesAt ? `Frist: ${call.closesAt}` : "",
    call.rollingDeadline ? "Løbende frist" : "",
    call.confidence !== undefined ? `Confidence: ${call.confidence}` : "",
    call.summary || "",
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 900);
}

function mergeScanRecords(existing, deepRecords, scannedFoundationIds, activeFoundationIds) {
  const activeExisting = existing.filter((record) => activeFoundationIds.has(record.foundation_id));
  const reviewedDeepRecords = preserveReviewStatuses(deepRecords, activeExisting);
  const preserved = activeExisting.filter((record) => !isCrawlerRecord(record) || !scannedFoundationIds.has(record.foundation_id));
  return [...new Map([...preserved, ...reviewedDeepRecords].map((record) => [record.scan_result_id, record])).values()]
    .sort((a, b) =>
      a.foundation_name.localeCompare(b.foundation_name, "da") ||
      a.program_name.localeCompare(b.program_name, "da") ||
      a.discovered_title.localeCompare(b.discovered_title, "da")
    );
}

async function readDeepScanState() {
  try {
    return JSON.parse(await fs.readFile(deepScanStatePath, "utf8"));
  } catch {
    return { nextOffset: 0 };
  }
}

async function writeDeepScanState(nextOffset, totalFoundations) {
  const payload = {
    nextOffset,
    totalFoundations,
    updatedAt: scannedAt,
  };
  await fs.writeFile(deepScanStatePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function rotateItems(items, start, limit) {
  if (!limit || limit <= 0 || limit >= items.length) return items;
  const normalizedStart = ((start % items.length) + items.length) % items.length;
  return Array.from({ length: limit }, (_, index) => items[(normalizedStart + index) % items.length]);
}

async function runCrawler(seedUrl, outputDir) {
  await execFileAsync("npm", [
    "run",
    "crawl",
    "--",
    "--seeds",
    seedUrl,
    "--max-pages",
    String(maxPages),
    "--out",
    outputDir,
  ], {
    cwd: crawlerDir,
    env: {
      ...process.env,
      CRAWLER_ALLOW_BATCH: "false",
      CRAWLER_ENABLE_GUESSED_PATHS: "true",
      CRAWLER_MAX_SITEMAP_URLS: process.env.CRAWLER_MAX_SITEMAP_URLS || "12",
      CRAWLER_MIN_DELAY_MS: process.env.CRAWLER_MIN_DELAY_MS || "700",
      CRAWLER_REQUEST_TIMEOUT_MS: process.env.CRAWLER_REQUEST_TIMEOUT_MS || "12000",
    },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 180000,
  });
}

async function readProfile(outputDir, foundation) {
  const preferred = path.join(outputDir, `${slugify(foundation.name)}.profile.json`);
  try {
    return JSON.parse(await fs.readFile(preferred, "utf8"));
  } catch {
    const files = await fs.readdir(outputDir).catch(() => []);
    const profileFile = files.find((file) => file.endsWith(".profile.json"));
    if (!profileFile) return null;
    return JSON.parse(await fs.readFile(path.join(outputDir, profileFile), "utf8"));
  }
}

function recordsFromProfile({ profile, foundation, program }) {
  const calls = Array.isArray(profile?.openCalls) ? profile.openCalls : [];
  if (!calls.length) {
    return [{
      scan_result_id: stableId(["crawler", foundation.foundation_id, program.program_id, "no-open-call"]),
      foundation_id: foundation.foundation_id,
      program_id: program.program_id,
      foundation_name: foundation.name,
      program_name: program.program_name,
      scan_url: profile?.website || foundation.website,
      scan_status: "no_match",
      match_type: "crawler_no_open_call",
      discovered_title: "Crawler fandt ingen open calls",
      discovered_url: profile?.website || foundation.website,
      excerpt: `Crawleren gennemgik ${profile?.sources?.length ?? 0} kilder uden at finde open-call records.`,
      scanned_at: scannedAt,
      review_status: "ignored",
    }];
  }

  return calls.map((call) => ({
    scan_result_id: stableId(["crawler", foundation.foundation_id, program.program_id, call.sourceUrl, call.title, call.status, call.closesAt]),
    foundation_id: foundation.foundation_id,
    program_id: program.program_id,
    foundation_name: foundation.name,
    program_name: program.program_name,
    scan_url: foundation.website || call.sourceUrl,
    scan_status: mapStatus(call.status),
    match_type: "crawler_open_call",
    discovered_title: call.title || `Crawler open call (${call.status})`,
    discovered_url: call.sourceUrl || foundation.website,
    excerpt: excerptForCall(call),
    contact_name: call.contactName || "",
    contact_email: call.contactEmail || "",
    contact_phone: call.contactPhone || "",
    contact_source_url: call.contactSourceUrl || call.sourceUrl || "",
    scanned_at: scannedAt,
    review_status: call.status === "historical" || call.status === "closed" ? "ignored" : "new",
  }));
}

const [foundationText, programText, existingText] = await Promise.all([
  fs.readFile(foundationsPath, "utf8"),
  fs.readFile(programsPath, "utf8"),
  fs.readFile(scanResultsPath, "utf8").catch(() => `${scanHeaders.join(",")}\n`),
]);

const allFoundations = csvToObjects(foundationText);
const activeFoundationIds = new Set(allFoundations.map((foundation) => foundation.foundation_id));
const state = await readDeepScanState();
const autoRotate = scanLimit > 0 && !limitFoundationIds.size && explicitOffset === null;
const startOffset = explicitOffset ?? (autoRotate ? Number(state.nextOffset || 0) : 0);
const candidateFoundations = allFoundations.filter((foundation) => !limitFoundationIds.size || limitFoundationIds.has(foundation.foundation_id));
const foundations = rotateItems(candidateFoundations, startOffset, scanLimit);
const programs = csvToObjects(programText);
const programsByFoundation = new Map();
for (const program of programs) {
  const foundationPrograms = programsByFoundation.get(program.foundation_id) || [];
  foundationPrograms.push(program);
  programsByFoundation.set(program.foundation_id, foundationPrograms);
}
const existing = csvToObjects(existingText);
const deepRecords = [];
const scannedFoundationIds = new Set(foundations.map((foundation) => foundation.foundation_id));

await fs.mkdir(deepOutputDir, { recursive: true });

for (const foundation of foundations) {
  const foundationPrograms = programsByFoundation.get(foundation.foundation_id) || [];
  for (const program of foundationPrograms) {
    const seedUrl = chooseSeedUrl(foundation, program);
    if (!seedUrl) continue;

    const outputDir = path.join(deepOutputDir, foundation.foundation_id, program.program_id);
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    try {
      await runCrawler(seedUrl, outputDir);
      const profile = await readProfile(outputDir, foundation);
      const records = profile
        ? recordsFromProfile({ profile, foundation, program })
        : [{
            scan_result_id: stableId(["crawler", foundation.foundation_id, program.program_id, "missing-profile"]),
            foundation_id: foundation.foundation_id,
            program_id: program.program_id,
            foundation_name: foundation.name,
            program_name: program.program_name,
            scan_url: seedUrl,
            scan_status: "error",
            match_type: "crawler_error",
            discovered_title: "Crawler output mangler",
            discovered_url: seedUrl,
            excerpt: "Crawleren afsluttede uden profil-JSON.",
            scanned_at: scannedAt,
            review_status: "new",
          }];
      deepRecords.push(...records);
      console.log(`${foundation.name} / ${program.program_name}: ${records.filter((record) => record.scan_status === "found").length} crawler calls`);
    } catch (error) {
      deepRecords.push({
        scan_result_id: stableId(["crawler", foundation.foundation_id, program.program_id, "error"]),
        foundation_id: foundation.foundation_id,
        program_id: program.program_id,
        foundation_name: foundation.name,
        program_name: program.program_name,
        scan_url: seedUrl,
        scan_status: "error",
        match_type: "crawler_error",
        discovered_title: "Deep scan fejlede",
        discovered_url: seedUrl,
        excerpt: error.message,
        scanned_at: scannedAt,
        review_status: "new",
      });
      console.log(`${foundation.name} / ${program.program_name}: crawler error`);
    }
  }
}

const merged = mergeScanRecords(existing, deepRecords, scannedFoundationIds, activeFoundationIds);
await fs.writeFile(scanResultsPath, toCsv(merged), "utf8");

if (autoRotate && candidateFoundations.length) {
  await writeDeepScanState((startOffset + foundations.length) % candidateFoundations.length, candidateFoundations.length);
}

const crawlerFound = deepRecords.filter((record) => record.scan_status === "found").length;
const crawlerErrors = deepRecords.filter((record) => record.scan_status === "error").length;
console.log(`Deep scanned ${foundations.length} foundations from offset ${startOffset}. Crawler call records: ${crawlerFound}. Errors: ${crawlerErrors}.`);
if (autoRotate) console.log(`Next deep-scan offset: ${(startOffset + foundations.length) % candidateFoundations.length}.`);
console.log(`Merged ${merged.length} scan rows into ${scanResultsPath}`);
