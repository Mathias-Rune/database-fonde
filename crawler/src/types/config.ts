export interface AppConfig {
  databaseUrl?: string;
  logLevel: string;
  crawler: {
    userAgent: string;
    concurrency: number;
    maxPagesPerSeed: number;
    requestTimeoutMs: number;
    minDelayMs: number;
    obeyRobotsTxt: boolean;
    enableGuessedPaths: boolean;
    allowBatchCrawl: boolean;
    maxSitemapUrls: number;
  };
  outputDir: string;
}
