// ISO-8601 week numbering, for picking an export range by week number.
// Weeks run Monday to Sunday and week 1 is the one containing Jan 4. A year holds 52 or
// 53 of them -- 2026 has 53 -- so nothing here assumes a flat 52.

const DAY = 86400000;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Monday of the ISO week containing d.
function mondayOf(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getTime() - dow * DAY);
}

const week1Monday = (year: number) => mondayOf(utc(year, 1, 4));

const weeksBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / (7 * DAY));

export function isoWeekStart(year: number, week: number): string {
  return iso(new Date(week1Monday(year).getTime() + (week - 1) * 7 * DAY));
}

export function isoWeekEnd(year: number, week: number): string {
  return iso(new Date(week1Monday(year).getTime() + ((week - 1) * 7 + 6) * DAY));
}

// Dec 28 always falls in the final ISO week of its calendar year, which is the cheapest
// way to ask whether this year runs to 52 or 53.
export function weeksInIsoYear(year: number): number {
  return weeksBetween(week1Monday(year), mondayOf(utc(year, 12, 28))) + 1;
}

// The ISO year is the calendar year of that week's Thursday, so early January can belong
// to the previous year's week 52/53 (2026-01-01 is week 1, but 2027-01-01 is 2026 W53).
export function isoWeekOf(date: string): { year: number; week: number } {
  const [y, m, d] = date.split("-").map(Number);
  const monday = mondayOf(utc(y, m, d));
  const year = new Date(monday.getTime() + 3 * DAY).getUTCFullYear();
  return { year, week: weeksBetween(week1Monday(year), monday) + 1 };
}
