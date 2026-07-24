import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FoundationProfile } from "../types/domain.js";

export async function writeProfileOutputs(profile: FoundationProfile, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const slug = slugify(profile.name ?? new URL(profile.website).hostname);
  await Promise.all([
    writeFile(path.join(outputDir, `${slug}.json`), JSON.stringify(toAssistantReadyJson(profile), null, 2)),
    writeFile(path.join(outputDir, `${slug}.md`), toHumanSummary(profile)),
    writeFile(path.join(outputDir, `${slug}.claims.json`), JSON.stringify(profile.claims, null, 2))
  ]);
}

export function toAssistantReadyJson(profile: FoundationProfile) {
  const judgment = researchJudgment(profile);
  const coverage = evidenceCoverage(profile);
  return {
    foundation: {
      name: profile.name,
      website: profile.website,
      country: profile.country,
      language: profile.language,
      confidence: profile.profileConfidence,
      profileUsability: judgment.profileUsability,
      researchPriority: judgment.researchPriority,
      recommendedHumanCheck: judgment.recommendedHumanCheck
    },
    evidenceCoverage: coverage,
    focusAreas: {
      normalized: profile.normalizedFocusAreas,
      rawLabels: profile.rawFocusAreaLabels,
      evidence: profile.claims
        .filter((claim) => claim.claimKey === "focus_area_raw" || claim.claimKey === "normalized_focus_area")
        .slice(0, 20)
    },
    grantHistory: {
      estimate: profile.typicalGrant,
      fundedProjects: profile.fundedProjects
    },
    openCall: {
      status: profile.openCallStatus,
      latestDeadline: profile.latestDeadline,
      summary: profile.openCallSummary,
      calls: profile.openCalls
    },
    uncertainties: profile.uncertainties,
    sourceEvidence: profile.sources.map((source) => ({
      url: source.sourceUrl,
      type: source.sourceType,
      title: source.pageTitle,
      relevanceScore: source.relevanceScore,
      crawledAt: source.crawledAt,
      excerpt: source.rawTextExcerpt
    }))
  };
}

export function toHumanSummary(profile: FoundationProfile): string {
  const grant = formatGrantEstimate(profile);
  const judgment = researchJudgment(profile);
  const coverage = evidenceCoverage(profile);
  return `# ${profile.name ?? profile.website}

Website: ${profile.website}
Profile confidence: ${profile.profileConfidence}
Profile usability: ${judgment.profileUsability}
Research priority: ${judgment.researchPriority}
Recommended human check: ${judgment.recommendedHumanCheck}

## Quick Read
- Main support areas: ${profile.normalizedFocusAreas.slice(0, 6).join(", ") || "Unknown from current evidence."}
- Funded examples found: ${profile.fundedProjects.length}
- Grant-size picture: ${profile.typicalGrant.qualityLabel ?? "unknown"}${profile.typicalGrant.median ? `; observed median ${formatAmount(profile.typicalGrant.median)} ${profile.typicalGrant.currency}` : ""}
- Application status: ${profile.openCallStatus}${profile.latestDeadline ? `; latest deadline ${profile.latestDeadline}` : ""}
- Evidence coverage: ${coverage.sourceCount} sources (${formatSourceTypes(coverage.sourceTypes)}); ${coverage.fundedProjectCount} funded records; ${coverage.usableGrantObservationCount} usable grant amounts.
- Biggest uncertainty: ${profile.uncertainties[0] ?? "No major uncertainty flagged."}

## What They Mainly Fund
${profile.normalizedFocusAreas.length ? profile.normalizedFocusAreas.join(", ") : "Unknown from current evidence."}

Raw evidence labels:
${profile.rawFocusAreaLabels.slice(0, 6).map((label) => `- ${label}`).join("\n") || "- None found"}

## Previously Funded Work
${profile.fundedProjects
  .slice(0, 10)
  .map((project) => `- ${project.year ?? "Year unknown"}: ${project.projectName ?? project.recipientOrganization ?? "Unnamed project"}${project.amount ? ` (${formatAmount(project.amount)} ${project.currency})` : ""}`)
  .join("\n") || "- No project-level records extracted."}

## Estimated Grant Level
${grant}

## Open Call Status
${profile.openCallStatus}${profile.latestDeadline ? `, latest deadline: ${profile.latestDeadline}` : ""}
${profile.openCallSummary ?? "No current call summary available."}

## Important Caveats
${profile.uncertainties.map((uncertainty) => `- ${uncertainty}`).join("\n") || "- None flagged."}

## Reliability Snapshot
What seems reliable:
${reliableSignals(profile).map((item) => `- ${item}`).join("\n") || "- Not enough reliable evidence yet."}

What is uncertain:
${uncertainSignals(profile).map((item) => `- ${item}`).join("\n")}

Do not over-interpret:
${overInterpretationWarnings(profile).map((item) => `- ${item}`).join("\n")}

## Why This Profile Is Useful
${whyUseful(profile).map((reason) => `- ${reason}`).join("\n") || "- Current crawl did not produce enough reliable evidence for prioritization."}

## What Still Needs Manual Verification
${manualVerificationItems(profile).map((item) => `- ${item}`).join("\n")}

## Top Sources
${profile.sources
  .slice(0, 10)
  .map((source) => `- [${source.pageTitle || source.sourceUrl}](${source.sourceUrl}) relevance=${source.relevanceScore}`)
  .join("\n")}
`;
}

