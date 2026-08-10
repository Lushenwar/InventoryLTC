// Transaction ledger CSV. One line per receive / HAA pickup, then an opening-stock line, a
// totals line and a closing stock-on-hand line, so an export balances like a T-account the
// way the legacy sheet did: opening + received − issued = on hand.
//
// The closing figure is the item's *real* current stock when the caller knows it (`OnHand`),
// and the opening balance is reverse-engineered back from it. A week where 250 masks came in
// and 250 went out then reads "9000 → 9000", not "0" -- which is what makes a wrong number
// visible instead of plausible.
//
// PPE (`unitsPerBox` set) is received and issued in pieces, so its quantity columns carry
// pieces, not boxes. Everything else stays in its stocked unit.
//
// ponytail: CSV, not a real .xlsx. Excel opens it natively, so a spreadsheet writer would be
// a dependency earning nothing. Switch to exceljs only if formulas or multiple sheets are wanted.

import { packSize } from "./pack";

export type TxRow = {
  day: string; // facility-local YYYY-MM-DD
  kind: string; // 'receive' | 'pickup'
  qty: number | null; // as stored: receives positive, pickups negative
  expiry: string | null;
  note: string | null;
  name: string | null;
  code: string | null;
  location: string | null;
  unitsPerBox: number | null;
};

export const TX_HEADER = [
  "Transaction date",
  "Expiry date",
  "Storage room",
  "Qty received",
  "Qty issued",
  "Picked by",
  "Issued to",
  "Item",
  "Code",
  "Notes",
  "Pieces",
];

// Quotes anything Excel would otherwise mis-split. Legacy product names really do contain
// commas ("ATTENDS SHAPED PAD NIGHT SUPER , CASE/4 BAGS EACH"), so this is load-bearing.
export function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The pickup route writes the note as `HAA pickup — {unit} · {picker}`. The unit field was
// added later, so an order with a single value carries the picker's name, not a unit.
export function pickupParts(note: string | null): { unit: string; picker: string } {
  const m = /^HAA pickup\s*—\s*(.*)$/.exec(note ?? "");
  const parts = (m?.[1] ?? "").split("·").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? { unit: parts[0], picker: parts[1] } : { unit: "", picker: parts[0] ?? "" };
}

type Cell = string | number | null;
type Tally = { recd: number; issued: number; piecesRecd: number; piecesIssued: number };

/**
 * An item's live stock, in the same two units the sheet reports:
 * `units` matches the quantity columns (pieces for PPE, boxes otherwise),
 * `pieces` matches the Pieces column. See `sheetUnits` / `sheetPieces`.
 */
export type OnHand = { units: number; pieces: number };

/** Stock as the quantity columns count it: pieces for PPE, the stocked unit otherwise. */
export const sheetUnits = (stock: number, unitsPerBox: number | null) => stock * (unitsPerBox ?? 1);
/** Stock as the Pieces column counts it -- pack size parsed from the name when not stored. */
export const sheetPieces = (stock: number, unitsPerBox: number | null, name: string) =>
  stock * (unitsPerBox ?? packSize(name));

const tally = (): Tally => ({ recd: 0, issued: 0, piecesRecd: 0, piecesIssued: 0 });

// One transaction line, counted into `t` as it is written.
function bodyLine(r: TxRow, t: Tally): Cell[] {
  const pickup = r.kind === "pickup";
  // Pickups are stored negative. Flip them so both columns read as plain positive
  // quantities; a legacy negative *receive* stays negative, which is the honest reading.
  const qty = pickup ? Math.abs(r.qty ?? 0) : r.qty ?? 0;
  const pieces = qty * (r.unitsPerBox ?? packSize(r.name ?? ""));
  // PPE moves in pieces, so that is what its quantity column reports -- a box count there
  // does not match what staff actually picked up or the legacy sheet recorded.
  const shown = r.unitsPerBox ? pieces : qty;
  if (pickup) {
    t.issued += shown;
    t.piecesIssued += pieces;
  } else {
    t.recd += shown;
    t.piecesRecd += pieces;
  }
  const { unit, picker } = pickup ? pickupParts(r.note) : { unit: "", picker: "" };
  return [
    r.day,
    r.expiry,
    r.location,
    pickup ? "" : shown,
    pickup ? shown : "",
    picker,
    unit,
    r.name ?? "(deleted item)",
    r.code,
    // A pickup's note is entirely consumed by the two columns above; repeating it is noise.
    pickup ? "" : r.note,
    pieces,
  ];
}

