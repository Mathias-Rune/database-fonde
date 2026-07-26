#!/usr/bin/env node
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { loadConfig } from "../config/env.js";
import { JsonFileRepository, PostgresFoundationRepository } from "../db/repository.js";
import { FoundationIntelligencePipeline } from "../pipeline.js";
import type { SeedInput } from "../types/domain.js";
import { createLogger } from "../utils/logger.js";

const argv = await yargs(hideBin(process.argv))
  .scriptName("foundation-intelligence")
  .command("crawl", "Crawl seed foundation sites and generate AI-ready profiles")
  .option("seeds", {
    type: "string",
    describe: "Comma-separated foundation root URLs",
    demandOption: true
  })
  .option("max-pages", {
    type: "number",
    describe: "Maximum pages per seed"
  })
  .option("out", {
    type: "string",
    describe: "Output directory"
  })
  .option("persist", {
    choices: ["json", "postgres"] as const,
    default: "json",
    describe: "Persistence backend"
  })
  .demandCommand(1)
  .help()
  .parse();

const command = argv._[0];
if (command !== "crawl") {
  throw new Error(`Unsupported command: ${String(command)}`);
}

const config = loadConfig();
const logger = createLogger(config.logLevel);
const outputDir = path.resolve(String(argv.out ?? config.outputDir));
const repository =
  argv.persist === "postgres"
    ? new PostgresFoundationRepository(config, logger)
    : new JsonFileRepository(outputDir);

const seeds: SeedInput[] = String(argv.seeds)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)
  .map((url) => ({ url, maxPages: argv.maxPages }));

if (seeds.length > 1 && !config.crawler.allowBatchCrawl) {
  throw new Error("Batch crawling is disabled by default. Set CRAWLER_ALLOW_BATCH=true only after confirming permission and rate limits.");
}

const pipeline = new FoundationIntelligencePipeline(config, logger, repository);
const results = await pipeline.run(seeds, outputDir);

for (const result of results) {
  logger.info(
    {
      name: result.profile.name,
      website: result.profile.website,
      openCallStatus: result.profile.openCallStatus,
      sources: result.profile.sources.length,
      outputDir
    },
    "Run complete"
  );
}
