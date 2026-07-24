// Backfill products.units_per_box for every PPE row, and reset PPE stock (on-hand boxes)
// from the ProductBalSumQ 20260723 balance sheet: stock = round(StockBalEa / unitsPerBox).
//
// Sheet-listed items (by part number) get their exact Unit/bx + a fresh stock from the balance.
// PPE rows not in the sheet get units_per_box inferred from the name (packSize), with a few
// manual overrides; their stock is left alone.
//
// Dry run by default. Pass --apply to write. Idempotent (safe to re-run).
//   node scripts/backfill_ppe_units.mjs           # preview
//   node scripts/backfill_ppe_units.mjs --apply   # write
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL);
const APPLY = process.argv.includes("--apply");

// ProductBalSumQ 20260723.xlsx — PPE only: PN -> [unitsPerBox, stockBalEa]
const SHEET = {
  "9710-100-048": [48, 11760], "9710-100-025": [25, 175], "PM4-57162": [100, 16400],
  "AAMI-601510": [60, 0], "4016": [50, 0], "DIS-320B": [50, 0], "PG4-1172": [50, 19400],
  "VM-AL02": [50, 207100], "CanGuard L3": [50, 0], "355-1870": [440, 16940],
  "355-1860": [20, 400], "355-1860S": [20, 360], "PM6-20019": [230, 0], "MDS2584": [250, 20500],
  "MDS2587": [230, 34270], "1185-D": [300, 0], "MDS2586": [250, 0], "MDS2585": [250, 0],
  "1185-C": [300, 0], "9985-D": [100, 0], "9994-D": [100, 36500], "9994-B": [100, 41000],
  "9994-C": [100, 0], "9985-C": [100, 45000], "9994-A": [100, 24200], "211-3206": [100, 5400],
  "211-3208": [100, 3900], "211-3205": [100, 400], "PM6-20017": [250, 80000], "203214": [50, 150],
  "203314": [50, 250], "PM6-20018": [250, 273250], "FG3001": [300, 11100], "NGPF-7002": [100, 24100],
};
const norm = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
const sheetByCode = new Map(Object.entries(SHEET).map(([k, v]) => [norm(k), v]));

// packSize: pieces per stocked unit parsed from the messy name (mirror of src/lib/pack.ts).
function packSize(name) {
  const s = (name || "").toLowerCase();
  const m =
    s.match(/(\d+)\s*\/\s*[a-z]{2,}/) ||
    s.match(/[a-z]{2,}\s*\/\s*(\d+)/) ||
    s.match(/(\d+)\s*per\b/) ||
    s.match(/(\d+)\s*(?:count|ct|pcs|pc|pieces|supp\w*|sleeve|bags?|bg|pk)\b/);
  const n = m ? parseInt(m[1], 10) : 1;
  return n > 0 ? n : 1;
}
// Manual units/box for non-sheet PPE the name can't state (or where packSize misreads).
const OVERRIDE_BY_CODE = { "780-100906585": 160, "211-3207": 100 }; // wipe tub = 160/tub; Alliance vinyl L = 100
const OVERRIDE_BY_ID = { 290: 50 }; // "L2 Mask" (no code) — L2 masks are 50/box

const rows = await sql`SELECT id, code, name, stock FROM products WHERE category = 'PPE' ORDER BY name`;
const plan = [];
for (const r of rows) {
  const sheet = sheetByCode.get(norm(r.code));
  let upb, newStock;
  if (sheet) {
    upb = sheet[0];
    newStock = Math.round(sheet[1] / sheet[0]);
  } else {
    upb = OVERRIDE_BY_ID[r.id] ?? OVERRIDE_BY_CODE[r.code] ?? packSize(r.name);
    newStock = null; // not in balance sheet -> leave stock as-is
  }
  plan.push({ ...r, upb, newStock, fromSheet: !!sheet });
}

console.log("id    code            u/box  stock->new  src   name");
for (const p of plan) {
  const st = p.newStock === null ? String(p.stock).padEnd(11) : `${p.stock}->${p.newStock}`.padEnd(11);
  console.log(
    String(p.id).padEnd(5),
    (p.code || "∅").padEnd(15),
    String(p.upb).padEnd(6),
    st,
    (p.fromSheet ? "sheet" : "infer").padEnd(5),
    p.name.slice(0, 42),
  );
}
const frac = plan.filter((p) => p.fromSheet && p.newStock * p.upb !== SHEET[Object.keys(SHEET).find((k) => norm(k) === norm(p.code))][1]);
if (frac.length) console.log("\n⚠ rounded (StockBal not divisible by u/box):", frac.map((p) => `${p.code} -> ${p.newStock}`).join(", "));

if (!APPLY) { console.log(`\nDRY RUN — ${plan.length} PPE rows. Re-run with --apply to write.`); process.exit(0); }

await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS units_per_box integer`;
let n = 0;
for (const p of plan) {
  if (p.newStock === null) {
    await sql`UPDATE products SET units_per_box = ${p.upb} WHERE id = ${p.id}`;
  } else {
    await sql`UPDATE products SET units_per_box = ${p.upb}, stock = ${p.newStock}, updated_at = now(), updated_by = 'admin' WHERE id = ${p.id}`;
  }
  n++;
}
console.log(`\nAPPLIED to ${n} PPE rows.`);
