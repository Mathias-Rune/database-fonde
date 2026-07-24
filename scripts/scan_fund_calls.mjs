import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractContact } from "./contact_extractor.mjs";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const dataDir = path.join(root, "data");
const foundationsPath = path.join(dataDir, "fonde_seed.csv");
const programsPath = path.join(dataDir, "programs_seed.csv");
const outputPath = path.join(dataDir, "call_scan_results.csv");
const scannedAt = new Date().toISOString();

const headers = [
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

const callTerms = [
  "apply",
  "application",
  "call",
  "calls",
  "deadline",
  "grant",
  "grants",
  "open call",
  "ansoeg",
  "ansoegning",
  "ansøg",
  "ansøgning",
  "frist",
  "opslag",
  "pulje",
  "søg støtte",
  "soeg stoette",
  "uddeling",
];

const ignoredLinkTexts = new Set([
  "skip to content",
  "gå til indhold",
  "videre til indhold",
  "menu",
  "search",
  "søg",
]);

const commonApplicationPaths = [
  "/ansoegning/",
  "/ansogning/",
  "/soeg-stoette/",
  "/sog-stotte/",
  "/apply/",
  "/apply-for-funding/",
  "/apply-for-grants/",
  "/grants/",
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
  const rowHeaders = rows.shift();
  return rows.map((row) =>
    Object.fromEntries(rowHeaders.map((header, index) => [header, row[index] || ""])),
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records) {
  return [
    headers.join(","),
    ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(",")),
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

function mergeScanRecords(existingRecords, fastRecords, activeFoundationIds) {
  const activeExistingRecords = existingRecords.filter((record) => activeFoundationIds.has(record.foundation_id));
  const preservedCrawlerRecords = activeExistingRecords.filter(isCrawlerRecord);
  const reviewedFastRecords = preserveReviewStatuses(fastRecords, activeExistingRecords);
  return [...new Map([...preservedCrawlerRecords, ...reviewedFastRecords].map((record) => [record.scan_result_id, record])).values()]
    .sort((a, b) =>
      a.foundation_name.localeCompare(b.foundation_name, "da") ||
      a.program_name.localeCompare(b.program_name, "da") ||
      a.discovered_title.localeCompare(b.discovered_title, "da")
    );
}

function normalizeText(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#8211;", "-")
    .replaceAll("&#8212;", "-")
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replaceAll(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function stableId(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
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

function homepage(value) {
  try {
    const url = new URL(value);
    return `${url.origin}/`;
  } catch {
    return "";
  }
}

function urlCandidates(program, foundation) {
  const primaryUrls = [
    program.application_url,
    program.source_url,
    foundation.application_url,
    foundation.source_url,
  ].map(normalizeUrl).filter(Boolean);
  const websiteUrls = [foundation.website].map(normalizeUrl).filter(Boolean);
  const seedUrls = [...new Set([...primaryUrls, ...websiteUrls])];
  const homepages = [...new Set(seedUrls.map(homepage).filter(Boolean))];
  const guessedUrls = homepages.flatMap((base) => commonApplicationPaths.map((item) => normalizeUrl(new URL(item, base).toString())));
  return [...new Set([...primaryUrls, ...websiteUrls, ...guessedUrls])].slice(0, 3);
}

function findMatchingLinks(html, baseUrl) {
  const links = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html))) {
    const href = match[1];
    const text = normalizeText(match[2]);
    const url = absoluteUrl(baseUrl, href);
    const haystack = `${text} ${url}`.toLocaleLowerCase("da");
    const term = callTerms.find((item) => haystack.includes(item));

    if (
      url &&
      text &&
      term &&
      !url.startsWith("mailto:") &&
      !text.includes("{{") &&
      !url.toLocaleLowerCase("da").includes("%7b") &&
      !ignoredLinkTexts.has(text.toLocaleLowerCase("da")) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
    ) {
      links.push({
        match_type: "call_link",
        discovered_title: text.slice(0, 180),
        discovered_url: url,
        excerpt: `Matchede "${term}" i linktekst eller URL.`,
      });
    }
  }

  return links;
}

function findPageMatches(html) {
  const text = normalizeText(html);
  const lower = text.toLocaleLowerCase("da");
  const term = callTerms.find((item) => lower.includes(item));

  if (!term) return [];

  const index = lower.indexOf(term);
  const excerpt = text.slice(Math.max(index - 90, 0), index + 220);
  return [{
    match_type: "page_text",
    discovered_title: "Muligt opslag fundet på siden",
    discovered_url: "",
    excerpt,
  }];
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 DanskFondsdatabaseCallScanner/0.2",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, method: "fetch" };
  } finally {
    clearTimeout(timeout);
  }
}

async function curlText(url) {
  const { stdout } = await execFileAsync("curl", [
    "-L",
    "-k",
    "--compressed",
    "--connect-timeout",
    "4",
    "--max-time",
    "6",
    "-A",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 DanskFondsdatabaseCallScanner/0.2",
    "-H",
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H",
    "Accept-Language: da-DK,da;q=0.9,en-US;q=0.8,en;q=0.7",
    "-w",
    "\n__HTTP_STATUS__:%{http_code}",
    url,
  ], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 8000,
    killSignal: "SIGKILL",
  });
  const marker = "\n__HTTP_STATUS__:";
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex === -1) {
    return { ok: false, status: 0, text: stdout, method: "curl" };
  }
  const text = stdout.slice(0, markerIndex);
  const status = Number(stdout.slice(markerIndex + marker.length).trim());
  return { ok: status >= 200 && status < 400, status, text, method: "curl" };
}

