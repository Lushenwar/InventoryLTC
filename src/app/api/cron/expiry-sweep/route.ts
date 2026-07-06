import { NextRequest, NextResponse } from "next/server";
import { buildRollup } from "@/lib/reminders";
import { sendReminderEmail } from "@/lib/dispatch";
import { facilityToday } from "@/lib/expiry";

// ponytail: fixed 90-day window for the automated sweep, matching the "watch"
// threshold; the manual preview in the UI still lets staff pick 30/60/90/180.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rollup = await buildRollup(facilityToday(), 90);
  const result = await sendReminderEmail(rollup);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expired: rollup.expired.length,
    expiring: rollup.expiring.length,
    needsDate: rollup.needsDate.length,
    outOfStock: rollup.outOfStock.length,
  });
}
