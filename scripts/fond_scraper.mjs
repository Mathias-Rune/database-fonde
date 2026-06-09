import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execSqliteFile, runSqlite, sqlString } from "./sqlite_utils.mjs";

const rootDir = process.cwd();
const dbPath = path.join(rootDir, "outputs", "fonds_database.sqlite");
const schemaPath = path.join(rootDir, "database", "scraping_schema.sql");
const reportDir = path.join(rootDir, "reports");
const reportPath = path.join(reportDir, "scrape-run-report.json");
const timeoutMs = Number(process.env.SCRAPER_TIMEOUT_MS || 15000);
const limit = Number(process.env.SCRAPER_LIMIT || 0);
const forceParse = process.env.SCRAPER_FORCE_PARSE === "true";
const dryRun = process.argv.includes("--dry-run");

const fieldLabels = {
  deadlines: "Ansøgningsfrister",
  funding_amounts: "Støttebeløb eller beløbsrammer",
  contact_info: "Kontaktoplysninger",
  purpose_criteria: "Formål, målgruppe og støttekriterier",
};

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&aring;/g, "å")
    .replace(/&aelig;/g, "æ")
    .replace(/&oslash;/g, "ø")
    .replace(/&Aring;/g, "Å")
    .replace(/&AElig;/g, "Æ")
    .replace(/&Oslash;/g, "Ø")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|tr|td)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join("\n");
}

function compactLineCandidates(text) {
  const rough = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map(normalizeWhitespace)
    .filter((line) => line.length >= 20 && line.length <= 360)
    .filter((line) => {
      const lower = line.toLocaleLowerCase("da");
      const noisyTerms = ["cookie", "datapolitik", "instagram", "linkedin", "search for", "ledige stillinger"];
      return !noisyTerms.some((term) => lower.includes(term));
    });
  return [...new Set(rough)];
}

function findMatches(lines, keywords, limitPerField = 5) {
  const matches = [];
  for (const line of lines) {
    const lower = line.toLocaleLowerCase("da");
    if (keywords.some((keyword) => lower.includes(keyword))) {
      matches.push(line);
    }
    if (matches.length >= limitPerField) break;
  }
  return matches;
}

function extractFields(text) {
  const lines = compactLineCandidates(text);
  const emailMatches = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]);
  const phoneMatches = [...text.matchAll(/(?:\+45\s?)?(?:\d{2}\s?){4}/g)].map((match) => match[0].trim());

  const fields = {
    deadlines: {
      value: findMatches(lines, ["ansøgningsfrist", "ansøgningsfrister", "frist", "deadline", "ansøg inden", "puljen lukker"]).join("\n"),
      confidence: 0.72,
    },
    funding_amounts: {
      value: findMatches(lines, ["kr.", "kroner", "beløb", "beløbsramme", "bevilling", "støttebeløb", "mio.", "million"]).join("\n"),
      confidence: 0.68,
    },
    contact_info: {
      value: [...new Set([...emailMatches, ...phoneMatches, ...findMatches(lines, ["kontakt", "kontaktperson", "telefon", "e-mail", "mail"], 4)])].join("\n"),
      confidence: emailMatches.length || phoneMatches.length ? 0.86 : 0.62,
    },
    purpose_criteria: {
      value: findMatches(lines, ["formål", "målgruppe", "kriterier", "støtter", "kan søge", "ansøgere", "projekter", "indsats"]).join("\n"),
      confidence: 0.7,
    },
  };

  return Object.fromEntries(
    Object.entries(fields)
      .map(([field, result]) => [field, { ...result, value: normalizeWhitespace(result.value) }])
      .filter(([, result]) => result.value.length > 0),
  );
}

