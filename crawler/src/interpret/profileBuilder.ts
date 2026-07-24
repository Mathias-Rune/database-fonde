import type { Claim, CrawlSource, FoundationProfile, FundedProject, OpenCall, OpenCallStatus } from "../types/domain.js";
import { normalizeFocusAreas } from "../taxonomy/focusAreas.js";
import { uniqueStrings } from "../utils/text.js";
import { domainKey } from "../utils/url.js";
import { estimateGrantSize } from "./grantEstimation.js";

export function buildFoundationProfile(input: {
  seedUrl: string;
  sources: CrawlSource[];
  claims: Claim[];
  fundedProjects: FundedProject[];
  openCalls: OpenCall[];
}): FoundationProfile {
  const officialSources = input.sources.sort(sourcePreference);
  const name = chooseFoundationName(input.seedUrl, input.sources, input.claims);
  const focusRaw = input.claims
    .filter((claim) => claim.claimKey === "focus_area_raw")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map((claim) => claim.claimValue);
  const normalizedFocus = uniqueStrings([
    ...input.claims.filter((claim) => claim.claimKey === "normalized_focus_area").map((claim) => claim.claimValue),
    ...input.fundedProjects.flatMap((project) => project.normalizedThemes),
    ...focusRaw.flatMap((label) => normalizeFocusAreas(label))
  ]);
  const targetGroups = uniqueStrings([
    ...input.claims.filter((claim) => claim.claimKey === "target_group").map((claim) => claim.claimValue),
    ...input.fundedProjects.flatMap((project) => project.targetGroups)
  ]).slice(0, 20);
  const applicationClaims = input.claims
    .filter((claim) => claim.claimKey === "application_process")
    .sort((a, b) => b.confidence - a.confidence);
  const selectedCall = chooseCurrentCall(input.openCalls);
  const openCallStatus = summarizeOpenCallStatus(input.openCalls, selectedCall);
  const grantEstimate = estimateGrantSize(input.fundedProjects);
  const uncertainties = collectUncertainties(input.claims, input.openCalls, grantEstimate.sampleSize, grantEstimate.note);
  const profileConfidence = computeProfileConfidence({
    sources: input.sources.length,
    claims: input.claims.length,
    projects: input.fundedProjects.length,
    openCalls: input.openCalls.length,
    normalizedFocus: normalizedFocus.length,
    grantConfidence: grantEstimate.confidence
  });

  return {
    name,
    website: new URL(input.seedUrl).origin,
    country: inferCountry(input.seedUrl, input.sources),
    language: inferLanguage(input.sources),
    normalizedFocusAreas: normalizedFocus,
    rawFocusAreaLabels: uniqueStrings(focusRaw),
    targetGroups,
    geography: uniqueStrings(input.fundedProjects.flatMap((project) => project.geography)),
    supportTypes: inferSupportTypes(input.claims),
    applicationProcessSummary: applicationClaims[0]?.claimValue,
    typicalGrant: grantEstimate,
    openCallStatus,
    openCallSummary: selectedCall?.summary,
    latestDeadline: selectedCall?.closesAt,
    lastCrawledAt: new Date().toISOString(),
    profileConfidence,
    notes: [
      `Profile generated from ${input.sources.length} sources on ${domainKey(input.seedUrl)}.`,
      ...(grantEstimate.note ? [grantEstimate.note] : [])
    ],
    sources: officialSources,
    claims: input.claims,
    fundedProjects: input.fundedProjects,
    openCalls: input.openCalls,
    uncertainties
  };
}

function chooseBestClaim(claims: Claim[], claimType: string, claimKey: string): Claim | undefined {
  return claims
    .filter((claim) => claim.claimType === claimType && claim.claimKey === claimKey)
    .sort((a, b) => b.confidence - a.confidence)[0];
}

function chooseFoundationName(seedUrl: string, sources: CrawlSource[], claims: Claim[]): string | undefined {
  const domainName = domainStemName(seedUrl);
  if (/(fond|fund|foundation|trust)/i.test(domainName)) return domainName;
  const rootOrigin = new URL(seedUrl).origin;
  const rootSource = sources.find((source) => new URL(source.sourceUrl).origin === rootOrigin && new URL(source.sourceUrl).pathname === "/");
  const rootTitle = rootSource?.pageTitle?.replace(/\s[|-].*$/, "").trim();
  if (rootTitle && /^(vi|we)\s/i.test(rootTitle)) return domainName;
  if (rootTitle && rootTitle.length > 2 && rootTitle.length < 90) return rootTitle;
  return chooseBestClaim(claims, "identity", "foundation_name")?.claimValue ?? domainName;
}

