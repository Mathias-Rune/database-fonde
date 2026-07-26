import * as cheerio from "cheerio";
import got from "got";
import pLimit from "p-limit";
import robotsParser from "robots-parser";
import type { Logger } from "pino";
import type { AppConfig } from "../types/config.js";
import type { CrawlSource, DiscoveredLink, SeedInput } from "../types/domain.js";
import { sha256 } from "../utils/hash.js";
import { cleanText } from "../utils/text.js";
import { domainKey, isProbablySkippableUrl, isSameDomain, normalizeUrl, sourceTypeFromUrl } from "../utils/url.js";
import { fetchPdfSource } from "./pdf.js";
import { scoreLinkPriority, scorePageRelevance } from "./relevance.js";

interface QueuedUrl {
  url: string;
  priority: number;
  depth: number;
  discoveredFrom?: string;
}

interface FetchedQueueItem {
  item: QueuedUrl;
  source: CrawlSource;
}

export class FoundationCrawler {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async crawlSeed(seed: SeedInput): Promise<CrawlSource[]> {
    const root = normalizeUrl(seed.url);
    if (!root) throw new Error(`Invalid seed URL: ${seed.url}`);
    const maxPages = seed.maxPages ?? this.config.crawler.maxPagesPerSeed;
    const robots = await this.loadRobots(root);
    const queue: QueuedUrl[] = [
      { url: root, priority: 1000, depth: 0 }
    ];
    const enqueued = new Set(queue.map((item) => item.url));
    if (this.config.crawler.enableGuessedPaths) {
      enqueueUrls(
        queue,
        enqueued,
        commonFoundationPaths(root).map((url) => ({ url, priority: scoreLinkPriority(url, url) + 5, depth: 1 }))
      );
    }
    for (const url of await this.loadSitemapUrls(root)) {
      enqueueUrl(queue, enqueued, { url, priority: scoreLinkPriority(url, url) + 15, depth: 1 });
    }
    const seen = new Set<string>();
    const contentHashes = new Set<string>();
    const sources: CrawlSource[] = [];
    const limit = pLimit(this.config.crawler.concurrency);
    const maxAttempts = Math.max(maxPages * 8, maxPages + 80);

    while (queue.length > 0 && sources.length < maxPages && seen.size < maxAttempts) {
      queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
      const remaining = Math.max(0, maxAttempts - seen.size);
      const batch = queue.splice(0, Math.min(this.config.crawler.concurrency, remaining));
      const results = await Promise.allSettled(
        batch.map((item) =>
          limit(async () => {
            if (seen.has(item.url)) return undefined;
            seen.add(item.url);
            if (item.depth > 5) return undefined;
            if (!isSameDomain(item.url, root) || isProbablySkippableUrl(item.url)) return undefined;
            if (robots && !robots.isAllowed(item.url, this.config.crawler.userAgent)) {
              this.logger.debug({ url: item.url, from: item.discoveredFrom }, "Skipped by robots.txt");
              return undefined;
            }
            await this.politeDelay();
            const source = await this.fetchSource(item.url, root);
            if (!source) return undefined;
            seen.add(source.sourceUrl);
            return { item, source } satisfies FetchedQueueItem;
          })
        )
      );

      for (const result of results) {
        if (result.status === "rejected") {
          this.logger.warn({ err: result.reason }, "Failed to fetch page");
          continue;
        }
        const fetched = result.value;
        if (!fetched) continue;
        const { item, source } = fetched;
        if (contentHashes.has(source.contentHash)) {
          this.logger.debug({ url: source.sourceUrl }, "Skipped duplicate content");
          continue;
        }
        contentHashes.add(source.contentHash);
        sources.push(source);
        this.logger.info(
          { url: source.sourceUrl, type: source.sourceType, relevance: source.relevanceScore },
          "Crawled source"
        );
        for (const link of source.links) {
          if (seen.has(link.url) || enqueued.has(link.url)) continue;
          if (!isSameDomain(link.url, root) || isProbablySkippableUrl(link.url)) continue;
          const depth = item.depth + 1;
          const priority = link.priorityHint + parentPageBoost(source.relevanceScore, source.sourceUrl);
          if (priority < 8 && source.relevanceScore < 15) continue;
          enqueueUrl(queue, enqueued, { url: link.url, priority, depth, discoveredFrom: source.sourceUrl });
        }
      }
    }

