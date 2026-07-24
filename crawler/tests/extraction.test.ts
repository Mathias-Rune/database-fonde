import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreLinkPriority } from "../src/crawl/relevance.js";
import { extractMoney } from "../src/extract/patterns.js";
import { dedupeFundedProjects, extractFundedProjects } from "../src/extract/projects.js";
import { buildFoundationProfile } from "../src/interpret/profileBuilder.js";
import type { CrawlSource } from "../src/types/domain.js";

function source(text: string, sourceUrl = "https://example.org/grants"): CrawlSource {
  return {
    sourceUrl,
    sourceType: "html",
    crawledAt: new Date("2026-04-30T00:00:00.000Z").toISOString(),
    contentHash: "test",
    relevanceScore: 100,
    rawTextExcerpt: text.slice(0, 200),
    text,
    links: []
  };
}

test("extractMoney handles Danish and English grant amount formats", () => {
  const cases = [
    ["DKK 4 million", 4_000_000],
    ["DKK 30m", 30_000_000],
    ["DKK 257,000", 257_000],
    ["DKK 4.4m", 4_400_000],
    ["1,5 mio. kr.", 1_500_000],
    ["115 millioner kroner", 115_000_000]
  ] as const;

  for (const [text, amount] of cases) {
    assert.equal(extractMoney(text)[0]?.amount, amount, text);
  }
});

test("project extraction rejects application budgets as funded projects", () => {
  const projects = extractFundedProjects(
    source("Applicants may apply for up to DKK 9 million. The application deadline is 20 August 2026.")
  );

  assert.equal(projects.length, 0);
});

test("project extraction reads visible granted-amount cards", () => {
  const projects = extractFundedProjects(
    source(`
      Related projects
      European Vocational Education and Training Initiative
      B.R.I.D.G.E. - Building Resources for Integration, Development, Guidance and Empowerment (2024)
      Granted amount:
      DKK 11m
      European Vocational Education and Training Initiative
      CareSphere: Experimental Care Laboratory (2024)
      Granted amount:
      DKK 4.4m
    `)
  );

  assert.deepEqual(
    projects.map((project) => [project.projectName, project.amount]),
    [
      ["B.R.I.D.G.E. - Building Resources for Integration, Development, Guidance and Empowerment (2024)", 11_000_000],
      ["CareSphere: Experimental Care Laboratory (2024)", 4_400_000]
    ]
  );
});

test("project extraction reads labeled project detail pages without related-news amounts", () => {
  const projects = extractFundedProjects(
    source(
      `
        Det har vi støttet
        Betty Nansen Teatret i 2020'erne
        Andre projekter
        Modtager
        Eva Præstiin
        Betty Nansen Teatret
        Projektnummer:
        00037858
        Bevilliget
        3.722.545 DKK
        År
        2021
        Projektbeskrivelse
        Bevillingen er givet til Betty Nansen Teatret.
        Nyheder
        Spin-outs Denmark går ind i ny fase med støtte på 115 millioner kroner
      `,
      "https://villumfonden.dk/da/project/betty-nansen-teatret-renovering-af-publikumsomraade"
    )
  );

  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectName, "Betty Nansen Teatret i 2020'erne");
  assert.equal(projects[0].recipientOrganization, "Betty Nansen Teatret");
  assert.equal(projects[0].amount, 3_722_545);
});

test("archive links outrank generic application pages", () => {
  const archive = scoreLinkPriority(
    "https://www.lundbeckfonden.com/grants-prizes/what-we-have-funded/all-grants",
    "All Grants"
  );
  const apply = scoreLinkPriority("https://www.lundbeckfonden.com/apply-grants", "Apply for grants");

  assert.equal(archive, 100);
  assert.ok(archive > apply);
});

