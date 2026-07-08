import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

// Remove/consume stock from a specific lot row (used, wasted, expired-pulled, count fix).
// Open to all staff -- routine daily work -- but every removal is logged to `events` with
// its reason. Atomic `stock = stock - qty`; the non-negative CHECK stops over-removal.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  const qty = Number(body.qty);
  if (!id || !Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "id and a positive quantity are required" }, { status: 400 });
  }
  const reason = body.reason ? String(body.reason).trim() : "";

  try {
    const [updated] = await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${qty}`, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    await db.insert(events).values({ productId: id, kind: "adjust", qtyDelta: -qty, note: reason || null });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23514") {
      return NextResponse.json({ error: "That's more than is on hand" }, { status: 400 });
    }
    throw err;
  }
}
