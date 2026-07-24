import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { Logger } from "pino";
import type { AppConfig } from "../types/config.js";
import type { FoundationProfile } from "../types/domain.js";

export interface FoundationRepository {
  saveProfile(profile: FoundationProfile): Promise<void>;
}

export class JsonFileRepository implements FoundationRepository {
  constructor(private readonly outputDir: string) {}

  async saveProfile(profile: FoundationProfile): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
    const slug = slugify(profile.name ?? new URL(profile.website).hostname);
    await writeFile(path.join(this.outputDir, `${slug}.profile.json`), JSON.stringify(profile, null, 2));
  }
}

export class PostgresFoundationRepository implements FoundationRepository {
  private readonly pool: Pool;

  constructor(
    config: AppConfig,
    private readonly logger: Logger
  ) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is required for Postgres persistence.");
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async saveProfile(profile: FoundationProfile): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const foundation = await client.query<{ id: string }>(
        `insert into foundations (
          name, website, country, language, normalized_focus_areas, raw_focus_area_labels,
          target_groups, geography, support_types, application_process_summary,
          typical_grant_min, typical_grant_max, typical_grant_median, typical_grant_mean,
          typical_grant_currency, typical_grant_sample_size, typical_grant_observed_year_min,
          typical_grant_observed_year_max, open_call_status, open_call_summary, latest_deadline,
          last_crawled_at, profile_confidence, notes
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
        )
        on conflict (website) do update set
          name = excluded.name,
          country = excluded.country,
          language = excluded.language,
          normalized_focus_areas = excluded.normalized_focus_areas,
          raw_focus_area_labels = excluded.raw_focus_area_labels,
          target_groups = excluded.target_groups,
          geography = excluded.geography,
          support_types = excluded.support_types,
          application_process_summary = excluded.application_process_summary,
          typical_grant_min = excluded.typical_grant_min,
          typical_grant_max = excluded.typical_grant_max,
          typical_grant_median = excluded.typical_grant_median,
          typical_grant_mean = excluded.typical_grant_mean,
          typical_grant_currency = excluded.typical_grant_currency,
          typical_grant_sample_size = excluded.typical_grant_sample_size,
          typical_grant_observed_year_min = excluded.typical_grant_observed_year_min,
          typical_grant_observed_year_max = excluded.typical_grant_observed_year_max,
          open_call_status = excluded.open_call_status,
          open_call_summary = excluded.open_call_summary,
          latest_deadline = excluded.latest_deadline,
          last_crawled_at = excluded.last_crawled_at,
          profile_confidence = excluded.profile_confidence,
          notes = excluded.notes,
          updated_at = now()
        returning id`,
        [
          profile.name,
          profile.website,
          profile.country,
          profile.language,
          profile.normalizedFocusAreas,
          profile.rawFocusAreaLabels,
          profile.targetGroups,
          profile.geography,
          profile.supportTypes,
          profile.applicationProcessSummary,
          profile.typicalGrant.min,
          profile.typicalGrant.max,
          profile.typicalGrant.median,
          profile.typicalGrant.mean,
          profile.typicalGrant.currency,
          profile.typicalGrant.sampleSize,
          profile.typicalGrant.observedYearMin,
          profile.typicalGrant.observedYearMax,
          profile.openCallStatus,
          profile.openCallSummary,
          profile.latestDeadline,
          profile.lastCrawledAt,
          profile.profileConfidence,
          profile.notes.join("\n")
        ]
      );
      const foundationId = foundation.rows[0].id;

      for (const source of profile.sources) {
        const sourceResult = await client.query<{ id: string }>(
          `insert into foundation_sources (
            foundation_id, source_url, source_type, page_title, crawled_at,
            content_hash, relevance_score, raw_text_excerpt
          ) values ($1,$2,$3,$4,$5,$6,$7,$8)
          on conflict (foundation_id, source_url, content_hash) do update set
            relevance_score = excluded.relevance_score
          returning id`,
          [
            foundationId,
            source.sourceUrl,
            source.sourceType,
            source.pageTitle,
            source.crawledAt,
            source.contentHash,
            source.relevanceScore,
            source.rawTextExcerpt
          ]
        );
        source.id = sourceResult.rows[0].id;
      }
      const sourceIdByUrl = new Map(profile.sources.map((source) => [source.sourceUrl, source.id]));

      await client.query("delete from foundation_claims where foundation_id = $1", [foundationId]);
      await client.query("delete from funded_projects where foundation_id = $1", [foundationId]);
      await client.query("delete from open_calls where foundation_id = $1", [foundationId]);

      for (const claim of profile.claims) {
        await client.query(
          `insert into foundation_claims (
            foundation_id, claim_type, claim_key, claim_value, evidence_snippet, source_url,
            source_id, extraction_method, is_explicit, confidence, status, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            foundationId,
            claim.claimType,
            claim.claimKey,
            claim.claimValue,
            claim.evidenceSnippet,
            claim.sourceUrl,
            sourceIdByUrl.get(claim.sourceUrl),
            claim.extractionMethod,
            claim.isExplicit,
            claim.confidence,
            claim.status,
            claim.createdAt
          ]
        );
      }

      for (const project of profile.fundedProjects) {
        await client.query(
          `insert into funded_projects (
            foundation_id, project_name, recipient_organization, year, amount, currency,
            description, raw_theme_labels, normalized_themes, target_groups, geography,
            source_url, source_id, confidence
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            foundationId,
            project.projectName,
            project.recipientOrganization,
            project.year,
            project.amount,
            project.currency,
            project.description,
            project.rawThemeLabels,
            project.normalizedThemes,
            project.targetGroups,
            project.geography,
            project.sourceUrl,
            sourceIdByUrl.get(project.sourceUrl),
            project.confidence
          ]
        );
      }

      for (const call of profile.openCalls) {
        await client.query(
          `insert into open_calls (
            foundation_id, title, status, thematic_area, eligibility, opens_at, closes_at,
            rolling_deadline, summary, source_url, source_id, confidence, last_verified_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            foundationId,
            call.title,
            call.status,
            call.thematicArea,
            call.eligibility,
            call.opensAt,
            call.closesAt,
            call.rollingDeadline,
            call.summary,
            call.sourceUrl,
            sourceIdByUrl.get(call.sourceUrl),
            call.confidence,
            call.lastVerifiedAt
          ]
        );
      }

      await client.query("commit");
      this.logger.info({ foundationId, website: profile.website }, "Saved profile to Postgres");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "foundation";
}
