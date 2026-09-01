import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";
import { verifyAdminPasscode } from "@/lib/admin";
import { withinUndoWindow } from "@/lib/undo";

// Undo one whole HAA pickup: hand every line's stock back and log the give-back.
//
// A typed 50 that should have been 5 is the one error the pickup path cannot catch -- it is
// under the on-hand count, under the quantity cap, and looks exactly like a real order. Before
// this, the only fix was finding someone with the passcode, and the ledger kept over-reporting
// that unit's usage forever. Now the person who filed it can take it straight back.
//
// The order is addressed by the `at` timestamp all of its lines share. Nothing is edited or
// deleted: the undo is new `pickup` rows with positive quantities, carrying the original order's
// note so the export still credits the correction to the right unit and picker, and pointing at
// the order they cancel via `reverses_at`. The ledger stays append-only and nets to zero.
//
// Open to floor staff for `UNDO_WINDOW_MS` after the order, admin-gated after that -- the same
// passcode every other count-changing write needs.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const raw = String(body.at ?? "");
  const at = new Date(raw);
  if (!raw || isNaN(at.getTime())) {
    return NextResponse.json({ error: "Which pickup? An order timestamp is required" }, { status: 400 });
  }

  // `reverses_at is null` keeps this to real orders: an undo is itself a pickup row, and
  // undoing one of those would put the mistake back.
  const lines = await db
    .select({ productId: events.productId, qtyDelta: events.qtyDelta, expirySet: events.expirySet, note: events.note })
    .from(events)
    .where(and(eq(events.kind, "pickup"), eq(events.at, at), isNull(events.reversesAt)));

  if (!lines.length) return NextResponse.json({ error: "That pickup is no longer on record" }, { status: 404 });

  const [already] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.reversesAt, at));
  if (already.n > 0) {
    return NextResponse.json({ error: "That pickup has already been undone" }, { status: 400 });
  }

  const isAdmin = verifyAdminPasscode(req.headers.get("x-admin-passcode"));
  if (!withinUndoWindow(at) && !isAdmin) {
    return NextResponse.json(
      { error: "Too long ago to undo on the floor — an admin can still take it back" },
      { status: 403 },
    );
  }

  const now = new Date();

  // Events first, stock second. Both orderings can half-apply (neon-http has no transactions),
  // but this one cannot pay the same order back twice: the unique index on
  // (reverses_at, product_id) rejects the duplicate before a single box moves.
  try {
    await db.insert(events).values(
      lines.map((l) => ({
        productId: l.productId,
        kind: "pickup",
        qtyDelta: Math.abs(l.qtyDelta ?? 0),
        expirySet: l.expirySet,
        note: l.note,
        actor: isAdmin ? "admin" : null,
        at: now,
        reversesAt: at,
      })),
    );
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return NextResponse.json({ error: "That pickup has already been undone" }, { status: 400 });
    }
    throw err;
  }

  for (const l of lines) {
    // The product was deleted after the pickup; there is no row to give the stock back to.
    // The event above still records the give-back, which is what the ledger needs.
    if (!l.productId) continue;
    const qty = Math.abs(l.qtyDelta ?? 0);
    await db
      .update(products)
      .set({
        stock: sql`${products.stock} + ${qty}`,
        // Put back the date the out-of-stock trigger wiped when this pickup emptied the lot.
        // `coalesce` so a lot that has since been received against keeps the date it has now.
        // ponytail: `needs_expiry` is not restored -- the trigger clears it too and the event
        // carries no record of it, so a flagged-but-undated lot comes back unflagged. Admin
        // re-flags it; storing the flag as well is the fix if that ever actually bites.
        ...(l.expirySet ? { expiry: sql`coalesce(${products.expiry}, ${l.expirySet}::date)` } : {}),
        updatedAt: now,
      })
      .where(eq(products.id, l.productId));
  }

  return NextResponse.json({ ok: true, count: lines.length });
}
