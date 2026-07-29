// Run: npx tsx src/lib/weeks.check.ts
import assert from "node:assert";
import { isoWeekEnd, isoWeekOf, isoWeekStart, weeksInIsoYear } from "./weeks";

// 2026 starts on a Thursday, so it is a 53-week year -- the case a flat "52 weeks" gets wrong.
assert.strictEqual(weeksInIsoYear(2026), 53);
assert.strictEqual(weeksInIsoYear(2025), 52);
assert.strictEqual(weeksInIsoYear(2020), 53);

// Week 1 of 2026 starts in December 2025.
assert.strictEqual(isoWeekStart(2026, 1), "2025-12-29");
assert.strictEqual(isoWeekEnd(2026, 1), "2026-01-04");
assert.strictEqual(isoWeekStart(2026, 31), "2026-07-27");
assert.strictEqual(isoWeekEnd(2026, 31), "2026-08-02");
assert.strictEqual(isoWeekEnd(2026, 53), "2027-01-03");

// Round trip: every week start reports the week it came from.
for (const year of [2020, 2025, 2026, 2027]) {
  for (let w = 1; w <= weeksInIsoYear(year); w++) {
    assert.deepStrictEqual(isoWeekOf(isoWeekStart(year, w)), { year, week: w }, `${year} W${w} start`);
    assert.deepStrictEqual(isoWeekOf(isoWeekEnd(year, w)), { year, week: w }, `${year} W${w} end`);
  }
}

// January dates that belong to the previous ISO year.
assert.deepStrictEqual(isoWeekOf("2027-01-01"), { year: 2026, week: 53 });
assert.deepStrictEqual(isoWeekOf("2026-01-01"), { year: 2026, week: 1 });
assert.deepStrictEqual(isoWeekOf("2026-07-29"), { year: 2026, week: 31 });

console.log("ok: iso week math holds across 2020, 2025, 2026, 2027");
