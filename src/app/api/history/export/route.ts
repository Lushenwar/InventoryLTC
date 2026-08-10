import { NextRequest, NextResponse } from "next/server";
import { and, asc, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, products, events } from "@/lib/db";
import { sheetPieces, sheetUnits, txCsv, txCsvGrouped, type OnHand } from "@/lib/txcsv";

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
//
// A filtered sheet closes on the item's *real* current stock and reverse-engineers the opening
// balance from it, so a week that received 250 and issued 250 reads "9000 -> 9000" instead of
// "0" -- a wrong count shows up as a wrong number rather than a plausible one. An unfiltered
// export has no single balance worth reporting, so it keeps the plain received-minus-issued net.

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
  let groupable = false;

  if (item) {
    const exact = sql`(lower(${products.name}) = lower(${item}) or lower(coalesce(${products.code}, '')) = lower(${item}))`;
    const like = `%${item}%`;
    const partial = or(ilike(products.name, like), ilike(products.code, like))!;

    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(exact);
    if (n) {
      itemMatch = exact;
    } else {
      const [{ n: loose }] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(partial);
      // Better a visible error than a plausible-looking empty ledger for a typo.
      if (!loose) return NextResponse.json({ error: `No item matches "${item}"` }, { status: 404 });
      itemMatch = partial;
      groupable = true;
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
    .orderBy(...(groupable ? [asc(products.name), asc(events.at)] : [asc(events.at)]));

  // Decided by what actually landed in the sheet, not by how many products matched: a search
  // hitting six items where only one moved this week is that one item's ledger, not a family.
  const grouped = groupable && new Set(rows.map((r) => r.name)).size > 1;

  // Real current stock, so the sheet closes on what is actually on the shelf and the opening
  // balance is read back from it. Summed across the item's lot rows -- lots are a storage
  // detail, the ledger is per product. Only for a filtered export: across all 377 products a
  // single "stock on hand" figure would be a number with no meaning attached to it.
  let onHand: Map<string, OnHand> | undefined;
  if (item) {
    const stocked = await db
      .select({ name: products.name, stock: products.stock, unitsPerBox: products.unitsPerBox })
      .from(products)
      .where(itemMatch);
    onHand = new Map();
    for (const p of stocked) {
      const cur = onHand.get(p.name) ?? { units: 0, pieces: 0 };
      cur.units += sheetUnits(p.stock, p.unitsPerBox);
      cur.pieces += sheetPieces(p.stock, p.unitsPerBox, p.name);
      onHand.set(p.name, cur);
    }
  }
  const onHandTotal = onHand
    ? [...onHand.values()].reduce((a, b) => ({ units: a.units + b.units, pieces: a.pieces + b.pieces }), { units: 0, pieces: 0 })
    : undefined;

  // Name the file after what is actually in it. The old "-item"/"-group" suffix described the
  // export's internal shape, which meant nothing to whoever opened the download folder later --
  // "apple-juice" does.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const suffix = [
    item ? slug(item) || "item" : "all-items",
    kindParam === "receive" ? "received" : kindParam === "pickup" ? "issued" : "",
  ]
    .filter(Boolean)
    .join("-");

  return new NextResponse(grouped ? txCsvGrouped(rows, onHand) : txCsv(rows, onHandTotal), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="steward-${suffix}_${start}_to_${end}.csv"`,
    },
  });
}
