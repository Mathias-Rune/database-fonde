import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const shouldSend = args.has("--send");
const shouldUpdateState = args.has("--update-state") || shouldSend;
const now = new Date(process.env.DIGEST_NOW || Date.now());
const statePath = process.env.DIGEST_STATE_PATH || path.join(root, "data", "weekly_digest_state.json");
const outputDir = process.env.DIGEST_OUTPUT_DIR || path.join(root, "outputs", "weekly-digest");
const minRelevance = Number(process.env.DIGEST_MIN_RELEVANCE || "20");
const maxDiscoveryCalls = Number(process.env.DIGEST_MAX_DISCOVERY || "20");

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase("da");
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function officialUrl(url) {
  try {
    const host = new URL(url).hostname;
    return !/(facebook|instagram|linkedin|grant\.nu|login)/i.test(host);
  } catch {
    return false;
  }
}

export function relevanceScore(item) {
  const text = normalize([
    item.foundation_name,
    item.program_name,
    item.support_areas,
    item.discovered_title,
    item.excerpt,
  ].join(" "));
  let score = 15;
  if (item.is_discovery) score += 15;
  const weights = [
    [/unge|ungdom|youth|børn og unge/, 28],
    [/demokrati|democratic|borgerinddrag|deltagelse|civilsamfund/, 25],
    [/klima|grøn omstilling|bæredygt|biodiversitet|climate/, 22],
    [/social innovation|social forandring|handlekraft|changemaker/, 20],
    [/fællesskab|frivillig|inklusion|mangfoldighed/, 14],
  ];
  for (const [pattern, weight] of weights) if (pattern.test(text)) score += weight;
  if (/invitation only|kun.*invitation|modtager ikke ansøgninger/.test(text)) score -= 35;
  if (/forskning|biomedicin|øjenforskning/.test(text) && !/unge|demokrati|klima/.test(text)) score -= 20;
  return Math.max(0, Math.min(100, score));
}

export function confidenceScore(item) {
  let score = 35;
  const uncertainties = [];
  if (item.verification_status === "source_checked") score += 20;
  else uncertainties.push("Kriterier er ikke fuldt kildeverificeret");
  if (officialUrl(item.url || item.discovered_url || item.application_url)) score += 15;
  else uncertainties.push("Linket er ikke en tydelig officiel informationsside");
  if (item.closes_on || /frist|deadline|\b202\d\b/i.test(`${item.discovered_title || ""} ${item.excerpt || ""}`)) score += 15;
  else uncertainties.push("Ingen konkret deadline fundet");
  if (item.match_type === "crawler_open_call") score += 15;
  else if (item.match_type === "page_text") score += 8;
  else if (item.match_type === "call_link") score += 5;
  if (item.scan_status === "error") {
    score -= 35;
    uncertainties.push("Kilden kunne ikke scannes");
  }
  if (item.is_discovery) uncertainties.push("Ny pulje eller udbyder; kriterier bør verificeres");
  return { score: Math.max(0, Math.min(100, score)), uncertainties };
}

export function callSignalScore(item) {
  const title = normalize(item.discovered_title);
  const text = normalize(`${item.discovered_title || ""} ${item.excerpt || ""} ${item.discovered_url || ""}`);
  let score = 0;
  if (item.match_type === "discovery_call") score += 40;
  if (item.match_type === "crawler_open_call") score += 45;
  if (item.match_type === "page_text") score += 22;
  if (item.match_type === "call_link") score += 16;
  if (/pulje|opslag|open call|call for proposals/.test(title)) score += 22;
  if (/deadline|frist|ansøg senest|apply by|\b202\d\b|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text)) score += 18;
  if (/åben for ansøg|open for application|løbende frist/.test(text)) score += 18;
  if (/^søg støtte$|^ansøg$|^ansøgning$|^for ansøgere$|^tilskud & puljer$|^uddelinger$/.test(title)) score -= 18;
  if (/^(se )?tilskud & puljer$|^uddelingspuljer$|^tilskud og puljer for/.test(title)) score -= 24;
  if (/muligt opslag fundet på siden/.test(title)) score -= 15;
  if (/login|log på|ansøgningsportal|survey-xact|afrapportering|regnskab|bevilgede indsatser|uddelingsudvalg|sådan søger|gode råd/.test(text)) score -= 24;
  return Math.max(0, Math.min(100, score));
}

