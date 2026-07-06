import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, products } from "./db";
import { daysUntil } from "./expiry";

export interface Rollup {
  generatedAt: string;
  windowDays: number;
  expired: { name: string; location: string; expiry: string }[];
  expiring: { name: string; location: string; expiry: string; daysToExpiry: number }[];
  needsDate: { name: string; location: string }[];
  outOfStock: { name: string; location: string }[];
}

const cols = { name: products.name, location: products.location, expiry: products.expiry };

export async function buildRollup(today: string, windowDays = 90): Promise<Rollup> {
  const [expiredRows, expiringRows, needsDateRows, outOfStockRows] = await Promise.all([
    db.select(cols).from(products).where(sql`${products.expiry} is not null and ${products.expiry} < ${today}`).orderBy(asc(products.location)),
    db.select(cols).from(products)
      .where(sql`${products.expiry} is not null and ${products.expiry} >= ${today} and ${products.expiry} <= (${today}::date + (${windowDays} || ' day')::interval)`)
      .orderBy(asc(products.location)),
    db.select({ name: products.name, location: products.location }).from(products)
      .where(and(isNull(products.expiry), eq(products.needsExpiry, true)))
      .orderBy(asc(products.location)),
    db.select({ name: products.name, location: products.location }).from(products)
      .where(eq(products.stock, 0))
      .orderBy(asc(products.location)),
  ]);

  return {
    generatedAt: today,
    windowDays,
    expired: expiredRows.map((r) => ({ name: r.name, location: r.location, expiry: r.expiry! })),
    expiring: expiringRows.map((r) => ({ name: r.name, location: r.location, expiry: r.expiry!, daysToExpiry: daysUntil(r.expiry, today)! })),
    needsDate: needsDateRows,
    outOfStock: outOfStockRows,
  };
}
