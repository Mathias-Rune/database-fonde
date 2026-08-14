#!/usr/bin/env node
import { Pool, type PoolClient } from "pg";
import { importSqliteOperationalData } from "./importSqlite.js";
import { readCanonicalSeedData } from "./seedReader.js";
import { readSqliteOperationalData } from "./sqliteReader.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const data = await readCanonicalSeedData();
const sqliteData = await readSqliteOperationalData();
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("begin");
  await importFoundations(client, data.foundations);
  await importPrograms(client, data.programs);
  await importProgramEligibility(client, data.programEligibility);
  await importProgramApplicants(client, data.programApplicants);
  await importProgramExclusions(client, data.programExclusions);
  await importDeadlines(client, data.deadlines);
  await importCallScans(client, data.callScanResults);
  await importSqliteOperationalData(client, sqliteData);
  await client.query("commit");
  console.log(JSON.stringify({
    foundations: data.foundations.length,
    programs: data.programs.length,
    program_eligibility: data.programEligibility.length,
    program_applicants: data.programApplicants.length,
    program_exclusions: data.programExclusions.length,
    deadlines: data.deadlines.length,
    call_scan_results: data.callScanResults.length,
    scrape_runs: sqliteData.scrapeRuns.length,
    scrape_snapshots: sqliteData.scrapeSnapshots.length,
    field_changes: sqliteData.fieldChanges.length
  }, null, 2));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function importFoundations(client: PoolClient, records: Record<string, string>[]) {
  await client.query(`
    update foundations f
    set foundation_key = seed.foundation_id, updated_at = now()
    from jsonb_to_recordset($1::jsonb) as seed(foundation_id text, website text)
    where f.website = seed.website and f.foundation_key <> seed.foundation_id
  `, [JSON.stringify(records)]);
  const result = await client.query(`
    insert into foundations (
      foundation_key, name, legal_type, regulator, country, city, website, application_url,
      support_areas, applicant_types, deadline_model, notes, source_url, last_checked, verification_status
    )
    select foundation_id, name, nullif(legal_type, ''), nullif(regulator, ''), coalesce(nullif(country, ''), 'Danmark'),
      nullif(city, ''), website, nullif(application_url, ''), nullif(support_areas, ''), nullif(applicant_types, ''),
      nullif(deadline_model, ''), nullif(notes, ''), nullif(source_url, ''), nullif(last_checked, '')::date,
      coalesce(nullif(verification_status, ''), 'to_verify')
    from jsonb_to_recordset($1::jsonb) as seed(
      foundation_id text, name text, legal_type text, regulator text, country text, city text, website text,
      application_url text, support_areas text, applicant_types text, deadline_model text, notes text,
      source_url text, last_checked text, verification_status text
    )
    on conflict (foundation_key) do update set
      name = excluded.name, legal_type = excluded.legal_type, regulator = excluded.regulator,
      country = excluded.country, city = excluded.city, website = excluded.website,
      application_url = excluded.application_url, support_areas = excluded.support_areas,
      applicant_types = excluded.applicant_types, deadline_model = excluded.deadline_model,
      notes = excluded.notes, source_url = excluded.source_url, last_checked = excluded.last_checked,
      verification_status = excluded.verification_status, updated_at = now()
  `, [JSON.stringify(records)]);
  assertImported("foundations", result.rowCount, records.length);
}

async function importPrograms(client: PoolClient, records: Record<string, string>[]) {
  const result = await client.query(`
    insert into programs (
      program_key, foundation_id, program_name, program_type, support_areas, applicant_types, geography,
      funding_use, amount_range, application_status, deadline_summary, application_url, source_url,
      last_checked, verification_status, notes
    )
    select seed.program_id, f.id, seed.program_name, nullif(seed.program_type, ''), nullif(seed.support_areas, ''),
      nullif(seed.applicant_types, ''), nullif(seed.geography, ''), nullif(seed.funding_use, ''),
      nullif(seed.amount_range, ''), nullif(seed.application_status, ''), nullif(seed.deadline_summary, ''),
      nullif(seed.application_url, ''), nullif(seed.source_url, ''), nullif(seed.last_checked, '')::date,
      coalesce(nullif(seed.verification_status, ''), 'to_verify'), nullif(seed.notes, '')
    from jsonb_to_recordset($1::jsonb) as seed(
      program_id text, foundation_id text, program_name text, program_type text, support_areas text,
      applicant_types text, geography text, funding_use text, amount_range text, application_status text,
      deadline_summary text, application_url text, source_url text, last_checked text,
      verification_status text, notes text
    )
    join foundations f on f.foundation_key = seed.foundation_id
    on conflict (program_key) do update set
      foundation_id = excluded.foundation_id, program_name = excluded.program_name, program_type = excluded.program_type,
      support_areas = excluded.support_areas, applicant_types = excluded.applicant_types, geography = excluded.geography,
      funding_use = excluded.funding_use, amount_range = excluded.amount_range,
      application_status = excluded.application_status, deadline_summary = excluded.deadline_summary,
      application_url = excluded.application_url, source_url = excluded.source_url,
      last_checked = excluded.last_checked, verification_status = excluded.verification_status,
      notes = excluded.notes, updated_at = now()
  `, [JSON.stringify(records)]);
  assertImported("programs", result.rowCount, records.length);
}

