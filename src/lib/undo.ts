/**
 * How long floor staff can undo their own HAA pickup without the admin passcode.
 *
 * Long enough to walk back to the supply room and notice the count is wrong, short enough that
 * an "undo" is always about the order you just filed rather than a week of quiet edits. Past the
 * window the order can still be undone -- it just becomes an admin action, like every other
 * write that changes a count.
 */
export const UNDO_WINDOW_MS = 30 * 60 * 1000;

/** True while an order is still the picker's own to take back. `at` is the order's timestamp. */
export function withinUndoWindow(at: string | Date, now: number = Date.now()): boolean {
  const t = new Date(at).getTime();
  return Number.isFinite(t) && now - t <= UNDO_WINDOW_MS;
}
