import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

// HAA (Home Assistant Aide) pickup: one order removes stock from several lots at once.
// Each line is logged as a `pickup` event sharing the same `at` timestamp + note, so the
// global history can regroup them back into the single order they were part of.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const raw = Array.isArray(body.items) ? body.items : [];
  const unit = body.unit ? String(body.unit).trim() : "";
  const picker = body.picker ? String(body.picker).trim() : "";
  if (!unit) return NextResponse.json({ error: "Say which unit this order is for" }, { status: 400 });
  if (!picker) return NextResponse.json({ error: "Say who picked this up" }, { status: 400 });

  const items = raw
    .map((it: { id: unknown; qty: unknown }) => ({ id: Number(it.id), qty: Number(it.qty) }))
    .filter((it: { id: number; qty: number }) => it.id && Number.isFinite(it.qty) && it.qty > 0);
  if (!items.length) return NextResponse.json({ error: "Add at least one item to the order" }, { status: 400 });

  const ids = items.map((it: { id: number }) => it.id);
  const rows = await db.select({ id: products.id, stock: products.stock, name: products.name }).from(products).where(inArray(products.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const it of items) {
    const row = byId.get(it.id);
    if (!row) return NextResponse.json({ error: "One of the items no longer exists" }, { status: 404 });
    if (it.qty > row.stock) return NextResponse.json({ error: `Only ${row.stock} of "${row.name}" on hand` }, { status: 400 });
  }

  const at = new Date();
  // ponytail: unit + picker live in the free-text note, no new column. Add one if units ever
  // need to be filtered/reported on rather than just read back in history.
  const note = `HAA pickup — ${unit} · ${picker}`;
  try {
    // ponytail: no transaction (neon-http). Pre-validated above; the non-negative CHECK is the
    // backstop if stock races down between validate and apply. Fine at single-facility volume.
    for (const it of items) {
      await db.update(products).set({ stock: sql`${products.stock} - ${it.qty}`, updatedAt: at }).where(eq(products.id, it.id));
    }
    await db.insert(events).values(items.map((it: { id: number; qty: number }) => ({ productId: it.id, kind: "pickup", qtyDelta: -it.qty, note, at })));
    return NextResponse.json({ ok: true, count: items.length });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23514") {
      return NextResponse.json({ error: "Stock changed — one line is now more than is on hand" }, { status: 400 });
    }
    throw err;
  }
}
