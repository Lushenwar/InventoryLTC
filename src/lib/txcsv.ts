// Transaction ledger CSV. One line per receive / HAA pickup, then a totals line and a
// stock-on-hand line: received minus issued, so a single-item export balances like a
// T-account the way the legacy sheet did.
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

const tally = (): Tally => ({ recd: 0, issued: 0, piecesRecd: 0, piecesIssued: 0 });

// One transaction line, counted into `t` as it is written.
function bodyLine(r: TxRow, t: Tally): Cell[] {
  const pickup = r.kind === "pickup";
  // Pickups are stored negative. Flip them so both columns read as plain positive
  // quantities; a legacy negative *receive* stays negative, which is the honest reading.
  const qty = pickup ? Math.abs(r.qty ?? 0) : r.qty ?? 0;
  const pieces = qty * (r.unitsPerBox ?? packSize(r.name ?? ""));
  if (pickup) {
    t.issued += qty;
    t.piecesIssued += pieces;
  } else {
    t.recd += qty;
    t.piecesRecd += pieces;
  }
  const { unit, picker } = pickup ? pickupParts(r.note) : { unit: "", picker: "" };
  return [
    r.day,
    r.expiry,
    r.location,
    pickup ? "" : qty,
    pickup ? qty : "",
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

function footer(totalLabel: string, onHandLabel: string, t: Tally): Cell[][] {
  return [
    // Pieces has no single meaning on a totals line (each body row mirrors one side or the
    // other), so it only carries the net, on the stock-on-hand line.
    [totalLabel, "", "", t.recd, t.issued, ...BLANK5, ""],
    [onHandLabel, "", "", t.recd - t.issued, "", ...BLANK5, t.piecesRecd - t.piecesIssued],
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

/** One item's ledger: transactions, then totals and stock on hand. */
export function txCsv(rows: TxRow[]): string {
  const t = tally();
  const body = rows.map((r) => bodyLine(r, t));
  return render([TX_HEADER, ...body, ...footer("Totals", "Stock on hand", t)]);
}

/**
 * Several items in one sheet: a block per item with its own subtotal and stock on hand,
 * then a grand total. The per-item balances are the point -- a single blended figure across
 * different products (and different pieces-per-box) would not be any item's real stock.
 * `rows` must arrive grouped by item, which the export query does by ordering on name.
 */
export function txCsvGrouped(rows: TxRow[]): string {
  const grand = tally();
  const groups = byItem(rows);
  const out: Cell[][] = [TX_HEADER];

  for (const [name, group] of groups) {
    const t = tally();
    for (const r of group) out.push(bodyLine(r, t));
    grand.recd += t.recd;
    grand.issued += t.issued;
    grand.piecesRecd += t.piecesRecd;
    grand.piecesIssued += t.piecesIssued;
    out.push(...footer(`Subtotal — ${name}`, `Stock on hand — ${name}`, t), EMPTY_ROW);
  }

  const n = `${groups.length} item${groups.length === 1 ? "" : "s"}`;
  out.push(...footer(`Totals — ${n}`, `Stock on hand — ${n}`, grand));
  return render(out);
}
