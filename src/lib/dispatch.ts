import "server-only";
import type { ExpiringItem, ExpiredItem } from "./reminders";

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

// Monthly digest: everything within 30 days of expiring.
export function buildExpiringText(items: ExpiringItem[], today: string): string {
  let msg = `Supplies expiring within 30 days -- ${today}\n`;
  msg += `Long-term care floor supply\n${"=".repeat(46)}\n\n`;
  msg += `EXPIRING SOON (${items.length})\n`;
  msg += groupByLocation(items, (i) => `   - ${i.name} -- ${i.expiry} (${i.daysToExpiry}d)`);
  msg += "\n\nPlan to use or replace these before they expire.";
  return msg;
}

// Fires the day items expire: what's newly expired, plus every item still expired.
export function buildExpiredText(newly: ExpiredItem[], allExpired: ExpiredItem[], today: string): string {
  let msg = `Supplies have EXPIRED -- ${today}\n`;
  msg += `Long-term care floor supply\n${"=".repeat(46)}\n\n`;
  msg += `NEWLY EXPIRED -- remove / verify (${newly.length})\n`;
  msg += groupByLocation(newly, (i) => `   - ${i.name} -- expired ${i.expiry}`);
  msg += "\n\n";

  const olderExpired = allExpired.filter((a) => !newly.some((n) => n.id === a.id));
  if (olderExpired.length) {
    msg += `STILL EXPIRED from before (${olderExpired.length})\n`;
    msg += groupByLocation(olderExpired, (i) => `   - ${i.name} -- expired ${i.expiry}`);
    msg += "\n\n";
  }
  msg += "Pull expired stock and reconcile counts.";
  return msg;
}

export async function sendEmail(subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REMINDER_EMAIL_TO;
  const from = process.env.REMINDER_EMAIL_FROM;
  if (!apiKey || !to || !from) {
    return { ok: false, error: "Missing RESEND_API_KEY, REMINDER_EMAIL_TO, or REMINDER_EMAIL_FROM" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject, text }),
  });

  if (!res.ok) {
    return { ok: false, error: `Resend API error: ${res.status} ${await res.text()}` };
  }
  return { ok: true };
}