function programSnapshot(program, deadline) {
  return {
    application_status: program.application_status || "",
    deadline_summary: program.deadline_summary || "",
    support_areas: program.support_areas || "",
    applicant_types: program.applicant_types || "",
    application_url: program.application_url || "",
    deadline_status: deadline?.status || "",
    opens_on: deadline?.opens_on || "",
    closes_on: deadline?.closes_on || "",
  };
}

function snapshotChanges(previous, current) {
  if (!previous) return [];
  const labels = {
    application_status: "ansøgningsstatus",
    deadline_summary: "fristtekst",
    support_areas: "støtteområder",
    applicant_types: "ansøgerkrav",
    application_url: "ansøgningslink",
    deadline_status: "friststatus",
    opens_on: "åbningsdato",
    closes_on: "deadline",
  };
  return Object.keys(labels)
    .filter((key) => String(previous[key] || "") !== String(current[key] || ""))
    .map((key) => ({ field: labels[key], from: previous[key] || "ikke angivet", to: current[key] || "ikke angivet" }));
}

function deadlineBucket(closesOn) {
  if (!closesOn) return null;
  const closes = new Date(`${closesOn}T23:59:59Z`);
  const days = Math.ceil((closes - now) / 86400000);
  if (days < 0 || days > 60) return null;
  if (days <= 14) return "14 dage";
  if (days <= 30) return "30 dage";
  return "60 dage";
}

function enrichCall(call, programById, foundationById) {
  const program = programById.get(call.program_id) || {};
  const foundation = foundationById.get(call.foundation_id) || {};
  const item = {
    ...call,
    support_areas: program.support_areas || foundation.support_areas || "",
    application_status: program.application_status || "",
    verification_status: program.verification_status || foundation.verification_status || "",
    url: call.discovered_url || program.application_url || foundation.application_url || foundation.website,
  };
  const confidence = confidenceScore(item);
  return { ...item, relevance: relevanceScore(item), confidence: confidence.score, call_signal: callSignalScore(item), uncertainties: confidence.uncertainties };
}

