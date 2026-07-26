import type { CrawlSource, OpenCall } from "../types/domain.js";
import { cleanText, excerptAround, firstSentenceish } from "../utils/text.js";
import { extractDates } from "./patterns.js";

const callCue =
  /(open call|call for proposals|application deadline|deadline|apply by|applications? open|ansøgningsfrist|ansøg senest|ansøgningsfrister|pulje|søg støtte|send en projektidé|indsend projektidé|indkaldelse)[^.:\n]{0,520}/gi;
const rollingCue = /(rolling|løbende|ongoing|continuous|uden fast frist|no fixed deadline|hver uge|send en projektidé|indsend projektidé)/i;
const closedCue = /(closed|deadline has passed|expired|lukket|fristen er udløbet|historical|archive)/i;
const weakMenuCue = /^(menu|for ansøgere|om |projekter|forskning|udstyr|kurser|medlemmer|\s|det støtter vi|skriv en god ansøgning)/i;

export function detectOpenCalls(source: CrawlSource, now = new Date()): OpenCall[] {
  const calls: OpenCall[] = [];
  for (const match of source.text.matchAll(callCue)) {
    const snippet = excerptAround(source.text, match.index ?? 0, 320);
    if (!isUsefulCallSnippet(snippet, source.sourceUrl)) continue;
    const dates = extractDates(snippet).filter((date) => date.date);
    const closesAt = chooseLikelyDeadline(dates.map((date) => date.date as string), now);
    const rollingDeadline = rollingCue.test(snippet);
    const status = classifyStatus({ snippet, closesAt, rollingDeadline, now, source });
    calls.push({
      title: inferTitle(source, snippet),
      status,
      thematicArea: inferTheme(snippet),
      eligibility: inferEligibility(snippet),
      closesAt,
      rollingDeadline,
      summary: summarizeCallSnippet(snippet),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: confidenceForCall(status, closesAt, rollingDeadline, snippet),
      lastVerifiedAt: now.toISOString()
    });
  }
  return dedupeCalls(calls);
}

function classifyStatus(input: {
  snippet: string;
  closesAt?: string;
  rollingDeadline: boolean;
  now: Date;
  source: CrawlSource;
}): OpenCall["status"] {
  if (closedCue.test(input.snippet)) return "closed";
  if (input.rollingDeadline) return "open";
  if (!input.closesAt) return input.source.relevanceScore > 40 ? "unclear" : "historical";
  const deadline = new Date(input.closesAt);
  const ageDays = (input.now.getTime() - deadline.getTime()) / 86_400_000;
  if (deadline >= input.now) return "open";
  if (ageDays < 45) return "closed";
  return "historical";
}

function isUsefulCallSnippet(snippet: string, sourceUrl: string): boolean {
  const lower = snippet.toLowerCase();
  const negativePage = /stoetter-vi-ikke|stotter-vi-ikke|det-stoetter-vi-ikke|det-stotter-vi-ikke/i.test(sourceUrl);
  if (negativePage) return false;
  if (/det-har-vi-stoettet|st(o|oe|ø)ttede-projekter|projekter\/.+/.test(sourceUrl) && !/ansøgningsfrist|deadline|ansøg senest|apply by/i.test(snippet)) {
    return false;
  }
  if (/arrangementer|events?/.test(sourceUrl) && !/ansøgningsfrist|deadline|ansøg senest|apply by/i.test(snippet)) {
    return false;
  }
  if (/støtter ikke løbende ansøgninger|støtter ikke|do not support|not fund/i.test(snippet)) return false;
  const applicationPage = /(ansog|ansoeg|apply|application|projektstoette|stotte|stoette)/i.test(sourceUrl);
  const hasApplyLanguage = /(søg|ansøg|apply|application|projektidé|project idea|deadline|frist|pulje|call for proposals|open call)/i.test(snippet);
  const hasDeadlineCue = /ansøgningsfrist|deadline|ansøg senest|apply by|frist/i.test(snippet);
  const hasRealSignal = rollingCue.test(snippet) || (hasDeadlineCue && extractDates(snippet).some((date) => date.date)) || applicationPage;
  if (!hasApplyLanguage || !hasRealSignal) return false;
  if (weakMenuCue.test(lower) && !/deadline|frist|ansøgningsfrist|open call|call for proposals|løbende modtager|kan søge/i.test(snippet)) return false;
  if (/nyhedsbrev|tilmeld|cookie|privatliv/i.test(snippet) && !/ansøg|deadline|frist/i.test(snippet)) return false;
  return true;
}

