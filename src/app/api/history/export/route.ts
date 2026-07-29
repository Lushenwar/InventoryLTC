import { NextRequest, NextResponse } from "next/server";
import { asc, sql } from "drizzle-orm";
import { db, products, events } from "@/lib/db";
import { packSize } from "@/lib/pack";

// Transaction export for a date range: receives in, HAA pickups out. Deliberately excludes
// create/edit/delete of the item records themselves -- this reports supply movement, not
// catalogue housekeeping.
//
// ponytail: CSV, not a real .xlsx. Excel opens it natively, so a spreadsheet writer would be
// a dependency earning nothing. Switch to exceljs only if formulas or multiple sheets are wanted.

const FACILITY_TZ = "America/Toronto";

// Quotes anything Excel would otherwise mis-split. Legacy product names really do contain
// commas ("ATTENDS SHAPED PAD NIGHT SUPER , CASE/4 BAGS EACH"), so this is load-bearing.
function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The pickup route writes the note as `HAA pickup — {unit} · {picker}`. The unit field was
// added later, so an order with a single value carries the picker's name, not a unit.
function pickupParts(note: string | null): { unit: string; picker: string } {
  const m = /^HAA pickup\s*—\s*(.*)$/.exec(note ?? "");
  const parts = (m?.[1] ?? "").split("·").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? { unit: parts[0], picker: parts[1] } : { unit: "", picker: parts[0] ?? "" };
}

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

  // Compare in facility-local days. events.at is a timestamptz, so filtering on it raw would
  // put a Monday 8pm pickup in the wrong week for anyone reading the file.
  const localDay = sql`(${events.at} AT TIME ZONE ${FACILITY_TZ})::date`;

  const rows = await db
    .select({
      at: events.at,
      localDay,
      kind: events.kind,
      qtyDelta: events.qtyDelta,
      expiry: sql<string | null>`coalesce(${events.expirySet}, ${products.expiry})`,
      note: events.note,
      code: products.code,
      name: products.name,
      location: products.location,
      uom: products.uom,
      unitsPerBox: products.unitsPerBox,
    })
    .from(events)
    .leftJoin(products, sql`${events.productId} = ${products.id}`)
    .where(sql`${events.kind} in ('receive', 'pickup') and ${localDay} between ${start} and ${end}`)
    .orderBy(asc(events.at));

  const header = [
    "Date", "Time", "Type", "Code", "Item", "Location", "UOM",
    "Qty received", "Qty issued", "Pieces", "Expiry date", "Unit", "Picked up by",
  ];

  const body = rows.map((r) => {
    const qty = r.qtyDelta ?? 0;
    const perBox = r.unitsPerBox ?? packSize(r.name ?? "");
    const { unit, picker } = r.kind === "pickup" ? pickupParts(r.note) : { unit: "", picker: "" };
    return [
      String(r.localDay),
      new Date(r.at).toLocaleTimeString("en-CA", { timeZone: FACILITY_TZ, hour: "2-digit", minute: "2-digit", hour12: false }),
      r.kind === "pickup" ? "HAA pickup" : "Receive",
      r.code,
      r.name ?? "(deleted item)",
      r.location,
      r.uom,
      r.kind === "receive" ? qty : "",
      r.kind === "pickup" ? Math.abs(qty) : "",
      // Mirrors whichever quantity column is filled, sign included -- a legacy negative
      // receive shouldn't read as a positive pile of pieces.
      (r.kind === "receive" ? qty : Math.abs(qty)) * perBox,
      r.expiry,
      unit,
      picker,
    ].map(csvCell).join(",");
  });

  // BOM so Excel reads it as UTF-8; without it the "·" and accented names come out mangled.
  const csv = "﻿" + [header.map(csvCell).join(","), ...body].join("\r\n") + "\r\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="steward-transactions_${start}_to_${end}.csv"`,
    },
  });
}
