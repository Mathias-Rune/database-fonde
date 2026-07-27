import type { PoolClient } from "pg";
import type { SqliteOperationalData } from "./sqliteReader.js";

export async function importSqliteOperationalData(client: PoolClient, data: SqliteOperationalData) {
  await importSubscriptions(client, data.notificationSubscriptions);
  await importFavorites(client, data.favoriteFoundations);
  await importEvents(client, data.notificationEvents);
  await importRuns(client, data.scrapeRuns);
  await importSnapshots(client, data.scrapeSnapshots);
  await importExtractedFields(client, data.extractedFields);
  await importFieldChanges(client, data.fieldChanges);
  await importNotifications(client, data.scrapeNotifications);
  await resetIdentity(client, "scrape_runs", "run_id");
  await resetIdentity(client, "scrape_snapshots", "snapshot_id");
  await resetIdentity(client, "foundation_field_changes", "change_id");
  await resetIdentity(client, "scrape_notifications", "notification_id");
}

async function importSubscriptions(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into notification_subscriptions (
      subscription_key, email, notify_deadline_soon, notify_new_foundation,
      notify_new_call, notify_favorite_update, created_at, updated_at
    )
    select subscription_id, email, notify_deadline_soon <> 0, notify_new_foundation <> 0,
      notify_new_call <> 0, notify_favorite_update <> 0, created_at::timestamptz, updated_at::timestamptz
    from jsonb_to_recordset($1::jsonb) as seed(
      subscription_id text, email text, notify_deadline_soon integer, notify_new_foundation integer,
      notify_new_call integer, notify_favorite_update integer, created_at text, updated_at text
    )
    on conflict (subscription_key) do update set
      email = excluded.email, notify_deadline_soon = excluded.notify_deadline_soon,
      notify_new_foundation = excluded.notify_new_foundation, notify_new_call = excluded.notify_new_call,
      notify_favorite_update = excluded.notify_favorite_update, updated_at = excluded.updated_at
  `, [JSON.stringify(records)]);
  assertImported("notification_subscriptions", result.rowCount, records.length);
}

async function importFavorites(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into favorite_foundations (favorite_key, subscription_id, foundation_id, created_at)
    select seed.favorite_id, subscriptions.id, foundations.id, seed.created_at::timestamptz
    from jsonb_to_recordset($1::jsonb) as seed(
      favorite_id text, subscription_id text, foundation_id text, created_at text
    )
    join notification_subscriptions subscriptions on subscriptions.subscription_key = seed.subscription_id
    join foundations on foundations.foundation_key = seed.foundation_id
    on conflict (favorite_key) do update set
      subscription_id = excluded.subscription_id, foundation_id = excluded.foundation_id,
      created_at = excluded.created_at
  `, [JSON.stringify(records)]);
  assertImported("favorite_foundations", result.rowCount, records.length);
}

async function importEvents(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into notification_events (
      event_id, event_type, foundation_id, program_id, deadline_id, scan_result_id,
      title, body, event_date, created_at, sent_at
    )
    select seed.event_id, seed.event_type, f.id, p.id, d.id, nullif(seed.scan_result_id, ''),
      seed.title, nullif(seed.body, ''), nullif(substr(seed.event_date, 1, 10), '')::date,
      seed.created_at::timestamptz, nullif(seed.sent_at, '')::timestamptz
    from jsonb_to_recordset($1::jsonb) as seed(
      event_id text, event_type text, foundation_id text, program_id text, deadline_id text,
      scan_result_id text, title text, body text, event_date text, created_at text, sent_at text
    )
    left join foundations f on f.foundation_key = nullif(seed.foundation_id, '')
    left join programs p on p.program_key = nullif(seed.program_id, '')
    left join deadlines d on d.deadline_key = nullif(seed.deadline_id, '')
    where (nullif(seed.foundation_id, '') is null or f.id is not null)
      and (nullif(seed.program_id, '') is null or p.id is not null)
      and (nullif(seed.deadline_id, '') is null or d.id is not null)
    on conflict (event_id) do update set
      event_type = excluded.event_type, foundation_id = excluded.foundation_id,
      program_id = excluded.program_id, deadline_id = excluded.deadline_id,
      scan_result_id = excluded.scan_result_id, title = excluded.title, body = excluded.body,
      event_date = excluded.event_date, created_at = excluded.created_at, sent_at = excluded.sent_at
  `, [JSON.stringify(records)]);
  assertImported("notification_events", result.rowCount, records.length);
}

async function importRuns(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into scrape_runs (
      run_id, started_at, finished_at, status, targets_checked, changed_pages,
      changes_detected, auto_approved, manual_review, error_message
    )
    select run_id, started_at::timestamptz, nullif(finished_at, '')::timestamptz, status,
      targets_checked, changed_pages, changes_detected, auto_approved, manual_review, nullif(error_message, '')
    from jsonb_to_recordset($1::jsonb) as seed(
      run_id bigint, started_at text, finished_at text, status text, targets_checked integer,
      changed_pages integer, changes_detected integer, auto_approved integer,
      manual_review integer, error_message text
    )
    on conflict (run_id) do update set
      started_at = excluded.started_at, finished_at = excluded.finished_at, status = excluded.status,
      targets_checked = excluded.targets_checked, changed_pages = excluded.changed_pages,
      changes_detected = excluded.changes_detected, auto_approved = excluded.auto_approved,
      manual_review = excluded.manual_review, error_message = excluded.error_message
  `, [JSON.stringify(records)]);
  assertImported("scrape_runs", result.rowCount, records.length);
}

