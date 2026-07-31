// Run: npx tsx src/lib/txcsv.check.ts
//
// The fixture is the facility's own legacy ledger for one item, retyped: the sheet whose
// bottom row reads "Total QtyRecd: 100,000 / Total QtyIssued: 79,500". If the export ever
// stops reproducing those two numbers from these transactions, this fails.
import assert from "node:assert";
import { isoWeekEnd, isoWeekStart } from "./weeks";
import { TX_HEADER, pickupParts, txCsv, type TxRow } from "./txcsv";

const ITEM = "Glove Nitrile blue Lrg";
const CODE = "MDS2586";

// Pickups are stored negative, exactly as the pickup route writes them.
const issue = (day: string, location: string, qty: number, picker: string, unit: string): TxRow => ({
  day,
  kind: "pickup",
  qty: -qty,
  expiry: null,
  note: `HAA pickup — ${unit} · ${picker}`,
  name: ITEM,
  code: CODE,
  location,
  unitsPerBox: null,
});

const receive = (day: string, location: string, qty: number, expiry: string | null, note: string): TxRow => ({
  day,
  kind: "receive",
  qty,
  expiry,
  note,
  name: ITEM,
  code: CODE,
  location,
  unitsPerBox: null,
});

const FS = "5W FS Rm";

// Newest first is how the feed reads; the export sorts ascending, so the fixture is listed
// the way the legacy sheet is and reversed on use.
const LEDGER: TxRow[] = [
  issue("2026-07-06", FS, 5_250, "HAA", "Unknown"),
  issue("2026-06-29", "5F Staff Lounge", 14_250, "HAA", "Unknown"),
  receive("2026-06-25", FS, 20_000, "2030-10-30", ""),
  issue("2026-06-22", FS, 8_000, "HAA", "All units"),
  issue("2026-06-18", FS, 15_250, "HAA", "All units"),
  receive("2026-05-27", FS, 20_000, null, "Weekly Check"),
  issue("2026-05-25", FS, 20_250, "HAA", ""),
  receive("2026-05-21", FS, 20_000, null, "Received by Wing"),
  receive("2026-05-13", "", 10_000, null, "Return from Emergency stock on 13 May"),
  // The one legacy day with movement both ways -- in Steward that is two events, not one row.
  receive("2026-04-27", "Others", 10_000, "2030-02-28", "Return to inventory 13 May"),
  issue("2026-04-27", "Others", 10_000, "Raymond", "Stock"),
  issue("2026-04-20", FS, 3_250, "HAAs", "All units"),
  issue("2026-04-14", FS, 3_000, "Unknown", ""),
  issue("2026-04-08", FS, 250, "Unknown", ""),
  receive("2026-03-25", FS, 10_000, "2029-03-31", ""),
  receive("2026-03-10", FS, 10_000, "2029-08-31", "For expiry tracking only"),
  receive("2026-03-06", FS, 0, "2029-06-30", "For expiry tracking only"),
].reverse();

const lines = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n");
const cols = (line: string) => line.split(",");

// Column order, as specified.
assert.deepStrictEqual(cols(lines(txCsv([]))[0]), TX_HEADER);
assert.deepStrictEqual(TX_HEADER.slice(0, 7), [
  "Transaction date", "Expiry date", "Storage room",
  "Qty received", "Qty issued", "Picked by", "Issued to",
]);

// --- The whole ledger: the totals the legacy sheet's bottom row shows. ---
{
  const out = lines(txCsv(LEDGER));
  assert.strictEqual(out.length, 1 + LEDGER.length + 2, "header + rows + totals + stock on hand");

  const totals = cols(out.at(-2)!);
  const onHand = cols(out.at(-1)!);
  assert.strictEqual(totals[0], "Totals");
  assert.strictEqual(totals[3], "100000");
  assert.strictEqual(totals[4], "79500");
  // Stock on hand is the very last line: received minus issued, T-account style.
  assert.strictEqual(onHand[0], "Stock on hand");
  assert.strictEqual(onHand[3], "20500");
  assert.strictEqual(Number(totals[3]) - Number(totals[4]), Number(onHand[3]));

  // Spot-check a pickup row: quantity lands in "Qty issued" as a positive, and the encoded
  // note splits into the two people columns.
  const jul6 = cols(out.find((l) => l.startsWith("2026-07-06"))!);
  assert.deepStrictEqual(jul6.slice(0, 7), ["2026-07-06", "", FS, "", "5250", "HAA", "Unknown"]);
  assert.strictEqual(jul6[7], ITEM);
  assert.strictEqual(jul6[8], CODE);

  // ...and a receive row: quantity on the other side, expiry carried through.
  const jun25 = cols(out.find((l) => l.startsWith("2026-06-25"))!);
  assert.deepStrictEqual(jun25.slice(0, 7), ["2026-06-25", "2030-10-30", FS, "20000", "", "", ""]);
}

