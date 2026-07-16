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
