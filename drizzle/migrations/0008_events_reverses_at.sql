-- Which HAA order an event undoes: the `at` timestamp every line of that order shares.
-- Null on ordinary events. It is what makes "has this order already been undone?" an exact
-- question -- without it a second undo would hand the stock back twice.
ALTER TABLE events ADD COLUMN IF NOT EXISTS reverses_at timestamptz;
