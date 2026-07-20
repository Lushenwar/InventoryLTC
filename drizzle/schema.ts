import { pgTable, bigserial, bigint, text, integer, boolean, date, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const products = pgTable("products", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: text("code"),
  name: text("name").notNull(),
  uom: text("uom").notNull().default("EA"),
  stock: integer("stock").notNull().default(0),
  location: text("location").notNull(),
  category: text("category"),           // sorting/grouping bucket; null until assigned
  expiry: date("expiry"),
  needsExpiry: boolean("needs_expiry").notNull().default(false),
  // Set true once the "expired" alert has gone out for this item's current expiry
  // date, so the daily sweep alerts once and not every day. Reset to false whenever
  // expiry changes (receive / admin edit) so a re-dated item can alert again.
  expiredNotified: boolean("expired_notified").notNull().default(false),
  note: text("note").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
}, (table) => [
  index("products_location_idx").on(table.location),
  index("products_category_idx").on(table.category),
  index("products_expiry_idx").on(table.expiry),
  check("stock_non_negative", sql`${table.stock} >= 0`),
]);

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: bigint("product_id", { mode: "number" }).references(() => products.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  qtyDelta: integer("qty_delta"),
  expirySet: date("expiry_set"),
  note: text("note"),          // free-text reason, e.g. why stock was removed ("used", "wasted")
  actor: text("actor"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