async function importDeadlines(client: PoolClient, records: Record<string, string>[]) {
  const result = await client.query(`
    insert into deadlines (
      deadline_key, program_id, deadline_type, status, opens_on, closes_on, recurrence,
      summary, last_checked, verification_status
    )
    select seed.deadline_id, p.id, nullif(seed.deadline_type, ''), coalesce(nullif(seed.status, ''), 'to_verify'),
      nullif(seed.opens_on, '')::date, nullif(seed.closes_on, '')::date, nullif(seed.recurrence, ''),
      nullif(seed.summary, ''), nullif(seed.last_checked, '')::date,
      coalesce(nullif(seed.verification_status, ''), 'to_verify')
    from jsonb_to_recordset($1::jsonb) as seed(
      deadline_id text, program_id text, deadline_type text, status text, opens_on text, closes_on text,
      recurrence text, summary text, last_checked text, verification_status text
    )
    join programs p on p.program_key = seed.program_id
    on conflict (deadline_key) do update set
      program_id = excluded.program_id, deadline_type = excluded.deadline_type, status = excluded.status,
      opens_on = excluded.opens_on, closes_on = excluded.closes_on, recurrence = excluded.recurrence,
      summary = excluded.summary, last_checked = excluded.last_checked,
      verification_status = excluded.verification_status, updated_at = now()
  `, [JSON.stringify(records)]);
  assertImported("deadlines", result.rowCount, records.length);
}

async function importProgramEligibility(client: PoolClient, records: Record<string, string>[]) {
  const result = await client.query(`
    insert into program_eligibility (
      program_id, eligibility_summary, cvr_requirement, cvr_notes, geography_scope, country_code,
      region, municipality, local_area, amount_model, amount_min, amount_max, amount_currency,
      amount_notes, source_url, last_checked, verification_status
    )
    select p.id, seed.eligibility_summary, seed.cvr_requirement, nullif(seed.cvr_notes, ''),
      seed.geography_scope, nullif(seed.country_code, ''), nullif(seed.region, ''),
      nullif(seed.municipality, ''), nullif(seed.local_area, ''), seed.amount_model,
      nullif(seed.amount_min, '')::numeric, nullif(seed.amount_max, '')::numeric,
      coalesce(nullif(seed.amount_currency, ''), 'DKK'), nullif(seed.amount_notes, ''),
      seed.source_url, nullif(seed.last_checked, '')::date,
      coalesce(nullif(seed.verification_status, ''), 'to_verify')
    from jsonb_to_recordset($1::jsonb) as seed(
      program_id text, eligibility_summary text, cvr_requirement text, cvr_notes text,
      geography_scope text, country_code text, region text, municipality text, local_area text,
      amount_model text, amount_min text, amount_max text, amount_currency text, amount_notes text,
      source_url text, last_checked text, verification_status text
    )
    join programs p on p.program_key = seed.program_id
    on conflict (program_id) do update set
      eligibility_summary = excluded.eligibility_summary, cvr_requirement = excluded.cvr_requirement,
      cvr_notes = excluded.cvr_notes, geography_scope = excluded.geography_scope,
      country_code = excluded.country_code, region = excluded.region,
      municipality = excluded.municipality, local_area = excluded.local_area,
      amount_model = excluded.amount_model, amount_min = excluded.amount_min,
      amount_max = excluded.amount_max, amount_currency = excluded.amount_currency,
      amount_notes = excluded.amount_notes, source_url = excluded.source_url,
      last_checked = excluded.last_checked, verification_status = excluded.verification_status,
      updated_at = now()
  `, [JSON.stringify(records)]);
  assertImported("program_eligibility", result.rowCount, records.length);
}

