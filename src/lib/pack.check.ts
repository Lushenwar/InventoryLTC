// Run: npx tsx src/lib/pack.check.ts
import assert from "node:assert";
import { packSize, receiveBoxes, snapQty } from "./pack";

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

// --- receiveBoxes: stock going ON the shelf. Must never round up. ---
//
// The bug this pins: receiving 400 pieces of a 250/box glove used to book 2 boxes = 500 pieces,
// inventing 100 that never arrived. Receiving and picking up now round the same way -- down.
assert.strictEqual(receiveBoxes(500, 250), 2, "an exact multiple is itself");
assert.strictEqual(receiveBoxes(400, 250), 1, "400 pieces is one box, not two");
assert.strictEqual(receiveBoxes(749, 250), 2);
assert.strictEqual(receiveBoxes(750, 250), 3);
// Under one box books nothing, so the caller can explain instead of inventing a box.
assert.strictEqual(receiveBoxes(100, 250), 0);
assert.strictEqual(receiveBoxes(249, 250), 0);
assert.strictEqual(receiveBoxes(0, 250), 0);
assert.strictEqual(receiveBoxes(-5, 250), 0, "a negative entry books nothing");
// No box size: the entry is already in the stocked unit.
assert.strictEqual(receiveBoxes(7, null), 7);
assert.strictEqual(receiveBoxes(0, null), 0);
// Receiving and picking up agree on where a part-box lands, for every size in the catalogue.
for (const per of [20, 50, 100, 150, 230, 250, 300, 440, 1920]) {
  for (const pieces of [per - 1, per, per + 1, per * 3 + 7, per * 10]) {
    const recv = receiveBoxes(pieces, per);
    assert.strictEqual(recv, Math.floor(pieces / per), `receive ${pieces}@${per}`);
    if (recv >= 1) {
      assert.strictEqual(snapQty(pieces, per, 9_999).boxes, recv, `receive and pickup agree at ${pieces}@${per}`);
    }
  }
}

console.log(`ok: ${cases.length} pack-size cases, the pickup quantity snap, and receive box rounding`);
