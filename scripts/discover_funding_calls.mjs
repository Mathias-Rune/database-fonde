import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { extractContact } from "./contact_extractor.mjs";

const root = process.cwd();
const sourcesPath = path.join(root, "data", "discovery_sources.csv");
const outputPath = path.join(root, "data", "discovery_results.csv");
const discoveredAt = new Date().toISOString();
const headers = ["discovery_id", "source_id", "source_name", "provider_name", "title", "url", "excerpt", "qualification_status", "qualification_score", "qualification_reasons", "closes_on", "applicant_hint", "contact_name", "contact_email", "contact_phone", "contact_source_url", "discovered_at", "scan_status", "review_status"];

const callTerms = [
  "ansøg", "ansoeg", "ansøgningspulje", "tilskudspulje", "pulje", "opslag", "open call",
  "call for", "grant", "støtteordning", "stoetteordning", "søg støtte", "soeg stoette",
];
const ignoredTitles = /^(læs mere|se mere|klik her|forside|kontakt|nyheder|log ind|menu|alle puljer|puljer og tilskud|tilskud og puljer)$/i;

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const names = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(names.map((name, index) => [name, values[index] || ""])));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(records) {
  return `${headers.join(",")}\n${records.map((record) => headers.map((header) => csvEscape(record[header])).join(",")).join("\n")}${records.length ? "\n" : ""}`;
}

function cleanText(value) {
  return String(value || "")
    .replaceAll("&amp;", "&").replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll(/<script[\s\S]*?<\/script>/gi, " ").replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ").trim();
}

function absoluteUrl(base, href) {
  try { const url = new URL(href, base); url.hash = ""; return /^https?:$/.test(url.protocol) ? url.toString() : ""; }
  catch { return ""; }
}

function providerFor(source, url) {
  try {
    const sourceHost = new URL(source.url).hostname.replace(/^www\./, "");
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === sourceHost || host.endsWith(`.${sourceHost}`) ? source.provider_name : host;
  } catch { return source.provider_name; }
}

function stableId(sourceId, url) {
  return crypto.createHash("sha1").update(`${sourceId}|${url}`).digest("hex").slice(0, 16);
}

export function extractDiscoveryLinks(html, source) {
  const records = [];
  const anchors = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchors.exec(html))) {
    const title = cleanText(match[2]).slice(0, 220);
    const url = absoluteUrl(source.url, match[1]);
    const titleLower = title.toLocaleLowerCase("da");
    const term = callTerms.find((candidate) => titleLower.includes(candidate));
    const fundingTerm = ["pulje", "tilskud", "støtteordning", "stoetteordning", "støtte til", "open call", "call for", "grant", "innobooster"]
      .find((candidate) => titleLower.includes(candidate));
    const years = [...title.matchAll(/\b(20\d{2})\b/g)].map((item) => Number(item[1]));
    const currentYear = new Date().getUTCFullYear();
    const currentOrFuture = years.some((year) => year >= currentYear);
    const historicalOnly = years.length > 0 && years.every((year) => year < currentYear);
    const currentStateListing = source.source_id === "state-pools" && currentOrFuture && /\/\d+\/?$/.test(new URL(url).pathname);
    if (!url || url.replace(/\/$/, "") === source.url.replace(/\/$/, "") || title.length < 5 || ignoredTitles.test(title) || (!fundingTerm && !currentStateListing) || historicalOnly || /login|cookie|privatliv|nyhedsbrev|bevillingsoversigt|udmøntede-puljer/i.test(url)) continue;
    records.push({
      discovery_id: stableId(source.source_id, url), source_id: source.source_id,
      source_name: source.source_name, provider_name: providerFor(source, url), title, url,
      excerpt: `Nyt muligt puljefund via ${source.source_name}; ${term ? `matchede “${term}”` : `omtaler ${Math.max(...years)}`}.`,
      discovered_at: discoveredAt, scan_status: "found", review_status: "new",
    });
  }
  return [...new Map(records.map((record) => [record.url, record])).values()];
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "user-agent": "SustainaryFundingDiscovery/1.0", "accept-language": "da-DK,da;q=0.9,en;q=0.7" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function extractDeadline(text, referenceDate = new Date()) {
  const months = { januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12 };
  const deadlineContext = [...text.matchAll(/.{0,100}\b(?:ansøgningsfrist|deadline|ansøg senest|frist for ansøgning)\b.{0,120}/gi)].map((match) => match[0]).join(" ");
  if (!deadlineContext) return "";
  const candidates = [];
  const addDate = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day)) candidates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  };
  for (const match of deadlineContext.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const middle = Number(match[2]), last = Number(match[3]);
    if (middle > 12 && last <= 12) addDate(match[1], last, middle);
    else addDate(match[1], middle, last);
  }
  for (const match of deadlineContext.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/g)) addDate(match[3], match[2], match[1]);
  for (const match of deadlineContext.matchAll(/\b(\d{1,2})\.?\s+(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s+(20\d{2})\b/gi)) addDate(match[3], months[match[2].toLowerCase()], match[1]);
  const today = referenceDate.toISOString().slice(0, 10);
  return [...new Set(candidates)].filter((date) => date >= today).sort()[0] || "";
}

