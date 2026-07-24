import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const root = process.cwd();
const csvPath = path.join(root, "data", "fonde_seed.csv");
const programsCsvPath = path.join(root, "data", "programs_seed.csv");
const deadlinesCsvPath = path.join(root, "data", "deadlines_seed.csv");
const outputDir = path.join(root, "outputs");
const xlsxPath = path.join(outputDir, "dansk_fonds_database.xlsx");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const [csvText, programsCsvText, deadlinesCsvText] = await Promise.all([
  fs.readFile(csvPath, "utf8"),
  fs.readFile(programsCsvPath, "utf8"),
  fs.readFile(deadlinesCsvPath, "utf8"),
]);
const csvRows = parseCsv(csvText);
const headers = csvRows[0];
const records = csvRows.slice(1).map((values) =>
  Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
);
const programRows = parseCsv(programsCsvText);
const programHeaders = programRows[0];
const programs = programRows.slice(1).map((values) =>
  Object.fromEntries(programHeaders.map((header, index) => [header, values[index] ?? ""])),
);
const deadlineRows = parseCsv(deadlinesCsvText);
const deadlineHeaders = deadlineRows[0];
const deadlines = deadlineRows.slice(1).map((values) =>
  Object.fromEntries(deadlineHeaders.map((header, index) => [header, values[index] ?? ""])),
);

const workbook = await Workbook.fromCSV(csvText, { sheetName: "Fonde" });
const programsSheet = workbook.worksheets.add("Puljer");
programsSheet.getRange(`A1:${String.fromCharCode(64 + programHeaders.length)}${programRows.length}`).values = programRows;

const deadlinesSheet = workbook.worksheets.add("Frister");
deadlinesSheet.getRange(`A1:${String.fromCharCode(64 + deadlineHeaders.length)}${deadlineRows.length}`).values = deadlineRows;

const summary = workbook.worksheets.add("Opsummering");

const statusCounts = records.reduce((acc, record) => {
  acc[record.verification_status] = (acc[record.verification_status] ?? 0) + 1;
  return acc;
}, {});

const cityCounts = records.reduce((acc, record) => {
  const city = record.city || "Ukendt";
  acc[city] = (acc[city] ?? 0) + 1;
  return acc;
}, {});

const topCities = Object.entries(cityCounts)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da"))
  .slice(0, 8);
const latestCheckDate = [...records, ...programs, ...deadlines]
  .map((record) => record.last_checked)
  .filter(Boolean)
  .sort()
  .at(-1) || "Ukendt";

summary.getRange("A1:B7").values = [
  ["Dansk Fondsdatabase", ""],
  ["Fonde i seed", records.length],
  ["Puljer i seed", programs.length],
  ["Løbende åbne puljer", deadlines.filter((deadline) => deadline.status === "open").length],
  ["Puljer skal verificeres", programs.filter((program) => program.verification_status === "to_verify").length],
  ["Seneste tjekdato", latestCheckDate],
  ["Primær datafil", "data/fonde_seed.csv"],
];

summary.getRange("D1:E1").values = [["By", "Antal"]];
summary.getRange(`D2:E${topCities.length + 1}`).values = topCities;

await fs.mkdir(outputDir, { recursive: true });

const summaryPreview = await workbook.inspect({
  kind: "table",
  range: "Opsummering!A1:E10",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 5,
});
console.log(summaryPreview.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await workbook.render({ sheetName: "Fonde", range: "A1:O12", scale: 1 });
await workbook.render({ sheetName: "Opsummering", range: "A1:E10", scale: 1 });

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(xlsxPath);
console.log(`Saved ${xlsxPath}`);
