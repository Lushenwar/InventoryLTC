import "server-only";
import type { Rollup } from "./reminders";

function groupByLocation<T extends { location: string }>(items: T[], line: (it: T) => string): string {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (!groups.has(it.location)) groups.set(it.location, []);
    groups.get(it.location)!.push(it);
  }
  return [...groups.keys()]
    .sort()
    .map((loc) => `${loc}\n${groups.get(loc)!.map(line).join("\n")}`)
    .join("\n\n");
}

export function buildReminderText(r: Rollup): string {
  let msg = `Supply expiry reminder -- ${r.generatedAt}\n`;
  msg += `Long-term care floor supply\n${"=".repeat(46)}\n\n`;

  if (r.expired.length) {
    msg += `EXPIRED -- remove / verify (${r.expired.length})\n`;
    msg += groupByLocation(r.expired, (i) => `   - ${i.name} -- EXPIRED ${i.expiry}`);
    msg += "\n\n";
  }
  if (r.expiring.length) {
    msg += `EXPIRING WITHIN ${r.windowDays} DAYS (${r.expiring.length})\n`;
    msg += groupByLocation(r.expiring, (i) => `   - ${i.name} -- ${i.expiry} (${i.daysToExpiry}d)`);
    msg += "\n\n";
  }
  if (r.needsDate.length) {
    msg += `MISSING EXPIRY DATE (${r.needsDate.length})\n`;
    msg += groupByLocation(r.needsDate, (i) => `   - ${i.name}`);
    msg += "\n\n";
  }
  if (r.outOfStock.length) {
    msg += `OUT OF STOCK (${r.outOfStock.length})\n`;
    msg += groupByLocation(r.outOfStock, (i) => `   - ${i.name}`);
    msg += "\n\n";
  }
  if (!r.expired.length && !r.expiring.length && !r.needsDate.length && !r.outOfStock.length) {
    msg += "Nothing to flag today.\n\n";
  }
  msg += "Please action expired and soon-to-expire items first.";
  return msg;
}

export async function sendReminderEmail(rollup: Rollup): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REMINDER_EMAIL_TO;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!apiKey || !to || !from) {
    return { ok: false, error: "Missing RESEND_API_KEY, REMINDER_EMAIL_TO, or REMINDER_EMAIL_FROM" };
  }

  const subject = `Supply expiry reminder -- ${rollup.expired.length} expired, ${rollup.expiring.length} expiring soon`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: to.split(",").map((s) => s.trim()),
      subject,
      text: buildReminderText(rollup),
    }),
  });

  if (!res.ok) {
    return { ok: false, error: `Resend API error: ${res.status} ${await res.text()}` };
  }
  return { ok: true };
}