test("funded project de-duplication collapses repeated pagination records", () => {
  const projects = dedupeFundedProjects([
    {
      projectName: "Postdocs",
      recipientOrganization: "Anne Mette Gissel Jensen",
      year: 2026,
      amount: 2_625_000,
      currency: "DKK",
      rawThemeLabels: [],
      normalizedThemes: [],
      targetGroups: [],
      geography: [],
      sourceUrl: "https://lundbeckfonden.com/grants-prizes/what-we-have-funded/all-grants",
      confidence: 0.9
    },
    {
      projectName: "Postdocs",
      recipientOrganization: "Anne Mette Gissel Jensen",
      year: 2026,
      amount: 2_625_000,
      currency: "DKK",
      rawThemeLabels: [],
      normalizedThemes: [],
      targetGroups: [],
      geography: [],
      sourceUrl: "https://lundbeckfonden.com/grants-prizes/what-we-have-funded/all-grants?page=1",
      confidence: 0.9
    }
  ]);

  assert.equal(projects.length, 1);
});

test("project extraction reads Lundbeck all-grants table rows", () => {
  const projects = extractFundedProjects(
    source(`
      Year
      Category
      Applicant
      Title
      Amount
      2026
      Postdocs
      Anne Mette Gissel Jensen
      Aarhus University
      Implications of SORL1-Minigene in Endolysosomal Trafficking across Neurodegenerative Diseases
      2.625.000 DKK
    `)
  );

  assert.equal(projects.length, 1);
  assert.equal(projects[0].projectName, "Implications of SORL1-Minigene in Endolysosomal Trafficking across Neurodegenerative Diseases");
  assert.equal(projects[0].recipientOrganization, "Aarhus University");
  assert.deepEqual(projects[0].rawThemeLabels, ["Postdocs"]);
  assert.equal(projects[0].amount, 2_625_000);
});

test("project extraction reads LEO labeled grant archive blocks", () => {
  const projects = extractFundedProjects(
    source(
      `
        Forside
        Research grants in open competition
        Filtrér
        Systemic effects of atopic dermatitis: Dysregulated immune responses to the intestinal microbiota
        Modtager: Jeppe Madura Larsen, Senior Researcher, Technical University of Denmark
        Beløb: DKK 4.349.062
        Grant category: Research grants in open competition
        Årstal: 2020
        Lande: Denmark
        Atopic Dermatitis (AD) is a common inflammatory skin disease.

        Granzyme B: A novel therapeutic target in cutaneous leishmaniasis
        Modtager: David Granville, Professor, University of British Columbia
        Beløb: DKK 2.023.506
        Grant category: Research grants in open competition
        Årstal: 2020
        Lande: Canada
      `,
      "https://leo-foundation.org/da/grant-category/research-grants-in-open-competition/"
    )
  );

  assert.equal(projects.length, 2);
  assert.equal(projects[0].projectName, "Systemic effects of atopic dermatitis: Dysregulated immune responses to the intestinal microbiota");
  assert.equal(projects[0].recipientOrganization, "Technical University of Denmark");
  assert.equal(projects[0].amount, 4_349_062);
  assert.deepEqual(projects[0].rawThemeLabels, ["Research grants in open competition"]);
  assert.equal(projects[1].recipientOrganization, "University of British Columbia");
});

test("profile confidence is capped when no grant evidence was found", () => {
  const sources = Array.from({ length: 25 }, (_, index) =>
    source("We support independent skin research. Apply for a grant. Next deadline: 4 June 2026.", `https://example.org/page-${index}`)
  );
  const claims = Array.from({ length: 80 }, (_, index) => ({
    claimType: "profile",
    claimKey: index % 2 === 0 ? "focus_area_raw" : "normalized_focus_area",
    claimValue: index % 2 === 0 ? "We support independent skin research" : "health",
    evidenceSnippet: "We support independent skin research.",
    sourceUrl: "https://example.org",
    extractionMethod: "rule_keyword" as const,
    isExplicit: true,
    confidence: 0.68,
    status: "found" as const,
    createdAt: new Date("2026-04-30T00:00:00.000Z").toISOString()
  }));

  const profile = buildFoundationProfile({
    seedUrl: "https://example.org",
    sources,
    claims,
    fundedProjects: [],
    openCalls: [
      {
        title: "Research grants",
        status: "open",
        rollingDeadline: false,
        closesAt: "2026-06-04T00:00:00.000Z",
        summary: "Next deadline: 4 June 2026",
        sourceUrl: "https://example.org",
        confidence: 0.9,
        lastVerifiedAt: new Date("2026-04-30T00:00:00.000Z").toISOString()
      }
    ]
  });

  assert.ok(profile.profileConfidence <= 0.72);
});
