import type { Logger } from "pino";
import type { AppConfig } from "./types/config.js";
import type { Claim, CrawlRunResult, CrawlSource, FundedProject, OpenCall, SeedInput } from "./types/domain.js";
import type { FoundationRepository } from "./db/repository.js";
import { FoundationCrawler } from "./crawl/crawler.js";
import { extractClaimsFromSource } from "./extract/claims.js";
import { dedupeFundedProjects, extractFundedProjects } from "./extract/projects.js";
import { detectOpenCalls } from "./extract/openCalls.js";
import { buildFoundationProfile } from "./interpret/profileBuilder.js";
import { detectClaimConflicts } from "./interpret/conflicts.js";
import { writeProfileOutputs } from "./output/profileOutput.js";
import { writeCsvExport } from "./output/csv.js";

export class FoundationIntelligencePipeline {
  private readonly crawler: FoundationCrawler;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly repository: FoundationRepository
  ) {
    this.crawler = new FoundationCrawler(config, logger);
  }

  async run(seeds: SeedInput[], outputDir = this.config.outputDir): Promise<CrawlRunResult[]> {
    const results: CrawlRunResult[] = [];
    for (const seed of seeds) {
      this.logger.info({ seed: seed.url }, "Starting foundation intelligence run");
      const sources = await this.crawler.crawlSeed(seed);
      const analyzedSources = sources.map((source) => {
        const claims = extractClaimsFromSource(source);
        const fundedProjects = extractFundedProjects(source);
        const openCalls = detectOpenCalls(source);
        const utilityScore = scoreSourceUtility(source, claims, fundedProjects, openCalls);
        return { source, claims, fundedProjects, openCalls, utilityScore };
      });
      const relevantSources = selectUsefulSources(analyzedSources, seed.maxPages ?? this.config.crawler.maxPagesPerSeed);
      this.logger.info(
        {
          seed: seed.url,
          sources: sources.length,
          relevant: relevantSources.length,
          topUtility: relevantSources.slice(0, 5).map((item) => ({
            url: item.source.sourceUrl,
            utilityScore: item.utilityScore,
            projects: item.fundedProjects.length,
            openCalls: item.openCalls.length
          }))
        },
        "Crawl discovery complete"
      );

      const claims = relevantSources.flatMap((item) => item.claims);
      const fundedProjects = dedupeFundedProjects(relevantSources.flatMap((item) => item.fundedProjects));
      const openCalls = relevantSources.flatMap((item) => item.openCalls);
      const conflicts = detectClaimConflicts(claims);

      for (const conflict of conflicts) {
        this.logger.warn(conflict, "Potential claim conflict");
        for (const claim of claims.filter((candidate) => `${candidate.claimType}:${candidate.claimKey}` === conflict.claimKey)) {
          claim.status = "conflicting";
          claim.confidence = Math.min(claim.confidence, 0.5);
        }
      }

      const profile = buildFoundationProfile({
        seedUrl: seed.url,
        sources: relevantSources.map((item) => item.source),
        claims,
        fundedProjects,
        openCalls
      });
      await this.repository.saveProfile(profile);
      await writeProfileOutputs(profile, outputDir);
      results.push({ seed, profile });
      this.logger.info(
        {
          website: profile.website,
          claims: profile.claims.length,
          projects: profile.fundedProjects.length,
          openCalls: profile.openCalls.length,
          confidence: profile.profileConfidence
        },
        "Foundation profile generated"
      );
    }
    await writeCsvExport(results.map((result) => result.profile), outputDir);
    return results;
  }
}

interface AnalyzedSource {
  source: CrawlSource;
  claims: Claim[];
  fundedProjects: FundedProject[];
  openCalls: OpenCall[];
  utilityScore: number;
}

function selectUsefulSources(analyzedSources: AnalyzedSource[], maxPages: number): AnalyzedSource[] {
  const rootUrl = analyzedSources.find((item) => new URL(item.source.sourceUrl).pathname === "/");
  const selected = new Map<string, (typeof analyzedSources)[number]>();
  if (rootUrl) selected.set(rootUrl.source.sourceUrl, rootUrl);

  const relevant = analyzedSources.filter((item) => item.source.relevanceScore >= 10);
  const projectCap = Math.max(2, Math.floor(maxPages * 0.4));
  const callCap = Math.max(2, Math.floor(maxPages * 0.4));

  addSources(
    selected,
    relevant
      .filter((item) => projectValue(item) > 0)
      .sort((a, b) => projectValue(b) - projectValue(a) || b.utilityScore - a.utilityScore),
    projectCap,
    maxPages
  );

  addSources(
    selected,
    relevant
      .filter((item) => callValue(item) > 0)
      .sort((a, b) => callValue(b) - callValue(a) || b.utilityScore - a.utilityScore),
    callCap,
    maxPages
  );

  addSources(
    selected,
    [...relevant].sort((a, b) => b.utilityScore - a.utilityScore || b.source.relevanceScore - a.source.relevanceScore),
    maxPages,
    maxPages
  );

  return [...selected.values()];
}

function scoreSourceUtility(
  source: CrawlSource,
  claims: Claim[],
  fundedProjects: FundedProject[],
  openCalls: OpenCall[]
): number {
  let score = source.relevanceScore;
  score += fundedProjects.length * 24;
  score += fundedProjects.filter((project) => project.amount).length * 8;
  score += openCalls.length * 18;
  score += openCalls.filter((call) => call.closesAt || call.rollingDeadline).length * 10;
  score += claims.filter((claim) => claim.claimKey === "application_process").length * 3;
  score += claims.filter((claim) => claim.claimKey === "amount_observed").slice(0, 6).length * 2;
  if (/støtter vi ikke|stotter vi ikke|what we do not support|do not support/i.test(source.sourceUrl + " " + (source.pageTitle ?? ""))) {
    score -= 35;
  }
  if (/fra start til slut|start to finish|naar-du-har-faaet-en-bevilling|received-a-grant/i.test(source.sourceUrl + " " + (source.pageTitle ?? ""))) {
    score -= 18;
  }
  return score;
}

function addSources(
  selected: Map<string, AnalyzedSource>,
  candidates: AnalyzedSource[],
  limit: number,
  maxPages: number
) {
  let added = 0;
  for (const item of candidates) {
    if (selected.size >= maxPages || added >= limit) break;
    if (selected.has(item.source.sourceUrl)) continue;
    selected.set(item.source.sourceUrl, item);
    added += 1;
  }
}

function projectValue(item: AnalyzedSource) {
  return item.fundedProjects.length * 10 + item.fundedProjects.filter((project) => project.amount).length * 4;
}

function callValue(item: AnalyzedSource) {
  return item.openCalls.length * 8 + item.openCalls.filter((call) => call.closesAt || call.rollingDeadline).length * 4;
}