function chooseLikelyDeadline(dates: string[], now: Date): string | undefined {
  if (dates.length === 0) return undefined;
  const future = dates
    .map((date) => new Date(date))
    .filter((date) => date >= now)
    .sort((a, b) => a.getTime() - b.getTime());
  if (future[0]) return future[0].toISOString();
  return dates
    .map((date) => new Date(date))
    .sort((a, b) => b.getTime() - a.getTime())[0]
    ?.toISOString();
}

function inferTitle(source: CrawlSource, snippet: string): string | undefined {
  return source.pageTitle || snippet.match(/(?:open call|call for proposals|pulje|opslag)[^.\n]{0,120}/i)?.[0]?.trim();
}

function inferTheme(snippet: string): string | undefined {
  return snippet.match(/(?:theme|thematic area|tema|område):?\s*([^.\n]{5,140})/i)?.[1]?.trim();
}

function inferEligibility(snippet: string): string | undefined {
  return snippet.match(/(?:who can apply|eligibility|hvem kan søge|ansøgere):?\s*([^.\n]{5,180})/i)?.[1]?.trim();
}

function summarizeCallSnippet(snippet: string): string {
  const lines = cleanText(snippet)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isBoilerplateLine(line));
  const anchor = lines.findIndex(isCallSummaryAnchor);
  const selected = anchor >= 0 ? selectSummaryLines(lines, anchor) : lines.slice(0, 8);
  return firstSentenceish(selected.join("\n"), 520);
}

function selectSummaryLines(lines: string[], anchor: number): string[] {
  const start = shouldKeepLeadIn(lines[anchor - 1]) ? anchor - 1 : anchor;
  const selected: string[] = [];
  for (const line of lines.slice(start)) {
    if (selected.length > 0 && isSummaryStopLine(line)) break;
    selected.push(line);
    if (selected.length >= 9) break;
  }
  return selected;
}

function shouldKeepLeadIn(line?: string): boolean {
  if (!line) return false;
  if (isBoilerplateLine(line) || isSummaryStopLine(line)) return false;
  if (isCallSummaryAnchor(line)) return false;
  return line.length >= 8 && line.length <= 140;
}

function isCallSummaryAnchor(line: string): boolean {
  return /(ansøgningsfrist|ansøgningsfrister|ansøg senest|deadline|open call|call for proposals|søg støtte|send en projektidé|indsend projektidé|kan søge|for at søge|løbende modtager|uden fast frist)/i.test(
    line
  );
}

function isBoilerplateLine(line: string): boolean {
  const normalized = line.trim();
  if (normalized.length <= 2) return true;
  if (/^(menu|search|søg|log ind|nyheder|kontakt|forside|brødkrumme|servicemenu|del|udskriv siden)$/i.test(normalized)) return true;
  if (/^(for ansøgere|om .+|projekter|forskning|udstyr|kurser|medlemmer|arrangementer|viden og læring)$/i.test(normalized)) {
    return true;
  }
  if (/^(det støtter vi|det har vi støttet|skriv en god ansøgning|projekter og donationer|ansøgningsfrister og -forløb)$/i.test(normalized)) {
    return true;
  }
  if (/^(læs mere|se alle|følg .+|tilmeld|navn|din email|cvr:|ean:)/i.test(normalized)) return true;
  if (/cookie|privatliv|nyhedsbrev|samtykke til at modtage nyhedsbreve/i.test(normalized)) return true;
  return false;
}

function isSummaryStopLine(line: string): boolean {
  return /^(foto:|læs mere|se alle|relaterede|kontakt|download|besøg hjemmeside|bliv opdateret|tilmeld)/i.test(line) || isFooterLine(line);
}

function isFooterLine(line: string): boolean {
  return /\b(CVR|EAN)\b|^\S+@\S+\.\S+$|^(telefon|phone|adresse|address)\b/i.test(line);
}

function confidenceForCall(status: OpenCall["status"], closesAt: string | undefined, rolling: boolean, snippet: string): number {
  let confidence = status === "unclear" ? 0.35 : 0.55;
  if (closesAt) confidence += 0.22;
  if (rolling) confidence += 0.18;
  if (/open call|ansøgningsfrist|deadline|call for proposals/i.test(snippet)) confidence += 0.12;
  if (closedCue.test(snippet)) confidence += 0.08;
  return Math.min(confidence, 0.92);
}

function dedupeCalls(calls: OpenCall[]): OpenCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = [call.title, call.closesAt, call.status, call.sourceUrl].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
