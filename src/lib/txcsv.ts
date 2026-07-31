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

export function txCsv(rows: TxRow[]): string {
  let recd = 0;
  let issued = 0;
  let piecesRecd = 0;
  let piecesIssued = 0;

  const body = rows.map((r) => {
    const pickup = r.kind === "pickup";
    // Pickups are stored negative. Flip them so both columns read as plain positive
    // quantities; a legacy negative *receive* stays negative, which is the honest reading.
    const qty = pickup ? Math.abs(r.qty ?? 0) : r.qty ?? 0;
    const pieces = qty * (r.unitsPerBox ?? packSize(r.name ?? ""));
    if (pickup) {
      issued += qty;
      piecesIssued += pieces;
    } else {
      recd += qty;
      piecesRecd += pieces;
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
  });

  // Picked by / Issued to / Item / Code / Notes are blank on both footer lines.
  const blank = ["", "", "", "", ""];
  const footer = [
    // Pieces has no single meaning on the totals line (each body row mirrors one side or the
    // other), so it only carries the net, on the stock-on-hand line.
    ["Totals", "", "", recd, issued, ...blank, ""],
    ["Stock on hand", "", "", recd - issued, "", ...blank, piecesRecd - piecesIssued],
  ];

  // BOM so Excel reads it as UTF-8; without it the "·" and accented names come out mangled.
  return (
    "﻿" +
    [TX_HEADER, ...body, ...footer].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
