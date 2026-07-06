import "dotenv/config";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, sql } from "drizzle-orm";
import { products } from "../drizzle/schema.js";

const db = drizzle(neon(process.env.DATABASE_URL!));

type SeedItem = {
  code: string | null;
  name: string;
  uom: string;
  stock: number;
  location: string;
  expiry: string | null;
  needsExpiry: boolean;
  note: string;
};

// ponytail: matches on (code, name, location) per CLAUDE.md; done as select-then-write
// rather than ON CONFLICT because most legacy rows have a null/blank code, and Postgres
// treats NULLs as distinct for unique-constraint conflict matching.
async function upsert(item: SeedItem) {
  const codeKey = item.code || "";
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        sql`coalesce(${products.code}, '') = ${codeKey}`,
        eq(products.name, item.name),
        eq(products.location, item.location),
      ),
    )
    .limit(1);

  const values = {
    code: item.code || null,
    uom: item.uom || "EA",
    stock: item.stock ?? 0,
    expiry: item.expiry || null,
    needsExpiry: item.needsExpiry ?? false,
    note: item.note || "",
  };

  if (existing.length) {
    await db.update(products).set(values).where(eq(products.id, existing[0].id));
    return "updated";
  }

  await db.insert(products).values({ ...values, name: item.name, location: item.location });
  return "inserted";
}

async function main() {
  const items: SeedItem[] = JSON.parse(readFileSync(new URL("../data/seed.json", import.meta.url), "utf8"));
  let inserted = 0, updated = 0;
  for (const item of items) {
    const result = await upsert(item);
    if (result === "inserted") inserted++; else updated++;
  }
  console.log(`Seed complete: ${inserted} inserted, ${updated} updated, ${items.length} total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