function similarity(a, b) {
  const aWords = new Set(normalizeWhitespace(a).toLocaleLowerCase("da").split(/\W+/).filter(Boolean));
  const bWords = new Set(normalizeWhitespace(b).toLocaleLowerCase("da").split(/\W+/).filter(Boolean));
  if (!aWords.size && !bWords.size) return 1;
  const intersection = [...aWords].filter((word) => bWords.has(word)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return intersection / union;
}

function classifyChange(fieldName, oldValue, newValue, confidence) {
  const sim = similarity(oldValue, newValue);
  const hasDateOrAmount = /\b\d{1,2}[./-]\d{1,2}|\b20\d{2}\b|\b\d+([.,]\d+)?\s*(kr\.|kroner|mio|million)/i.test(newValue);
  const significance = fieldName === "deadlines" || fieldName === "funding_amounts" || hasDateOrAmount ? "high" : sim > 0.82 ? "low" : "medium";
  const validationStatus =
    !oldValue && confidence >= 0.88
      ? "approved_auto"
      : oldValue && sim >= 0.88 && confidence >= 0.78
        ? "approved_auto"
        : "manual_review";

  return { significance, validationStatus, similarity: sim };
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "database-fonde-scraper/1.0" },
    });
    const html = await response.text();
    const text = htmlToText(html);
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      html,
      text,
      hash: crypto.createHash("sha256").update(html).digest("hex"),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      html: "",
      text: "",
      hash: "",
      error: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureSchema() {
  await execSqliteFile(dbPath, schemaPath, { cwd: rootDir });
}

async function createRun() {
  const now = new Date().toISOString();
  const [row] = await runSqlite(dbPath, `INSERT INTO scrape_runs (started_at) VALUES (${sqlString(now)}) RETURNING run_id;`);
  return row.run_id;
}

async function getTargets() {
  const rows = await runSqlite(
    dbPath,
    "SELECT foundation_id, name, website, application_url, source_url FROM foundations ORDER BY name;",
  );
  return limit > 0 ? rows.slice(0, limit) : rows;
}

async function latestHash(foundationId, url) {
  const [row] = await runSqlite(
    dbPath,
    `SELECT content_hash FROM scrape_snapshots WHERE foundation_id = ${sqlString(foundationId)} AND url = ${sqlString(url)} AND content_hash IS NOT NULL ORDER BY snapshot_id DESC LIMIT 1;`,
  );
  return row?.content_hash || "";
}

async function currentFieldValue(foundationId, fieldName) {
  const [row] = await runSqlite(
    dbPath,
    `SELECT field_value FROM foundation_extracted_fields WHERE foundation_id = ${sqlString(foundationId)} AND field_name = ${sqlString(fieldName)};`,
  );
  return row?.field_value || "";
}

async function recordSnapshot(runId, foundation, page, changed) {
  await runSqlite(
    dbPath,
    `INSERT INTO scrape_snapshots (run_id, foundation_id, url, fetched_at, http_status, content_hash, content_text, changed_since_last, error_message)
     VALUES (${runId}, ${sqlString(foundation.foundation_id)}, ${sqlString(page.finalUrl)}, ${sqlString(new Date().toISOString())}, ${page.status ?? "NULL"}, ${sqlString(page.hash)}, ${sqlString(page.text.slice(0, 50000))}, ${changed ? 1 : 0}, ${sqlString(page.error)});`,
  );
}

async function upsertExtractedField(foundationId, fieldName, value, sourceUrl, confidence) {
  await runSqlite(
    dbPath,
    `INSERT INTO foundation_extracted_fields (foundation_id, field_name, field_value, source_url, confidence, updated_at)
     VALUES (${sqlString(foundationId)}, ${sqlString(fieldName)}, ${sqlString(value)}, ${sqlString(sourceUrl)}, ${confidence}, ${sqlString(new Date().toISOString())})
     ON CONFLICT(foundation_id, field_name) DO UPDATE SET
       field_value = excluded.field_value,
       source_url = excluded.source_url,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at;`,
  );
}

async function recordFieldChange(runId, foundationId, fieldName, oldValue, newValue, sourceUrl, confidence, validation) {
  await runSqlite(
    dbPath,
    `INSERT INTO foundation_field_changes (run_id, foundation_id, field_name, old_value, new_value, source_url, confidence, significance, validation_status, detected_at)
     VALUES (${runId}, ${sqlString(foundationId)}, ${sqlString(fieldName)}, ${sqlString(oldValue)}, ${sqlString(newValue)}, ${sqlString(sourceUrl)}, ${confidence}, ${sqlString(validation.significance)}, ${sqlString(validation.validationStatus)}, ${sqlString(new Date().toISOString())});`,
  );

  if (validation.validationStatus === "approved_auto") {
    await upsertExtractedField(foundationId, fieldName, newValue, sourceUrl, confidence);
  }
}

function urlsForFoundation(foundation) {
  return [...new Set([foundation.application_url, foundation.source_url, foundation.website].filter(Boolean))];
}

