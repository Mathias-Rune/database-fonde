import path from "node:path";
import { fileURLToPath } from "node:url";

const crawlerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const repositoryRoot = path.resolve(crawlerRoot, "..");
export const postgresMigrationsDir = path.join(repositoryRoot, "database", "postgres");
export const seedDataDir = path.join(repositoryRoot, "data");
