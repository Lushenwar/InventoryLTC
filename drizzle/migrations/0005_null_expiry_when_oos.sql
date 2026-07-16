-- Out-of-stock items carry no expiry: an item that isn't physically here has nothing to expire.
-- Enforced in the DB so every write path (receive, remove, pickup, edit, create) obeys it.
CREATE OR REPLACE FUNCTION null_expiry_when_oos() RETURNS trigger AS $$
BEGIN
  IF NEW.stock = 0 THEN
    NEW.expiry := NULL;
    NEW.needs_expiry := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS products_null_expiry_when_oos ON products;
--> statement-breakpoint
CREATE TRIGGER products_null_expiry_when_oos
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION null_expiry_when_oos();
--> statement-breakpoint
UPDATE products SET expiry = NULL, needs_expiry = false WHERE stock = 0 AND (expiry IS NOT NULL OR needs_expiry);
