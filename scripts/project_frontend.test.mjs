import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");

test("file preview explains that project writes require the local server", async () => {
  const source = await readFile(path.join(rootDir, "frontend", "app.js"), "utf8");
  const html = await readFile(path.join(rootDir, "index.html"), "utf8");

  assert.match(source, /Start appen med ‘Start fondsdatabase\.command’ for at gemme projekter/);
  assert.match(source, /Forbindelsen til den lokale database blev afbrudt/);
  assert.doesNotMatch(source, /127\.0\.0\.1:8010/);
  assert.match(html, /id="projectServerNotice"/);
});
