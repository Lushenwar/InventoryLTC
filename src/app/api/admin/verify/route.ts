import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPasscode } from "@/lib/admin";

// Lets the UI confirm a passcode immediately when unlocking admin mode,
// instead of only finding out it's wrong on the next gated action.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ok = verifyAdminPasscode(body.passcode ?? null);
  return NextResponse.json({ ok });
}
