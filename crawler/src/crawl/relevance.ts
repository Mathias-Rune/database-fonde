import type { SourceType } from "../types/domain.js";

const danishKeywords = [
  "støtte",
  "støtter",
  "støttet",
  "bevilling",
  "bevillinger",
  "uddeling",
  "donation",
  "donationer",
  "ansøgning",
  "ansøg",
  "ansøgningsfrist",
  "kriterier",
  "projekter",
  "projektstøtte",
  "tidligere støttede projekter",
  "det har vi støttet",
  "det støtter vi",
  "hvad vi støtter",
  "retningslinjer",
  "pulje",
  "frist",
  "opslag",
  "årsrapport"
];

const englishKeywords = [
  "grants",
  "grant",
  "grantmaking",
  "funding",
  "donations",
  "funded projects",
  "projects we support",
  "what we support",
  "who we support",
  "application",
  "apply",
  "deadline",
  "guidelines",
  "open call",
  "current calls",
  "call for proposals",
  "supported projects",
  "awarded grants",
  "grant recipients",
  "annual report",
  "eligibility",
  "programme",
  "program"
];

const urlBoosts = [
  "grants-and-awards",
  "grant-recipients",
  "funded-projects",
  "supported-projects",
  "what-we-support",
  "who-we-support",
  "det-har-vi-stoettet",
  "det-har-vi-stottet",
  "det-stoetter-vi",
  "det-stotter-vi",
  "hvad-vi-stoetter",
  "hvad-vi-stotter",
  "stoettede-projekter",
  "stottede-projekter",
  "bevillinger",
  "grant",
  "fund",
  "stotte",
  "stoette",
  "ansoeg",
  "ansog",
  "application",
  "guideline",
  "call",
  "projekter",
  "project",
  "bevilling",
  "uddeling",
  "annual",
  "rapport",
  "pdf"
];

const weakUrlSignals = [
  "kontakt",
  "contact",
  "cookie",
  "privacy",
  "persondata",
  "press",
  "presse",
  "newsletter",
  "medarbejdere",
  "employees",
  "bestyrelse",
  "board",
  "job",
  "career"
];

const archiveSignals = [
  "projektoversigt",
  "bevillingsliste",
  "grant listings",
  "what we have supported",
  "what we have funded",
  "det har vi støttet",
  "project overview",
  "funded projects",
  "supported projects",
  "grant recipients",
  "awarded grants",
  "all projects",
  "all grants",
  "se alle bevillinger",
  "archive",
  "oversigt"
];

const highValueArchiveSignals = [
  "all grants",
  "se alle bevillinger",
  "what-we-have-funded/all-grants",
  "grant-recipients",
  "funded-projects",
  "supported-projects",
  "stoettede-projekter",
  "stottede-projekter"
];

const callSignals = [
  "aktuelle opslag",
  "current calls",
  "open call",
  "call for proposals",
  "guidelines for applicants",
  "application guide",
  "apply for grants",
  "ansøgning om midler",
  "facts about the call",
  "call closes",
  "call opens"
];

const weakPageSignals = [
  "det støtter vi ikke",
  "det stotter vi ikke",
  "what we do not support",
  "do not support",
  "når du har fået en bevilling",
  "when you have received a grant",
  "en ansøgnings vej fra start til slut",
  "application from start to finish",
  "hvordan arbejder vi",
  "how do we work",
  "hvad er bevillinger",
  "what are grants"
];

const amountPattern = /\b(?:DKK|kr\.?|kroner|EUR|€|USD|\$)\s?[\d.,]+|[\d.,]+\s?(?:DKK|kr\.?|kroner|EUR|€|USD|\$)\b/gi;
const datePattern =
  /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}|januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;

export interface RelevanceInput {
  url: string;
  title?: string;
  headings?: string[];
  bodyText?: string;
  sourceType: SourceType;
}

export interface RelevanceResult {
  score: number;
  reasons: string[];
}