async function importSnapshots(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into scrape_snapshots (
      snapshot_id, run_id, foundation_id, url, fetched_at, http_status, content_hash,
      content_text, changed_since_last, error_message
    )
    select seed.snapshot_id, seed.run_id, f.id, seed.url, seed.fetched_at::timestamptz,
      seed.http_status, nullif(seed.content_hash, ''), nullif(seed.content_text, ''),
      seed.changed_since_last <> 0, nullif(seed.error_message, '')
    from jsonb_to_recordset($1::jsonb) as seed(
      snapshot_id bigint, run_id bigint, foundation_id text, url text, fetched_at text,
      http_status integer, content_hash text, content_text text, changed_since_last integer, error_message text
    )
    join foundations f on f.foundation_key = seed.foundation_id
    on conflict (snapshot_id) do update set
      run_id = excluded.run_id, foundation_id = excluded.foundation_id, url = excluded.url,
      fetched_at = excluded.fetched_at, http_status = excluded.http_status,
      content_hash = excluded.content_hash, content_text = excluded.content_text,
      changed_since_last = excluded.changed_since_last, error_message = excluded.error_message
  `, [JSON.stringify(records)]);
  assertImported("scrape_snapshots", result.rowCount, records.length);
}

async function importExtractedFields(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into foundation_extracted_fields (
      foundation_id, field_name, field_value, source_url, confidence, updated_at
    )
    select f.id, seed.field_name, seed.field_value, seed.source_url, seed.confidence, seed.updated_at::timestamptz
    from jsonb_to_recordset($1::jsonb) as seed(
      foundation_id text, field_name text, field_value text, source_url text, confidence numeric, updated_at text
    )
    join foundations f on f.foundation_key = seed.foundation_id
    on conflict (foundation_id, field_name) do update set
      field_value = excluded.field_value, source_url = excluded.source_url,
      confidence = excluded.confidence, updated_at = excluded.updated_at
  `, [JSON.stringify(records)]);
  assertImported("foundation_extracted_fields", result.rowCount, records.length);
}

async function importFieldChanges(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into foundation_field_changes (
      change_id, run_id, foundation_id, field_name, old_value, new_value, source_url,
      confidence, significance, validation_status, detected_at, decided_at, decision_note
    )
    select seed.change_id, seed.run_id, f.id, seed.field_name, nullif(seed.old_value, ''), seed.new_value,
      seed.source_url, seed.confidence, seed.significance, seed.validation_status,
      seed.detected_at::timestamptz, nullif(seed.decided_at, '')::timestamptz, nullif(seed.decision_note, '')
    from jsonb_to_recordset($1::jsonb) as seed(
      change_id bigint, run_id bigint, foundation_id text, field_name text, old_value text,
      new_value text, source_url text, confidence numeric, significance text,
      validation_status text, detected_at text, decided_at text, decision_note text
    )
    join foundations f on f.foundation_key = seed.foundation_id
    on conflict (change_id) do update set
      run_id = excluded.run_id, foundation_id = excluded.foundation_id, field_name = excluded.field_name,
      old_value = excluded.old_value, new_value = excluded.new_value, source_url = excluded.source_url,
      confidence = excluded.confidence, significance = excluded.significance,
      validation_status = excluded.validation_status, detected_at = excluded.detected_at,
      decided_at = excluded.decided_at, decision_note = excluded.decision_note
  `, [JSON.stringify(records)]);
  assertImported("foundation_field_changes", result.rowCount, records.length);
}

async function importNotifications(client: PoolClient, records: Record<string, unknown>[]) {
  const result = await client.query(`
    insert into scrape_notifications (
      notification_id, run_id, subject, body, created_at, sent_at, status, error_message
    )
    select notification_id, run_id, subject, body, created_at::timestamptz,
      nullif(sent_at, '')::timestamptz, status, nullif(error_message, '')
    from jsonb_to_recordset($1::jsonb) as seed(
      notification_id bigint, run_id bigint, subject text, body text, created_at text,
      sent_at text, status text, error_message text
    )
    on conflict (notification_id) do update set
      run_id = excluded.run_id, subject = excluded.subject, body = excluded.body,
      created_at = excluded.created_at, sent_at = excluded.sent_at,
      status = excluded.status, error_message = excluded.error_message
  `, [JSON.stringify(records)]);
  assertImported("scrape_notifications", result.rowCount, records.length);
}

async function resetIdentity(client: PoolClient, table: string, column: string) {
  await client.query(
    `select setval(pg_get_serial_sequence($1, $2), greatest(coalesce((select max(${column}) from ${table}), 1), 1), true)`,
    [table, column]
  );
}

function assertImported(table: string, actual: number | null, expected: number) {
  if (actual !== expected) throw new Error(`${table}: expected ${expected} imported rows, received ${actual ?? 0}`);
}