function evidenceCoverage(profile: FoundationProfile): {
  sourceCount: number;
  sourceTypes: Record<string, number>;
  claimCount: number;
  fundedProjectCount: number;
  usableGrantObservationCount: number;
  openCallCount: number;
} {
  return {
    sourceCount: profile.sources.length,
    sourceTypes: profile.sources.reduce<Record<string, number>>((counts, source) => {
      counts[source.sourceType] = (counts[source.sourceType] ?? 0) + 1;
      return counts;
    }, {}),
    claimCount: profile.claims.length,
    fundedProjectCount: profile.fundedProjects.length,
    usableGrantObservationCount: profile.typicalGrant.sampleSize,
    openCallCount: profile.openCalls.length
  };
}

function researchJudgment(profile: FoundationProfile): {
  profileUsability: "high" | "medium" | "low";
  researchPriority: "high" | "medium" | "low";
  recommendedHumanCheck: string;
} {
  const focusKnown = profile.normalizedFocusAreas.length >= 3;
  const projectsKnown = profile.fundedProjects.length >= 5;
  const grantUsable = profile.typicalGrant.qualityLabel === "strong sample" || profile.typicalGrant.qualityLabel === "moderate sample";
  const openCallUseful = profile.openCallStatus === "open" || profile.openCallStatus === "upcoming";
  const sourceCoverage = profile.sources.length >= 3;
  const score = [focusKnown, projectsKnown, grantUsable, openCallUseful, sourceCoverage, profile.profileConfidence >= 0.75].filter(Boolean).length;

  const profileUsability =
    focusKnown && profile.profileConfidence >= 0.75 && (projectsKnown || grantUsable)
      ? "high"
      : score >= 2 || openCallUseful
        ? "medium"
        : "low";
  const researchPriority = openCallUseful || (profileUsability === "high" && grantUsable) ? "high" : profileUsability === "medium" ? "medium" : "low";
  const recommendedHumanCheck =
    profileUsability === "high"
      ? "Review source pages and confirm current application route before using in outreach."
      : profileUsability === "medium"
        ? "Manual review recommended before prioritizing; enough evidence exists to guide the check."
        : "Do not rely on this profile yet; collect better source pages or a corrected seed first.";
  return { profileUsability, researchPriority, recommendedHumanCheck };
}

function whyUseful(profile: FoundationProfile): string[] {
  const reasons: string[] = [];
  if (profile.normalizedFocusAreas.length) reasons.push(`It identifies likely support areas from ${profile.claims.length} extracted claims.`);
  if (profile.fundedProjects.length >= 3) reasons.push(`It includes ${profile.fundedProjects.length} funded-project observations with source URLs.`);
  else if (profile.fundedProjects.length > 0) reasons.push(`It found ${profile.fundedProjects.length} possible funded-project observation, but it should be manually checked before use.`);
  if (profile.typicalGrant.sampleSize >= 3) {
    reasons.push(`It gives a ${profile.typicalGrant.qualityLabel ?? "sample"} grant-size picture from ${profile.typicalGrant.sampleSize} usable amount observations.`);
  }
  if (profile.openCallStatus === "open" || profile.openCallStatus === "upcoming") {
    reasons.push("It found current or upcoming application evidence that may be worth acting on.");
  }
  return reasons;
}

