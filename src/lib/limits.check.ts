// Run: npx tsx src/lib/limits.check.ts
import assert from "node:assert";
import { MAX_QTY, checkQty } from "./limits";

// Everything the facility actually stocks passes. The largest real holding is ~4,100 boxes.
for (const n of [0, 1, 5, 300, 1085, 4142, 10_000, MAX_QTY]) {
  assert.strictEqual(checkQty(n), null, `${n} is a normal quantity`);
}
// Removals are sent as positive numbers, but a signed delta is still fine either way.
assert.strictEqual(checkQty(-4142), null);

// The typo that put 99.6% of the dashboard total into one row.
assert.match(checkQty(10_000_000)!, /looks like a typo/);
assert.match(checkQty(10_000_000)!, /100,000/, "says what the limit is");
assert.strictEqual(checkQty(MAX_QTY + 1) === null, false, "the cap is inclusive, one past it is not");

// Fractions never reach the integer stock column.
assert.match(checkQty(1.5)!, /whole number/);
assert.match(checkQty(-0.5)!, /whole number/);

// Junk that Number() happily produces from a hand-rolled request body.
assert.match(checkQty(NaN)!, /must be a number/);
assert.match(checkQty(Infinity)!, /must be a number/);

// The label is caller-supplied so the message names the field staff are looking at.
assert.match(checkQty(1.5, "Quantity received")!, /^Quantity received/);

console.log("ok: quantity limits accept every real holding and reject typos, fractions and junk");
