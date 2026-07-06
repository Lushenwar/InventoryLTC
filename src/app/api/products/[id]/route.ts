import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, products, events } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  const body = await req.json();

  const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  const code = body.code !== undefined ? String(body.code).trim() || null : existing.code;
  const uom = body.uom !== undefined ? String(body.uom).trim() || "EA" : existing.uom;
  const stock = body.stock !== undefined ? Math.max(0, Number(body.stock) || 0) : existing.stock;
  const location = body.location !== undefined ? String(body.location).trim() : existing.location;
  const expiry: string | null = body.expiry !== undefined ? body.expiry || null : existing.expiry;
  const needsExpiry = expiry
    ? false
    : body.needsExpiry !== undefined
      ? Boolean(body.needsExpiry)
      : existing.needsExpiry;
  const note = body.note !== undefined ? String(body.note).trim() : existing.note;

  const [updated] = await db
    .update(products)
    .set({ name, code, uom, stock, location, expiry, needsExpiry, note, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();

  const newEvents: (typeof events.$inferInsert)[] = [];
  if (stock !== existing.stock) {
    newEvents.push({ productId: id, kind: "adjust", qtyDelta: stock - existing.stock });
  }
  if (expiry !== existing.expiry) {
    newEvents.push({ productId: id, kind: "set_expiry", expirySet: expiry });
  }
  if (newEvents.length) await db.insert(events).values(newEvents);

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);

  const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  await db.insert(events).values({ productId: id, kind: "delete" });
  await db.delete(products).where(eq(products.id, id));

  return NextResponse.json({ ok: true });
}