export function scorePageRelevance(input: RelevanceInput): RelevanceResult {
  const url = input.url.toLowerCase();
  const title = (input.title ?? "").toLowerCase();
  const headings = (input.headings ?? []).join(" ").toLowerCase();
  const body = (input.bodyText ?? "").toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  for (const keyword of urlBoosts) {
    if (url.includes(keyword)) {
      score += 8;
      reasons.push(`url:${keyword}`);
    }
  }

  for (const signal of weakUrlSignals) {
    if (url.includes(signal)) {
      score -= 8;
      reasons.push(`weak_url:${signal}`);
    }
  }

  for (const signal of archiveSignals) {
    const lower = signal.toLowerCase();
    if (url.includes(lower)) {
      score += 16;
      reasons.push(`archive_url:${signal}`);
    }
    if (title.includes(lower)) {
      score += 18;
      reasons.push(`archive_title:${signal}`);
    }
    if (headings.includes(lower)) {
      score += 14;
      reasons.push(`archive_heading:${signal}`);
    }
  }

  for (const signal of highValueArchiveSignals) {
    const lower = signal.toLowerCase();
    if (url.includes(lower)) {
      score += 34;
      reasons.push(`high_value_archive_url:${signal}`);
    }
    if (title.includes(lower)) {
      score += 34;
      reasons.push(`high_value_archive_title:${signal}`);
    }
  }

  for (const signal of callSignals) {
    const lower = signal.toLowerCase();
    if (url.includes(lower)) {
      score += 14;
      reasons.push(`call_url:${signal}`);
    }
    if (title.includes(lower)) {
      score += 16;
      reasons.push(`call_title:${signal}`);
    }
    if (headings.includes(lower)) {
      score += 12;
      reasons.push(`call_heading:${signal}`);
    }
  }

  for (const signal of weakPageSignals) {
    const lower = signal.toLowerCase();
    if (url.includes(lower)) {
      score -= 22;
      reasons.push(`weak_page_url:${signal}`);
    }
    if (title.includes(lower)) {
      score -= 24;
      reasons.push(`weak_page_title:${signal}`);
    }
    if (headings.includes(lower)) {
      score -= 16;
      reasons.push(`weak_page_heading:${signal}`);
    }
  }

  for (const keyword of [...danishKeywords, ...englishKeywords]) {
    const lower = keyword.toLowerCase();
    if (title.includes(lower)) {
      score += 12;
      reasons.push(`title:${keyword}`);
    }
    if (headings.includes(lower)) {
      score += 10;
      reasons.push(`heading:${keyword}`);
    }
    const occurrences = body.split(lower).length - 1;
    if (occurrences > 0) {
      score += Math.min(occurrences * 2, 14);
      reasons.push(`body:${keyword}`);
    }
  }

  if (input.sourceType === "pdf") {
    score += 8;
    reasons.push("file:pdf");
  }
  const amountMatches = body.match(amountPattern)?.length ?? 0;
  const dateMatches = body.match(datePattern)?.length ?? 0;
  if (amountMatches > 0) {
    score += Math.min(8 + amountMatches * 2, 24);
    reasons.push("contains:grant_amount");
  }
  if (dateMatches > 0) {
    score += Math.min(4 + dateMatches, 12);
    reasons.push("contains:date");
  }

  if (amountMatches >= 3 && /projekt|project|bevilling|grant|supported|støttet/i.test(body)) {
    score += 18;
    reasons.push("record_density:projects_amounts");
  }
  if (dateMatches >= 2 && /deadline|ansøgningsfrist|call closes|call opens|apply/i.test(body)) {
    score += 16;
    reasons.push("record_density:call_dates");
  }
  if (/forbehold for automatiske udtræk|search all projects|søge efter alle projekter|grant listings/i.test(body)) {
    score += 20;
    reasons.push("structure:archive_search");
  }

  return { score: Math.max(0, Math.min(score, 100)), reasons: [...new Set(reasons)] };
}

export function scoreLinkPriority(url: string, text = ""): number {
  const result = scorePageRelevance({
    url,
    title: text,
    headings: [],
    bodyText: text,
    sourceType: url.toLowerCase().endsWith(".pdf") ? "pdf" : "html"
  });
  return result.score;
}
