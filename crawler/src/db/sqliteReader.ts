import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { repositoryRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface SqliteOperationalData {
  notificationSubscriptions: Record<string, unknown>[];
  favoriteFoundations: Record<string, unknown>[];
  notificationEvents: Record<string, unknown>[];
  scrapeRuns: Record<string, unknown>[];
  scrapeSnapshots: Record<string, unknown>[];
  extractedFields: Record<string, unknown>[];
  fieldChanges: Record<string, unknown>[];
  scrapeNotifications: Record<string, unknown>[];
}

export async function readSqliteOperationalData(
  databasePath = path.join(repositoryRoot, "outputs", "fonds_database.sqlite")
): Promise<SqliteOperationalData> {
  const [notificationSubscriptions, favoriteFoundations, notificationEvents, scrapeRuns, scrapeSnapshots, extractedFields, fieldChanges, scrapeNotifications] = await Promise.all([
    querySqlite(databasePath, "select * from notification_subscriptions order by subscription_id"),
    querySqlite(databasePath, "select * from favorite_foundations order by favorite_id"),
    querySqlite(databasePath, "select * from notification_events order by event_id"),
    querySqlite(databasePath, "select * from scrape_runs order by run_id"),
    querySqlite(databasePath, "select * from scrape_snapshots order by snapshot_id"),
    querySqlite(databasePath, "select * from foundation_extracted_fields order by foundation_id, field_name"),
    querySqlite(databasePath, "select * from foundation_field_changes order by change_id"),
    querySqlite(databasePath, "select * from scrape_notifications order by notification_id")
  ]);
  return {
    notificationSubscriptions,
    favoriteFoundations,
    notificationEvents,
    scrapeRuns,
    scrapeSnapshots,
    extractedFields,
    fieldChanges,
    scrapeNotifications
  };
}

async function querySqlite(databasePath: string, sql: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-json", databasePath, sql], {
    cwd: repositoryRoot,
    timeout: 30_000,
    maxBuffer: 50 * 1024 * 1024
  });
  return stdout.trim() ? JSON.parse(stdout) as Record<string, unknown>[] : [];
}
