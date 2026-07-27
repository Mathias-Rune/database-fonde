import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { createReviewRepository, validateReviewInput } from "./review_repository.mjs";
import { runSqlite } from "./sqlite_utils.mjs";

test("review input validation rejects unknown states and oversized notes", () => {
  assert.equal(validateReviewInput({ scan_result_id: "abc-123", review_status: "reviewed" }).ok, true);
  assert.equal(validateReviewInput({ scan_result_id: "abc-123", review_status: "approved" }).statusCode, 400);
  assert.equal(validateReviewInput({ scan_result_id: "../scan", review_status: "reviewed" }).statusCode, 400);
  assert.equal(validateReviewInput({ scan_result_id: "abc", review_status: "ignored", note: "x".repeat(1001) }).statusCode, 400);
});

test("SQLite review repository persists status and audit events", async (context) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fonds-review-"));
  context.after(() => rm(tempDir, { recursive: true, force: true }));
  const sqlitePath = path.join(tempDir, "reviews.sqlite");
  await runSqlite(sqlitePath, `
    create table call_scan_results (
      scan_result_id text primary key,
      review_status text not null default 'new'
    );
    insert into call_scan_results (scan_result_id) values ('scan-1');
  `, { cwd: tempDir });
  const repository = createReviewRepository({ databaseUrl: "", sqlitePath, cwd: tempDir, actor: "test_editor" });

  const first = await repository.update(validateReviewInput({ scan_result_id: "scan-1", review_status: "reviewed" }));
  assert.equal(first.review_status, "reviewed");
  assert.equal(first.reviewed_by, "test_editor");
  assert.equal((await repository.list())[0].review_status, "reviewed");

  await repository.update(validateReviewInput({ scan_result_id: "scan-1", review_status: "ignored", note: "Dublet" }));
  const events = await runSqlite(sqlitePath, "select previous_status, review_status from call_scan_review_events order by event_id", { cwd: tempDir });
  assert.deepEqual(events, [
    { previous_status: "new", review_status: "reviewed" },
    { previous_status: "reviewed", review_status: "ignored" },
  ]);
  assert.equal(await repository.update(validateReviewInput({ scan_result_id: "missing", review_status: "reviewed" })), undefined);
});

test("frontend no longer writes scan review overrides to localStorage", async () => {
  const source = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /saveJson\(["']fondsdb\.scanReviewOverrides/);
  assert.match(source, /fetch\(["']\/api\/call-reviews/);
  assert.match(source, /localStorage\.removeItem\(["']fondsdb\.scanReviewOverrides/);
});

test("Postgres review repository updates canonical data and audit history", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const repository = createReviewRepository({ databaseUrl, actor: "ci_editor" });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const reviews = await repository.list();
    assert.ok(reviews.length > 0);
    const original = reviews[0];
    const updated = await repository.update(validateReviewInput({
      scan_result_id: original.scan_result_id,
      review_status: "reviewed",
      note: "CI review",
    }));
    assert.equal(updated.review_status, "reviewed");
    assert.equal(updated.reviewed_by, "ci_editor");
    const events = await pool.query(
      "select review_status from call_scan_review_events where scan_result_id = $1 order by event_id desc limit 1",
      [original.scan_result_id],
    );
    assert.equal(events.rows[0].review_status, "reviewed");
    await repository.update(validateReviewInput({
      scan_result_id: original.scan_result_id,
      review_status: original.review_status,
      note: "Reset after CI",
    }));
  } finally {
    await repository.close();
    await pool.end();
  }
});
