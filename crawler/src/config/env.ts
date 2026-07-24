import "dotenv/config";
import { z } from "zod";
import type { AppConfig } from "../types/config.js";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  CRAWLER_USER_AGENT: z
    .string()
    .default("FoundationIntelligenceResearchBot/0.1 (configure CRAWLER_USER_AGENT with contact before production crawling)"),
  CRAWLER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  CRAWLER_MAX_PAGES_PER_SEED: z.coerce.number().int().positive().default(10),
  CRAWLER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  CRAWLER_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(5_000),
  CRAWLER_OBEY_ROBOTS_TXT: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  CRAWLER_ENABLE_GUESSED_PATHS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CRAWLER_ALLOW_BATCH: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CRAWLER_MAX_SITEMAP_URLS: z.coerce.number().int().nonnegative().default(20),
  OUTPUT_DIR: z.string().default("data/outputs")
});

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  return {
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    crawler: {
      userAgent: env.CRAWLER_USER_AGENT,
      concurrency: env.CRAWLER_CONCURRENCY,
      maxPagesPerSeed: env.CRAWLER_MAX_PAGES_PER_SEED,
      requestTimeoutMs: env.CRAWLER_REQUEST_TIMEOUT_MS,
      minDelayMs: env.CRAWLER_MIN_DELAY_MS,
      obeyRobotsTxt: env.CRAWLER_OBEY_ROBOTS_TXT,
      enableGuessedPaths: env.CRAWLER_ENABLE_GUESSED_PATHS,
      allowBatchCrawl: env.CRAWLER_ALLOW_BATCH,
      maxSitemapUrls: env.CRAWLER_MAX_SITEMAP_URLS
    },
    outputDir: env.OUTPUT_DIR
  };
}