export function buildDigestModel({ foundations, programs, deadlines, calls, discoveries = [], state }) {
  const foundationById = new Map(foundations.map((item) => [item.foundation_id, item]));
  const programById = new Map(programs.map((item) => [item.program_id, item]));
  const deadlineByProgram = new Map(deadlines.map((item) => [item.program_id, item]));
  const seen = new Set(state.seen_call_ids || []);
  const contactByProgram = new Map();
  for (const call of calls) {
    if (call.contact_name && !contactByProgram.has(call.program_id)) contactByProgram.set(call.program_id, call);
  }

  const discoveryCalls = discoveries
    .filter((item) => item.scan_status === "found" && item.qualification_status === "qualified")
    .map((item) => ({
      scan_result_id: `discovery-${item.discovery_id}`,
      foundation_id: `discovery-${item.provider_name}`,
      program_id: `discovery-${item.discovery_id}`,
      foundation_name: item.provider_name || item.source_name,
      program_name: item.title,
      scan_url: item.source_name,
      scan_status: "found",
      match_type: "discovery_call",
      discovered_title: item.title,
      discovered_url: item.url,
      excerpt: item.excerpt,
      verification_status: "to_verify",
      is_discovery: true,
      discovery_source: item.source_name,
      qualification_score: Number(item.qualification_score || 0),
      closes_on: item.closes_on || "",
      applicant_hint: item.applicant_hint || "",
      contact_name: item.contact_name || "",
      contact_email: item.contact_email || "",
      contact_phone: item.contact_phone || "",
      contact_source_url: item.contact_source_url || "",
    }));

  const knownUrls = new Set(calls.map((item) => item.discovered_url || item.scan_url).filter(Boolean).map((url) => String(url).replace(/\/$/, "")));
  const scoredCalls = [...calls, ...discoveryCalls.filter((item) => !knownUrls.has(String(item.discovered_url).replace(/\/$/, "")))]
    .filter((item) => item.scan_status === "found")
    .map((item) => enrichCall(item, programById, foundationById))
    .filter((item) => !/lukket|closed/i.test(item.application_status))
    .filter((item) => item.relevance >= minRelevance)
    .filter((item) => item.call_signal >= 38);

  const knownRelevantCalls = scoredCalls
    .filter((item) => !item.is_discovery)
    .sort((a, b) => b.relevance - a.relevance || b.confidence - a.confidence);
  const qualifiedDiscoveryCalls = scoredCalls
    .filter((item) => item.is_discovery)
    .sort((a, b) => b.qualification_score - a.qualification_score || Boolean(b.closes_on) - Boolean(a.closes_on) || b.relevance - a.relevance)
    .slice(0, maxDiscoveryCalls);
  const relevantCalls = [...knownRelevantCalls, ...qualifiedDiscoveryCalls];

  const newCalls = relevantCalls.filter((item) => !seen.has(item.scan_result_id));
  const upcomingDeadlines = deadlines
    .map((deadline) => {
      const eventDate = deadline.closes_on || (deadline.status === "upcoming" ? deadline.opens_on : "");
      const bucket = deadlineBucket(eventDate);
      if (!bucket) return null;
      const program = programById.get(deadline.program_id) || {};
      const foundation = foundationById.get(program.foundation_id) || {};
      const item = {
        ...deadline,
        bucket,
        event_date: eventDate,
        event_type: deadline.closes_on ? "deadline" : "åbner",
        foundation_name: foundation.name || "Ukendt aktør",
        program_name: program.program_name || deadline.program_id,
        support_areas: program.support_areas || foundation.support_areas || "",
        verification_status: deadline.verification_status || program.verification_status,
        url: program.application_url || foundation.application_url || foundation.website,
        contact_name: contactByProgram.get(deadline.program_id)?.contact_name || "",
        contact_email: contactByProgram.get(deadline.program_id)?.contact_email || "",
        contact_phone: contactByProgram.get(deadline.program_id)?.contact_phone || "",
        contact_source_url: contactByProgram.get(deadline.program_id)?.contact_source_url || "",
      };
      const confidence = confidenceScore(item);
      return { ...item, relevance: relevanceScore(item), confidence: confidence.score, uncertainties: confidence.uncertainties };
    })
    .filter(Boolean)
    .filter((item) => item.relevance >= minRelevance)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));

  const changes = [];
  const currentSnapshots = {};
  for (const program of programs) {
    const current = programSnapshot(program, deadlineByProgram.get(program.program_id));
    currentSnapshots[program.program_id] = current;
    const fields = snapshotChanges(state.program_snapshots?.[program.program_id], current);
    if (!fields.length) continue;
    const foundation = foundationById.get(program.foundation_id) || {};
    changes.push({
      foundation_name: foundation.name || program.foundation_id,
      program_name: program.program_name,
      url: program.application_url || foundation.application_url || foundation.website,
      fields,
      relevance: relevanceScore({ ...program, foundation_name: foundation.name }),
    });
  }

  const discoveryErrors = discoveries
    .filter((item) => item.scan_status === "error")
    .map((item) => ({ ...item, foundation_name: item.provider_name || item.source_name, program_name: "Discovery-kilde", match_type: "discovery_error", discovered_url: item.url, verification_status: "to_verify", is_discovery: true }));
  const errors = [...calls.filter((item) => item.scan_status === "error" && !String(item.match_type || "").startsWith("crawler_")), ...discoveryErrors].map((item) => {
    const confidence = confidenceScore(item);
    return { ...item, confidence: confidence.score, uncertainties: confidence.uncertainties };
  });

  return {
    generated_at: now.toISOString(),
    period_start: state.last_delivered_at,
    new_calls: newCalls,
    deadlines: upcomingDeadlines,
    changes: changes.filter((item) => item.relevance >= minRelevance),
    errors,
    stats: {
      foundations: foundations.length,
      programs: programs.length,
      relevant_calls: relevantCalls.length,
      discovery_calls: relevantCalls.filter((item) => item.is_discovery).length,
      new_calls: newCalls.length,
      upcoming_deadlines: upcomingDeadlines.length,
      changes: changes.length,
      scan_errors: errors.length,
    },
    next_state: {
      version: 1,
      last_delivered_at: now.toISOString(),
      seen_call_ids: [...new Set([...(state.seen_call_ids || []), ...relevantCalls.map((item) => item.scan_result_id)])].sort(),
      program_snapshots: currentSnapshots,
    },
  };
}