function extractApplicantHint(text) {
  const sentence = text.split(/[.!?]+/).map((item) => item.replaceAll(/\s+/g, " ").trim()).find((item) => /\b(?:kan søge|kan ansøge|målgruppe(?:n)? er|ansøgere skal)\b/i.test(item));
  if (!sentence) return "";
  const signalAt = sentence.search(/\b(?:kan søge|kan ansøge|målgruppe(?:n)? er|ansøgere skal)\b/i);
  const hint = sentence.slice(Math.max(0, signalAt - 80), signalAt + 180).trim().slice(0, 240);
  if (!/^[A-ZÆØÅ]/.test(hint) || /^Hvem kan søge$/i.test(hint)) return "";
  return hint;
}

export function qualifyDiscoveryPage(record, html, referenceDate = new Date()) {
  const text = cleanText(html).slice(0, 70000);
  const lower = text.toLocaleLowerCase("da");
  const title = record.title.toLocaleLowerCase("da");
  const closesOn = extractDeadline(text, referenceDate);
  const contact = extractContact(html, record.url);
  const reasons = [];
  let score = 15;
  const concreteFunding = /ansøgningspulje|tilskudspulje|\b[\p{L}-]*pulje(?:n|r)?\b|støtteordning|open call|call for proposals|innobooster/iu.test(`${record.title} ${text.slice(0, 5000)}`);
  const applicationSignal = /ansøgningsfrist|åben for ansøg|ansøg(?:ning|ningsskema)?|søg (?:om )?(?:tilskud|støtte)|kan søge/i.test(lower);
  const closedSignal = /puljen er lukket|ansøgningsfristen er udløbet|kan ikke længere søges|ikke åben for ansøg|closed for applications/i.test(lower);
  const categorySignal = /^(?:søg |aktuelle |alle |børne- og unge)?puljer$|puljeoversigt|overblik over tilskud|tilskud og puljer|puljer og tilskud|faq/i.test(title) || /\/soeg-puljer(?:[/?]|$)|[?&](?:area|category|filter)=/i.test(record.url);
  if (concreteFunding) { score += 25; reasons.push("konkret puljesprog"); }
  if (applicationSignal) { score += 25; reasons.push("ansøgningssignal"); }
  if (closesOn) { score += 20; reasons.push(`aktuel dato ${closesOn}`); }
  if (contact.contact_name) { score += 5; reasons.push("navngiven kontakt"); }
  if (text.length < 300) { score -= 20; reasons.push("meget lidt sideindhold"); }
  if (categorySignal) { score -= 30; reasons.push("oversigts- eller kategoriside"); }
  if (closedSignal) { score -= 80; reasons.push("lukket eller udløbet"); }
  score = Math.max(0, Math.min(100, score));
  const qualificationStatus = !closedSignal && !categorySignal && score >= 65 ? "qualified" : score >= 35 ? "review" : "rejected";
  return {
    ...record,
    excerpt: `${record.excerpt} Kvalificering: ${reasons.join(", ") || "få konkrete signaler"}.`,
    qualification_status: qualificationStatus,
    qualification_score: String(score),
    qualification_reasons: reasons.join("; "),
    closes_on: closesOn,
    applicant_hint: extractApplicantHint(text),
    ...contact,
  };
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function main() {
  const [sourcesText, existingText] = await Promise.all([
    fs.readFile(sourcesPath, "utf8"),
    fs.readFile(outputPath, "utf8").catch(() => `${headers.join(",")}\n`),
  ]);
  const sources = parseCsv(sourcesText);
  const existing = new Map(parseCsv(existingText).map((item) => [item.discovery_id, item]));
  const results = [];
  for (const source of sources) {
    try {
      const candidates = extractDiscoveryLinks(await fetchHtml(source.url), source);
      const records = await mapLimit(candidates, 6, async (record) => {
        try {
          const qualified = qualifyDiscoveryPage(record, await fetchHtml(record.url));
          return { ...qualified, review_status: existing.get(record.discovery_id)?.review_status || qualified.review_status };
        } catch (error) {
          return { ...record, qualification_status: "review", qualification_score: "20", qualification_reasons: `Detaljesiden kunne ikke læses: ${error.message}`, closes_on: "", applicant_hint: "", contact_name: "", contact_email: "", contact_phone: "", contact_source_url: "", review_status: existing.get(record.discovery_id)?.review_status || record.review_status };
        }
      });
      results.push(...records);
      console.log(`${source.source_name}: ${records.filter((item) => item.qualification_status === "qualified").length} kvalificerede, ${records.filter((item) => item.qualification_status === "review").length} til review, ${records.filter((item) => item.qualification_status === "rejected").length} afvist`);
    } catch (error) {
      results.push({ discovery_id: stableId(source.source_id, "error"), source_id: source.source_id, source_name: source.source_name, provider_name: source.provider_name, title: "Discovery-scan fejlede", url: source.url, excerpt: error.message, discovered_at: discoveredAt, scan_status: "error", review_status: "new" });
      console.log(`${source.source_name}: fejl (${error.message})`);
    }
  }
  const unique = [...new Map(results.map((record) => [record.discovery_id, record])).values()].sort((a, b) => a.source_name.localeCompare(b.source_name, "da") || a.title.localeCompare(b.title, "da"));
  await fs.writeFile(outputPath, toCsv(unique), "utf8");
  console.log(`Discovery kvalificerede ${unique.filter((item) => item.qualification_status === "qualified").length} puljer, satte ${unique.filter((item) => item.qualification_status === "review").length} til review og fandt ${unique.filter((item) => item.scan_status === "error").length} kildefejl.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
