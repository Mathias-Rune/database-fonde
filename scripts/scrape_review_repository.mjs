import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSqliteFile, runSqlite, sqlString } from "./sqlite_utils.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSchemaPath = path.join(scriptsDir, "..", "database", "scraping_schema.sql");
const allowedDecisions = new Set(["approve", "reject"]);

export function validateScrapeDecision(changeId, decision, note = "") {
  const normalizedId = Number(changeId);
  if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0) {
    return { ok: false, statusCode: 400, message: "Ugyldigt ændrings-id" };
  }
  if (!allowedDecisions.has(decision)) {
    return { ok: false, statusCode: 400, message: "Beslutningen skal være approve eller reject" };
  }
  if (typeof note !== "string" || note.length > 1000) {
    return { ok: false, statusCode: 400, message: "Noten må højst være 1000 tegn" };
  }
  return { ok: true, changeId: normalizedId, decision, note: note.trim() };
}

export function createScrapeReviewRepository({ sqlitePath, cwd = process.cwd(), schemaPath = defaultSchemaPath } = {}) {
  if (!sqlitePath) throw new Error("sqlitePath is required");

  async function ensureSchema() {
    await execSqliteFile(sqlitePath, schemaPath, { cwd: path.dirname(schemaPath) });
  }

  async function listPending() {
    await ensureSchema();
    return runSqlite(
      sqlitePath,
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
      { cwd },
    );
  }

  async function listApprovedFields() {
    await ensureSchema();
    return runSqlite(
      sqlitePath,
      `SELECT
         e.foundation_id,
         f.name AS foundation_name,
         e.field_name,
         e.field_value,
         e.source_url,
         e.confidence,
         e.updated_at,
         COALESCE((
           SELECT c.validation_status
           FROM foundation_field_changes c
           WHERE c.foundation_id = e.foundation_id
             AND c.field_name = e.field_name
             AND c.new_value = e.field_value
             AND c.validation_status IN ('approved_auto', 'approved_manual')
           ORDER BY c.change_id DESC
           LIMIT 1
         ), 'approved_auto') AS validation_status,
         (
           SELECT c.decided_at
           FROM foundation_field_changes c
           WHERE c.foundation_id = e.foundation_id
             AND c.field_name = e.field_name
             AND c.new_value = e.field_value
             AND c.validation_status = 'approved_manual'
           ORDER BY c.change_id DESC
           LIMIT 1
         ) AS decided_at,
         (
           SELECT c.decision_note
           FROM foundation_field_changes c
           WHERE c.foundation_id = e.foundation_id
             AND c.field_name = e.field_name
             AND c.new_value = e.field_value
             AND c.validation_status = 'approved_manual'
           ORDER BY c.change_id DESC
           LIMIT 1
         ) AS decision_note
       FROM foundation_extracted_fields e
       JOIN foundations f ON f.foundation_id = e.foundation_id
       ORDER BY e.updated_at DESC, f.name, e.field_name
       LIMIT 100;`,
      { cwd },
    );
  }

  async function decide(input) {
    await ensureSchema();
    const [existing] = await runSqlite(
      sqlitePath,
      `SELECT change_id FROM foundation_field_changes
       WHERE change_id = ${input.changeId} AND validation_status = 'manual_review';`,
      { cwd },
    );
    if (!existing) return undefined;

    const decidedAt = new Date().toISOString();
    const status = input.decision === "approve" ? "approved_manual" : "rejected";
    const defaultNote = input.decision === "approve"
      ? "Godkendt i lokal redaktørvisning"
      : "Afvist i lokal redaktørvisning";
    const decisionNote = input.note || defaultNote;

    if (input.decision === "approve") {
      await runSqlite(
        sqlitePath,
        `BEGIN IMMEDIATE;
         INSERT INTO foundation_extracted_fields
           (foundation_id, field_name, field_value, source_url, confidence, updated_at)
         SELECT foundation_id, field_name, new_value, source_url, confidence, ${sqlString(decidedAt)}
         FROM foundation_field_changes
         WHERE change_id = ${input.changeId} AND validation_status = 'manual_review'
         ON CONFLICT(foundation_id, field_name) DO UPDATE SET
           field_value = excluded.field_value,
           source_url = excluded.source_url,
           confidence = excluded.confidence,
           updated_at = excluded.updated_at;
         UPDATE foundation_field_changes
         SET validation_status = 'approved_manual',
             decided_at = ${sqlString(decidedAt)},
             decision_note = ${sqlString(decisionNote)}
         WHERE change_id = ${input.changeId} AND validation_status = 'manual_review';
         COMMIT;`,
        { cwd },
      );
    } else {
      await runSqlite(
        sqlitePath,
        `UPDATE foundation_field_changes
         SET validation_status = 'rejected',
             decided_at = ${sqlString(decidedAt)},
             decision_note = ${sqlString(decisionNote)}
         WHERE change_id = ${input.changeId} AND validation_status = 'manual_review';`,
        { cwd },
      );
    }

    const [updated] = await runSqlite(
      sqlitePath,
      `SELECT change_id, foundation_id, field_name, new_value, source_url, confidence,
              validation_status, decided_at, decision_note
       FROM foundation_field_changes
       WHERE change_id = ${input.changeId};`,
      { cwd },
    );
    return updated?.validation_status === status && updated?.decided_at === decidedAt ? updated : undefined;
  }

  return { listPending, listApprovedFields, decide };
}
