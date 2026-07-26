import type { Claim, CrawlSource } from "../types/domain.js";
import { normalizeFocusAreas } from "../taxonomy/focusAreas.js";
import { excerptAround, firstSentenceish, uniqueStrings } from "../utils/text.js";
import { extractDates, extractMoney } from "./patterns.js";

const focusCueRegex =
  /(\bwe support\b|\bwe fund\b|\bsupports\b|\bfunds\b|støtter|yder støtte til|formål|purpose|focus areas?|indsatsområder?|vi støtter)[^.:\n]{0,260}/gi;
const targetCuePattern = /(children|young people|unge|børn|foreninger|nonprofits?|ngo|organisationer|applicants?|ansøgere)[^.:\n]{0,220}/gi;
const applicationCueRegex = /(apply|application|ansøg|ansøgningsfrist|deadline|guidelines|retningslinjer|kriterier)[^.:\n]{0,260}/gi;
const negativeSupportRegex = /(støtter ikke|support does not|do not support|ikke støtter|not fund)/i;
const knownFocusLabels = [
  "Arbejdsliv",
  "Demokrati",
  "Grøn Forandring",
  "Grøn forandring",
  "Rytmisk Musik",
  "Rytmisk musik"
];

export function extractClaimsFromSource(source: CrawlSource): Claim[] {
  const now = new Date().toISOString();
  const claims: Claim[] = [];
  const foundationName = inferFoundationName(source);
  if (foundationName) {
    claims.push(makeClaim(source, "identity", "foundation_name", foundationName, source.pageTitle ?? foundationName, "heuristic_summary", true, 0.65, now));
  }

  for (const match of source.text.matchAll(focusCueRegex)) {
    const value = firstSentenceish(match[0]);
    if (negativeSupportRegex.test(value) || value.length < 12) continue;
    claims.push(makeClaim(source, "profile", "focus_area_raw", value, excerptAround(source.text, match.index ?? 0), "rule_keyword", true, 0.68, now));
    for (const area of normalizeFocusAreas(value)) {
      claims.push(makeClaim(source, "profile", "normalized_focus_area", area, excerptAround(source.text, match.index ?? 0), "taxonomy", false, 0.6, now));
    }
  }

  for (const label of extractKnownFocusLabels(source.text)) {
    claims.push(makeClaim(source, "profile", "focus_area_raw", label, label, "rule_keyword", true, 0.78, now));
    for (const area of normalizeFocusAreas(label)) {
      claims.push(makeClaim(source, "profile", "normalized_focus_area", area, label, "taxonomy", false, 0.72, now));
    }
  }

  for (const match of source.text.matchAll(targetCuePattern)) {
    claims.push(makeClaim(source, "profile", "target_group", firstSentenceish(match[0], 240), excerptAround(source.text, match.index ?? 0), "rule_keyword", true, 0.54, now));
  }

  for (const match of source.text.matchAll(applicationCueRegex)) {
    claims.push(makeClaim(source, "application", "application_process", firstSentenceish(match[0], 300), excerptAround(source.text, match.index ?? 0), "rule_keyword", true, 0.58, now));
  }

  for (const money of extractMoney(source.text).slice(0, 40)) {
    claims.push(makeClaim(source, "grant", "amount_observed", `${money.amount} ${money.currency}`, excerptAround(source.text, money.index), "rule_money", true, 0.72, now));
  }

  for (const date of extractDates(source.text).slice(0, 60)) {
    const key = date.date ? "date_observed" : "year_observed";
    claims.push(makeClaim(source, "date", key, date.date ?? String(date.year), excerptAround(source.text, date.index), "rule_date", true, 0.62, now));
  }

  return dedupeClaims(claims);
}

function inferFoundationName(source: CrawlSource): string | undefined {
  const title = source.pageTitle?.replace(/\s[|-].*$/, "").trim();
  if (title && title.length > 2 && title.length < 90) return title;
  const host = new URL(source.sourceUrl).hostname.replace(/^www\./, "");
  return host.split(".")[0]?.replace(/[-_]/g, " ");
}

function extractKnownFocusLabels(text: string): string[] {
  const found = new Set<string>();
  for (const label of knownFocusLabels) {
    if (text.includes(label)) found.add(normalizeKnownFocusLabel(label));
  }
  return [...found];
}

function normalizeKnownFocusLabel(label: string): string {
  if (/grøn/i.test(label)) return "Grøn Forandring";
  if (/rytmisk/i.test(label)) return "Rytmisk Musik";
  return label;
}

function makeClaim(
  source: CrawlSource,
  claimType: string,
  claimKey: string,
  claimValue: string,
  evidenceSnippet: string,
  extractionMethod: Claim["extractionMethod"],
  isExplicit: boolean,
  confidence: number,
  createdAt: string
): Claim {
  return {
    claimType,
    claimKey,
    claimValue,
    evidenceSnippet,
    sourceUrl: source.sourceUrl,
    sourceId: source.id,
    extractionMethod,
    isExplicit,
    confidence,
    status: confidence < 0.45 ? "inferred_low_confidence" : "found",
    createdAt
  };
}

function dedupeClaims(claims: Claim[]): Claim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = [claim.claimType, claim.claimKey, claim.claimValue, claim.sourceUrl].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
