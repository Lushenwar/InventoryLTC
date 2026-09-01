-- Which HAA order an event undoes: the `at` timestamp every line of that order shares.
-- Null on ordinary events. It is what makes "has this order already been undone?" an exact
-- question -- without it a second undo would hand the stock back twice.
ALTER TABLE events ADD COLUMN IF NOT EXISTS reverses_at timestamptz;
--> statement-breakpoint
-- One undo per product per order. Two staff double-tapping "Undo" on a slow phone would both
-- pass an application-level "already undone?" check and hand the stock back twice; this makes
-- the second one fail in the database instead. An order never has two lines for the same
-- product -- the cart is keyed by product -- so the pair is unique by construction.
CREATE UNIQUE INDEX IF NOT EXISTS events_one_reversal_per_line
  ON events (reverses_at, product_id) WHERE reverses_at IS NOT NULL;
