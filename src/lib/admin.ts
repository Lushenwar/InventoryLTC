import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// ponytail: one shared passcode gating every write that touches a product record --
// create, receive, edit, remove stock, delete -- not real per-user accounts. HAA pickup
// is the one open path: floor staff record their own orders. No rate limiting --
// acceptable for a low-stakes internal tool with no PHI/financial data; add throttling
// if that changes.
export function verifyAdminPasscode(provided: string | null): boolean {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Guard for a write route: a 403 to return when the passcode is missing/wrong, else null. */
export function adminGate(req: Request, action: string): NextResponse | null {
  if (verifyAdminPasscode(req.headers.get("x-admin-passcode"))) return null;
  return NextResponse.json({ error: `Admin passcode required to ${action}` }, { status: 403 });
}