async function getText(url) {
  try {
    const result = await fetchText(url);
    if (result.ok) return result;
    if (result.status >= 500 || result.status === 403) {
      const curlResult = await curlText(url);
      if (curlResult.ok) return curlResult;
    }
    return result;
  } catch (error) {
    try {
      const curlResult = await curlText(url);
      if (curlResult.ok) return curlResult;
      return { ...curlResult, error: error.message };
    } catch (curlError) {
      throw new Error(`${error.message}; curl fallback: ${curlError.message}`);
    }
  }
}

function makeRecord({ foundation, program, scanUrl, match, contact = {}, status = "found" }) {
  return {
    scan_result_id: stableId([foundation.foundation_id, program.program_id, scanUrl, match.discovered_title, match.discovered_url, match.excerpt]),
    foundation_id: foundation.foundation_id,
    program_id: program.program_id,
    foundation_name: foundation.name,
    program_name: program.program_name,
    scan_url: scanUrl,
    scan_status: status,
    match_type: match.match_type,
    discovered_title: match.discovered_title,
    discovered_url: match.discovered_url || scanUrl,
    excerpt: match.excerpt,
    contact_name: contact.contact_name || "",
    contact_email: contact.contact_email || "",
    contact_phone: contact.contact_phone || "",
    contact_source_url: contact.contact_source_url || "",
    scanned_at: scannedAt,
    review_status: status === "no_match" ? "ignored" : "new",
  };
}

async function scanProgram(program, foundation) {
  const candidates = urlCandidates(program, foundation);
  if (!candidates.length) {
    return [{
      foundation_id: foundation.foundation_id,
      program_id: program.program_id,
      foundation_name: foundation.name,
      program_name: program.program_name,
      scan_url: "",
      scan_status: "error",
      match_type: "missing_url",
      discovered_title: "Mangler URL",
      discovered_url: "",
      excerpt: "Der findes ingen URL at scanne.",
      scanned_at: scannedAt,
      review_status: "new",
    }];
  }

  const failures = [];

  for (const scanUrl of candidates) {
    let result;
    try {
      result = await getText(scanUrl);
    } catch (error) {
      failures.push(`${scanUrl}: ${error.message}`);
      continue;
    }

    if (!result.ok) {
      failures.push(`${scanUrl}: HTTP ${result.status}`);
      continue;
    }

    const pageContact = extractContact(result.text, scanUrl);
    const matches = [...findMatchingLinks(result.text, scanUrl), ...findPageMatches(result.text)]
      .slice(0, 5);

    if (!matches.length) {
      return [makeRecord({
        foundation,
        program,
        scanUrl,
        status: "no_match",
        match: {
          match_type: "no_match",
          discovered_title: "Ingen call-match fundet",
          discovered_url: "",
          excerpt: "Siden blev scannet, men der blev ikke fundet tydelige call-, frist- eller ansøgningsmatches.",
        },
      })];
    }

    const detailedRecords = [];
    for (const match of matches) {
      let contact = pageContact;
      const detailUrl = normalizeUrl(match.discovered_url);
      if (!contact.contact_name && detailUrl && detailUrl !== scanUrl && !/login|grant\.nu/i.test(detailUrl)) {
        try {
          const detail = await getText(detailUrl);
          if (detail.ok) contact = extractContact(detail.text, detailUrl);
        } catch {
          // Kontaktopslag må ikke gøre et ellers gyldigt call-fund til en scanfejl.
        }
      }
      detailedRecords.push(makeRecord({ foundation, program, scanUrl, match, contact }));
    }
    return detailedRecords;
  }

  const scanUrl = candidates[0];
  try {
    throw new Error(failures.slice(0, 4).join(" | "));
  } catch (error) {
    return [{
      scan_result_id: stableId([foundation.foundation_id, program.program_id, scanUrl, "error"]),
      foundation_id: foundation.foundation_id,
      program_id: program.program_id,
      foundation_name: foundation.name,
      program_name: program.program_name,
      scan_url: scanUrl,
      scan_status: "error",
      match_type: "fetch_error",
      discovered_title: "Scan fejlede",
      discovered_url: scanUrl,
      excerpt: error.message,
      scanned_at: scannedAt,
      review_status: "new",
    }];
  }
}

const [foundationText, programText, existingText] = await Promise.all([
  fs.readFile(foundationsPath, "utf8"),
  fs.readFile(programsPath, "utf8"),
  fs.readFile(outputPath, "utf8").catch(() => `${headers.join(",")}\n`),
]);

const foundations = csvToObjects(foundationText);
const programs = csvToObjects(programText);
const existingRecords = csvToObjects(existingText);
const foundationById = new Map(foundations.map((foundation) => [foundation.foundation_id, foundation]));
const activeFoundationIds = new Set(foundations.map((foundation) => foundation.foundation_id));
const records = [];

for (const program of programs) {
  const foundation = foundationById.get(program.foundation_id);
  if (!foundation) continue;
  const programRecords = await scanProgram(program, foundation);
  const foundCount = programRecords.filter((record) => record.scan_status === "found").length;
  const errorCount = programRecords.filter((record) => record.scan_status === "error").length;
  console.log(`${foundation.name}: ${foundCount} fund, ${errorCount} fejl`);
  records.push(...programRecords);
}

const uniqueRecords = mergeScanRecords(existingRecords, records, activeFoundationIds);

await fs.writeFile(outputPath, toCsv(uniqueRecords), "utf8");
const fastFound = records.filter((record) => record.scan_status === "found").length;
const fastErrors = records.filter((record) => record.scan_status === "error").length;
const crawlerPreserved = uniqueRecords.filter(isCrawlerRecord).length;
console.log(`Scanned ${programs.length} programs. Found ${fastFound} possible call matches. Errors: ${fastErrors}.`);
console.log(`Preserved ${crawlerPreserved} crawler rows while updating fast-scan rows.`);
console.log(`Saved ${outputPath}`);
