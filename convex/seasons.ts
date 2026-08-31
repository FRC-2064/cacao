import { query } from "./_generated/server";

/**
 * The competition seasons, newest first.
 *
 * Public by design -- see PUBLIC_DATA in convex/auth.ts -- and unlike every
 * other public list on this backend there is deliberately **no** `getActor` /
 * `resolveNames` pass here: a season is a label and two calendar days. It
 * carries no person reference, no id that resolves to one, and nothing that
 * differs between a stranger and a signed-in member. Do not add a gate or an
 * actor lookup by reflex -- there is nothing here for either to protect.
 *
 * The projection is still an explicit allowlist rather than a rest-spread, so
 * a column added to the schema later has to be opted in here before it can
 * leave the server. That part is the house pattern regardless of sensitivity.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    // Bounded: a season is one school year, so this table gains a row a year.
    const rows = await ctx.db.query("seasons").take(50);
    return rows
      // `startDate` is `YYYY-MM-DD`, so a string compare is a date compare.
      .sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))
      .map((s) => ({
        _id: s._id,
        label: s.label,
        startDate: s.startDate,
        endDate: s.endDate,
        isCurrent: s.isCurrent,
      }));
  },
});
