import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

// Global activity feed: every stock/expiry change, newest first, with the product it touched.
// productId is set null on product delete, so delete events show without a name.
export async function GET() {
  const rows = await db
    .select({
      id: events.id,
      kind: events.kind,
      qtyDelta: events.qtyDelta,
      expirySet: events.expirySet,
      note: events.note,
      actor: events.actor,
      at: events.at,
      name: products.name,
      code: products.code,
      location: products.location,
      uom: products.uom,
    })
    .from(events)
    .leftJoin(products, eq(events.productId, products.id))
    .orderBy(desc(events.at))
    .limit(300);
  return NextResponse.json(rows);
}
