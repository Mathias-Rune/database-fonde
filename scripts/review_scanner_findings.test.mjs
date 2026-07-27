import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSqlite } from "./sqlite_utils.mjs";
import {
  applyReviewDecisions,
  loadReviewData,
  parseCsv,
  validateDecisionCoverage,
} from "./review_scanner_findings.mjs";

const rootDir = path.dirname(path.dirname(new URL(import.meta.url).pathname));

test("parseCsv handles quoted commas", () => {
  const [row] = parseCsv('id,note\n1,"Relevant, officiel side"\n');
  assert.deepEqual(row, { id: "1", note: "Relevant, officiel side" });
});

test("review decisions cover exactly all 73 new findings", async () => {
  const { decisions, scans } = await loadReviewData();
  const result = validateDecisionCoverage(decisions, scans);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.total, 73);
  assert.deepEqual(result.counts, { reviewed: 40, ignored: 33 });
  const errorScan = scans.find((scan) => scan.scan_status === "error" && scan.review_status === "new");
  assert.ok(errorScan);
  assert.equal(decisions.some((decision) => decision.scan_result_id === errorScan.scan_result_id), false);
});

test("review decisions are idempotent and create an audit trail", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "fonds-review-decisions-"));
  const sqlitePath = path.join(temporaryDir, "fonds.sqlite");
  await fs.copyFile(path.join(rootDir, "outputs", "fonds_database.sqlite"), sqlitePath);
  await runSqlite(sqlitePath, `
    drop table if exists call_scan_review_events;
    drop table if exists call_scan_review_overrides;
  `, { cwd: rootDir });
  t.after(() => fs.rm(temporaryDir, { recursive: true, force: true }));

  const { decisions } = await loadReviewData();
  const first = await applyReviewDecisions(decisions, { sqlitePath, actor: "automated_test", cwd: rootDir });
  const second = await applyReviewDecisions(decisions, { sqlitePath, actor: "automated_test", cwd: rootDir });
  assert.deepEqual(first, { applied: 73, backend: "sqlite" });
  assert.deepEqual(second, { applied: 73, backend: "sqlite" });

  const [overrides] = await runSqlite(sqlitePath, `
    select count(*) as total,
      sum(case when review_status = 'reviewed' then 1 else 0 end) as reviewed,
      sum(case when review_status = 'ignored' then 1 else 0 end) as ignored
    from call_scan_review_overrides
  `, { cwd: rootDir });
  const [events] = await runSqlite(sqlitePath, "select count(*) as total from call_scan_review_events", { cwd: rootDir });
  assert.equal(overrides.total, 73);
  assert.equal(overrides.reviewed + overrides.ignored, 73);
  assert.equal(events.total, 73);
});