function itemLink(item, label) {
  return item.url ? `<a href="${escapeHtml(item.url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

function scoreBadges(item) {
  const uncertainty = item.uncertainties?.length ? `<br><small>Usikkerhed: ${escapeHtml(item.uncertainties.join("; "))}</small>` : "";
  return `<small>Relevans ${item.relevance ?? "-"}/100 · Sikkerhed ${item.confidence ?? "-"}/100</small>${uncertainty}`;
}

function contactHtml(item) {
  if (!item.contact_name) return "";
  const details = [
    item.contact_email ? `<a href="mailto:${escapeHtml(item.contact_email)}">${escapeHtml(item.contact_email)}</a>` : "",
    item.contact_phone ? escapeHtml(item.contact_phone) : "",
  ].filter(Boolean).join(" · ");
  const source = item.contact_source_url ? ` · <a href="${escapeHtml(item.contact_source_url)}">kilde</a>` : "";
  return `<br><small>Kontakt: ${escapeHtml(item.contact_name)}${details ? ` · ${details}` : ""}${source}</small>`;
}

function discoveryHtml(item) {
  if (!item.is_discovery) return "";
  const applicant = item.applicant_hint ? `<br><small>Hvem kan søge: ${escapeHtml(item.applicant_hint)}</small>` : "";
  return `<br><small><strong>Ny, kvalificeret pulje/udbyder</strong> · fundet via ${escapeHtml(item.discovery_source)} · kvalificering ${item.qualification_score}/100</small>${applicant}`;
}

function discoveryText(item) {
  return item.is_discovery ? ` | NY KVALIFICERET PULJE/UDBYDER via ${item.discovery_source} (${item.qualification_score}/100)${item.applicant_hint ? ` | hvem kan søge: ${item.applicant_hint}` : ""}` : "";
}

function contactText(item) {
  if (!item.contact_name) return "";
  return ` | kontakt: ${[item.contact_name, item.contact_email, item.contact_phone].filter(Boolean).join(" · ")}`;
}

function deadlineHtml(item) {
  if (!item) return "";
  const label = item.event_type === "åbner" ? "Åbner" : "Deadline";
  return `<br><small>${label}: <strong>${escapeHtml(item.event_date)}</strong> (${escapeHtml(item.bucket)})</small>`;
}

function deadlineText(item) {
  if (!item) return "";
  const label = item.event_type === "åbner" ? "åbner" : "deadline";
  return ` | ${label}: ${item.event_date}`;
}

export function renderHtml(model) {
  const sections = [];
  if (model.new_calls.length || model.deadlines.length) {
    const deadlinesByProgram = new Map(model.deadlines.map((item) => [item.program_id, item]));
    const displayedPrograms = new Set(model.new_calls.map((item) => item.program_id));
    const callRows = model.new_calls.map((item) => {
      const deadline = deadlinesByProgram.get(item.program_id) || (item.closes_on ? { event_type: "deadline", event_date: item.closes_on, bucket: deadlineBucket(item.closes_on) || "aktuel" } : null);
      return `<li>${itemLink(item, item.match_type === "page_text" ? item.program_name : (item.discovered_title || item.program_name || "Nyt fund"))} — ${escapeHtml(item.foundation_name)}${discoveryHtml(item)}${deadlineHtml(deadline)}${contactHtml(item)}<br>${scoreBadges(item)}</li>`;
    });
    const deadlineOnlyRows = model.deadlines
      .filter((item) => !displayedPrograms.has(item.program_id))
      .map((item) => `<li>${itemLink(item, item.program_name)} — ${escapeHtml(item.foundation_name)}${deadlineHtml(item)}${contactHtml(item)}<br>${scoreBadges(item)}</li>`);
    sections.push(`<h2>Relevante puljer, calls og deadlines</h2><ul>${[...callRows, ...deadlineOnlyRows].join("")}</ul>`);
  }
  if (model.changes.length) {
    sections.push(`<h2>Ændringer</h2><ul>${model.changes.map((item) => `<li>${itemLink(item, `${item.foundation_name}: ${item.program_name}`)}<ul>${item.fields.map((change) => `<li>${escapeHtml(change.field)}: ${escapeHtml(change.from)} → ${escapeHtml(change.to)}</li>`).join("")}</ul></li>`).join("")}</ul>`);
  }
  sections.push(`<h2>Datakvalitet</h2><p>${model.errors.length ? `${model.errors.length} kilder havde scanproblemer. De er ikke præsenteret som sikre nye puljer.` : "Alle kilder blev scannet uden tekniske fejl."}</p>`);
  if (!model.new_calls.length && !model.deadlines.length && !model.changes.length) sections.unshift("<p>Ingen nye relevante ændringer siden sidste udsendelse.</p>");
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#17212b;line-height:1.5}h1{margin-bottom:4px}h2{margin-top:28px}li{margin:9px 0}a{color:#0969da}small{color:#59636e}.meta{color:#59636e}</style></head><body><h1>Sustainary Fondsblik</h1><p class="meta">Relevante puljer, deadlines og kontaktpersoner · ${escapeHtml(dateOnly(now))}</p>${sections.join("")}<hr><p class="meta">${model.stats.foundations} aktører · ${model.stats.programs} programmer · ${model.stats.scan_errors} scanfejl</p></body></html>`;
}

