import type { Claim } from "../types/domain.js";

export interface Conflict {
  claimKey: string;
  values: string[];
  sourceUrls: string[];
  note: string;
}

export function detectClaimConflicts(claims: Claim[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const grouped = new Map<string, Claim[]>();
  for (const claim of claims) {
    if (claim.claimKey === "amount_observed" || claim.claimKey === "date_observed") continue;
    const key = `${claim.claimType}:${claim.claimKey}`;
    grouped.set(key, [...(grouped.get(key) ?? []), claim]);
  }
  for (const [key, group] of grouped.entries()) {
    const highConfidenceValues = [...new Set(group.filter((claim) => claim.confidence >= 0.72).map((claim) => claim.claimValue))];
    if (highConfidenceValues.length > 5) {
      conflicts.push({
        claimKey: key,
        values: highConfidenceValues.slice(0, 10),
        sourceUrls: [...new Set(group.map((claim) => claim.sourceUrl))],
        note: "Multiple high-confidence values were found. This may be legitimate multi-value data, but should be reviewed."
      });
    }
  }
  return conflicts;
}
