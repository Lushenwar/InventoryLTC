import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";
import { txCsv } from "@/lib/txcsv";

// Transaction export for a date range: receives in, HAA pickups out. Deliberately excludes
// create/edit/delete of the item records themselves -- this reports supply movement, not
// catalogue housekeeping.
//
// Filters: ?kind=receive|pickup narrows to one direction, ?item=<exact product name> narrows
// to one item (all of its lots and locations, which is what makes the footer a real ledger).

const FACILITY_TZ = "America/Toronto";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!isDate(from) || !isDate(to)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD dates" }, { status: 400 });
  }
  // Swap rather than reject: a reversed range is a slip, not a reason to hand back nothing.
  const [start, end] = from <= to ? [from, to] : [to, from];

  const kindParam = searchParams.get("kind");
  if (kindParam && kindParam !== "receive" && kindParam !== "pickup") {
    return NextResponse.json({ error: "kind must be receive or pickup" }, { status: 400 });
  }
  const kinds = kindParam ? [kindParam] : ["receive", "pickup"];
  const item = searchParams.get("item")?.trim() || null;

  // Compare in facility-local days. events.at is a timestamptz, so filtering on it raw would
  // put a Monday 8pm pickup in the wrong week for anyone reading the file.
  const localDay = sql<string>`(${events.at} AT TIME ZONE ${FACILITY_TZ})::date`;

  const rows = await db
    .select({
      at: events.at,
      day: localDay,
      kind: events.kind,
      qty: events.qtyDelta,
      expiry: sql<string | null>`coalesce(${events.expirySet}, ${products.expiry})`,
      note: events.note,
      code: products.code,
      name: products.name,
      location: products.location,
      unitsPerBox: products.unitsPerBox,
    })
    .from(events)
    .leftJoin(products, sql`${events.productId} = ${products.id}`)
    .where(
      and(
        inArray(events.kind, kinds),
        sql`${localDay} between ${start} and ${end}`,
        item ? eq(products.name, item) : undefined,
      ),
    )
    .orderBy(asc(events.at));

  const suffix = [kindParam === "receive" ? "received" : kindParam === "pickup" ? "issued" : "", item ? "item" : ""]
    .filter(Boolean)
    .join("-");

  return new NextResponse(txCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="steward-transactions${suffix ? `-${suffix}` : ""}_${start}_to_${end}.csv"`,
    },
  });
}
