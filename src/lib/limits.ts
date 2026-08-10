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
