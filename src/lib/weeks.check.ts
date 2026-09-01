// Run: npx tsx src/lib/weeks.check.ts
import assert from "node:assert";
import { weekEnd, weekOf, weekStart, weeksInYear } from "./weeks";

// Week 1 is the week of the year's first Monday: 2026 W1 is Jan 5-11.
assert.strictEqual(weekStart(2026, 1), "2026-01-05");
assert.strictEqual(weekEnd(2026, 1), "2026-01-11");

// 2024 starts on a Monday, so it runs to 53 weeks -- the case a flat "52 weeks" gets wrong.
assert.strictEqual(weeksInYear(2024), 53);
assert.strictEqual(weeksInYear(2025), 52);
assert.strictEqual(weeksInYear(2026), 52);

assert.strictEqual(weekStart(2026, 30), "2026-07-27");
assert.strictEqual(weekEnd(2026, 30), "2026-08-02");
assert.strictEqual(weekEnd(2026, 52), "2027-01-03");

// Round trip: every week start reports the week it came from.
for (const year of [2020, 2024, 2025, 2026, 2027]) {
  for (let w = 1; w <= weeksInYear(year); w++) {
    assert.deepStrictEqual(weekOf(weekStart(year, w)), { year, week: w }, `${year} W${w} start`);
    assert.deepStrictEqual(weekOf(weekEnd(year, w)), { year, week: w }, `${year} W${w} end`);
  }
}

// January days before the first Monday close out the previous year.
assert.deepStrictEqual(weekOf("2026-01-01"), { year: 2025, week: 52 });
assert.deepStrictEqual(weekOf("2026-01-04"), { year: 2025, week: 52 });
assert.deepStrictEqual(weekOf("2026-01-05"), { year: 2026, week: 1 });
assert.deepStrictEqual(weekOf("2027-01-01"), { year: 2026, week: 52 });
assert.deepStrictEqual(weekOf("2026-07-29"), { year: 2026, week: 30 });

// A year that itself starts on a Monday has no leftover days.
assert.deepStrictEqual(weekOf("2024-01-01"), { year: 2024, week: 1 });

console.log("ok: week math holds across 2020, 2024, 2025, 2026, 2027");
