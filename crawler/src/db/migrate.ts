#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { postgresMigrationsDir } from "./paths.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query(`create table if not exists schema_migrations (
    migration_name text primary key,
    applied_at timestamptz not null default now()
  )`);
  await client.query("select pg_advisory_lock(hashtext('fonds_database_migrations'))");
  const files = (await readdir(postgresMigrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const applied = await client.query<{ migration_name: string }>("select migration_name from schema_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.migration_name));

  for (const file of files) {
    if (appliedNames.has(file)) continue;
    await client.query("begin");
    try {
      await client.query(await readFile(path.join(postgresMigrationsDir, file), "utf8"));
      await client.query("insert into schema_migrations (migration_name) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} finally {
  await client.query("select pg_advisory_unlock(hashtext('fonds_database_migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
