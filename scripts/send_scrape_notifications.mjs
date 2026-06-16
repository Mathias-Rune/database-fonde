import { execFile } from "node:child_process";
import path from "node:path";
import { runSqlite, sqlString } from "./sqlite_utils.mjs";

const rootDir = process.cwd();
const dbPath = path.join(rootDir, "outputs", "fonds_database.sqlite");
const to = process.env.NOTIFICATION_EMAIL_TO;
const from = process.env.NOTIFICATION_EMAIL_FROM || "fondsdatabase@localhost";
const sendmailPath = process.env.SENDMAIL_PATH || "/usr/sbin/sendmail";

function sendMail(message) {
  return new Promise((resolve, reject) => {
    const child = execFile(sendmailPath, ["-t"], { timeout: 30000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.write(message);
    child.stdin.end();
  });
}

if (!to) {
  await runSqlite(
    dbPath,
    `UPDATE scrape_notifications SET status = 'disabled', error_message = 'NOTIFICATION_EMAIL_TO is not configured' WHERE status = 'queued';`,
  );
  console.log(JSON.stringify({ sent: 0, disabled: true, reason: "NOTIFICATION_EMAIL_TO missing" }, null, 2));
  process.exit(0);
}

const notifications = await runSqlite(
  dbPath,
  "SELECT notification_id, subject, body FROM scrape_notifications WHERE status = 'queued' ORDER BY notification_id LIMIT 20;",
);

let sent = 0;
for (const notification of notifications) {
  const message = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${notification.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    notification.body,
    "",
  ].join("\n");

  try {
    await sendMail(message);
    sent += 1;
    await runSqlite(
      dbPath,
      `UPDATE scrape_notifications SET status = 'sent', sent_at = ${sqlString(new Date().toISOString())} WHERE notification_id = ${notification.notification_id};`,
    );
  } catch (error) {
    await runSqlite(
      dbPath,
      `UPDATE scrape_notifications SET status = 'failed', error_message = ${sqlString(error.message)} WHERE notification_id = ${notification.notification_id};`,
    );
  }
}

console.log(JSON.stringify({ sent, checked: notifications.length }, null, 2));
