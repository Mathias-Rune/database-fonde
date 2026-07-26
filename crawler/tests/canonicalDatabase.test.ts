import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFoundationKey } from "../src/db/repository.js";
import { parseCsv, readCanonicalSeedData } from "../src/db/seedReader.js";
import { readSqliteOperationalData } from "../src/db/sqliteReader.js";

test("CSV parser preserves quoted commas and line breaks", () => {
  const records = parseCsv('id,name,note\n1,"Fond, A","Linje 1\nLinje 2"\n');
  assert.deepEqual(records, [{ id: "1", name: "Fond, A", note: "Linje 1\nLinje 2" }]);
});

test("canonical foundation keys are stable across URL path changes", () => {
  assert.equal(canonicalFoundationKey("https://www.example.org/apply"), "example-org");
  assert.equal(canonicalFoundationKey("https://example.org/grants?year=2026"), "example-org");
});

test("current seed data has valid canonical relationships", async () => {
  const data = await readCanonicalSeedData();
  const foundationIds = new Set(data.foundations.map((row) => row.foundation_id));
  const programIds = new Set(data.programs.map((row) => row.program_id));

  assert.ok(data.foundations.length > 0);
  assert.equal(foundationIds.size, data.foundations.length, "foundation_id must be unique");
  assert.equal(programIds.size, data.programs.length, "program_id must be unique");
  assert.ok(data.programs.every((row) => foundationIds.has(row.foundation_id)), "program references unknown foundation");
  assert.ok(data.deadlines.every((row) => programIds.has(row.program_id)), "deadline references unknown program");
  assert.ok(data.callScanResults.every((row) => foundationIds.has(row.foundation_id)), "scan references unknown foundation");
  assert.ok(
    data.callScanResults.every((row) => !row.program_id || programIds.has(row.program_id)),
    "scan references unknown program"
  );
});

test("SQLite scraper history is readable and internally related", async () => {
  const data = await readSqliteOperationalData();
  const runIds = new Set(data.scrapeRuns.map((row) => row.run_id));
  const subscriptionIds = new Set(data.notificationSubscriptions.map((row) => row.subscription_id));

  assert.ok(data.scrapeRuns.length > 0);
  assert.ok(data.scrapeSnapshots.every((row) => runIds.has(row.run_id)), "snapshot references unknown run");
  assert.ok(data.fieldChanges.every((row) => runIds.has(row.run_id)), "field change references unknown run");
  assert.ok(data.scrapeNotifications.every((row) => runIds.has(row.run_id)), "notification references unknown run");
  assert.ok(
    data.favoriteFoundations.every((row) => subscriptionIds.has(row.subscription_id)),
    "favorite references unknown subscription"
  );
});