export function renderText(model) {
  const lines = ["SUSTAINARY FONDSBLIK", "Relevante puljer, deadlines og kontaktpersoner", `Genereret: ${model.generated_at}`, ""];
  if (model.new_calls.length || model.deadlines.length) {
    lines.push("RELEVANTE PULJER, CALLS OG DEADLINES");
    const deadlinesByProgram = new Map(model.deadlines.map((item) => [item.program_id, item]));
    const displayedPrograms = new Set(model.new_calls.map((item) => item.program_id));
    for (const item of model.new_calls) {
      const deadline = deadlinesByProgram.get(item.program_id) || (item.closes_on ? { event_type: "deadline", event_date: item.closes_on } : null);
      lines.push(`- ${item.foundation_name}: ${item.match_type === "page_text" ? item.program_name : (item.discovered_title || item.program_name)}${discoveryText(item)}${deadlineText(deadline)} | relevans ${item.relevance}/100 | sikkerhed ${item.confidence}/100${contactText(item)} | ${item.url}`);
    }
    for (const item of model.deadlines.filter((deadline) => !displayedPrograms.has(deadline.program_id))) {
      lines.push(`- ${item.foundation_name}: ${item.program_name}${deadlineText(item)} | relevans ${item.relevance}/100 | sikkerhed ${item.confidence}/100${contactText(item)} | ${item.url}`);
    }
    lines.push("");
  }
  if (model.changes.length) {
    lines.push("ÆNDRINGER");
    for (const item of model.changes) lines.push(`- ${item.foundation_name}: ${item.program_name} — ${item.fields.map((field) => field.field).join(", ")} | ${item.url}`);
    lines.push("");
  }
  lines.push("DATAKVALITET", model.errors.length ? `${model.errors.length} kilder havde scanproblemer.` : "Alle kilder blev scannet uden tekniske fejl.");
  return `${lines.join("\n")}\n`;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function sendWithResend({ html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DIGEST_FROM || "info@sustainary.org";
  const to = (process.env.DIGEST_TO || "mpv@sustainary.org,valdemar@sustainary.org,manuela@sustainary.org").split(",").map((item) => item.trim()).filter(Boolean);
  if (!apiKey) throw new Error("RESEND_API_KEY mangler");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `Sustainary fondsupdate · ${dateOnly(now)}`, html, text }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Resend returnerede HTTP ${response.status}: ${body}`);
  return JSON.parse(body);
}

async function main() {
  const [foundationsText, programsText, deadlinesText, callsText, discoveriesText, state] = await Promise.all([
    fs.readFile(path.join(root, "data", "fonde_seed.csv"), "utf8"),
    fs.readFile(path.join(root, "data", "programs_seed.csv"), "utf8"),
    fs.readFile(path.join(root, "data", "deadlines_seed.csv"), "utf8"),
    fs.readFile(path.join(root, "data", "call_scan_results.csv"), "utf8"),
    fs.readFile(path.join(root, "data", "discovery_results.csv"), "utf8").catch(() => ""),
    readJson(statePath, { version: 1, last_delivered_at: null, seen_call_ids: [], program_snapshots: {} }),
  ]);
  const model = buildDigestModel({
    foundations: parseCsv(foundationsText),
    programs: parseCsv(programsText),
    deadlines: parseCsv(deadlinesText),
    calls: parseCsv(callsText),
    discoveries: discoveriesText ? parseCsv(discoveriesText) : [],
    state,
  });
  const html = renderHtml(model);
  const text = renderText(model);
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "latest.html"), html, "utf8"),
    fs.writeFile(path.join(outputDir, "latest.txt"), text, "utf8"),
    fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify({ ...model, next_state: undefined }, null, 2)}\n`, "utf8"),
  ]);

  if (shouldSend) {
    const result = await sendWithResend({ html, text });
    console.log(`Mail sendt via Resend: ${result.id}`);
  } else {
    console.log("Preview genereret; mail blev ikke sendt.");
  }
  if (shouldUpdateState) await fs.writeFile(statePath, `${JSON.stringify(model.next_state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(model.stats));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
