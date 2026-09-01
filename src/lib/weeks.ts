// Week numbering for picking an export range by week number.
// Weeks run Monday to Sunday and week 1 is the one starting on the year's first Monday --
// so 2026 W1 is Jan 5-11. A year holds 52 or 53 of them (2024 has 53), so nothing here
// assumes a flat 52. Days before the first Monday belong to the previous year's last week.

const DAY = 86400000;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Monday of the week containing d.
function mondayOf(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getTime() - dow * DAY);
}

// First Monday on or after Jan 1.
function week1Monday(year: number): Date {
  const jan1 = utc(year, 1, 1);
  const dow = (jan1.getUTCDay() + 6) % 7;
  return dow === 0 ? jan1 : new Date(jan1.getTime() + (7 - dow) * DAY);
}

const weeksBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / (7 * DAY));

export function weekStart(year: number, week: number): string {
  return iso(new Date(week1Monday(year).getTime() + (week - 1) * 7 * DAY));
}

export function weekEnd(year: number, week: number): string {
  return iso(new Date(week1Monday(year).getTime() + ((week - 1) * 7 + 6) * DAY));
}

// Whatever is left between this year's first Monday and the next one: 52 or 53.
export function weeksInYear(year: number): number {
  return weeksBetween(week1Monday(year), week1Monday(year + 1));
}

// The week belongs to the calendar year of its Monday, so Jan 1-4 of a year that does not
// start on a Monday reads as the previous year's week 52/53.
export function weekOf(date: string): { year: number; week: number } {
  const [y, m, d] = date.split("-").map(Number);
  const monday = mondayOf(utc(y, m, d));
  const year = monday.getUTCFullYear();
  return { year, week: weeksBetween(week1Monday(year), monday) + 1 };
}
