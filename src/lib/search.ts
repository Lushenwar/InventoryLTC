/**
 * A typed query -> the words to require, each stripped of a plural "s".
 *
 * Lives apart from `queries.ts` because that file is server-only (it pulls in the database
 * client), and this rule is worth testing on its own.
 *
 * Staff search for "gloves"; the catalogue says "Glove Nitrile (blue) Lrg". Requiring every word
 * lets word order stop mattering, and dropping a trailing "s" makes singular and plural the same
 * search -- together that is the difference between finding the item and concluding the app is
 * broken. Only for words long enough to be a real noun, and never on a double "s" ("dress" must
 * not become "dres").
 *
 * ponytail: one character off the end, not a stemmer. Upgrade path if the misses pile up is
 * Postgres full-text search, which is a schema change and an index, not a line of code.
 */
export function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && /[^s]s$/i.test(t) ? t.slice(0, -1) : t));
}
