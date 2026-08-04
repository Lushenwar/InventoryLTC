// Pack size ("pieces per stocked unit") parsed from the messy legacy product name,
// e.g. "CASE/250 EACH" -> 250, "30/box" -> 30, "5pcs/box" -> 5, "144 Count" -> 144.
// Quantity = stock * packSize. A name with no pack number means 1 piece per unit.
// ponytail: heuristic over free-text names; it will miss/misread ambiguous
// multi-number titles. Upgrade path if mis-reads pile up: a stored override column.
export function packSize(name: string): number {
  const s = name.toLowerCase();
  // Pack count = the number beside a slash, either order: "30/cs" -> 30, "case/4" -> 4,
  // "box/100 each" -> 100. Word side needs 2+ letters so 'w/2"' (with-2-inch) doesn't match.
  const m =
    s.match(/(\d+)\s*\/\s*[a-z]{2,}/) ||   // 30/box, 2/pk, 250/bx, 10/bg
    s.match(/[a-z]{2,}\s*\/\s*(\d+)/) ||   // case/4, box/100, case/1920 each
    s.match(/(\d+)\s*per\b/) ||            // 160 per tub, 20 per package
    s.match(/(\d+)\s*(?:count|ct|pcs|pc|pieces|supp\w*|sleeve|bags?|bg|pk)\b/); // 144 count, 5pcs, 4 bags, 12pk
  const n = m ? parseInt(m[1], 10) : 1;
  return n > 0 ? n : 1;
}

export type Snap = { boxes: number; warn: string | null };

/**
 * A freely typed quantity -> the whole boxes actually pickable, plus the message to show
 * when the entry had to move. Stock is boxes, so anything between two box counts has to snap.
 *
 * Rounds *down* -- 1000 pieces of a 300/box item is 900, not 1200: never hand out more than
 * was asked for. Floors at one box, because a fraction of a box cannot be picked, and clamps
 * to what is on hand. `unitsPerBox` null means the item is counted in its stocked unit, where
 * the only thing that can move is the clamp.
 */
export function snapQty(entered: number, unitsPerBox: number | null, maxBoxes: number, unit = "pcs"): Snap {
  const per = unitsPerBox ?? 1;
  const maxPieces = maxBoxes * per;
  if (entered > maxPieces) {
    return { boxes: maxBoxes, warn: `Only ${maxPieces.toLocaleString()} ${unit} on hand — set to the maximum.` };
  }
  const boxes = Math.max(1, Math.floor(entered / per));
  const landed = boxes * per;
  if (landed === entered) return { boxes, warn: null };
  return {
    boxes,
    warn: `${entered.toLocaleString()} ${unit} isn't a whole box of ${per} — using ${landed.toLocaleString()}.`,
  };
}
