// Run: npx tsx src/lib/txcsv.check.ts
//
// The fixture is the facility's own legacy ledger for one item, retyped: the sheet whose
// bottom row reads "Total QtyRecd: 100,000 / Total QtyIssued: 79,500". If the export ever
// stops reproducing those two numbers from these transactions, this fails.
import assert from "node:assert";
import { isoWeekEnd, isoWeekStart } from "./weeks";
import { TX_HEADER, pickupParts, sheetPieces, sheetUnits, txCsv, txCsvGrouped, type TxRow } from "./txcsv";

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
  // The one legacy day with movement both ways -- in Inventory Date that is two events, not one row.
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
  assert.strictEqual(out.length, 1 + LEDGER.length + 3, "header + rows + opening + totals + stock on hand");

  const opening = cols(out.at(-3)!);
  const totals = cols(out.at(-2)!);
  const onHand = cols(out.at(-1)!);
  assert.strictEqual(totals[0], "Totals");
  assert.strictEqual(totals[3], "100000");
  assert.strictEqual(totals[4], "79500");
  // Stock on hand is the very last line. With no live stock supplied it is the range's net,
  // off an opening of zero -- T-account style, the way the legacy sheet read.
  assert.strictEqual(opening[0], "Opening stock");
  assert.strictEqual(opening[3], "0");
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
    count: out.length - 4,
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
// A quiet week with nothing in it still exports a valid, zeroed sheet -- with one line saying so
// rather than an empty body (see the Apple Juice case below).
assert.deepStrictEqual(footer(inWeeks(2026, 24, 24)), { recd: "0", issued: "0", onHand: "0", count: 1 });
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

// --- Pieces: PPE is stocked in boxes but received, issued and reported in pieces. ---
{
  const box = (kind: string, qty: number): TxRow => ({
    day: "2026-07-06", kind, qty, expiry: null, note: kind === "pickup" ? "HAA pickup — 5W · HAA" : "",
    name: "Glove Nitrile 100/box", code: "G1", location: FS, unitsPerBox: 100,
  });
  const out = lines(txCsv([box("receive", 12), box("pickup", -5)]));
  assert.strictEqual(cols(out[1]).at(-1), "1200"); // 12 boxes received
  assert.strictEqual(cols(out[2]).at(-1), "500"); //  5 boxes issued
  assert.strictEqual(cols(out.at(-1)!).at(-1), "700"); // net pieces on hand
  // The quantity columns carry pieces too, not the box count -- that is what was physically
  // received and picked up, and what the legacy sheet recorded.
  assert.strictEqual(cols(out[1])[3], "1200", "PPE received in pieces");
  assert.strictEqual(cols(out[2])[4], "500", "PPE issued in pieces");
  assert.deepStrictEqual(cols(out.at(-2)!).slice(3, 5), ["1200", "500"]);
  assert.strictEqual(cols(out.at(-1)!)[3], "700");
  // unitsPerBox null falls back to the pack size parsed from the name -- but only for the
  // Pieces column. A non-PPE item keeps reporting its stocked unit in the quantity columns.
  const loose = lines(txCsv([{ ...box("receive", 2), unitsPerBox: null }]));
  assert.strictEqual(cols(loose[1]).at(-1), "200");
  assert.strictEqual(cols(loose[1])[3], "2", "non-PPE quantity stays in stocked units");
}

// --- Real stock on hand: the closing line is what is on the shelf, opening is read back. ---
//
// The case that motivated it: receive 250 masks then pick up 250 in the same week. The net is
// zero, but the shelf still holds the 9,000 it started with, and a sheet reading "0" hides a
// discrepancy instead of exposing one.
{
  const mask = (kind: string, qty: number): TxRow => ({
    day: "2026-07-06", kind, qty, expiry: null, note: kind === "pickup" ? "HAA pickup — 5W · HAA" : "",
    name: "Mask Procedure Medium", code: "M1", location: FS, unitsPerBox: 50,
  });
  // 9,000 pieces on hand now = 180 boxes of 50.
  const out = lines(txCsv([mask("receive", 5), mask("pickup", -5)], { units: 9_000, pieces: 9_000 }));
  assert.deepStrictEqual(cols(out.at(-2)!).slice(3, 5), ["250", "250"], "250 in, 250 out");
  assert.strictEqual(cols(out.at(-3)!)[3], "9000", "opening = closing minus the net");
  assert.strictEqual(cols(out.at(-1)!)[3], "9000", "closing is the real shelf count, not the net");

  // Opening + received - issued = on hand, on a week that actually moved the needle.
  const up = lines(txCsv([mask("receive", 10)], { units: 9_500, pieces: 9_500 }));
  assert.strictEqual(cols(up.at(-3)!)[3], "9000");
  assert.strictEqual(cols(up.at(-1)!)[3], "9500");

  // A quiet week for a stocked item reports the stock, not a zeroed sheet.
  assert.strictEqual(cols(lines(txCsv([], { units: 9_000, pieces: 9_000 })).at(-1)!)[3], "9000");
}

// Live stock converts to the sheet's two units the same way the body rows do.
assert.strictEqual(sheetUnits(180, 50), 9_000); // PPE: pieces
assert.strictEqual(sheetUnits(180, null), 180); // everything else: stocked units
assert.strictEqual(sheetPieces(180, 50, "Mask 50/box"), 9_000);
assert.strictEqual(sheetPieces(6, null, "Glove Nitrile 250/box"), 1_500); // pack size off the name

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

