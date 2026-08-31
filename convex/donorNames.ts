/**
 * Donor name matching -- the single implementation, on the server.
 *
 * The rule this encodes ("Ruth & Paul Harrison" and "Ruth and Paul Harrison"
 * are one donor) has to run in two places that cannot share a module freely:
 * `convex/donors.ts`, which resolves a name to a row at write time, and
 * `src/lib/finance/donors.ts`, which groups gifts for the donor report.
 * `convex/lib.ts` faced the same problem with `seasonForDate` and duplicated
 * the four lines. Duplicating a *matching* rule is worse: two copies that
 * drift do not produce an error, they produce two donor rows for one person
 * and a report that quietly splits their giving in half.
 *
 * So it lives here instead, and both sides import it. This file is a leaf
 * with no imports at all, deliberately: that is what lets it be reached from
 * a Convex function, from the browser bundle, and from
 * `scripts/import/generate.ts` under Node's type stripping (which needs the
 * explicit `.ts` extension, and so cannot follow a chain that uses
 * extensionless imports). Keep it that way -- add an import here and one of
 * those three stops working.
 *
 * The direction matters and is not arbitrary: the client imports the server's
 * copy, not the other way round. `npm run build`, `npm run check` and the
 * test run all exercise the client reaching into `convex/`. Nothing available
 * outside a deployment exercises deployed Convex code reaching into `src/`,
 * so that direction would be an unverified bet on the deploy bundler.
 */

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "rev"]);

/**
 * Reduce a donor name to a key that survives the spellings people actually
 * use. Built from the variants observed in the live HCB data: trailing
 * whitespace, inconsistent casing, `&` against `and`, and stray punctuation.
 */
export function normalizeDonorName(raw: string): string {
  const collapsed = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed
    .split(" ")
    .filter((word) => word.length > 0 && !HONORIFICS.has(word))
    .join(" ");
}

/**
 * Does this "name" carry an email address?
 *
 * HCB's donation form takes whatever is typed into its name box, and people
 * type their email: the live feed contains `"Donation from
 * A.Rivera0106@example.com"`. Section 5 of the design rules that donor names
 * stay public because they are already public on HCB -- that ruling is about
 * *names*, and an address is not one.
 *
 * Containment rather than a whole-string match, deliberately: "John Smith
 * (john@example.com)" is the same disclosure as the bare address. A real
 * donor name has no `@` in it, so there is nothing on the other side of the
 * trade.
 */
export function isEmailShapedDonorName(raw: string): boolean {
  return /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(raw);
}

/**
 * The same address, taken out of free text that has to stay readable.
 *
 * The donor report shows each gift's description next to its donor, and for
 * an HCB donation that description *is* the memo -- so sanitizing the name
 * alone still rendered "Donation from someone@example.com" one line below the
 * name it had just replaced, and wrote it into the per-donor CSV export.
 *
 * A fresh literal each call rather than a shared `/g` regex: a `g` regex
 * carries `lastIndex` between calls, so a shared one would silently skip
 * every other match.
 */
export function redactEmails(text: string): string {
  return text.replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, "[email removed]");
}

/**
 * The spelling HCB itself uses for a gift with no attributable donor, and so
 * the one `isAnonymousDonor` below already recognises.
 *
 * Lives here rather than in `src/lib/finance/donors.ts`, where it started,
 * because both sides now need it: the report routes an email-shaped name into
 * this bucket when *reading*, and `donors.resolveDonorByName` has to route the
 * same name into it when *writing*, or the address is already in the database
 * by the time anything redacts it.
 */
export const ANONYMOUS_DONOR_NAME = "Anonymous Donor";

/**
 * HCB labels anonymous gifts "Anonymous Donor". These roll into one row --
 * a fun figure to see -- but must never merge into a named donor, so they are
 * recognised here and excluded from fuzzy suggestions.
 */
export function isAnonymousDonor(raw: string): boolean {
  return /^anonymous(\s+donor)?$/.test(normalizeDonorName(raw));
}