    return sources.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private async fetchSource(url: string, rootUrl: string): Promise<CrawlSource | undefined> {
    const sourceType = sourceTypeFromUrl(url);
    if (sourceType === "pdf") return fetchPdfSource(url, this.config, [], rootUrl);

    const response = await got(url, {
      headers: { "user-agent": this.config.crawler.userAgent },
      timeout: { request: this.config.crawler.requestTimeoutMs },
      retry: { limit: 0 },
      throwHttpErrors: false
    });
    if (response.statusCode >= 400) return undefined;
    if (!isSameDomain(response.url || url, rootUrl)) {
      this.logger.debug({ url, redirectedTo: response.url }, "Skipped off-domain redirect");
      return undefined;
    }
    const contentType = response.headers["content-type"] ?? "";
    if (contentType.includes("application/pdf")) return fetchPdfSource(response.url || url, this.config, [], rootUrl);
    if (!contentType.includes("text/html") && !response.body.includes("<html")) return undefined;

    const finalUrl = normalizeUrl(response.url || url) ?? url;
    const $ = cheerio.load(response.body);
    const structuredDataLinks = extractStructuredDataLinks($, finalUrl);
    $("script, style, noscript, svg").remove();
    $("br,p,li,h1,h2,h3,h4,h5,h6,td,th,tr,dt,dd,div,section,article,header,footer,nav").append("\n");
    const title = cleanText($("title").first().text());
    const headings = $("h1,h2,h3")
      .map((_, element) => cleanText($(element).text()))
      .get()
      .filter(Boolean);
    const text = cleanText($("body").text());
    const metaText = [
      $("meta[name='description']").attr("content"),
      $("meta[property='og:description']").attr("content")
    ]
      .filter(Boolean)
      .join("\n");
    const combinedText = cleanText([metaText, text].filter(Boolean).join("\n\n"));
    const links = dedupeLinks([
      ...extractElementLinks($, finalUrl),
      ...structuredDataLinks.map((linkUrl) => discoveredLink(linkUrl, "structured data", finalUrl))
    ]);

    const relevance = scorePageRelevance({ url: finalUrl, title, headings, bodyText: combinedText, sourceType: "html" });
    return {
      sourceUrl: finalUrl,
      sourceType: "html",
      pageTitle: title,
      crawledAt: new Date().toISOString(),
      contentHash: sha256(combinedText),
      relevanceScore: relevance.score,
      rawTextExcerpt: combinedText.slice(0, 1500),
      text: combinedText,
      links
    };
  }

  private async loadSitemapUrls(rootUrl: string): Promise<string[]> {
    const sitemapCandidates = uniqueStrings([
      new URL("/sitemap.xml", rootUrl).toString(),
      new URL("/sitemap_index.xml", rootUrl).toString(),
      ...(await this.loadRobotsSitemaps(rootUrl))
    ]);
    const visited = new Set<string>();
    const urls = new Set<string>();
    const queue = [...sitemapCandidates];

    while (queue.length > 0 && visited.size < 10 && urls.size < this.config.crawler.maxSitemapUrls) {
      const sitemapUrl = queue.shift();
      if (!sitemapUrl || visited.has(sitemapUrl)) continue;
      visited.add(sitemapUrl);
      const entries = await this.fetchSitemapEntries(sitemapUrl, rootUrl);
      for (const entry of entries) {
        if (/\.xml(?:\?|$)/i.test(new URL(entry).pathname)) {
          if (!visited.has(entry)) queue.push(entry);
          continue;
        }
        urls.add(entry);
      }
    }

    return [...urls]
      .map((url) => ({ url, priority: scoreLinkPriority(url, url) }))
      .filter((item) => item.priority >= 16)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.crawler.maxSitemapUrls)
      .map((item) => item.url);
  }

  private async fetchSitemapEntries(sitemapUrl: string, rootUrl: string): Promise<string[]> {
    try {
      const response = await got(sitemapUrl, {
        headers: { "user-agent": this.config.crawler.userAgent },
        timeout: { request: 5000 },
        retry: { limit: 1 },
        throwHttpErrors: false
      });
      if (response.statusCode >= 400) return [];
      const $ = cheerio.load(response.body, { xmlMode: true });
      return $("loc")
        .map((_, element) => normalizeUrl($(element).text()))
        .get()
        .filter((url): url is string => Boolean(url))
        .filter((url) => isSameDomain(url, rootUrl) && !isProbablySkippableUrl(url));
    } catch {
      return [];
    }
  }

  private async loadRobotsSitemaps(rootUrl: string): Promise<string[]> {
    const robotsUrl = new URL("/robots.txt", rootUrl).toString();
    try {
      const response = await got(robotsUrl, {
        headers: { "user-agent": this.config.crawler.userAgent },
        timeout: { request: 5000 },
        retry: { limit: 1 },
        throwHttpErrors: false
      });
      if (response.statusCode >= 400) return [];
      return response.body
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*sitemap:\s*(\S+)/i)?.[1])
        .flatMap((url) => {
          const normalized = url ? normalizeUrl(url) : undefined;
          return normalized ? [normalized] : [];
        });
    } catch {
      return [];
    }
  }

  private async loadRobots(rootUrl: string) {
    if (!this.config.crawler.obeyRobotsTxt) return undefined;
    const robotsUrl = new URL("/robots.txt", rootUrl).toString();
    try {
      const response = await got(robotsUrl, {
        headers: { "user-agent": this.config.crawler.userAgent },
        timeout: { request: 5000 },
        retry: { limit: 1 }
      });
      return robotsParser(robotsUrl, response.body);
    } catch {
      this.logger.debug({ domain: domainKey(rootUrl) }, "No robots.txt loaded");
      return undefined;
    }
  }

  private async politeDelay(): Promise<void> {
    if (this.config.crawler.minDelayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.config.crawler.minDelayMs));
  }
}

