// Run: npx tsx src/lib/pack.check.ts
import assert from "node:assert";
import { packSize } from "./pack";

const cases: [string, number][] = [
  ["0.9% sodium chloride ... flush syringe, 30/box", 30],
  ["ALCOHOL PREP MEDIUM 20/ca", 20],
  ["APPLICATOR COTTON TIP 6\" STERILE 2/PK", 2],
  ["APRON PLASTIC ... BOX/100 EACH", 100],
  ["ACCEL ... 160 PER TUB CASE/1920 EACH", 1920],
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
console.log(`ok: ${cases.length} cases pass`);
