import path from "node:path";
import { Pool } from "pg";
import { runSqlite, sqlString } from "./sqlite_utils.mjs";

const reviewStatuses = new Set(["new", "reviewed", "ignored"]);

export function validateReviewInput(input) {
  const scanResultId = typeof input?.scan_result_id === "string" ? input.scan_result_id.trim() : "";
  const reviewStatus = typeof input?.review_status === "string" ? input.review_status.trim() : "";
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(scanResultId)) {
    return { ok: false, statusCode: 400, message: "Ugyldigt scan_result_id" };
  }
  if (!reviewStatuses.has(reviewStatus)) {
    return { ok: false, statusCode: 400, message: "Ugyldig review_status" };
  }
  if (note.length > 1000) {
    return { ok: false, statusCode: 400, message: "Reviewnoten må højst være 1000 tegn" };
  }
  return { ok: true, scanResultId, reviewStatus, note };
}

export function createReviewRepository({
  databaseUrl = process.env.DATABASE_URL,
  sqlitePath,
  cwd = process.cwd(),
  actor = process.env.REVIEW_ACTOR || "local_admin",
} = {}) {
  if (databaseUrl) return new PostgresReviewRepository(databaseUrl, actor);
  if (!sqlitePath) throw new Error("sqlitePath is required when DATABASE_URL is not configured");
  return new SqliteReviewRepository(path.resolve(sqlitePath), cwd, actor);
}

class PostgresReviewRepository {
  constructor(databaseUrl, actor) {
    this.backend = "postgres";
    this.actor = actor;
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async list() {
    const result = await this.pool.query(`
      select scan_result_id, review_status, reviewed_at, reviewed_by, review_note
      from call_scan_results
      order by scanned_at desc, scan_result_id
    `);
    return result.rows;
  }

  async update(input) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(
        "select scan_result_id, review_status, reviewed_at, reviewed_by, review_note from call_scan_results where scan_result_id = $1 for update",
        [input.scanResultId],
      );
      if (current.rowCount === 0) {
        await client.query("rollback");
        return undefined;
      }
      if (current.rows[0].review_status === input.reviewStatus && (current.rows[0].review_note || "") === input.note) {
        await client.query("commit");
        return current.rows[0];
      }
      const reviewedAt = new Date().toISOString();
      const updated = await client.query(`
        update call_scan_results
        set review_status = $2, reviewed_at = $3, reviewed_by = $4, review_note = nullif($5, '')
        where scan_result_id = $1
        returning scan_result_id, review_status, reviewed_at, reviewed_by, review_note
      `, [input.scanResultId, input.reviewStatus, reviewedAt, this.actor, input.note]);
      await client.query(`
        insert into call_scan_review_events (
          scan_result_id, previous_status, review_status, reviewed_at, reviewed_by, review_note
        ) values ($1, $2, $3, $4, $5, nullif($6, ''))
      `, [input.scanResultId, current.rows[0].review_status, input.reviewStatus, reviewedAt, this.actor, input.note]);
      await client.query("commit");
      return updated.rows[0];
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class SqliteReviewRepository {
  constructor(sqlitePath, cwd, actor) {
    this.backend = "sqlite";
    this.sqlitePath = sqlitePath;
    this.cwd = cwd;
    this.actor = actor;
    this.ready = this.ensureSchema();
  }

  async ensureSchema() {
    await runSqlite(this.sqlitePath, `
      create table if not exists call_scan_review_overrides (
        scan_result_id text primary key,
        review_status text not null check (review_status in ('new', 'reviewed', 'ignored')),
        reviewed_at text not null,
        reviewed_by text not null,
        review_note text
      );
      create table if not exists call_scan_review_events (
        event_id integer primary key autoincrement,
        scan_result_id text not null,
        previous_status text not null,
        review_status text not null,
        reviewed_at text not null,
        reviewed_by text not null,
        review_note text
      );
    `, { cwd: this.cwd });
  }

  async list() {
    await this.ready;
    return runSqlite(this.sqlitePath, `
      select scan_result_id, review_status, reviewed_at, reviewed_by, review_note
      from call_scan_review_overrides
      order by reviewed_at desc, scan_result_id
    `, { cwd: this.cwd });
  }

  async update(input) {
    await this.ready;
    const existingScan = await runSqlite(this.sqlitePath, `
      select review_status from call_scan_results where scan_result_id = ${sqlString(input.scanResultId)}
    `, { cwd: this.cwd });
    if (existingScan.length === 0) return undefined;
    const overrides = await runSqlite(this.sqlitePath, `
      select review_status, review_note from call_scan_review_overrides where scan_result_id = ${sqlString(input.scanResultId)}
    `, { cwd: this.cwd });
    const previousStatus = overrides[0]?.review_status || existingScan[0].review_status || "new";
    if (previousStatus === input.reviewStatus && (overrides[0]?.review_note || "") === input.note) {
      return overrides[0] || {
        scan_result_id: input.scanResultId,
        review_status: previousStatus,
        reviewed_at: null,
        reviewed_by: null,
        review_note: null,
      };
    }
    const reviewedAt = new Date().toISOString();
    await runSqlite(this.sqlitePath, `
      begin immediate;
      insert into call_scan_review_overrides (
        scan_result_id, review_status, reviewed_at, reviewed_by, review_note
      ) values (
        ${sqlString(input.scanResultId)}, ${sqlString(input.reviewStatus)}, ${sqlString(reviewedAt)},
        ${sqlString(this.actor)}, ${sqlString(input.note || null)}
      ) on conflict(scan_result_id) do update set
        review_status = excluded.review_status,
        reviewed_at = excluded.reviewed_at,
        reviewed_by = excluded.reviewed_by,
        review_note = excluded.review_note;
      insert into call_scan_review_events (
        scan_result_id, previous_status, review_status, reviewed_at, reviewed_by, review_note
      ) values (
        ${sqlString(input.scanResultId)}, ${sqlString(previousStatus)}, ${sqlString(input.reviewStatus)},
        ${sqlString(reviewedAt)}, ${sqlString(this.actor)}, ${sqlString(input.note || null)}
      );
      commit;
    `, { cwd: this.cwd });
    return {
      scan_result_id: input.scanResultId,
      review_status: input.reviewStatus,
      reviewed_at: reviewedAt,
      reviewed_by: this.actor,
      review_note: input.note || null,
    };
  }

  async close() {}
}
