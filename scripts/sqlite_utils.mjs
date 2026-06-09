import { execFile } from "node:child_process";
import path from "node:path";

export function runSqlite(dbPath, sql, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-json", dbPath, sql], { cwd, timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }

      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch (parseError) {
        reject(Object.assign(parseError, { stdout, stderr }));
      }
    });
  });
}

export function execSqliteFile(dbPath, filePath, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", [dbPath, `.read ${path.relative(cwd, filePath)}`], { cwd, timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}
