import { NextRequest, NextResponse } from "next/server";
import { and, asc, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, products, events } from "@/lib/db";
import { txCsv, txCsvGrouped } from "@/lib/txcsv";

// Transaction export for a date range: receives in, HAA pickups out. Deliberately excludes
// create/edit/delete of the item records themselves -- this reports supply movement, not
// catalogue housekeeping.
//
// Filters: ?kind=receive|pickup narrows to one direction, ?item=<name, code, or partial>
// narrows to a product.
//
// An exact name/code hit is one item's ledger: its lots and locations, one balance at the
// bottom. Anything else is read as a family -- "nitrile", "vinyl", "Lrg" -- and lands more
// than one item in the sheet, so every item gets its own subtotal and stock on hand and only
// the clearly-labelled grand total spans them. A single blended figure across products with
// different pieces-per-box would not be any item's real stock, which is why a partial is
// never folded into one balance. Matching ignores case throughout.

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
  let itemMatch: SQL | undefined;
  let grouped = false;

  if (item) {
    const exact = sql`(lower(${products.name}) = lower(${item}) or lower(coalesce(${products.code}, '')) = lower(${item}))`;
    const like = `%${item}%`;
    const partial = or(ilike(products.name, like), ilike(products.code, like))!;

    // Distinct names decide the shape: one item reads as a ledger, several as a family sheet.
    const names = await db.selectDistinct({ name: products.name }).from(products).where(exact);
    if (names.length) {
      itemMatch = exact;
    } else {
      const loose = await db.selectDistinct({ name: products.name }).from(products).where(partial);
      // Better a visible error than a plausible-looking empty ledger for a typo.
      if (!loose.length) return NextResponse.json({ error: `No item matches "${item}"` }, { status: 404 });
      itemMatch = partial;
      grouped = loose.length > 1;
    }
  }

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
        itemMatch,
      ),
    )
    // Grouping is a run-length walk over the rows, so the name has to lead the sort.
    .orderBy(...(grouped ? [asc(products.name), asc(events.at)] : [asc(events.at)]));

  const suffix = [
    kindParam === "receive" ? "received" : kindParam === "pickup" ? "issued" : "",
    item ? (grouped ? "group" : "item") : "",
  ]
    .filter(Boolean)
    .join("-");

  return new NextResponse(grouped ? txCsvGrouped(rows) : txCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="steward-transactions${suffix ? `-${suffix}` : ""}_${start}_to_${end}.csv"`,
    },
  });
}
