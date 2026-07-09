// Single source of truth for expiry status + thresholds. The table, badges,
// filters, and (later) the cron all read status through this file.

export type StatusKey = "expired" | "soon" | "watch" | "ok" | "flag" | "none" | "oos";

export interface StatusInfo {
  key: StatusKey;
  days: number | null;
}

export const STATUS_META: Record<StatusKey, { label: string; cls: string }> = {
  expired: { label: "Expired", cls: "b-expired" },
  soon: { label: "Expiring", cls: "b-soon" },
  watch: { label: "Watch", cls: "b-watch" },
  ok: { label: "In date", cls: "b-ok" },
  flag: { label: "Needs date", cls: "b-flag" },
  none: { label: "No expiry", cls: "b-none" },
  oos: { label: "Out of stock", cls: "b-oos" },
};

const FACILITY_TZ = "America/Toronto"; // ponytail: single-facility hardcode; add a setting if a second location ever needs its own clock

// Calendar day (YYYY-MM-DD) in the facility's timezone, not the server's --
// a Vercel function's `new Date()` is UTC, which drifts a day off local
// midnight and would flip reminders a day early/late.
export function facilityToday(tz: string = FACILITY_TZ): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toUTCDayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysUntil(expiry: string | null, todayStr: string): number | null {
  if (!expiry) return null;
  return toUTCDayNumber(expiry) - toUTCDayNumber(todayStr);
}

// Zero on hand means we don't physically have the item, so an expiry status is
// meaningless -- it reads as "Out of stock" and drops out of expiry alerts.
export function statusOf(expiry: string | null, needsExpiry: boolean, todayStr: string, stock = 1): StatusInfo {
  if (stock <= 0) return { key: "oos", days: null };
  if (expiry) {
    const days = daysUntil(expiry, todayStr);
    if (days === null) return { key: "none", days: null };
    if (days < 0) return { key: "expired", days };
    if (days <= 30) return { key: "soon", days };
    if (days <= 90) return { key: "watch", days };
    return { key: "ok", days };
  }
  return { key: needsExpiry ? "flag" : "none", days: null };
}
