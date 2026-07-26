import got from "got";
import pdf from "pdf-parse";
import type { AppConfig } from "../types/config.js";
import type { CrawlSource, DiscoveredLink } from "../types/domain.js";
import { sha256 } from "../utils/hash.js";
import { cleanText } from "../utils/text.js";
import { isSameDomain } from "../utils/url.js";
import { scorePageRelevance } from "./relevance.js";

export async function fetchPdfSource(
  url: string,
  config: AppConfig,
  links: DiscoveredLink[] = [],
  rootUrl?: string
): Promise<CrawlSource | undefined> {
  const response = await got(url, {
    headers: { "user-agent": config.crawler.userAgent },
    timeout: { request: config.crawler.requestTimeoutMs },
    retry: { limit: 2 },
    throwHttpErrors: false
  });
  if (response.statusCode >= 400) return undefined;
  if (rootUrl && !isSameDomain(response.url || url, rootUrl)) return undefined;
  const parsed = await pdf(response.rawBody);
  const text = cleanText(parsed.text);
  if (!text) return undefined;
  const relevance = scorePageRelevance({
    url,
    title: parsed.info?.Title,
    bodyText: text,
    headings: [],
    sourceType: "pdf"
  });
  return {
    sourceUrl: url,
    sourceType: "pdf",
    pageTitle: parsed.info?.Title,
    crawledAt: new Date().toISOString(),
    contentHash: sha256(text),
    relevanceScore: relevance.score,
    rawTextExcerpt: text.slice(0, 1500),
    text,
    links
  };
}