// --- Grouped export: several items in one sheet, each balancing on its own. ---
//
// The case that motivated it: gloves of the same size under different pack sizes are
// separate products, so one blended balance would mean nothing -- 250/box and 150/box do
// not add up in pieces.
{
  const glove = (name: string, perBox: number, day: string, kind: string, qty: number): TxRow => ({
    day, kind, qty, expiry: null,
    note: kind === "pickup" ? "HAA pickup — 5W · HAA" : "",
    name, code: null, location: FS, unitsPerBox: perBox,
  });
  const LRG250 = "Glove Nitrile (blue) Lrg 250/box";
  const LRG150 = "Glove Nitrile (blue) Lrg 150/box";

  // Arrives grouped by item, the way the export query orders it.
  const out = lines(txCsvGrouped([
    glove(LRG250, 250, "2026-07-06", "receive", 10),
    glove(LRG250, 250, "2026-07-07", "pickup", -4),
    glove(LRG150, 150, "2026-07-06", "receive", 20),
    glove(LRG150, 150, "2026-07-08", "pickup", -5),
  ]));

  // header + (2 rows + 3 footer) + blank + (2 rows + 3 footer) = 12. No grand total.
  assert.strictEqual(out.length, 12);

  const at = (label: string) => cols(out.find((l) => l.startsWith(label))!);
  // Both are PPE, so every quantity here is in pieces: 10 boxes of 250 is 2,500 received.
  assert.deepStrictEqual(at(`Subtotal — ${LRG250}`).slice(3, 5), ["2500", "1000"]);
  assert.strictEqual(at(`Stock on hand — ${LRG250}`)[3], "1500"); // 6 boxes x 250
  assert.strictEqual(at(`Stock on hand — ${LRG250}`).at(-1), "1500");
  assert.deepStrictEqual(at(`Subtotal — ${LRG150}`).slice(3, 5), ["3000", "750"]);
  assert.strictEqual(at(`Stock on hand — ${LRG150}`)[3], "2250"); // 15 boxes x 150
  assert.strictEqual(at(`Stock on hand — ${LRG150}`).at(-1), "2250");

  // No combined figure anywhere: 2,500 pieces of a 250/box glove plus 3,000 of a 150/box glove
  // is not a count of anything, and a line labelled "Totals" gets read as one regardless.
  assert.ok(!out.some((l) => /^(Totals|Opening stock|Stock on hand) — \d+ items?/.test(l)), "no grand total");
  // The sheet ends on the last item's own closing balance.
  assert.ok(out.at(-1)!.startsWith(`Stock on hand — ${LRG150}`));

  // With live stock per item, each block still closes on its own shelf count.
  const stocked = lines(txCsvGrouped(
    [
      glove(LRG250, 250, "2026-07-06", "receive", 10),
      glove(LRG250, 250, "2026-07-07", "pickup", -10), // nets to zero, shelf is not empty
      glove(LRG150, 150, "2026-07-06", "receive", 20),
    ],
    new Map([
      [LRG250, { units: 5_000, pieces: 5_000 }],
      [LRG150, { units: 4_500, pieces: 4_500 }],
    ]),
  ));
  const st = (label: string) => cols(stocked.find((l) => l.startsWith(label))!);
  assert.strictEqual(st(`Opening stock — ${LRG250}`)[3], "5000", "net zero leaves the opening alone");
  assert.strictEqual(st(`Stock on hand — ${LRG250}`)[3], "5000");
  assert.strictEqual(st(`Opening stock — ${LRG150}`)[3], "1500"); // 4500 - 3000 received
  assert.strictEqual(st(`Stock on hand — ${LRG150}`)[3], "4500");

  // A blank separator sits between blocks, but never at either end.
  assert.ok(out.some((l) => /^,+$/.test(l)), "blank separator row present");
  assert.ok(!/^,+$/.test(out.at(-1)!), "sheet does not end on a blank row");
}

// One matching item balances under its own name, and matches the ungrouped ledger's numbers.
{
  const only = LEDGER.filter((r) => r.day >= "2026-06-22" && r.day <= "2026-06-28");
  const g = lines(txCsvGrouped(only));
  assert.deepStrictEqual(cols(g.at(-2)!).slice(0, 5), [`Subtotal — ${ITEM}`, "", "", "20000", "8000"]);
  assert.strictEqual(cols(g.at(-1)!)[3], "12000");
  assert.strictEqual(cols(g.at(-1)!)[3], footer(only).onHand, "grouped and single agree");
}

// The whole legacy ledger is one item, so grouping it leaves its subtotal untouched.
assert.deepStrictEqual(cols(lines(txCsvGrouped(LEDGER)).at(-2)!).slice(3, 5), ["100000", "79500"]);

// --- A range with no movement says so, instead of looking like data went missing. ---
//
// Reported against Apple Juice: 55 on hand, nothing received or issued that week. The sheet read
// "Opening 55 / Totals 0 0 / Stock on hand 55" with an empty body, which looks like the
// transactions failed to load rather than like a quiet week.
{
  const quiet = lines(txCsv([], { units: 55, pieces: 55 }));
  assert.strictEqual(quiet.length, 5, "header + the note + three balance lines");
  assert.strictEqual(cols(quiet[1])[0], "No transactions in this date range");
  assert.strictEqual(cols(quiet.at(-3)!)[3], "55", "opening is still the real shelf count");
  assert.deepStrictEqual(cols(quiet.at(-2)!).slice(3, 5), ["0", "0"]);
  assert.strictEqual(cols(quiet.at(-1)!)[3], "55");
  // Same note on the grouped path, which a family search with no movement lands on.
  assert.strictEqual(cols(lines(txCsvGrouped([]))[1])[0], "No transactions in this date range");
}

console.log("ok: transaction export columns, week slices, direction filters, ledger totals, and grouped subtotals");
