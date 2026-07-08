import { NextRequest, NextResponse } from "next/server";
import { getExpiring, getNewlyExpired, getAllExpired, markExpiredNotified } from "@/lib/reminders";
import { buildExpiringText, buildExpiredText, sendEmail } from "@/lib/dispatch";
import { facilityToday } from "@/lib/expiry";

// Runs daily. Two independent emails, neither sent every day:
//   1. EXPIRED alert -- fires only when something has newly expired since the last
//      run; lists the newly-expired items plus a summary of everything still expired,
//      then marks them so the same item is never emailed twice.
//   2. EXPIRING digest -- a weekly roundup of everything within 30 days, sent Mondays
//      only. Weekly not monthly: a 30-day horizon needs more than one look a month, or
//      an item entering the window just after a send could sit ~4 weeks before it shows.
//      ponytail: day-of-week check instead of a second cron entry.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = facilityToday();
  let expiredSent = 0;
  let expiringSent = 0;

  // 1. Expired alert (notify-once)
  const newlyExpired = await getNewlyExpired(today);
  if (newlyExpired.length) {
    const allExpired = await getAllExpired(today);
    const subject = `${newlyExpired.length} supply item(s) have expired`;
    const result = await sendEmail(subject, buildExpiredText(newlyExpired, allExpired, today));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    await markExpiredNotified(newlyExpired.map((i) => i.id));
    expiredSent = newlyExpired.length;
  }

  // 2. Expiring digest (weekly, Mondays). UTC on a date-only string -> no TZ drift.
  if (new Date(today + "T00:00:00Z").getUTCDay() === 1) {
    const expiring = await getExpiring(today, 30);
    if (expiring.length) {
      const subject = `${expiring.length} supply item(s) expiring within 30 days`;
      const result = await sendEmail(subject, buildExpiringText(expiring, today));
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
      expiringSent = expiring.length;
    }
  }

  return NextResponse.json({ ok: true, expiredSent, expiringSent });
}
