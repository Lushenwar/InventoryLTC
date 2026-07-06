import "server-only";
import { timingSafeEqual } from "node:crypto";

// ponytail: one shared passcode gating expiry-override and delete, not real
// per-user accounts. No rate limiting -- acceptable for a low-stakes internal
// tool with no PHI/financial data; add throttling if that changes.
export function verifyAdminPasscode(provided: string | null): boolean {
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
