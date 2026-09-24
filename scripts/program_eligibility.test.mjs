import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

async function readSeed(name) {
  return parseCsv(await readFile(new URL(`../data/${name}`, import.meta.url), "utf8"));
}

test("every program has one valid structured eligibility profile", async () => {
  const [programs, profiles] = await Promise.all([
    readSeed("programs_seed.csv"),
    readSeed("program_eligibility_seed.csv"),
  ]);
  const programIds = new Set(programs.map((row) => row.program_id));
  assert.equal(profiles.length, programs.length);
  assert.equal(new Set(profiles.map((row) => row.program_id)).size, profiles.length);
  assert.ok(profiles.every((row) => programIds.has(row.program_id)));

  const cvrValues = new Set(["required", "not_required", "conditional", "unknown"]);
  const geographyValues = new Set(["national", "regional", "municipal", "local", "international", "mixed", "unknown"]);
  assert.ok(profiles.every((row) => cvrValues.has(row.cvr_requirement)));
  assert.ok(profiles.every((row) => geographyValues.has(row.geography_scope)));
  assert.ok(profiles.every((row) => !row.amount_min || Number(row.amount_min) >= 0));
  assert.ok(profiles.every((row) => !row.amount_max || Number(row.amount_max) >= 0));
  assert.ok(profiles.every((row) => !row.amount_min || !row.amount_max || Number(row.amount_min) <= Number(row.amount_max)));
});

test("applicant and exclusion rules reference canonical programs", async () => {
  const [programs, applicants, exclusions] = await Promise.all([
    readSeed("programs_seed.csv"),
    readSeed("program_applicants_seed.csv"),
    readSeed("program_exclusions_seed.csv"),
  ]);
  const programIds = new Set(programs.map((row) => row.program_id));
  assert.ok(programs.every((program) => applicants.some((row) => row.program_id === program.program_id)));
  assert.ok(applicants.every((row) => programIds.has(row.program_id) && row.label));
  assert.ok(exclusions.every((row) => programIds.has(row.program_id) && row.description && row.source_url));
  assert.equal(new Set(exclusions.map((row) => row.exclusion_id)).size, exclusions.length);
});

test("frontend loads and renders structured eligibility data", async () => {
  const source = await readFile(new URL("../frontend/app.js", import.meta.url), "utf8");
  assert.match(source, /fetch\("data\/program_eligibility_seed\.csv"\)/);
  assert.match(source, /cvrRequirementLabel/);
  assert.match(source, /Udelukkelser/);
});
