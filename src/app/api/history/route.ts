import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

const PAGE_SIZE = 100;

// Global activity feed: every stock/expiry change, newest first, with the product it touched.
// productId is set null on product delete, so delete events show without a join — their identity
// lives in events.note instead, which is why search also matches note text.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const page = Math.max(0, Number(searchParams.get("page")) || 0);

  const where = q
    ? or(
        ilike(products.name, `%${q}%`),
        ilike(products.code, `%${q}%`),
        ilike(products.location, `%${q}%`),
        ilike(events.note, `%${q}%`),
      )
    : undefined;

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
    .where(where)
    .orderBy(desc(events.at))
    .limit(PAGE_SIZE + 1) // one extra row tells us whether a next page exists
    .offset(page * PAGE_SIZE);

  const hasMore = rows.length > PAGE_SIZE;
  return NextResponse.json({ rows: rows.slice(0, PAGE_SIZE), page, hasMore });
}
