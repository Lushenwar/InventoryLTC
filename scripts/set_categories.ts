/**
 * Assigns a `category` to every product.
 *
 *  - Non-"38 Facility Storage" locations map to a single category (LOCATION_CATEGORY).
 *  - "38 Facility Storage" items take their category from data/supply-categories.csv
 *    (matched by code, then by name); anything not in that list is inferred from
 *    keywords (INFER_RULES) into one of the CSV's own categories.
 *
 * Run:  npx tsx scripts/set_categories.ts --dry     # print plan, write nothing
 *       npx tsx scripts/set_categories.ts           # update prod DB + seed.json
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, writeFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const STORE_38 = "38 Facility Storage";

// Location -> single category (everything except 38 Facility Storage).
const LOCATION_CATEGORY: Record<string, string> = {
  "32 Facility Storage": "Lab",
  "52 Equipment Storage": "Personal",
  "52 Facility Storage": "Fall",
  "58 Facility Storage": "PPE",
  "62 Facility Storage": "PPE",
  "68 Facility Storage": "Brief",
  "72 Equipment Storage": "Brief",
  "78 Facility Storage": "Brief",
  "7W Record Room": "Medicine",
  "Receiving Outdoor Pod": "Medicine",
};

// Keyword rules for 38-storage items not present in the CSV. First match wins,
// so order matters (catheter before generic bandage/tray, etc.).
// ponytail: keyword heuristic, upgrade path is to extend the CSV instead.
const INFER_RULES: [RegExp, string][] = [
  [/tape measure/i, "General Supplies"],
  [/catheter|foley|urine|urethral|urinary|coude|leg bag|statlock/i, "Urology"],
  [/needle|syringe|luer|solution set|medication set/i, "Needle, Syringes"],
  [/o2|oxygen|cannula|resuscit|vari-?vent|yankauer|whistle tip|suction/i, "Respiratory"],
  [/bag for injection|dextrose/i, "IV"],
  [/lab |fecal|occult|fungus|virus|enteric|rplex|hema-?screen|nasopharyngeal|specimen|\butm\b/i, "Lab"],
  [/betadine|povidone|peroxide|calmoseptine|ointment|iodine/i, "Medication"],
  [/enfit|feeding|kangaroo|enteral/i, "Nutrition"],
  [/blood pressure|thermometer|otoscope|penlight|specula|probe cover/i, "Diagnostics"],
  [/gauze|bandage|dressing|abdominal pad|eye pad|tegaderm|tensor|conform|sure-?wrap|elastic|\btape\b|non-adherent|telfa|triangular|staple remover|sponge|wound/i, "Wound care"],
  [/scissor|tray|instrument|forceps|cotton ball|applicator|tongue depressor|pill crusher|body bag|cold\/hot pack|hot pack/i, "General Supplies"],
];

// minimal CSV parse: quoted fields, embedded commas/newlines.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s: string | null | undefined) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function loadCsv() {
  const byCode = new Map<string, string>(), byName = new Map<string, string>();
  for (const r of parseCsv(readFileSync("data/supply-categories.csv", "utf8")).slice(1)) {
    if (r.length < 7 || !r[2]) continue;
    let [, category, code, desc, , , product] = r;
    if (category.startsWith("Male EXTERNAL")) category = "Urology"; // mangled by embedded newline in CSV
    if (category === "SYRINGE") category = "Needle, Syringes";
    for (const c of code.split(/[\\/\n]+/)) if (norm(c)) byCode.set(norm(c), category);
    if (norm(desc)) byName.set(norm(desc), category);
    if (norm(product)) byName.set(norm(product), category);
  }
  return { byCode, byName };
}

function infer(name: string): string {
  for (const [re, cat] of INFER_RULES) if (re.test(name)) return cat;
  return "General Supplies";
}

type Src = "location" | "csv" | "infer";
export function makeCategorizer() {
  const { byCode, byName } = loadCsv();
  return (loc: string, code: string | null, name: string): { category: string; source: Src } => {
    if (loc !== STORE_38) return { category: LOCATION_CATEGORY[loc] ?? "Uncategorized", source: "location" };
    const hit = byCode.get(norm(code)) || byName.get(norm(name));
    if (hit) return { category: hit, source: "csv" };
    return { category: infer(name), source: "infer" };
  };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const categorize = makeCategorizer();
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`select id, code, name, location from products order by location, name` as any[];

  const counts: Record<string, number> = {};
  const inferred: { name: string; category: string }[] = [];
  for (const p of rows) {
    const { category, source } = categorize(p.location, p.code, p.name);
    counts[category] = (counts[category] || 0) + 1;
    if (source === "infer") inferred.push({ name: p.name, category });
  }

  console.log("=== category totals ===");
  for (const [c, n] of Object.entries(counts).sort()) console.log(n.toString().padStart(4), c);
  console.log(`\n=== 38-storage inferred (${inferred.length}) — review these ===`);
  for (const i of inferred.sort((a, b) => a.category.localeCompare(b.category)))
    console.log(`  ${i.category.padEnd(18)} ${i.name}`);

  if (dry) { console.log("\n(dry run — nothing written)"); return; }

  // update DB
  for (const p of rows) {
    const { category } = categorize(p.location, p.code, p.name);
    await sql`update products set category=${category} where id=${p.id}`;
  }
  console.log(`\nUpdated ${rows.length} DB rows.`);

  // update seed.json (the spreadsheet of record)
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  for (const s of seed) s.category = categorize(s.location, s.code, s.name).category;
  writeFileSync("data/seed.json", JSON.stringify(seed, null, 2) + "\n");
  console.log(`Updated ${seed.length} seed.json rows.`);
}
main();