// --- Week slices: the export is picked by ISO week, so check several. ---
const inWeeks = (year: number, from: number, to: number) =>
  LEDGER.filter((r) => r.day >= isoWeekStart(year, from) && r.day <= isoWeekEnd(year, to));

function footer(rows: TxRow[]): { recd: string; issued: string; onHand: string; count: number } {
  const out = lines(txCsv(rows));
  return {
    recd: cols(out.at(-2)!)[3],
    issued: cols(out.at(-2)!)[4],
    onHand: cols(out.at(-1)!)[3],
    count: out.length - 3,
  };
}

// W28 (Jul 6-12): the single pickup.
assert.deepStrictEqual(footer(inWeeks(2026, 28, 28)), { recd: "0", issued: "5250", onHand: "-5250", count: 1 });
// W27 (Jun 29-Jul 5): the Staff Lounge pickup only -- proves the Jul 6 row is excluded.
assert.deepStrictEqual(footer(inWeeks(2026, 27, 27)), { recd: "0", issued: "14250", onHand: "-14250", count: 1 });
// W26 (Jun 22-28): one in, one out.
assert.deepStrictEqual(footer(inWeeks(2026, 26, 26)), { recd: "20000", issued: "8000", onHand: "12000", count: 2 });
// W22 (May 25-31): a week that nets negative.
assert.deepStrictEqual(footer(inWeeks(2026, 22, 22)), { recd: "20000", issued: "20250", onHand: "-250", count: 2 });
// W18 (Apr 27-May 3): the both-ways day, which must balance to zero.
assert.deepStrictEqual(footer(inWeeks(2026, 18, 18)), { recd: "10000", issued: "10000", onHand: "0", count: 2 });
// A quiet week with nothing in it still exports a valid, zeroed sheet.
assert.deepStrictEqual(footer(inWeeks(2026, 24, 24)), { recd: "0", issued: "0", onHand: "0", count: 0 });
// A multi-week span (W22-W28) is the sum of its parts.
assert.deepStrictEqual(footer(inWeeks(2026, 22, 28)), { recd: "40000", issued: "63000", onHand: "-23000", count: 7 });
// The full span reproduces the sheet's bottom row.
assert.deepStrictEqual(footer(inWeeks(2026, 10, 28)), { recd: "100000", issued: "79500", onHand: "20500", count: 17 });

// --- Direction filters: "received only" / "issued only" (what the HAA pickups are). ---
{
  const onlyRecd = LEDGER.filter((r) => r.kind === "receive");
  const onlyIssued = LEDGER.filter((r) => r.kind === "pickup");
  assert.deepStrictEqual(footer(onlyRecd), { recd: "100000", issued: "0", onHand: "100000", count: 8 });
  assert.deepStrictEqual(footer(onlyIssued), { recd: "0", issued: "79500", onHand: "-79500", count: 9 });
  assert.strictEqual(onlyRecd.length + onlyIssued.length, LEDGER.length);
}

// --- Pieces: PPE is stocked in boxes but counted in pieces. ---
{
  const box = (kind: string, qty: number): TxRow => ({
    day: "2026-07-06", kind, qty, expiry: null, note: kind === "pickup" ? "HAA pickup — 5W · HAA" : "",
    name: "Glove Nitrile 100/box", code: "G1", location: FS, unitsPerBox: 100,
  });
  const out = lines(txCsv([box("receive", 12), box("pickup", -5)]));
  assert.strictEqual(cols(out[1]).at(-1), "1200"); // 12 boxes received
  assert.strictEqual(cols(out[2]).at(-1), "500"); //  5 boxes issued
  assert.strictEqual(cols(out.at(-1)!).at(-1), "700"); // net pieces on hand
  // unitsPerBox null falls back to the pack size parsed from the name.
  assert.strictEqual(cols(lines(txCsv([{ ...box("receive", 2), unitsPerBox: null }]))[1]).at(-1), "200");
}

// --- Escaping and note parsing. ---
{
  const nasty: TxRow = {
    day: "2026-07-06", kind: "receive", qty: 1, expiry: null,
    note: 'said "ok"', name: "ATTENDS SHAPED PAD, CASE/4 BAGS", code: null,
    location: FS, unitsPerBox: null,
  };
  const line = lines(txCsv([nasty]))[1];
  assert.ok(line.includes('"ATTENDS SHAPED PAD, CASE/4 BAGS"'), "comma in name is quoted");
  assert.ok(line.includes('"said ""ok"""'), "quotes are doubled");
}
assert.deepStrictEqual(pickupParts("HAA pickup — All units · Raymond"), { unit: "All units", picker: "Raymond" });
// Older orders predate the unit field: the single value is the picker, not a unit.
assert.deepStrictEqual(pickupParts("HAA pickup — Raymond"), { unit: "", picker: "Raymond" });
assert.deepStrictEqual(pickupParts(null), { unit: "", picker: "" });

console.log("ok: transaction export columns, week slices, direction filters, and ledger totals");
