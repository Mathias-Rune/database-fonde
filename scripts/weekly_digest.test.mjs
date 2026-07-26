import test from "node:test";
import assert from "node:assert/strict";
import { callSignalScore, confidenceScore, parseCsv, relevanceScore, renderText } from "./weekly_digest.mjs";
import { extractContact } from "./contact_extractor.mjs";
import { extractDiscoveryLinks, qualifyDiscoveryPage } from "./discover_funding_calls.mjs";

test("parseCsv handles quoted commas and newlines", () => {
  const rows = parseCsv('id,title,body\n1,"Pulje, grøn","Linje 1\nLinje 2"\n');
  assert.equal(rows[0].title, "Pulje, grøn");
  assert.equal(rows[0].body, "Linje 1\nLinje 2");
});

test("relevanceScore prioritizes Sustainary themes", () => {
  const high = relevanceScore({ support_areas: "Unge; demokrati; grøn omstilling; civilsamfund" });
  const low = relevanceScore({ support_areas: "Biomedicinsk forskning" });
  assert.ok(high >= 80);
  assert.ok(low < 45);
});

test("confidenceScore reports missing deadline", () => {
  const result = confidenceScore({ verification_status: "source_checked", url: "https://example.org/call", scan_status: "found" });
  assert.ok(result.score >= 60);
  assert.ok(result.uncertainties.includes("Ingen konkret deadline fundet"));
});

test("callSignalScore rejects generic navigation and keeps explicit calls", () => {
  assert.ok(callSignalScore({ match_type: "call_link", discovered_title: "Søg støtte" }) < 38);
  assert.ok(callSignalScore({ match_type: "call_link", discovered_title: "Drømmepuljen", excerpt: "Frist 10. august 2026" }) >= 38);
});

test("extractContact keeps explicitly labelled people and their details", () => {
  const contact = extractContact(`
    <h3>Kontaktperson</h3><p>Anna Jensen</p>
    <p><a href="mailto:anna@example.org">anna@example.org</a> · +45 12 34 56 78</p>
  `, "https://example.org/pulje");
  assert.deepEqual(contact, {
    contact_name: "Anna Jensen",
    contact_email: "anna@example.org",
    contact_phone: "+45 12 34 56 78",
    contact_source_url: "https://example.org/pulje",
  });
});

test("extractContact ignores unlabelled generic contact details", () => {
  assert.equal(extractContact('<footer>Kontakt os på info@example.org</footer>').contact_name, "");
});

test("extractContact recognizes a contact section followed by a person", () => {
  const contact = extractContact('<h2>Kontakt</h2><p>Mette Sørensen</p><p>mette@example.org</p>');
  assert.equal(contact.contact_name, "Mette Sørensen");
});

test("extractContact does not treat organisations as people", () => {
  assert.equal(extractContact('<h2>Kontakt</h2><p>Frederiksberg Rådhus</p>').contact_name, "");
  assert.equal(extractContact('<h2>Kontakt</h2><p>Velliv Foreningen</p>').contact_name, "");
  assert.equal(extractContact('<h2>Kontakt</h2><p>Privatlivspolitik Cookiepolitik</p>').contact_name, "");
});

test("renderText attaches deadlines to their funding opportunity", () => {
  const text = renderText({
    generated_at: "2026-07-03T09:00:00Z",
    new_calls: [{ program_id: "p1", foundation_name: "Testfonden", program_name: "Ungepuljen", discovered_title: "Ungepuljen", relevance: 90, confidence: 80, url: "https://example.org" }],
    deadlines: [{ program_id: "p1", foundation_name: "Testfonden", program_name: "Ungepuljen", event_type: "deadline", event_date: "2026-08-10", relevance: 90, confidence: 80, url: "https://example.org" }],
    changes: [],
    errors: [],
  });
  assert.match(text, /Testfonden: Ungepuljen \| deadline: 2026-08-10/);
  assert.doesNotMatch(text, /DEADLINES OG ÅBNINGER/);
});

test("extractDiscoveryLinks finds broad calls and ignores generic navigation", () => {
  const source = { source_id: "official", source_name: "Officiel oversigt", provider_name: "Myndigheden", url: "https://example.org/puljer" };
  const results = extractDiscoveryLinks('<a href="/puljer/unge-2026">Ny pulje for lokale unge</a><a href="/">Læs mere</a>', source);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider_name, "Myndigheden");
});

test("qualifyDiscoveryPage accepts open concrete calls and rejects closed ones", () => {
  const record = { title: "Ungepuljen 2026", url: "https://example.org/ungepuljen", excerpt: "Fundet" };
  const open = qualifyDiscoveryPage(record, `<h1>Ungepuljen</h1><p>Foreninger kan søge tilskud. Ansøgningsfrist 10. august 2026.</p><p>${"Puljen støtter lokale aktiviteter. ".repeat(12)}</p>`, new Date("2026-07-03T00:00:00Z"));
  assert.equal(open.qualification_status, "qualified");
  assert.equal(open.closes_on, "2026-08-10");
  assert.match(open.applicant_hint, /Foreninger kan søge/);
  const closed = qualifyDiscoveryPage(record, '<h1>Ungepuljen</h1><p>Puljen er lukket. Ansøgningsfristen er udløbet.</p>', new Date("2026-07-03T00:00:00Z"));
  assert.equal(closed.qualification_status, "rejected");
});
