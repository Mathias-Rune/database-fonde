import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createScrapeReviewRepository, validateScrapeDecision } from "./scrape_review_repository.mjs";
import { runSqlite } from "./sqlite_utils.mjs";

test("scrape decision validation rejects invalid and unsafe input", () => {
  assert.equal(validateScrapeDecision("1", "approve", "Ser korrekt ud").ok, true);
  assert.equal(validateScrapeDecision("not-a-number", "approve").statusCode, 400);
  assert.equal(validateScrapeDecision("1; drop table foundations", "approve").statusCode, 400);
  assert.equal(validateScrapeDecision(1, "maybe").statusCode, 400);
  assert.equal(validateScrapeDecision(1, "reject", "x".repeat(1001)).statusCode, 400);
});

test("manual approval atomically persists the field and audit decision", async (context) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "fonds-scrape-review-"));
  context.after(() => rm(tempDir, { recursive: true, force: true }));
  const sqlitePath = path.join(tempDir, "scrape.sqlite");
  await runSqlite(sqlitePath, `
    PRAGMA foreign_keys = ON;
    CREATE TABLE foundations (foundation_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO foundations VALUES ('fond-1', 'Testfonden');
  `, { cwd: tempDir });
  const repository = createScrapeReviewRepository({ sqlitePath, cwd: tempDir });
  await repository.listPending();
  await runSqlite(sqlitePath, `
    INSERT INTO scrape_runs (run_id, started_at) VALUES (1, '2026-07-31T10:00:00.000Z');
    INSERT INTO foundation_field_changes
      (run_id, foundation_id, field_name, new_value, source_url, confidence, detected_at)
    VALUES
      (1, 'fond-1', 'deadlines', '1. oktober 2026', 'https://example.test/frister', 0.82, '2026-07-31T10:01:00.000Z'),
      (1, 'fond-1', 'contact_info', 'Forkert kontakt', 'https://example.test/kontakt', 0.51, '2026-07-31T10:02:00.000Z');
  `, { cwd: tempDir });

  const approvedInput = validateScrapeDecision(1, "approve", "Kontrolleret på kilden");
  const approved = await repository.decide(approvedInput);
  assert.equal(approved.validation_status, "approved_manual");
  assert.equal(approved.decision_note, "Kontrolleret på kilden");

  const fields = await repository.listApprovedFields();
  assert.equal(fields.length, 1);
  assert.equal(fields[0].foundation_name, "Testfonden");
  assert.equal(fields[0].field_value, "1. oktober 2026");
  assert.equal(fields[0].validation_status, "approved_manual");
  assert.equal(fields[0].decision_note, "Kontrolleret på kilden");

  assert.equal(await repository.decide(approvedInput), undefined, "a decision cannot be applied twice");

  const rejected = await repository.decide(validateScrapeDecision(2, "reject", "Ikke relevant"));
  assert.equal(rejected.validation_status, "rejected");
  assert.equal((await repository.listApprovedFields()).length, 1, "rejection must not create an extracted field");
});
