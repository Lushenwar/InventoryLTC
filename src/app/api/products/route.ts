import { NextRequest, NextResponse } from "next/server";
import { db, products, events } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const location = String(body.location ?? "").trim();
  if (!name) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
  if (!location) return NextResponse.json({ error: "Location is required" }, { status: 400 });

  const stock = Math.max(0, Number(body.stock) || 0);
  const expiry: string | null = body.expiry || null;
  const needsExpiry = expiry ? false : Boolean(body.needsExpiry);

  const [created] = await db
    .insert(products)
    .values({
      code: body.code ? String(body.code).trim() : null,
      name,
      uom: body.uom ? String(body.uom).trim() : "EA",
      stock,
      location,
      expiry,
      needsExpiry,
      note: body.note ? String(body.note).trim() : "",
    })
    .returning();

  await db.insert(events).values({
    productId: created.id,
    kind: "create",
    qtyDelta: stock,
    expirySet: expiry,
  });

  return NextResponse.json(created, { status: 201 });
}
