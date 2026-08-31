import { query } from "./_generated/server";
import { requireActor } from "./auth";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  ANONYMOUS_DONOR_NAME,
  isAnonymousDonor,
  isEmailShapedDonorName,
  normalizeDonorName,
} from "./donorNames";

/**
 * People and organisations who gave money or goods.
 *
 * Spec section 5 rules that donor *names* stay public because they are already
 * public on HCB, and they still are: `expenses.list` and `income.list` emit
 * each gift's `donorName` to a stranger, unchanged.
 *
 * This query is a different artifact from those -- the whole table, enumerated
 * on request, `normalizedKey` included -- and it has exactly one caller,
 * `DonorNameInput.svelte`, which is mounted only inside `ExpenseModal` and
 * `LogDepositModal`. Both are writer-only forms, so `requireActor` costs the
 * typeahead nothing and takes a listing endpoint off the unauthenticated
 * surface of a branch whose subject is exactly that. Deleting it, the other
 * option, would break both forms' duplicate-spelling defence.
 *
 * Contrast `contacts`, which is gated harder still: an adult at a sponsor
 * organisation gave the team their email and phone number, not their name to
 * publish.
 */

/**
 * Rebuilt from an explicit allowlist like every other list here, even though
 * this table has only three columns -- a column added later has to be opted
 * in before it can leave the server.
 *
 * `.collect()` rather than `.take(n)`, matching the other public lists. A
 * bound would be the wrong instinct on this table specifically: donors are
 * the one thing here that grows by a row per new name the bank hands us, so
 * any ceiling picked today can be outgrown -- and a truncated donor is not a
 * missing list entry, it is a gift that silently stops being attributable.
 * `.collect()` past the transaction limit fails loudly instead, which is the
 * behaviour to want if it ever gets there.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    const rows = await ctx.db.query("donors").collect();
    return rows
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((d) => ({
        _id: d._id,
        displayName: d.displayName,
        normalizedKey: d.normalizedKey,
        isAnonymous: d.isAnonymous,
      }));
  },
});

/**
 * Resolve a typed donor name to a row, creating one if this is a name we have
 * not seen. Returns `undefined` for a blank or absent name.
 *
 * **Why this is a helper and not a mutation.** The property that matters is
 * that a member filling in a deposit form can attribute it to a donor,
 * existing or new, without the client inventing an id -- and without a second
 * round-trip that could leave the deposit saved and its donor lost. A
 * `donors.findOrCreate` mutation the client calls before `income.add` is two
 * transactions: the first can commit and the second fail, and now there is an
 * orphan donor row and a deposit attributed to nobody. Called from inside the
 * deposit mutation it is one transaction, so the donor and the gift commit
 * together or not at all. This is also what spec section 5 asks for --
 * "ingestion-time find-or-create ... when HCB hands us a name, resolve or
 * create the donor row once" -- rather than a join-time heuristic.
 *
 * The client therefore never sends a `v.id("donors")`. It sends the string
 * the form collected, which is what it has; `donors.list` above exists so a
 * form can offer the existing names and avoid inventing a near-duplicate
 * spelling in the first place.
 *
 * Matching is `normalizeDonorName`, the same rule `src/lib/finance/donors.ts`
 * groups the donor report by, imported rather than reimplemented -- see
 * `convex/donorNames.ts`. Without that, "Ruth & Paul Harrison" typed today
 * and "Ruth and Paul Harrison" typed next month become two rows and one
 * household's giving is split in half in the report, with no error anywhere.
 */
export async function resolveDonorByName(
  ctx: MutationCtx,
  rawName: string | undefined
): Promise<Id<"donors"> | undefined> {
  if (rawName === undefined) return undefined;

  // Collapsed, not just trimmed: "Ruth   Harrison" and "Ruth Harrison" are
  // one donor, and the display name is what every report renders.
  const displayName = rawName.trim().replace(/\s+/g, " ");
  // A blank is a deliberate value, not a missing one: it is what a user
  // leaves behind when they clear the donor field. The callers distinguish
  // "field absent" (leave the existing donor alone) from "field blank" (clear
  // it), and both arrive here as `undefined` out.
  if (displayName === "") return undefined;

  /**
   * An email address is not a name, and this is the write side of a rule that
   * only existed on the read side.
   *
   * `src/lib/finance/donors.ts` routes an email-shaped name into the anonymous
   * bucket when it *renders* a gift, and says why: HCB's donation form takes
   * whatever is typed into its name box, and "a human can type an address into
   * a name box just as readily as a donor can". But redaction at read time with
   * no guard at write time means the address is already in `donors.displayName`
   * -- which `donors.list` emits to any member, and which `income.list` and
   * `expenses.list` emit as `donorName` to anyone at all. On a branch about
   * not publishing addresses,
   * that is the wrong place to be relying on every reader remembering.
   *
   * Routed to the bucket rather than refused: throwing here would reject the
   * whole deposit over its donor field, losing money the member is trying to
   * record. Two such gifts merging is not a mis-attribution -- it is a bucket,
   * not a person, and `isAnonymousDonor` below then marks the row as one.
   */
  const attributable = isEmailShapedDonorName(displayName)
    ? ANONYMOUS_DONOR_NAME
    : displayName;

  // The fallback matters for a name that normalizes to nothing at all -- a
  // donor written only in non-Latin script, say. Without it every such donor
  // would collapse onto the empty key and become one row. Kept identical to
  // `scripts/import/generate.ts`'s registry so an imported donor and a
  // hand-typed one land on the same row.
  const normalizedKey = normalizeDonorName(attributable) || attributable.toLowerCase();

  // `.first()`, not `.unique()`. Two rows sharing a key would be a bug, but
  // it is a bug about one person recorded twice -- attributing this gift to
  // either is right, while throwing would refuse to save a deposit over a
  // duplicate the member cannot see or fix.
  const existing = await ctx.db
    .query("donors")
    .withIndex("by_normalized_key", (q) => q.eq("normalizedKey", normalizedKey))
    .first();
  if (existing) return existing._id;

  return await ctx.db.insert("donors", {
    displayName: attributable,
    normalizedKey,
    isAnonymous: isAnonymousDonor(attributable),
  });
}
