// Pack size ("pieces per stocked unit") parsed from the messy legacy product name,
// e.g. "CASE/250 EACH" -> 250, "30/box" -> 30, "5pcs/box" -> 5, "144 Count" -> 144.
// Quantity = stock * packSize. A name with no pack number means 1 piece per unit.
// ponytail: heuristic over free-text names; it will miss/misread ambiguous
// multi-number titles. Upgrade path if mis-reads pile up: a stored override column.
export function packSize(name: string): number {
  const s = name.toLowerCase();
  const m =
    s.match(/\/\s*(\d+)\s*(?:each|ea)\b/) ||                                   // case/250 each, box/100 each, /100 each
    s.match(/(\d+)\s*\/\s*(?:box|bx|bag|bg|pk|pack|case|ca|tub|sleeve|pkg|package)\b/) || // 30/box, 2/pk, 250/bx, 100/pk
    s.match(/(\d+)\s*per\b/) ||                                                // 160 per tub, 20 per package
    s.match(/(\d+)\s*(?:count|ct|pcs|pc|pieces|supp\w*|sleeve|bags?|bg)\b/) || // 144 count, 5pcs, 4 bags, 10bg
    s.match(/(\d+)\s*pk\b/);                                                   // 12pk
  const n = m ? parseInt(m[1], 10) : 1;
  return n > 0 ? n : 1;
}