async function updateRun(runId, summary, status = "completed", errorMessage = "") {
  await runSqlite(
    dbPath,
    `UPDATE scrape_runs SET
      finished_at = ${sqlString(new Date().toISOString())},
      status = ${sqlString(status)},
      targets_checked = ${summary.targets_checked},
      changed_pages = ${summary.changed_pages},
      changes_detected = ${summary.changes_detected},
      auto_approved = ${summary.auto_approved},
      manual_review = ${summary.manual_review},
      error_message = ${sqlString(errorMessage)}
     WHERE run_id = ${runId};`,
  );
}

async function createNotification(runId, summary, pendingExamples) {
  if (summary.changes_detected === 0) return;
  const subject = `Fondsdatabase: ${summary.changes_detected} ændringer fundet`;
  const body = [
    `Scraperen fandt ${summary.changes_detected} mulige ændringer.`,
    `${summary.auto_approved} blev auto-godkendt.`,
    `${summary.manual_review} kræver manuel gennemgang.`,
    "",
    ...pendingExamples.map((change) => `- ${change.foundation_name}: ${fieldLabels[change.field_name]} (${change.significance})`),
  ].join("\n");

  await runSqlite(
    dbPath,
    `INSERT INTO scrape_notifications (run_id, subject, body, created_at, status)
     VALUES (${runId}, ${sqlString(subject)}, ${sqlString(body)}, ${sqlString(new Date().toISOString())}, 'queued');`,
  );
}

await ensureSchema();
const runId = await createRun();
const summary = {
  run_id: runId,
  dry_run: dryRun,
  targets_checked: 0,
  changed_pages: 0,
  changes_detected: 0,
  auto_approved: 0,
  manual_review: 0,
  fetch_errors: 0,
};
const detected = [];

try {
  const targets = await getTargets();

  for (const foundation of targets) {
    summary.targets_checked += 1;
    const bestExtractions = new Map();

    for (const url of urlsForFoundation(foundation)) {
      const page = await fetchPage(url);
      if (!page.ok) {
        summary.fetch_errors += 1;
      }

      const previousHash = await latestHash(foundation.foundation_id, page.finalUrl || url);
      const changed = !!page.hash && page.hash !== previousHash;
      if (changed) summary.changed_pages += 1;

      if (!dryRun) {
        await recordSnapshot(runId, foundation, page, changed);
      }

      if (!page.ok || !page.text || (!forceParse && !changed && previousHash)) continue;

      const extracted = extractFields(page.text);
      for (const [fieldName, extraction] of Object.entries(extracted)) {
        const sourcePriority = page.finalUrl === foundation.application_url || page.finalUrl === foundation.source_url ? 0.12 : 0;
        const score = extraction.confidence + sourcePriority - Math.max(0, extraction.value.length - 900) / 5000;
        const current = bestExtractions.get(fieldName);
        if (!current || score > current.score) {
          bestExtractions.set(fieldName, {
            ...extraction,
            source_url: page.finalUrl,
            score,
          });
        }
      }
    }

    for (const [fieldName, extraction] of bestExtractions.entries()) {
      const oldValue = await currentFieldValue(foundation.foundation_id, fieldName);
      if (normalizeWhitespace(oldValue) === normalizeWhitespace(extraction.value)) continue;

      const validation = classifyChange(fieldName, oldValue, extraction.value, extraction.confidence);
      summary.changes_detected += 1;
      summary[validation.validationStatus === "approved_auto" ? "auto_approved" : "manual_review"] += 1;

      const change = {
        foundation_id: foundation.foundation_id,
        foundation_name: foundation.name,
        field_name: fieldName,
        old_value: oldValue,
        new_value: extraction.value,
        source_url: extraction.source_url,
        confidence: extraction.confidence,
        significance: validation.significance,
        validation_status: validation.validationStatus,
      };
      detected.push(change);

      if (!dryRun) {
        await recordFieldChange(
          runId,
          foundation.foundation_id,
          fieldName,
          oldValue,
          extraction.value,
          extraction.source_url,
          extraction.confidence,
          validation,
        );
      }
    }
  }

  if (!dryRun) {
    await createNotification(runId, summary, detected.filter((change) => change.validation_status === "manual_review").slice(0, 10));
    await updateRun(runId, summary);
  } else {
    await updateRun(runId, summary);
  }

  const report = {
    generated_at: new Date().toISOString(),
    ...summary,
    detected_changes: detected.slice(0, 100),
  };
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await updateRun(runId, summary, "failed", error.message);
  throw error;
}
