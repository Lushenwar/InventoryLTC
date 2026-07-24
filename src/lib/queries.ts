import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, products } from "./db";
import type { Counts, Product } from "./types";

export interface Filters {
  q?: string;
  loc?: string;
  cat?: string;
  status?: string;
  sort?: string;
  dir?: string;
}

const SORTABLE = new Set(["name", "location", "category", "stock", "expiry"]);

// Every expiry status is scoped to in-stock rows so the chip filters match the
// badges: a zero-on-hand item is "Out of stock", never expired/expiring/etc.
function statusPredicate(status: string | undefined, today: string): SQL | undefined {
  switch (status) {
    case "expired":
      return sql`${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} < ${today}`;
    case "soon":
      return sql`${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} >= ${today} and ${products.expiry} <= (${today}::date + interval '30 day')`;
    case "watch":
      return sql`${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} > (${today}::date + interval '30 day') and ${products.expiry} <= (${today}::date + interval '90 day')`;
    case "soon90":
      return sql`${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} >= ${today} and ${products.expiry} <= (${today}::date + interval '90 day')`;
    case "ok":
      return sql`${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} > (${today}::date + interval '90 day')`;
    case "flag":
      return sql`${products.stock} > 0 and ${products.expiry} is null and ${products.needsExpiry} = true`;
    case "none":
      return sql`${products.stock} > 0 and ${products.expiry} is null and ${products.needsExpiry} = false`;
    case "oos":
      return eq(products.stock, 0);
    default:
      return undefined;
  }
}

// Mirrors the prototype's sort tie-break: real dates first, then flagged
// "needs date" items, then unflagged "no expiry" items last.
function expirySortExpr(today: string) {
  return sql`case
    when ${products.expiry} is not null then (${products.expiry} - ${today}::date)
    when ${products.needsExpiry} then 900000000
    else 900000001
  end`;
}

export async function fetchProducts(filters: Filters, today: string): Promise<Product[]> {
  const conditions: SQL[] = [];
  if (filters.loc && filters.loc !== "all") conditions.push(eq(products.location, filters.loc));
  if (filters.cat && filters.cat !== "all") conditions.push(eq(products.category, filters.cat));
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(or(ilike(products.name, like), ilike(products.code, like))!);
  }
  const statusCond = statusPredicate(filters.status, today);
  if (statusCond) conditions.push(statusCond);

  const sortKey = SORTABLE.has(filters.sort ?? "") ? filters.sort! : "expiry";
  const sortExpr = sortKey === "expiry" ? expirySortExpr(today) : products[sortKey as "name" | "location" | "category" | "stock"];
  const orderFn = filters.dir === "desc" ? desc : asc;

  const rows = await db
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderFn(sortExpr));

  return rows as Product[];
}

export async function fetchCounts(today: string): Promise<Counts> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      onhand: sql<number>`coalesce(sum(${products.stock}),0)::int`,
      expired: sql<number>`count(*) filter (where ${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} < ${today})::int`,
      soon: sql<number>`count(*) filter (where ${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} >= ${today} and ${products.expiry} <= (${today}::date + interval '30 day'))::int`,
      watch: sql<number>`count(*) filter (where ${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} > (${today}::date + interval '30 day') and ${products.expiry} <= (${today}::date + interval '90 day'))::int`,
      ok: sql<number>`count(*) filter (where ${products.stock} > 0 and ${products.expiry} is not null and ${products.expiry} > (${today}::date + interval '90 day'))::int`,
      flag: sql<number>`count(*) filter (where ${products.stock} > 0 and ${products.expiry} is null and ${products.needsExpiry} = true)::int`,
      none: sql<number>`count(*) filter (where ${products.stock} > 0 and ${products.expiry} is null and ${products.needsExpiry} = false)::int`,
      oos: sql<number>`count(*) filter (where ${products.stock} = 0)::int`,
    })
    .from(products);
  return row;
}

export async function fetchLocations(): Promise<string[]> {
  const rows = await db.selectDistinct({ location: products.location }).from(products).orderBy(asc(products.location));
  return rows.map((r) => r.location);
}

export async function fetchCategories(): Promise<string[]> {
  const rows = await db.selectDistinct({ category: products.category }).from(products).orderBy(asc(products.category));
  return rows.map((r) => r.category).filter((c): c is string => !!c);
}
