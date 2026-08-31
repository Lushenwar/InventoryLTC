import { NextRequest, NextResponse } from "next/server";
import { fetchProducts } from "@/lib/queries";
import { STATUS_META, facilityToday, statusOf } from "@/lib/expiry";
import { csvCell } from "@/lib/txcsv";
import { packSize } from "@/lib/pack";

// A snapshot of what is on the shelf right now, as a CSV Excel opens directly.
//
// The history export answers "what moved"; this answers "what is here" -- the question an
// inventory manager actually has when counting stock or deciding what to reorder, and the one
// thing the app could not previously get out of the screen and into a spreadsheet.
//
// It takes the same filters as the inventory page, so the file is exactly what was on screen:
// filter to a room and a status, export, and the sheet matches what you were looking at.
//
// Deliberately no totals row. Summing pieces across different products is not a count of
// anything (the same reason the multi-item history export lost its grand total), and a footer
// line would break Excel's own filtering and pivots over the rows above it.

const HEADER = [
  "Item",
  "Code",
  "Storage room",
  "Category",
  "Boxes on shelf",
  "Unit",
  "Pieces per box",
  "Total pieces",
  "Expiry date",
  "Status",
  "Days to expiry",
  "Note",
];

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const get = (k: string) => sp.get(k) ?? undefined;
  const today = facilityToday();

  const rows = await fetchProducts(
    { q: get("q"), loc: get("loc"), cat: get("cat"), status: get("status"), sort: get("sort"), dir: get("dir") },
    today,
  );

  const body = rows.map((p) => {
    const s = statusOf(p.expiry, p.needsExpiry, today, p.stock);
    // Pieces per box is the stored figure for PPE and the one parsed from the name otherwise --
    // the same rule the Total pieces column on screen uses, so the two agree.
    const per = p.unitsPerBox ?? packSize(p.name);
    return [
      p.name,
      p.code,
      p.location,
      p.category,
      p.stock,
      p.uom,
      per,
      p.stock * per,
      p.expiry,
      STATUS_META[s.key].label,
      s.days,
      p.note,
    ];
  });

  // BOM so Excel reads it as UTF-8 rather than mangling the accented and "·" characters.
  const csv = "﻿" + [HEADER, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

  const slug = (v: string | undefined) =>
    v && v !== "all" ? "-" + v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) : "";
  const name = `inventory-date-stock${slug(get("loc"))}${slug(get("cat"))}${slug(get("status"))}_${today}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
