// Run: npx tsx src/lib/limits.check.ts
import assert from "node:assert";
import { MAX_QTY, checkQty, clearsShelf } from "./limits";

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

// Clearing the shelf is what gets queried -- an ordinary draw off a full room is not.
assert.strictEqual(clearsShelf(40, 42, null), true, "40 of 42 empties the room");
assert.strictEqual(clearsShelf(42, 42, null), true, "and so does taking all of it");
assert.strictEqual(clearsShelf(50, 200, null), false, "a quarter of the shelf is an ordinary order");

// Small numbers are never queried: taking the last box of something is normal, and a warning
// there is a warning staff learn to tap straight past.
assert.strictEqual(clearsShelf(1, 1, null), false, "the last single box");
assert.strictEqual(clearsShelf(9, 9, null), false, "still under the threshold");
assert.strictEqual(clearsShelf(10, 10, null), true, "two digits, and the shelf is empty");

// PPE is judged on the pieces staff typed, not the box count they never see.
assert.strictEqual(clearsShelf(1, 1, 300), true, "300 pieces is worth querying; 1 box would not be");
assert.strictEqual(clearsShelf(3, 10, 300), false, "900 pieces off a well-stocked room is fine");

console.log("ok: quantity limits accept every real holding and reject typos, fractions and junk, and shelf-clearing pickups get queried");
