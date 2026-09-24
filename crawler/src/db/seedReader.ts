import { readFile } from "node:fs/promises";
import path from "node:path";
import { seedDataDir } from "./paths.js";

export interface CanonicalSeedData {
  foundations: Record<string, string>[];
  programs: Record<string, string>[];
  programEligibility: Record<string, string>[];
  programApplicants: Record<string, string>[];
  programExclusions: Record<string, string>[];
  deadlines: Record<string, string>[];
  callScanResults: Record<string, string>[];
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
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
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  if (headers.length === 0) return [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export async function readCanonicalSeedData(dataDir = seedDataDir): Promise<CanonicalSeedData> {
  const [foundations, programs, programEligibility, programApplicants, programExclusions, deadlines, callScanResults] = await Promise.all([
    readCsv(dataDir, "fonde_seed.csv", ["foundation_id", "name", "website"]),
    readCsv(dataDir, "programs_seed.csv", ["program_id", "foundation_id", "program_name"]),
    readCsv(dataDir, "program_eligibility_seed.csv", ["program_id", "cvr_requirement", "geography_scope", "amount_model"]),
    readCsv(dataDir, "program_applicants_seed.csv", ["program_id", "applicant_category", "eligibility_status"]),
    readCsv(dataDir, "program_exclusions_seed.csv", ["exclusion_id", "program_id", "exclusion_type"]),
    readCsv(dataDir, "deadlines_seed.csv", ["deadline_id", "program_id", "status"]),
    readCsv(dataDir, "call_scan_results.csv", ["scan_result_id", "foundation_id", "scan_url"])
  ]);
  return { foundations, programs, programEligibility, programApplicants, programExclusions, deadlines, callScanResults };
}

async function readCsv(dataDir: string, fileName: string, requiredHeaders: string[]) {
  const records = parseCsv(await readFile(path.join(dataDir, fileName), "utf8"));
  const headers = new Set(Object.keys(records[0] ?? {}));
  const missing = requiredHeaders.filter((header) => !headers.has(header));
  if (missing.length > 0) throw new Error(`${fileName} mangler kolonner: ${missing.join(", ")}`);
  return records;
}