function commonFoundationPaths(rootUrl: string): string[] {
  const paths = [
    "/soeg-stoette",
    "/sog-stotte",
    "/ansog",
    "/ansoeg",
    "/ansøg",
    "/det-stoetter-vi",
    "/det-stotter-vi",
    "/hvad-vi-stoetter",
    "/hvad-vi-stotter",
    "/projekter",
    "/projektstoette",
    "/stoettede-projekter",
    "/stottede-projekter",
    "/det-har-vi-stoettet",
    "/det-har-vi-stottet",
    "/bevillinger",
    "/donationer",
    "/uddelinger",
    "/nyheder",
    "/aktuelt",
    "/funding",
    "/grants",
    "/our-grants",
    "/grants-prizes/what-we-have-funded",
    "/grants-prizes/what-we-have-funded/all-grants",
    "/grants-and-awards",
    "/grant-recipients",
    "/funded-projects",
    "/supported-projects",
    "/what-we-support",
    "/who-we-support",
    "/projects",
    "/news",
    "/archive",
    "/apply",
    "/how-to-apply",
    "/application",
    "/applications",
    "/guidelines",
    "/open-calls",
    "/current-calls",
    "/calls",
    "/about",
    "/om-os"
  ];
  const languageRoots = ["/da", "/en", "/dk"];
  const languagePrefixes = ["", ...languageRoots];
  const generatedPaths = [
    ...languageRoots,
    ...languagePrefixes.flatMap((prefix) =>
      paths.map((path) => `${prefix}${path}`.replace(/\/+/g, "/"))
    )
  ];
  return uniqueStrings(generatedPaths.map((path) => new URL(path, rootUrl).toString()));
}

function parentPageBoost(relevanceScore: number, sourceUrl: string): number {
  const sectionBoost = scoreLinkPriority(sourceUrl, sourceUrl) >= 20 ? 8 : 0;
  return Math.min(Math.floor(relevanceScore / 8), 10) + sectionBoost;
}

function extractElementLinks($: cheerio.CheerioAPI, sourceUrl: string): DiscoveredLink[] {
  const links: DiscoveredLink[] = [];
  $("a[href], area[href], iframe[src], frame[src], embed[src], object[data], link[href]").each((_, element) => {
    const node = $(element);
    const href = node.attr("href") ?? node.attr("src") ?? node.attr("data");
    const normalized = href ? normalizeUrl(href, sourceUrl) : undefined;
    if (!normalized) return;
    const rel = (node.attr("rel") ?? "").toLowerCase();
    if (element.tagName === "link" && !/(alternate|canonical|archives?|index|contents?)/.test(rel)) return;
    const label = cleanText(
      [
        node.text(),
        node.attr("aria-label"),
        node.attr("title"),
        node.attr("alt"),
        rel,
        node.closest("li,article,section,nav,tr").find("h1,h2,h3,h4,th").first().text()
      ]
        .filter(Boolean)
        .join(" ")
    );
    links.push(discoveredLink(normalized, label, sourceUrl));
  });
  return links;
}

function extractStructuredDataLinks($: cheerio.CheerioAPI, sourceUrl: string): string[] {
  const links: string[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw.trim()) return;
    try {
      collectStructuredUrls(JSON.parse(raw), sourceUrl, links);
    } catch {
      return;
    }
  });
  return uniqueStrings(links);
}

function collectStructuredUrls(value: unknown, sourceUrl: string, links: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredUrls(item, sourceUrl, links);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["url", "@id", "sameAs"]) {
    const candidate = record[key];
    const candidates = Array.isArray(candidate) ? candidate : [candidate];
    for (const raw of candidates) {
      if (typeof raw !== "string") continue;
      const normalized = normalizeUrl(raw, sourceUrl);
      if (normalized) links.push(normalized);
    }
  }
  for (const nested of Object.values(record)) {
    collectStructuredUrls(nested, sourceUrl, links);
  }
}

function discoveredLink(url: string, text: string, sourceUrl: string): DiscoveredLink {
  return {
    url,
    text,
    sourceUrl,
    sourceType: sourceTypeFromUrl(url),
    priorityHint: scoreLinkPriority(url, text)
  };
}

function dedupeLinks(links: DiscoveredLink[]): DiscoveredLink[] {
  const deduped = new Map<string, DiscoveredLink>();
  for (const link of links) {
    const existing = deduped.get(link.url);
    if (!existing || link.priorityHint > existing.priorityHint) {
      deduped.set(link.url, link);
    }
  }
  return [...deduped.values()];
}

function enqueueUrls(queue: QueuedUrl[], enqueued: Set<string>, items: QueuedUrl[]): void {
  for (const item of items) enqueueUrl(queue, enqueued, item);
}

function enqueueUrl(queue: QueuedUrl[], enqueued: Set<string>, item: QueuedUrl): void {
  if (enqueued.has(item.url)) return;
  enqueued.add(item.url);
  queue.push(item);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
