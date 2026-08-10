// Run: npx tsx src/lib/shelflife.check.ts
import assert from "node:assert";
import { expiryFromMfg, shelfLifeYears } from "./shelflife";

// Every distinct PPE product name in the database, with the years it must map to.
const cases: [string, number][] = [
  ["3M N95 1860 20/box", 5],
  ["3M N95 1870+ 440/case", 5],
  ["Medicom N95 Small 50/box", 5],
  ["Glove Nitrile (blue) Lrg 250/box", 5],
  ["ALLIANCE Glove Vinyl MEDIUM (7W)", 5],
  ["GLOVE COPOLY POLYETHYLENE ONE SIZE FIT ALL BOX/500 EACH, 10bx/case", 5],
  ["MEDLINE Nitrile Gloves X-Large 230/box", 5],
  ["Synguard Nitrile Gloves Medium 100/box", 5],
  ["MEDICOM ASSURETOUCH SHIELD PF VINYL XL", 5], // a glove line, not a face shield
  ["Sterling Face Shield 48/box", 3],
  ["Viva L2 Mask 50/box", 3],
  ["CanadamasQ L2 Mask 50/box", 3],
  ["L2 Mask", 3],
  ["PER-MED L2 Gown 100/box", 3],
  ["Global L3 Gown 60/box", 3],
  ['ACCEL 1 MINUTE DISINFECTANT WIPE 6"X7" 160 PER TUB CASE/1920 EACH', 2],
  ["ALOE CARE FOAMING 72% ALCOHOL HAND SANITIZER 1L PUMP BTL CASE/8 EACH", 2],
  ["health  sanitizer", 2],
];
for (const [name, want] of cases) {
  assert.strictEqual(shelfLifeYears(name), want, `${name} -> expected ${want}, got ${shelfLifeYears(name)}`);
}

const glove = "Glove Nitrile (blue) Lrg 250/box";
assert.strictEqual(expiryFromMfg("2026-03-14", glove), "2031-03-14");
assert.strictEqual(expiryFromMfg("2026-01-05", "Viva L2 Mask 50/box"), "2029-01-05");
assert.strictEqual(expiryFromMfg("2026-01-05", "health  sanitizer"), "2028-01-05");
// Leap day clamps back, never forward past the real shelf life.
assert.strictEqual(expiryFromMfg("2024-02-29", glove), "2029-02-28");

console.log(`ok: ${cases.length + 4} cases pass`);