function reliableSignals(profile: FoundationProfile): string[] {
  const signals: string[] = [];
  if (profile.normalizedFocusAreas.length >= 3 && profile.claims.length >= 10) signals.push("Support areas are reasonably grounded in extracted source text.");
  if (profile.fundedProjects.length >= 5) signals.push("Funded-project examples are useful for initial pattern review.");
  if (profile.typicalGrant.qualityLabel === "strong sample" || profile.typicalGrant.qualityLabel === "moderate sample") {
    signals.push(`Grant-size picture is based on a ${profile.typicalGrant.qualityLabel} of ${profile.typicalGrant.sampleSize} usable observations.`);
  }
  if (profile.openCallStatus === "open" || profile.openCallStatus === "upcoming") signals.push("Application evidence appears actionable enough to check manually.");
  return signals;
}

function uncertainSignals(profile: FoundationProfile): string[] {
  const signals: string[] = [];
  if (profile.sources.length < 3) signals.push("Source coverage is shallow.");
  if (profile.fundedProjects.length < 3) signals.push("Funded-project history is sparse or missing.");
  if (profile.typicalGrant.sampleSize < 3) signals.push("Grant-size estimate is not available from reliable observations.");
  if (profile.openCallStatus === "unclear" || profile.openCallStatus === "not_found") signals.push("Application/open-call status is not confirmed.");
  if (!profile.normalizedFocusAreas.length) signals.push("Main support areas were not extracted reliably.");
  return signals.length ? signals : ["No major uncertainty beyond normal source review."];
}

function overInterpretationWarnings(profile: FoundationProfile): string[] {
  const warnings = ["This is a crawled evidence brief, not a complete due-diligence profile."];
  if (profile.typicalGrant.sampleSize >= 3) warnings.push("Grant size reflects observed crawled examples, not the foundation's full historical distribution.");
  if (profile.fundedProjects.length > 0 && profile.fundedProjects.length < 3) warnings.push("One or two funded examples are leads, not a pattern.");
  if (profile.openCallStatus === "not_found") warnings.push("not_found means no evidence was found in this crawl; it does not mean applications are closed.");
  return warnings;
}

function manualVerificationItems(profile: FoundationProfile): string[] {
  const items: string[] = [];
  items.push("Confirm the foundation's current application rules and deadlines on the source website.");
  if (profile.typicalGrant.sampleSize >= 3) {
    items.push("Treat grant size as an observed sample, not a complete historical average.");
  } else {
    items.push("Grant size is unknown because too few reliable funded-project amounts were found.");
  }
  if (profile.openCallStatus === "unclear" || profile.openCallStatus === "not_found") {
    items.push("Open-call status needs manual checking; not_found does not mean closed.");
  }
  if (profile.fundedProjects.length === 0) {
    items.push("Funded-project history was not extracted reliably from this crawl.");
  }
  if (profile.sources.length < 3) {
    items.push("Source coverage is shallow; try better seed URLs or key subpages.");
  }
  return items;
}

function formatAmount(value?: number): string {
  if (value === undefined) return "unknown";
  return Math.round(value).toLocaleString("en-US");
}

function formatSourceTypes(sourceTypes: Record<string, number>): string {
  const formatted = Object.entries(sourceTypes)
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");
  return formatted || "none";
}

function formatGrantEstimate(profile: FoundationProfile): string {
  const estimate = profile.typicalGrant;
  if (estimate.sampleSize < 3 || !estimate.median) {
    return [
      "Unknown from current evidence.",
      `Quality: ${estimate.qualityLabel ?? "insufficient data"}; usable observations: ${estimate.sampleSize}.`,
      estimate.note ?? "Too few observed grant amounts to infer a typical grant range."
    ].join("\n");
  }
  const sourceMix = Object.entries(estimate.sourceBreakdown ?? {})
    .map(([source, count]) => `${source}=${count}`)
    .join(", ");
  const yearSpan =
    estimate.observedYearMin && estimate.observedYearMax
      ? `${estimate.observedYearMin}-${estimate.observedYearMax}`
      : "year unknown";
  return [
    `Observed median: ${formatAmount(estimate.median)} ${estimate.currency}.`,
    `Observed range: ${formatAmount(estimate.min)}-${formatAmount(estimate.max)} ${estimate.currency}.`,
    `Central range: ${formatAmount(estimate.centralMin)}-${formatAmount(estimate.centralMax)} ${estimate.currency}.`,
    `Quality: ${estimate.qualityLabel ?? "unknown"}; usable observations: ${estimate.sampleSize}; source mix: ${sourceMix || "unknown"}; years: ${yearSpan}.`,
    estimate.note ?? "Treat this as an observed sample, not a complete grant history."
  ].join("\n");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "foundation";
}
