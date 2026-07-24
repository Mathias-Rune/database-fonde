import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const dbPath = process.env.FONDS_DB_PATH || path.join(root, "outputs", "fonds_database.sqlite");
const digestDir = process.env.NOTIFICATION_DIGEST_DIR || path.join(root, "data");
const now = new Date();
const nowIso = now.toISOString();
const args = new Set(process.argv.slice(2));
const shouldSend = args.has("--send");
const shouldMarkSent = args.has("--mark-sent");
const lookbackDays = Number(process.env.NOTIFICATION_LOOKBACK_DAYS || "7");
const minCallQuality = Number(process.env.NOTIFICATION_MIN_CALL_QUALITY || "40");

function stableId(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 20);
}

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function scanQuality(scan) {
  const text = `${scan.discovered_title || ""} ${scan.excerpt || ""} ${scan.discovered_url || ""}`.toLocaleLowerCase("da");
  let score = 0;

  if (scan.match_type === "crawler_open_call") score += 45;
  if (scan.match_type === "page_text") score += 22;
  if (scan.match_type === "call_link") score += 16;
  if (/deadline|frist|ansøgningsfrist|ansøg senest|apply by|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|202\d/.test(text)) score += 28;
  if (/open call|call for proposals|pulje|opslag|ansøg om støtte|søg støtte|start ansøgning/.test(text)) score += 16;
  if (/crawler status: open|løbende frist|rolling/.test(text)) score += 18;
  if (/støtter vi ikke|stoetter vi ikke|stotter vi ikke|bevillingsmodtagere|skriv en god ansøgning|how-to-apply|sådan søger du/.test(text)) score -= 16;
  if (/mail|@|nyhedsbrev|cookie|login/.test(text)) score -= 12;

  return Math.max(0, Math.min(100, score));
}

