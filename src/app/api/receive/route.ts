import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  const qty = Number(body.qty);
  if (!id || !Number.isFinite(qty)) {
    return NextResponse.json({ error: "id and qty are required" }, { status: 400 });
  }

  const expiry: string | null = body.expiry || null;

  try {
    const [updated] = await db
      .update(products)
      .set({
        stock: sql`${products.stock} + ${qty}`,
        ...(expiry ? { expiry, needsExpiry: false, expiredNotified: false } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    await db.insert(events).values({
      productId: id,
      kind: "receive",
      qtyDelta: qty,
      expirySet: expiry,
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23514") {
      return NextResponse.json({ error: "That would make stock negative" }, { status: 400 });
    }
    throw err;
  }
}
