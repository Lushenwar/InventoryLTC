// Run: npx tsx src/lib/pack.check.ts
import assert from "node:assert";
import { packSize, snapQty } from "./pack";

const cases: [string, number][] = [
  ["0.9% sodium chloride ... flush syringe, 30/box", 30],
  ["ALCOHOL PREP MEDIUM 20/ca", 20],
  ["APPLICATOR COTTON TIP 6\" STERILE 2/PK", 2],
  ["APRON PLASTIC ... BOX/100 EACH", 100],
  ["ACCEL ... 160 PER TUB CASE/1920 EACH", 1920],
  ["ATTENDS SHAPED PAD NIGHT SUPER , CASE/4 BAGS EACH", 4],
  ["Some glove 30/cs", 30],
  ["BEDSIDE RAIL BUMPER PAD W/2\" WRAP 30\"CVR", 1], // w/2" is with-2-inch, not a pack
  ["Cup Drinking Paper 4OZ 100/PK", 100],
  ["Covid Ag (rapid test kit),5pcs/box", 5],
  ["Calmoseptine Ointment, 3-5gm., 144 Count", 144],
  ["Colace Glycerin Suppositories, 24supporitories", 24],
  ["BluePad Alliance Underpad DISP 23\"x36\" 10/BG", 10],
  ["Cup Medicine Plastic 1OZ 30ML 50 sleeve/bx", 50],
  ["Alcohol 70%", 1],                       // no pack number
  ["CATHETER RED RUBBER 12FR", 1],          // gauge/size, not a pack
  ["Acetaminophen 325 mg Tab (Tylenol)", 1],
];

for (const [name, want] of cases) {
  assert.strictEqual(packSize(name), want, `${name} -> expected ${want}, got ${packSize(name)}`);
}

// --- snapQty: a typed piece count -> whole boxes. 300/box, 20 boxes (6,000 pieces) on hand. ---
const snap = (n: number) => snapQty(n, 300, 20);

assert.deepStrictEqual(snap(900), { boxes: 3, warn: null }, "an exact multiple passes through");
// The case from the report: 1000 lands on 900, never 1200.
assert.strictEqual(snap(1000).boxes, 3);
assert.match(snap(1000).warn!, /isn't a whole box of 300 — using 900/);
assert.strictEqual(snap(1199).boxes, 3, "rounds down, not to nearest");
assert.strictEqual(snap(1200).boxes, 4);
// Under one box still picks one -- a part box cannot leave the shelf.
assert.strictEqual(snap(1).boxes, 1);
assert.strictEqual(snap(299).boxes, 1);
// Over what is on hand clamps to the maximum and says so, rather than snapping first.
assert.strictEqual(snap(45_000).boxes, 20);
assert.match(snap(45_000).warn!, /Only 6,000 pcs on hand/);
assert.deepStrictEqual(snap(6_000), { boxes: 20, warn: null }, "exactly the maximum is not a warning");
// No box size: the item is counted in its stocked unit, so only the clamp can move it.
assert.deepStrictEqual(snapQty(7, null, 20), { boxes: 7, warn: null });
assert.strictEqual(snapQty(999, null, 20, "EA").boxes, 20);

console.log(`ok: ${cases.length} pack-size cases and the pickup quantity snap`);