async function sqlite(sql, { json = false } = {}) {
  const args = json ? ["-json", dbPath, sql] : [dbPath, sql];
  const { stdout } = await execFileAsync("sqlite3", args, {
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!json) return stdout;
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

async function ensureSchema() {
  const columns = await sqlite("PRAGMA table_info(notification_subscriptions);", { json: true });
  const hasNewCallColumn = columns.some((column) => column.name === "notify_new_call");
  if (!hasNewCallColumn) {
    await sqlite("ALTER TABLE notification_subscriptions ADD COLUMN notify_new_call INTEGER NOT NULL DEFAULT 1;");
  }
}

async function upsertEnvSubscription() {
  const email = process.env.NOTIFY_EMAIL?.trim();
  if (!email) return null;

  const subscriptionId = stableId(["subscription", email.toLocaleLowerCase("da")]);
  await sqlite(`
    INSERT INTO notification_subscriptions (
      subscription_id,
      email,
      notify_deadline_soon,
      notify_new_foundation,
      notify_new_call,
      notify_favorite_update,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlQuote(subscriptionId)},
      ${sqlQuote(email)},
      ${process.env.NOTIFY_DEADLINE_SOON === "0" ? 0 : 1},
      ${process.env.NOTIFY_NEW_FOUNDATION === "0" ? 0 : 1},
      ${process.env.NOTIFY_NEW_CALL === "0" ? 0 : 1},
      ${process.env.NOTIFY_FAVORITE_UPDATE === "0" ? 0 : 1},
      ${sqlQuote(nowIso)},
      ${sqlQuote(nowIso)}
    )
    ON CONFLICT(email) DO UPDATE SET
      notify_deadline_soon = excluded.notify_deadline_soon,
      notify_new_foundation = excluded.notify_new_foundation,
      notify_new_call = excluded.notify_new_call,
      notify_favorite_update = excluded.notify_favorite_update,
      updated_at = excluded.updated_at;
  `);

  const favorites = (process.env.FAVORITE_FOUNDATION_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const foundationId of favorites) {
    await sqlite(`
      INSERT OR IGNORE INTO favorite_foundations (favorite_id, subscription_id, foundation_id, created_at)
      VALUES (
        ${sqlQuote(stableId(["favorite", subscriptionId, foundationId]))},
        ${sqlQuote(subscriptionId)},
        ${sqlQuote(foundationId)},
        ${sqlQuote(nowIso)}
      );
    `);
  }

  return subscriptionId;
}

async function insertEvent(event) {
  await sqlite(`
    INSERT OR IGNORE INTO notification_events (
      event_id,
      event_type,
      foundation_id,
      program_id,
      deadline_id,
      scan_result_id,
      title,
      body,
      event_date,
      created_at
    )
    VALUES (
      ${sqlQuote(event.event_id)},
      ${sqlQuote(event.event_type)},
      ${sqlQuote(event.foundation_id)},
      ${sqlQuote(event.program_id)},
      ${sqlQuote(event.deadline_id)},
      ${sqlQuote(event.scan_result_id)},
      ${sqlQuote(event.title)},
      ${sqlQuote(event.body)},
      ${sqlQuote(event.event_date)},
      ${sqlQuote(nowIso)}
    );
  `);
}

async function buildDeadlineEvents() {
  const today = dateOnly(now);
  const soon = dateOnly(addDays(now, 14));
  const rows = await sqlite(`
    SELECT
      d.deadline_id,
      d.program_id,
      d.closes_on,
      d.summary,
      p.program_name,
      f.foundation_id,
      f.name AS foundation_name
    FROM deadlines d
    JOIN programs p ON p.program_id = d.program_id
    JOIN foundations f ON f.foundation_id = p.foundation_id
    WHERE d.closes_on IS NOT NULL
      AND d.closes_on >= ${sqlQuote(today)}
      AND d.closes_on <= ${sqlQuote(soon)}
      AND d.status IN ('open', 'upcoming', 'to_verify');
  `, { json: true });

  return rows.map((row) => ({
    event_id: stableId(["deadline_soon", row.deadline_id, row.closes_on]),
    event_type: "deadline_soon",
    foundation_id: row.foundation_id,
    program_id: row.program_id,
    deadline_id: row.deadline_id,
    scan_result_id: null,
    title: `${row.program_name} lukker snart`,
    body: `${row.foundation_name} har frist ${row.closes_on}. ${row.summary || ""}`.trim(),
    event_date: row.closes_on,
  }));
}

async function buildNewCallEvents() {
  const since = new Date(now);
  since.setDate(since.getDate() - lookbackDays);
  const rows = await sqlite(`
    SELECT
      scan_result_id,
      foundation_id,
      program_id,
      foundation_name,
      program_name,
      match_type,
      discovered_title,
      discovered_url,
      excerpt,
      scanned_at
    FROM call_scan_results
    WHERE scan_status = 'found'
      AND review_status = 'new'
      AND match_type IN ('crawler_open_call', 'call_link', 'page_text')
      AND scanned_at >= ${sqlQuote(since.toISOString())};
  `, { json: true });

  return rows
    .map((row) => ({ ...row, quality_score: scanQuality(row) }))
    .filter((row) => row.quality_score >= minCallQuality)
    .map((row) => ({
    event_id: stableId(["new_call", row.scan_result_id]),
    event_type: "new_call",
    foundation_id: row.foundation_id,
    program_id: row.program_id,
    deadline_id: null,
    scan_result_id: row.scan_result_id,
    title: `Nyt call-fund: ${row.discovered_title || row.program_name}`,
    body: `${row.foundation_name} · kvalitet ${row.quality_score} · ${row.match_type} · ${row.excerpt || row.discovered_url || ""}`.trim(),
    event_date: row.scanned_at,
  }));
}

async function buildNewFoundationEvents() {
  const rows = await sqlite(`
    SELECT foundation_id, name, city, support_areas, last_checked
    FROM foundations
    WHERE verification_status IN ('source_checked', 'to_verify', 'needs_update');
  `, { json: true });

  return rows.map((row) => ({
    event_id: stableId(["new_foundation", row.foundation_id]),
    event_type: "new_foundation",
    foundation_id: row.foundation_id,
    program_id: null,
    deadline_id: null,
    scan_result_id: null,
    title: `Fond i databasen: ${row.name}`,
    body: `${row.city || "Danmark"} · ${row.support_areas || "Støtteområder skal tjekkes"}`,
    event_date: row.last_checked || nowIso,
  }));
}

async function buildFavoriteUpdateEvents() {
  const rows = await sqlite(`
    SELECT DISTINCT
      csr.scan_result_id,
      csr.foundation_id,
      csr.program_id,
      csr.foundation_name,
      csr.program_name,
      csr.match_type,
      csr.discovered_title,
      csr.discovered_url,
      csr.excerpt,
      csr.scanned_at
    FROM call_scan_results csr
    JOIN favorite_foundations ff ON ff.foundation_id = csr.foundation_id
    WHERE csr.scan_status = 'found'
      AND csr.review_status != 'ignored'
      AND csr.scanned_at >= ${sqlQuote(new Date(now.getTime() - lookbackDays * 86400000).toISOString())};
  `, { json: true });

  return rows
    .map((row) => ({ ...row, quality_score: scanQuality(row) }))
    .filter((row) => row.quality_score >= minCallQuality)
    .map((row) => ({
    event_id: stableId(["favorite_update", row.scan_result_id]),
    event_type: "favorite_update",
    foundation_id: row.foundation_id,
    program_id: row.program_id,
    deadline_id: null,
    scan_result_id: row.scan_result_id,
    title: `Favorit opdateret: ${row.foundation_name}`,
    body: `${row.program_name || "Program"} · kvalitet ${row.quality_score} · ${row.discovered_title || row.excerpt || "Nyt scan-fund"}`,
    event_date: row.scanned_at,
  }));
}

async function buildEvents() {
  const groups = await Promise.all([
    buildDeadlineEvents(),
    buildNewCallEvents(),
    buildNewFoundationEvents(),
    buildFavoriteUpdateEvents(),
  ]);
  const events = groups.flat();
  for (const event of events) {
    await insertEvent(event);
  }
  return events.length;
}

async function loadSubscriptions() {
  return sqlite(`
    SELECT
      subscription_id,
      email,
      notify_deadline_soon,
      notify_new_foundation,
      notify_new_call,
      notify_favorite_update
    FROM notification_subscriptions
    ORDER BY email;
  `, { json: true });
}

async function loadPendingEvents(subscription) {
  const enabledTypes = [
    subscription.notify_deadline_soon ? "deadline_soon" : null,
    subscription.notify_new_foundation ? "new_foundation" : null,
    subscription.notify_new_call ? "new_call" : null,
    subscription.notify_favorite_update ? "favorite_update" : null,
  ].filter(Boolean);

  if (!enabledTypes.length) return [];
  return sqlite(`
    SELECT
      event_id,
      event_type,
      title,
      body,
      event_date,
      foundation_id,
      program_id,
      deadline_id,
      scan_result_id
    FROM notification_events
    WHERE sent_at IS NULL
      AND event_type IN (${enabledTypes.map(sqlQuote).join(", ")})
    ORDER BY event_type, event_date DESC, title
    LIMIT 50;
  `, { json: true });
}

function renderDigest(subscription, events) {
  const lines = [
    `# Dansk Fondsdatabase alerts`,
    "",
    `Til: ${subscription.email}`,
    `Genereret: ${nowIso}`,
    "",
  ];

  if (!events.length) {
    lines.push("Ingen nye alerts lige nu.");
    return `${lines.join("\n")}\n`;
  }

  const labels = {
    deadline_soon: "Frister inden for 14 dage",
    new_foundation: "Fonde i databasen",
    new_call: "Nye call-fund",
    favorite_update: "Favorit-opdateringer",
  };

  for (const [type, label] of Object.entries(labels)) {
    const typeEvents = events.filter((event) => event.event_type === type);
    if (!typeEvents.length) continue;
    lines.push(`## ${label}`, "");
    typeEvents.forEach((event) => {
      lines.push(`- ${event.title}`);
      if (event.body) lines.push(`  ${event.body}`);
    });
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writeDigest(subscription, digest) {
  await fs.mkdir(digestDir, { recursive: true });
  const safeEmail = subscription.email.replace(/[^a-z0-9._-]+/gi, "_");
  const fileName = `notification_digest_${safeEmail}_${nowIso.replace(/[:.]/g, "-")}.md`;
  const digestPath = path.join(digestDir, fileName);
  await fs.writeFile(digestPath, digest, "utf8");
  return digestPath;
}

async function sendDigest(subscription, digest) {
  if (!process.env.SMTP_HOST) {
    throw new Error("SMTP_HOST mangler. Digest blev skrevet til fil i stedet.");
  }

  let nodemailer;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new Error("Nodemailer er ikke installeret. Kør evt. npm install nodemailer, eller brug digest-filen.");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "1",
    auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    } : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "fondsdb@localhost",
    to: subscription.email,
    subject: "Dansk Fondsdatabase alerts",
    text: digest,
  });
}

async function markEventsSent(events) {
  if (!events.length) return;
  await sqlite(`
    UPDATE notification_events
    SET sent_at = ${sqlQuote(nowIso)}
    WHERE event_id IN (${events.map((event) => sqlQuote(event.event_id)).join(", ")});
  `);
}

await ensureSchema();
await upsertEnvSubscription();
const builtCount = await buildEvents();
const subscriptions = await loadSubscriptions();

if (!subscriptions.length) {
  console.log("Ingen subscriptions. Sæt NOTIFY_EMAIL=din@email.dk for at oprette en lokal subscription.");
  console.log(`Oprettede/opdaterede ${builtCount} notification events.`);
  process.exit(0);
}

let totalPending = 0;
for (const subscription of subscriptions) {
  const events = await loadPendingEvents(subscription);
  totalPending += events.length;
  const digest = renderDigest(subscription, events);
  const digestPath = await writeDigest(subscription, digest);
  console.log(`${subscription.email}: ${events.length} pending alerts -> ${digestPath}`);

  if (shouldSend && events.length) {
    await sendDigest(subscription, digest);
    console.log(`${subscription.email}: email sendt`);
    await markEventsSent(events);
  } else if (shouldMarkSent && events.length) {
    await markEventsSent(events);
    console.log(`${subscription.email}: markeret som sendt`);
  }
}

console.log(`Oprettede/opdaterede ${builtCount} notification candidates. Pending i digest: ${totalPending}.`);
