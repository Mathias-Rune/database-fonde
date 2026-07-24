import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FoundationProfile } from "../types/domain.js";

export async function writeCsvExport(profiles: FoundationProfile[], outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const rows = [
    [
      "name",
      "website",
      "normalized_focus_areas",
      "open_call_status",
      "latest_deadline",
      "typical_grant_median",
      "typical_grant_currency",
      "typical_grant_sample_size",
      "profile_confidence"
    ],
    ...profiles.map((profile) => [
      profile.name ?? "",
      profile.website,
      profile.normalizedFocusAreas.join("|"),
      profile.openCallStatus,
      profile.latestDeadline ?? "",
      profile.typicalGrant.median?.toString() ?? "",
      profile.typicalGrant.currency ?? "",
      profile.typicalGrant.sampleSize.toString(),
      profile.profileConfidence.toString()
    ])
  ];
  await writeFile(path.join(outputDir, "foundations.csv"), rows.map((row) => row.map(csvCell).join(",")).join("\n"));
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
