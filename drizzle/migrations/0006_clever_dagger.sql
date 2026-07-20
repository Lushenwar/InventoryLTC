ALTER TABLE "products" ADD COLUMN "category" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" USING btree ("category");