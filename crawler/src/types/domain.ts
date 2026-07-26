export type SourceType = "html" | "pdf" | "other";

export type ExtractionMethod =
  | "rule_date"
  | "rule_money"
  | "rule_keyword"
  | "rule_table"
  | "taxonomy"
  | "heuristic_summary"
  | "llm_assisted_placeholder";

export type ClaimStatus =
  | "found"
  | "not_found"
  | "unclear"
  | "conflicting"
  | "inferred_low_confidence";

export type OpenCallStatus = "open" | "upcoming" | "closed" | "historical" | "unclear";

export interface SeedInput {
  url: string;
  maxPages?: number;
}

export interface CrawlSource {
  id?: string;
  foundationId?: string;
  sourceUrl: string;
  sourceType: SourceType;
  pageTitle?: string;
  crawledAt: string;
  contentHash: string;
  relevanceScore: number;
  rawTextExcerpt: string;
  text: string;
  links: DiscoveredLink[];
}

export interface DiscoveredLink {
  url: string;
  text?: string;
  sourceUrl: string;
  sourceType: SourceType;
  priorityHint: number;
}

export interface Claim {
  id?: string;
  foundationId?: string;
  claimType: string;
  claimKey: string;
  claimValue: string;
  evidenceSnippet: string;
  sourceUrl: string;
  sourceId?: string;
  extractionMethod: ExtractionMethod;
  isExplicit: boolean;
  confidence: number;
  status: ClaimStatus;
  createdAt: string;
}

export interface FundedProject {
  id?: string;
  foundationId?: string;
  projectName?: string;
  recipientOrganization?: string;
  year?: number;
  amount?: number;
  currency?: string;
  description?: string;
  rawThemeLabels: string[];
  normalizedThemes: string[];
  targetGroups: string[];
  geography: string[];
  sourceUrl: string;
  sourceId?: string;
  confidence: number;
}

export interface OpenCall {
  id?: string;
  foundationId?: string;
  title?: string;
  status: OpenCallStatus;
  thematicArea?: string;
  eligibility?: string;
  opensAt?: string;
  closesAt?: string;
  rollingDeadline: boolean;
  summary?: string;
  sourceUrl: string;
  sourceId?: string;
  confidence: number;
  lastVerifiedAt: string;
}

export interface GrantEstimate {
  min?: number;
  max?: number;
  centralMin?: number;
  centralMax?: number;
  median?: number;
  mean?: number;
  currency?: string;
  sampleSize: number;
  qualityLabel?: "strong sample" | "moderate sample" | "weak sample" | "insufficient data";
  sourceBreakdown?: Record<string, number>;
  observedYearMin?: number;
  observedYearMax?: number;
  confidence: number;
  note?: string;
}

export interface FoundationProfile {
  id?: string;
  name?: string;
  website: string;
  country?: string;
  language?: string;
  normalizedFocusAreas: string[];
  rawFocusAreaLabels: string[];
  targetGroups: string[];
  geography: string[];
  supportTypes: string[];
  applicationProcessSummary?: string;
  typicalGrant: GrantEstimate;
  openCallStatus: OpenCallStatus | "not_found" | "conflicting" | "inferred_low_confidence";
  openCallSummary?: string;
  latestDeadline?: string;
  lastCrawledAt: string;
  profileConfidence: number;
  notes: string[];
  sources: CrawlSource[];
  claims: Claim[];
  fundedProjects: FundedProject[];
  openCalls: OpenCall[];
  uncertainties: string[];
}

export interface CrawlRunResult {
  seed: SeedInput;
  profile: FoundationProfile;
}
