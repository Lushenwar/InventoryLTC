import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { products } from "../drizzle/schema.js";

// One-off, idempotent: the legacy sheet crammed multi-lot items into one row with the
// per-lot breakdown stashed in `note` (e.g. "7/8/2026=1000\n8/20/2026=300"). This splits
// those into one row per (expiry, qty) lot so each lot gets its own status/countdown.
// Re-running is a no-op: after splitting, note is cleared and no longer parses as a breakdown.
const db = drizzle(neon(process.env.DATABASE_URL!));

// Returns the lots if `note` is purely a "M/D/YYYY=qty" breakdown of 2+ lines, else null.
function parseLots(note: string): { expiry: string; qty: number }[] | null {
  const lines = note.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const lots: { expiry: string; qty: number }[] = [];
  for (const line of lines) {
    const m = line.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*=\s*(\d+)$/);
    if (!m) return null; // not a clean breakdown -> leave the note alone
    const [, mo, d, y, q] = m;
    lots.push({ expiry: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, qty: Number(q) });
  }
  return lots;
}

async function main() {
  const rows = await db.select().from(products);
  let split = 0, added = 0;
  for (const p of rows) {
    const lots = parseLots(p.note);
    if (!lots) continue;
    const total = lots.reduce((s, l) => s + l.qty, 0);
    if (total !== p.stock) {
      console.warn(`! "${p.name}" (id ${p.id}): lot sum ${total} != stock ${p.stock}; skipping`);
      continue;
    }
    lots.sort((a, b) => a.expiry.localeCompare(b.expiry));
    const [first, ...rest] = lots;
    // Reuse the original row as the earliest lot (keeps its id + event history intact).
    await db.update(products).set({ expiry: first.expiry, stock: first.qty, needsExpiry: false, note: "" }).where(eq(products.id, p.id));
    for (const lot of rest) {
      await db.insert(products).values({ code: p.code, name: p.name, uom: p.uom, location: p.location, stock: lot.qty, expiry: lot.expiry, needsExpiry: false, note: "" });
      added++;
    }
    split++;
    console.log(`Split "${p.name}" (id ${p.id}) into ${lots.length} lots`);
  }
  console.log(`Done: ${split} products split, ${added} new lot rows added`);
}

main().catch((e) => { console.error(e); process.exit(1); });
