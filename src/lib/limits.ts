/**
 * Largest quantity a single write may set or move, in stocked units (boxes).
 *
 * Nothing in the catalogue comes near it -- the biggest genuine holding is ~4,100 boxes -- so this
 * leaves roughly 24x headroom over anything real.
 *
 * It exists because a stray keypress used to sail straight through. A receive of 10,000,000 on one
 * row survived every layer of the app and left 99.6% of the dashboard's "units on hand" figure
 * sitting inside a single typo. There was no upper bound anywhere between a thumb and the database.
 */
export const MAX_QTY = 100_000;

/**
 * Null when the quantity is usable, otherwise the message to hand back.
 *
 * Rejects fractions too: stock is an integer column, so a decimal either errors in Postgres or is
 * silently rounded, and neither is something staff should discover from a count going wrong.
 */
export function checkQty(n: number, what = "Quantity"): string | null {
  if (!Number.isFinite(n)) return `${what} must be a number`;
  if (!Number.isInteger(n)) return `${what} must be a whole number`;
  if (Math.abs(n) > MAX_QTY) {
    return `${what} of ${n.toLocaleString()} looks like a typo — the most you can enter at once is ${MAX_QTY.toLocaleString()}`;
  }
  return null;
}

/**
 * A pickup line big enough to be worth querying before it lands.
 *
 * `MAX_QTY` catches the keypress that lands in the millions; this catches the one that stays
 * plausible. There is no way to tell 50-from-5 apart from a real 50 when 200 are on the shelf,
 * and pretending to would just teach staff to tap past the warning. What *is* recognisable is a
 * line that clears the shelf -- both the likeliest place for an extra digit and the one where a
 * wrong number does the most damage, because the room reads as empty and the out-of-stock
 * trigger takes the lot's expiry date with it.
 *
 * `qty` and `max` are in stocked units (boxes); the magnitude test is in the units on screen,
 * so PPE is judged on the pieces staff actually typed.
 */
export const CLEARS_SHELF = 0.8;
const WORTH_QUERYING = 10; // one or two of anything is never a mistyped digit

export function clearsShelf(qty: number, max: number, unitsPerBox: number | null): boolean {
  return qty * (unitsPerBox ?? 1) >= WORTH_QUERYING && qty >= max * CLEARS_SHELF;
}
