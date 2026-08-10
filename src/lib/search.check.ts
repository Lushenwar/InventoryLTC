// Run: npx tsx src/lib/search.check.ts
//
// The search box is how staff find anything, and the catalogue's names are nothing like the words
// people use for the items. These are the queries an HAA actually types.
import assert from "node:assert";
import { searchTerms } from "./search";

// Every word is required, so word order stops mattering.
assert.deepStrictEqual(searchTerms("blue gloves"), ["blue", "glove"]);
assert.deepStrictEqual(searchTerms("  gloves   blue  "), ["glove", "blue"], "extra spaces collapse");
assert.deepStrictEqual(searchTerms(""), []);
assert.deepStrictEqual(searchTerms(undefined), [], "an empty box filters nothing");

// A trailing plural "s" comes off, so "gloves" finds a product named "Glove".
assert.deepStrictEqual(searchTerms("gloves"), ["glove"]);
assert.deepStrictEqual(searchTerms("wipes briefs masks"), ["wipe", "brief", "mask"]);

// ...but not where it would mangle the word.
assert.deepStrictEqual(searchTerms("dress"), ["dress"], "double s is left alone");
assert.deepStrictEqual(searchTerms("gauze"), ["gauze"]);
assert.deepStrictEqual(searchTerms("abs"), ["abs"], "too short to be a plural noun");
assert.deepStrictEqual(searchTerms("iv"), ["iv"]);

// Catalogue codes survive: a trailing S is dropped, but substring matching still finds the row
// ("355-1860" matches "355-1860S"), so the search only ever widens.
assert.deepStrictEqual(searchTerms("355-1860S"), ["355-1860"]);
assert.deepStrictEqual(searchTerms("MDS2586"), ["MDS2586"]);

console.log("ok: search splits on words, requires each, and matches singular against plural");
