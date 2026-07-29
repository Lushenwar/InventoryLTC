// PPE shelf life. PPE boxes are stamped with a manufacture date far more often
// than an expiry, so staff enter whichever one is printed and we derive the other.
// Years are the conservative end of each published range (a "2-3 year" sanitizer
// is treated as 2) so nothing is trusted past its real date.
// ponytail: name heuristic like pack.ts, checked against all 46 PPE rows in
// shelflife.check.ts. Upgrade path if new PPE stock misses these patterns: a
// shelf_life_years column on products.
export function shelfLifeYears(name: string): number {
  const s = name.toLowerCase();
  if (/sanitiz|wipe|disinfect/.test(s)) return 2; // alcohol / peroxide evaporates
  if (/mask|gown|face shield/.test(s)) return 3; // "shield" alone is a glove line (Assuretouch Shield)
  return 5; // gloves, N95s, everything else
}

// Same day-of-month N years away. Feb 29 clamps back to Feb 28 rather than
// spilling into March, so a derived expiry never lands a day late.
function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  const day = String(Math.min(d, daysInMonth)).padStart(2, "0");
  return `${y + years}-${String(m).padStart(2, "0")}-${day}`;
}

export const expiryFromMfg = (mfg: string, name: string) => shiftYears(mfg, shelfLifeYears(name));

// Inverse, for display. Only meaningful when it lands in the past -- an expiry
// that outruns the shelf life implies a manufacture date that hasn't happened
// yet, which is nonsense, not information. Callers drop it (see MfgLine).
export const mfgFromExpiry = (expiry: string, name: string) => shiftYears(expiry, -shelfLifeYears(name));
