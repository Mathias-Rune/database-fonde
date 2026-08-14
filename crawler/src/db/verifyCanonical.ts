#!/usr/bin/env node
import { Pool } from "pg";
import { readCanonicalSeedData } from "./seedReader.js";
import { readSqliteOperationalData } from "./sqliteReader.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const [seed, sqlite] = await Promise.all([readCanonicalSeedData(), readSqliteOperationalData()]);
const pool = new Pool({ connectionString: databaseUrl });
try {
  const expected = new Map<string, number>([
    ["foundations", seed.foundations.length],
    ["programs", seed.programs.length],
    ["program_eligibility", seed.programEligibility.length],
    ["program_applicants", seed.programApplicants.length],
    ["program_exclusions", seed.programExclusions.length],
    ["deadlines", seed.deadlines.length],
    ["call_scan_results", seed.callScanResults.length],
    ["scrape_runs", sqlite.scrapeRuns.length],
    ["scrape_snapshots", sqlite.scrapeSnapshots.length],
    ["foundation_extracted_fields", sqlite.extractedFields.length],
    ["foundation_field_changes", sqlite.fieldChanges.length],
    ["scrape_notifications", sqlite.scrapeNotifications.length]
  ]);

  const results: Record<string, number> = {};
  for (const [table, minimum] of expected) {
    const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${table}`);
    const count = Number(result.rows[0].count);
    if (count < minimum) throw new Error(`${table}: expected at least ${minimum} rows, received ${count}`);
    results[table] = count;
  }

  const duplicateWebsites = await pool.query("select website from foundations group by website having count(*) > 1");
  if (duplicateWebsites.rowCount) throw new Error("Duplicate foundation websites found");

  const migrations = await pool.query<{ count: string }>("select count(*)::text as count from schema_migrations");
  if (Number(migrations.rows[0].count) < 5) throw new Error("Not all canonical migrations were applied");

  console.log(JSON.stringify({ ok: true, tables: results }, null, 2));
} finally {
  await pool.end();
}