function domainStemName(seedUrl: string): string {
  const stem = new URL(seedUrl).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ");
  return stem
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function chooseCurrentCall(calls: OpenCall[]): OpenCall | undefined {
  const order: Record<OpenCallStatus, number> = { open: 5, upcoming: 4, unclear: 3, closed: 2, historical: 1 };
  return [...calls].sort((a, b) => order[b.status] - order[a.status] || b.confidence - a.confidence)[0];
}

function summarizeOpenCallStatus(calls: OpenCall[], selected?: OpenCall): FoundationProfile["openCallStatus"] {
  if (calls.length === 0) return "not_found";
  const active = calls.filter((call) => call.status === "open" || call.status === "upcoming");
  const historical = calls.filter((call) => call.status === "historical" || call.status === "closed");
  if (active.length && historical.length && (selected?.confidence ?? 0) < 0.55) return "conflicting";
  return selected?.status ?? "unclear";
}

function collectUncertainties(claims: Claim[], calls: OpenCall[], grantSampleSize: number, grantNote?: string): string[] {
  const uncertainties: string[] = [];
  if (!claims.some((claim) => claim.claimKey === "focus_area_raw")) {
    uncertainties.push("No explicit focus area statement was found.");
  }
  if (grantSampleSize < 3) {
    uncertainties.push("Typical grant size was not inferred because fewer than three grant amount observations were found.");
  } else if (grantNote) {
    uncertainties.push(grantNote);
  }
  if (!calls.length) {
    uncertainties.push("No open call evidence was found; status is not_found rather than closed.");
  }
  if (calls.some((call) => call.status === "unclear")) {
    uncertainties.push("At least one call-like page had insufficient date evidence for a confident status.");
  }
  return uncertainties;
}

function computeProfileConfidence(input: {
  sources: number;
  claims: number;
  projects: number;
  openCalls: number;
  normalizedFocus: number;
  grantConfidence: number;
}): number {
  let confidence = 0.2;
  confidence += Math.min(input.sources * 0.04, 0.2);
  confidence += Math.min(input.claims * 0.005, 0.18);
  confidence += Math.min(input.normalizedFocus * 0.04, 0.16);
  confidence += Math.min(input.projects * 0.015, 0.18);
  confidence += input.openCalls > 0 ? 0.08 : 0;
  confidence += input.grantConfidence * 0.12;
  const evidenceCap = input.projects === 0 && input.grantConfidence === 0 ? 0.72 : 0.92;
  return Math.min(Number(confidence.toFixed(2)), evidenceCap);
}

function sourcePreference(a: CrawlSource, b: CrawlSource): number {
  const officialA = officialWeight(a.sourceUrl);
  const officialB = officialWeight(b.sourceUrl);
  return officialB - officialA || b.relevanceScore - a.relevanceScore;
}

function officialWeight(url: string): number {
  const lower = url.toLowerCase();
  if (/\/(about|om-os|who-we-are|foundation)\b/.test(lower)) return 3;
  if (/\/(apply|ansog|ansoeg|grant|stotte|stoette|guideline|retningslinjer)\b/.test(lower)) return 4;
  if (/\/(news|nyheder|archive|arkiv)\b/.test(lower)) return 1;
  return 2;
}

function inferCountry(seedUrl: string, sources: CrawlSource[]): string | undefined {
  const host = new URL(seedUrl).hostname;
  const joined = sources.slice(0, 5).map((source) => source.text).join(" ").toLowerCase();
  if (host.endsWith(".dk") || joined.includes("danmark")) return "DK";
  return undefined;
}

function inferLanguage(sources: CrawlSource[]): string | undefined {
  const sample = sources.slice(0, 3).map((source) => source.text).join(" ").toLowerCase();
  const danishHits = ["og", "ansøgning", "støtte", "til", "for"].filter((word) => sample.includes(` ${word} `)).length;
  const englishHits = ["and", "application", "support", "to", "for"].filter((word) => sample.includes(` ${word} `)).length;
  if (danishHits > englishHits) return "da";
  if (englishHits > danishHits) return "en";
  return undefined;
}

function inferSupportTypes(claims: Claim[]): string[] {
  const text = claims.map((claim) => claim.claimValue).join(" ").toLowerCase();
  const supportTypes: string[] = [];
  if (/grant|bevilling|støtte|funding/.test(text)) supportTypes.push("grants");
  if (/scholarship|stipend/.test(text)) supportTypes.push("scholarships");
  if (/award|pris/.test(text)) supportTypes.push("awards");
  return supportTypes;
}