// Picked by / Issued to / Item / Code / Notes are blank on every footer line.
const BLANK5 = ["", "", "", "", ""];
const EMPTY_ROW: Cell[] = TX_HEADER.map(() => "");

// A range with nothing in it still prints its balance lines, which on their own read like a
// broken sheet -- "Opening 55 / Totals 0 / On hand 55" looks like data went missing. Say plainly
// that nothing moved, so the balances read as the answer rather than as a gap.
const NOTHING_MOVED: Cell[] = [
  "No transactions in this date range",
  ...TX_HEADER.slice(1).map(() => "" as Cell),
];
const bodyOf = (rows: TxRow[], t: Tally): Cell[][] =>
  rows.length ? rows.map((r) => bodyLine(r, t)) : [NOTHING_MOVED];

/**
 * Opening stock, the range's movements, then closing stock -- in that reading order.
 *
 * `on` is the item's real current stock; the opening balance is it minus the range's net, so
 * the three lines always tie out. Without it (an unfiltered export spanning many products,
 * where no single balance would mean anything) the sheet falls back to opening 0 and a plain
 * received-minus-issued net, which is what it always reported.
 */
function footer(labels: [string, string, string], t: Tally, on?: OnHand): Cell[][] {
  const net = t.recd - t.issued;
  const netPieces = t.piecesRecd - t.piecesIssued;
  const units = on ? on.units : net;
  const pieces = on ? on.pieces : netPieces;
  return [
    [labels[0], "", "", units - net, "", ...BLANK5, pieces - netPieces],
    // Pieces has no single meaning on a totals line (each body row mirrors one side or the
    // other), so it is left to the two balance lines.
    [labels[1], "", "", t.recd, t.issued, ...BLANK5, ""],
    [labels[2], "", "", units, "", ...BLANK5, pieces],
  ];
}

// Consecutive rows sharing an item name. The query orders by name, so a plain run-length
// walk groups them -- no map, and the sheet keeps the query's ordering.
function byItem(rows: TxRow[]): [string, TxRow[]][] {
  const out: [string, TxRow[]][] = [];
  for (const r of rows) {
    const name = r.name ?? "(deleted item)";
    if (out.length && out[out.length - 1][0] === name) out[out.length - 1][1].push(r);
    else out.push([name, [r]]);
  }
  return out;
}

const render = (rows: Cell[][]) =>
  // BOM so Excel reads it as UTF-8; without it the "·" and accented names come out mangled.
  "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** One item's ledger: transactions, then opening stock, totals and stock on hand. */
export function txCsv(rows: TxRow[], onHand?: OnHand): string {
  const t = tally();
  const body = bodyOf(rows, t);
  return render([TX_HEADER, ...body, ...footer(["Opening stock", "Totals", "Stock on hand"], t, onHand)]);
}

/**
 * Several items in one sheet: a block per item with its own opening stock, subtotal and stock
 * on hand. `rows` must arrive grouped by item, which the export query does by ordering on name.
 *
 * There is deliberately **no grand total**. Adding a mask's pieces to a glove's pieces produces a
 * number that is not a count of anything -- different products, different pack sizes -- and a
 * labelled "Totals — 4 items" line was still read as a real figure. The per-item blocks are the
 * whole answer; a sum across them was only ever noise sitting where a total belongs.
 *
 * `onHand` is keyed by product name; items missing from it fall back to the range's net.
 */
export function txCsvGrouped(rows: TxRow[], onHand?: Map<string, OnHand>): string {
  const groups = byItem(rows);
  const out: Cell[][] = [TX_HEADER];

  if (!groups.length) out.push(NOTHING_MOVED);

  groups.forEach(([name, group], i) => {
    if (i) out.push(EMPTY_ROW); // separator between blocks, never trailing
    const t = tally();
    for (const r of group) out.push(bodyLine(r, t));
    out.push(...footer([`Opening stock — ${name}`, `Subtotal — ${name}`, `Stock on hand — ${name}`], t, onHand?.get(name)));
  });

  return render(out);
}
