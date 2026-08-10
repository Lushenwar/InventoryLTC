/**
 * Assigns a `category` to every product.
 *
 *  - Non-"38 Facility Storage" locations map to a single category (LOCATION_CATEGORY).
 *  - "38 Facility Storage" items take their category from data/supply-categories.csv
 *    (matched by code, then by name); anything not in that list is inferred from
 *    keywords (INFER_RULES) into one of the CSV's own categories.
 *
 * Run:  npx tsx scripts/set_categories.ts --dry         # print the plan, write nothing
 *       npx tsx scripts/set_categories.ts --seed-only   # rewrite seed.json only, leave the DB
 *       npx tsx scripts/set_categories.ts               # update prod DB + seed.json
 *
 * Idempotent: re-running produces the same categories, so a second run reports 0 changes.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync, writeFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const STORE_38 = "38 Facility Storage";

// Location -> the category for anything in that room a ROOM_RULES entry doesn't claim.
// A room is only a safe default where the room really is single-purpose (the drug room, the
// glove room). Where it isn't, ROOM_RULES below does the real work.
const LOCATION_CATEGORY: Record<string, string> = {
  "32 Facility Storage": "Waste",          // Stericycle sharps/waste bins -- was "Lab", which they are not
  "52 Equipment Storage": "Personal care",
  "52 Facility Storage": "Fall prevention",
  "58 Facility Storage": "PPE",
  "62 Facility Storage": "PPE",
  "68 Facility Storage": "Brief",
  "72 Equipment Storage": "Brief",
  "78 Facility Storage": "Brief",
  "7W Record Room": "Medicine",
  "Receiving Outdoor Pod": "Brief",        // two brief lines -- was "Medicine", plainly wrong
};

// Per-item rules for the rooms that hold more than one kind of thing. Stamping a whole room
// with one category made "category" a second, worse copy of "location" -- which is how a dry
// wipe ended up filed as a brief. First match wins, so order matters within a room.
const ROOM_RULES: Record<string, [RegExp, string][]> = {
  // The catch-all room: food, protective wear, toiletries and plastic containers all together.
  "52 Equipment Storage": [
    [/apron|shoe cover|shower cap/i, "PPE"],
    [/apple|honey|thickner|thickener|juice|sauce/i, "Nutrition"],
    [/urine specimen/i, "Lab"],
    // Body/toileting care. Ahead of the container rule so "DENTURE CUP" reads as denture care,
    // not as a cup.
    [/bedpan|urinal|commode|emesis|wash basin|denture|tooth|comb|razor|shav|shampoo|bodywash|lotion|skin cream|perineal|mouth rinse|nail clipper|glycerin swab|readybath/i, "Personal care"],
    [/cup|fork|spoon|straw|tumbler|basket|caddy|dispenser|bracket|spray bottle|jug|tray|tub scrub|cylinder|shoe box|box holder|tissue|distilled water/i, "General Supplies"],
  ],
  // Fall equipment, lift equipment and pressure-relief padding share a room but not a purpose.
  "52 Facility Storage": [
    [/hoyer|sling|transport chair/i, "Mobility & Transfer"],
    [/heel|foot pillow|wedge|cushion|equagel|silicore/i, "Pressure care"],
  ],
  // The brief rooms also stock peri-care wipes and washcloths -- Patrick's actual finding.
  "68 Facility Storage": [[/wipe|washcloth/i, "Personal care"]],
  "72 Equipment Storage": [[/wipe|washcloth/i, "Personal care"]],
  "78 Facility Storage": [[/wipe|washcloth/i, "Personal care"]],
};

// "Medication" (3 topical antiseptics) sat next to "Medicine" (61 actual drugs) and nobody could
// tell which was which from the filter dropdown. Betadine, peroxide and a barrier ointment are
// skin/wound products, so they join the category that already covers those.
const MERGE: Record<string, string> = { Medication: "Wound care" };

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

type Src = "location" | "room-rule" | "csv" | "infer";
export function makeCategorizer() {
  const { byCode, byName } = loadCsv();
  const merge = (c: string) => MERGE[c] ?? c;
  return (loc: string, code: string | null, name: string): { category: string; source: Src } => {
    if (loc !== STORE_38) {
      for (const [re, cat] of ROOM_RULES[loc] ?? []) if (re.test(name)) return { category: merge(cat), source: "room-rule" };
      return { category: merge(LOCATION_CATEGORY[loc] ?? "Uncategorized"), source: "location" };
    }
    const hit = byCode.get(norm(code)) || byName.get(norm(name));
    if (hit) return { category: merge(hit), source: "csv" };
    return { category: merge(infer(name)), source: "infer" };
  };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const seedOnly = process.argv.includes("--seed-only");
  const categorize = makeCategorizer();
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`select id, code, name, location, category from products order by location, name` as any[];

  const counts: Record<string, number> = {};
  const inferred: { name: string; category: string }[] = [];
  const changed: { loc: string; name: string; from: string; to: string }[] = [];
  for (const p of rows) {
    const { category, source } = categorize(p.location, p.code, p.name);
    counts[category] = (counts[category] || 0) + 1;
    if (source === "infer") inferred.push({ name: p.name, category });
    if ((p.category ?? "") !== category) changed.push({ loc: p.location, name: p.name, from: p.category ?? "(none)", to: category });
  }

  console.log("=== category totals ===");
  for (const [c, n] of Object.entries(counts).sort()) console.log(n.toString().padStart(4), c);

  // The whole point of the dry run: every row whose category this pass would move, so the
  // reclassification is reviewed as a list of decisions rather than trusted as a rule set.
  console.log(`\n=== would change (${changed.length}) ===`);
  for (const c of changed.sort((a, b) => a.loc.localeCompare(b.loc) || a.from.localeCompare(b.from) || a.name.localeCompare(b.name)))
    console.log(`  ${c.loc.slice(0, 21).padEnd(22)} ${c.from.padEnd(16)} -> ${c.to.padEnd(20)} ${c.name.slice(0, 46)}`);

  console.log(`\n=== 38-storage inferred (${inferred.length}) — review these ===`);
  for (const i of inferred.sort((a, b) => a.category.localeCompare(b.category)))
    console.log(`  ${i.category.padEnd(18)} ${i.name}`);

  if (dry) { console.log("\n(dry run — nothing written)"); return; }

  // update DB -- skipped by --seed-only, so the reclassification can land in a PR as a seed.json
  // diff and only touch the live inventory when that PR is deployed.
  if (seedOnly) {
    console.log("\n(--seed-only — DB left alone)");
  } else {
    for (const p of rows) {
      const { category } = categorize(p.location, p.code, p.name);
      await sql`update products set category=${category} where id=${p.id}`;
    }
    console.log(`\nUpdated ${rows.length} DB rows.`);
  }

  // update seed.json (the spreadsheet of record)
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8"));
  for (const s of seed) s.category = categorize(s.location, s.code, s.name).category;
  writeFileSync("data/seed.json", JSON.stringify(seed, null, 2) + "\n");
  console.log(`Updated ${seed.length} seed.json rows.`);
}
main();