async function importProgramApplicants(client: PoolClient, records: Record<string, string>[]) {
  await client.query("delete from program_applicants where program_id in (select id from programs where program_key = any($1::text[]))", [
    [...new Set(records.map((record) => record.program_id))]
  ]);
  const result = await client.query(`
    insert into program_applicants (program_id, applicant_category, label, eligibility_status, conditions)
    select p.id, seed.applicant_category, seed.label,
      coalesce(nullif(seed.eligibility_status, ''), 'eligible'), nullif(seed.conditions, '')
    from jsonb_to_recordset($1::jsonb) as seed(
      program_id text, applicant_category text, label text, eligibility_status text, conditions text
    )
    join programs p on p.program_key = seed.program_id
  `, [JSON.stringify(records)]);
  assertImported("program_applicants", result.rowCount, records.length);
}

async function importProgramExclusions(client: PoolClient, records: Record<string, string>[]) {
  const result = await client.query(`
    insert into program_exclusions (
      exclusion_id, program_id, exclusion_type, description, source_url, last_checked, verification_status
    )
    select seed.exclusion_id, p.id, seed.exclusion_type, seed.description, seed.source_url,
      nullif(seed.last_checked, '')::date, coalesce(nullif(seed.verification_status, ''), 'to_verify')
    from jsonb_to_recordset($1::jsonb) as seed(
      exclusion_id text, program_id text, exclusion_type text, description text, source_url text,
      last_checked text, verification_status text
    )
    join programs p on p.program_key = seed.program_id
    on conflict (exclusion_id) do update set
      program_id = excluded.program_id, exclusion_type = excluded.exclusion_type,
      description = excluded.description, source_url = excluded.source_url,
      last_checked = excluded.last_checked, verification_status = excluded.verification_status,
      updated_at = now()
  `, [JSON.stringify(records)]);
  assertImported("program_exclusions", result.rowCount, records.length);
}

async function importCallScans(client: PoolClient, records: Record<string, string>[]) {
  const result = await client.query(`
    insert into call_scan_results (
      scan_result_id, foundation_id, program_id, foundation_name, program_name, scan_url, scan_status,
      match_type, discovered_title, discovered_url, excerpt, contact_name, contact_email, contact_phone,
      contact_source_url, scanned_at, review_status
    )
    select seed.scan_result_id, f.id, p.id, nullif(seed.foundation_name, ''), nullif(seed.program_name, ''),
      seed.scan_url, seed.scan_status, nullif(seed.match_type, ''), nullif(seed.discovered_title, ''),
      nullif(seed.discovered_url, ''), nullif(seed.excerpt, ''), nullif(seed.contact_name, ''),
      nullif(seed.contact_email, ''), nullif(seed.contact_phone, ''), nullif(seed.contact_source_url, ''),
      seed.scanned_at::timestamptz, coalesce(nullif(seed.review_status, ''), 'new')
    from jsonb_to_recordset($1::jsonb) as seed(
      scan_result_id text, foundation_id text, program_id text, foundation_name text, program_name text,
      scan_url text, scan_status text, match_type text, discovered_title text, discovered_url text,
      excerpt text, contact_name text, contact_email text, contact_phone text, contact_source_url text,
      scanned_at text, review_status text
    )
    join foundations f on f.foundation_key = seed.foundation_id
    left join programs p on p.program_key = nullif(seed.program_id, '')
    where nullif(seed.program_id, '') is null or p.id is not null
    on conflict (scan_result_id) do update set
      foundation_id = excluded.foundation_id, program_id = excluded.program_id,
      foundation_name = excluded.foundation_name, program_name = excluded.program_name,
      scan_url = excluded.scan_url, scan_status = excluded.scan_status, match_type = excluded.match_type,
      discovered_title = excluded.discovered_title, discovered_url = excluded.discovered_url,
      excerpt = excluded.excerpt, contact_name = excluded.contact_name, contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone, contact_source_url = excluded.contact_source_url,
      scanned_at = excluded.scanned_at
  `, [JSON.stringify(records)]);
  assertImported("call_scan_results", result.rowCount, records.length);
}

function assertImported(table: string, actual: number | null, expected: number) {
  if (actual !== expected) {
    throw new Error(`${table}: expected ${expected} imported rows, received ${actual ?? 0}`);
  }
}
