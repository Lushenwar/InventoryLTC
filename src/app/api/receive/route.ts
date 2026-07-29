import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

// A "lot" is a (product, expiry) pair. Receiving stock with a *different* expiry than
// the picked row must not overwrite that row's date -- it lands on its own sibling row
// so each expiry keeps its own countdown/status/alert. Same or blank date tops up in
// place; a blank date on an undated row just adds quantity; a date on an undated row
// fills the date in.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  const qty = Number(body.qty);
  if (!id || !Number.isFinite(qty)) {
    return NextResponse.json({ error: "id and qty are required" }, { status: 400 });
  }
  const targetExpiry: string | null = body.expiry || null;

  const [picked] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!picked) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const fillsInDate = targetExpiry !== null && picked.expiry === null; // undated row gets its date
  const sameLot = targetExpiry === null || picked.expiry === targetExpiry;

  try {
    let targetId = picked.id;
    let created = false;

    if (!fillsInDate && !sameLot) {
      // Dated lot that differs from an already-dated row -> its own sibling lot.
      const [sibling] = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            sql`coalesce(${products.code}, '') = coalesce(${picked.code}, '')`,
            eq(products.name, picked.name),
            eq(products.location, picked.location),
            eq(products.expiry, targetExpiry),
          ),
        )
        .limit(1);

      if (sibling) {
        targetId = sibling.id;
      } else {
        const [row] = await db
          .insert(products)
          // category and unitsPerBox are product attributes, not lot attributes -- a sibling
          // lot that dropped them stopped reading as PPE, losing its piece math and its
          // manufacture-date line. Only stock/expiry/note differ between lots.
          .values({ code: picked.code, name: picked.name, uom: picked.uom, location: picked.location, category: picked.category, unitsPerBox: picked.unitsPerBox, stock: 0, expiry: targetExpiry, needsExpiry: false, note: "" })
          .returning({ id: products.id });
        targetId = row.id;
        created = true;
      }
    }

    const [updated] = await db
      .update(products)
      .set({
        stock: sql`${products.stock} + ${qty}`,
        // `created` matters as much as `fillsInDate`: the sibling is inserted at stock 0,
        // which trips the null_expiry_when_oos trigger and strips the date we just set.
        // Re-set it here, in the statement that actually puts stock on the row.
        ...(fillsInDate || created ? { expiry: targetExpiry, needsExpiry: false, expiredNotified: false } : {}),
        updatedAt: new Date(),
      })
      .where(eq(products.id, targetId))
      .returning();

    // Always "receive": needing a fresh sibling row is a storage detail of the same delivery.
    // Logging it as "create" hid split-lot deliveries from anything filtering on receives,
    // the transaction export included. "create" now means only a genuinely new product.
    await db.insert(events).values({ productId: targetId, kind: "receive", qtyDelta: qty, expirySet: targetExpiry });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "23514") {
      return NextResponse.json({ error: "That would make stock negative" }, { status: 400 });
    }
    throw err;
  }
}
