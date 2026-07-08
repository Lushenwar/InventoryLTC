import "server-only";
import { asc, inArray, sql } from "drizzle-orm";
import { db, products } from "./db";
import { daysUntil } from "./expiry";

export interface ExpiringItem {
  name: string;
  location: string;
  expiry: string;
  daysToExpiry: number;
}
export interface ExpiredItem {
  id: number;
  name: string;
  location: string;
  expiry: string;
}

const listCols = { name: products.name, location: products.location, expiry: products.expiry };

// Everything expiring within `windowDays` (default 30) but not yet expired.
// Used by the monthly "expiring soon" digest -- purely date-based, no state.
export async function getExpiring(today: string, windowDays = 30): Promise<ExpiringItem[]> {
  const rows = await db
    .select(listCols)
    .from(products)
    .where(sql`${products.expiry} is not null and ${products.expiry} >= ${today} and ${products.expiry} <= (${today}::date + (${windowDays} || ' day')::interval)`)
    .orderBy(asc(products.location));
  return rows.map((r) => ({ name: r.name, location: r.location, expiry: r.expiry!, daysToExpiry: daysUntil(r.expiry, today)! }));
}

// Items that are expired AND have not had an "expired" alert sent yet.
// These are what triggers a send; empty means the daily sweep stays quiet.
export async function getNewlyExpired(today: string): Promise<ExpiredItem[]> {
  const rows = await db
    .select({ id: products.id, ...listCols })
    .from(products)
    .where(sql`${products.expiry} is not null and ${products.expiry} < ${today} and ${products.expiredNotified} = false`)
    .orderBy(asc(products.location));
  return rows.map((r) => ({ id: r.id, name: r.name, location: r.location, expiry: r.expiry! }));
}

// Every currently-expired item, notified or not -- the "summary of the other
// things that have expired as well" that rides along in the expired alert.
export async function getAllExpired(today: string): Promise<ExpiredItem[]> {
  const rows = await db
    .select({ id: products.id, ...listCols })
    .from(products)
    .where(sql`${products.expiry} is not null and ${products.expiry} < ${today}`)
    .orderBy(asc(products.location));
  return rows.map((r) => ({ id: r.id, name: r.name, location: r.location, expiry: r.expiry! }));
}

export async function markExpiredNotified(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.update(products).set({ expiredNotified: true }).where(inArray(products.id, ids));
}
