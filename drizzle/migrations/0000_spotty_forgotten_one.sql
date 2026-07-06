CREATE TABLE IF NOT EXISTS "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" bigint,
	"kind" text NOT NULL,
	"qty_delta" integer,
	"expiry_set" date,
	"actor" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"uom" text DEFAULT 'EA' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"location" text NOT NULL,
	"expiry" date,
	"needs_expiry" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "stock_non_negative" CHECK ("products"."stock" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_location_idx" ON "products" USING btree ("location");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_expiry_idx" ON "products" USING btree ("expiry");