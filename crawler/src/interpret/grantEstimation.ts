import type { FundedProject, GrantEstimate } from "../types/domain.js";

export function estimateGrantSize(projects: FundedProject[]): GrantEstimate {
  const observations = projects
    .filter((project) => project.amount && project.currency && isUsableGrantObservation(project))
    .map((project) => ({
      amount: project.amount as number,
      currency: project.currency as string,
      year: project.year,
      sourceKind: classifyObservationSource(project)
    }));
  if (observations.length < 3) {
    return {
      sampleSize: observations.length,
      qualityLabel: "insufficient data",
      sourceBreakdown: countBy(observations.map((observation) => observation.sourceKind)),
      confidence: observations.length === 0 ? 0 : 0.28,
      currency: observations[0]?.currency,
      note: "Too few observed grant amounts to infer a typical grant range."
    };
  }

  const currencyCounts = new Map<string, number>();
  for (const observation of observations) {
    currencyCounts.set(observation.currency, (currencyCounts.get(observation.currency) ?? 0) + 1);
  }
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const sameCurrency = observations.filter((observation) => observation.currency === currency);
  const amounts = sameCurrency.map((observation) => observation.amount).sort((a, b) => a - b);
  const centralAmounts = centralSample(amounts);
  const mean = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  const median =
    amounts.length % 2 === 0
      ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
      : amounts[Math.floor(amounts.length / 2)];
  const years = sameCurrency.map((observation) => observation.year).filter((year): year is number => Boolean(year));
  const sourceBreakdown = countBy(sameCurrency.map((observation) => observation.sourceKind));
  const qualityLabel = qualityForSample(amounts, sourceBreakdown);
  const skewed = isSkewed(amounts, median, mean);
  const singleSourceKind = Object.keys(sourceBreakdown).length === 1 ? Object.keys(sourceBreakdown)[0] : undefined;

  return {
    min: amounts[0],
    max: amounts[amounts.length - 1],
    centralMin: centralAmounts[0],
    centralMax: centralAmounts[centralAmounts.length - 1],
    median,
    mean,
    currency,
    sampleSize: sameCurrency.length,
    qualityLabel,
    sourceBreakdown,
    observedYearMin: years.length ? Math.min(...years) : undefined,
    observedYearMax: years.length ? Math.max(...years) : undefined,
    confidence: confidenceForQuality(qualityLabel, amounts, sourceBreakdown),
    note: buildGrantNote({
      excludedOtherCurrencies: sameCurrency.length < observations.length,
      qualityLabel,
      skewed,
      singleSourceKind
    })
  };
}

function isUsableGrantObservation(project: FundedProject): boolean {
  const text = `${project.projectName ?? ""} ${project.description ?? ""}`.toLowerCase();
  if (!project.projectName) return false;
  if (/samlet:|samlet\s+\d|samlet bevilling|samlet pulje|op til|kan søge|støtte over|stoette over|pulje på|\d+\s+projekter\s+(får|fik|modtager)/.test(text)) return false;
  if (/støttede projekter|pulje-projekter|projekt- og kontaktliste|unnamed project/.test(text)) return false;
  if ((project.amount ?? 0) > 25_000_000 && project.confidence < 0.9) return false;
  return project.confidence >= 0.65;
}

function classifyObservationSource(project: FundedProject): string {
  if (/\.pdf($|\?)/i.test(project.sourceUrl)) return "pdf";
  if (/\/projekter$|st(o|oe|ø)ttede-projekter|det-har-vi-stoettet/i.test(project.sourceUrl)) return "structured_list";
  if (/\/projekter\//i.test(project.sourceUrl)) return "article";
  return "page";
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function centralSample(amounts: number[]): number[] {
  if (amounts.length < 8) return amounts;
  const trim = Math.max(1, Math.floor(amounts.length * 0.1));
  return amounts.slice(trim, amounts.length - trim);
}

function qualityForSample(amounts: number[], sourceBreakdown: Record<string, number>): GrantEstimate["qualityLabel"] {
  if (amounts.length < 3) return "insufficient data";
  if (amounts.length < 6) return "weak sample";
  const sourceKinds = Object.keys(sourceBreakdown).length;
  if (amounts.length >= 15 && !isHighlySkewed(amounts) && sourceKinds >= 1) return "strong sample";
  if (amounts.length >= 6) return "moderate sample";
  return "weak sample";
}

function confidenceForQuality(
  qualityLabel: GrantEstimate["qualityLabel"],
  amounts: number[],
  sourceBreakdown: Record<string, number>
): number {
  const base = qualityLabel === "strong sample" ? 0.76 : qualityLabel === "moderate sample" ? 0.58 : qualityLabel === "weak sample" ? 0.38 : 0;
  const diversityBoost = Object.keys(sourceBreakdown).length > 1 ? 0.06 : 0;
  const skewPenalty = isHighlySkewed(amounts) ? 0.1 : isSkewed(amounts, medianOf(amounts), meanOf(amounts)) ? 0.04 : 0;
  return Math.max(0, Math.min(Number((base + diversityBoost - skewPenalty).toFixed(2)), 0.86));
}

function isSkewed(amounts: number[], median: number, mean: number): boolean {
  if (amounts.length < 4 || median <= 0) return false;
  return mean / median > 1.75 || amounts[amounts.length - 1] / median > 8;
}

function isHighlySkewed(amounts: number[]): boolean {
  if (amounts.length < 6) return false;
  const median = medianOf(amounts);
  return median > 0 && amounts[amounts.length - 1] / median > 15;
}

function medianOf(amounts: number[]): number {
  return amounts.length % 2 === 0
    ? (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2
    : amounts[Math.floor(amounts.length / 2)];
}

function meanOf(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
}

function buildGrantNote(input: {
  excludedOtherCurrencies: boolean;
  qualityLabel: GrantEstimate["qualityLabel"];
  skewed: boolean;
  singleSourceKind?: string;
}): string {
  const notes = [
    `Quality label: ${input.qualityLabel}.`,
    "Estimate is based only on observed grants from crawled pages, not a complete grant history."
  ];
  if (input.excludedOtherCurrencies) notes.push("Only the most common observed currency was used; other currencies were excluded.");
  if (input.singleSourceKind) notes.push(`All usable observations came from ${input.singleSourceKind} evidence.`);
  if (input.skewed) notes.push("Amounts are skewed, so the median and central range are more trustworthy than the mean.");
  return notes.join(" ");
}
