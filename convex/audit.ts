import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireActor, resolveNames } from "./auth";

/**
 * The audit feed. Gated -- see PUBLIC_DATA in convex/auth.ts -- because every
 * row is stamped with a `userId` and reading it is reading who did what.
 *
 * A deleted entity renders as e.g. "deleted grant": the row's own name is
 * gone with it, and this endpoint does not resurrect it.
 *
 * `limit` is declared because the client sends it. The store was passing
 * `{ limit: 200 }` against `args: {}`, which Convex rejects -- "Unexpected
 * field `limit` in object" -- so the subscription never delivered a snapshot
 * and the feed read empty no matter how many rows were behind it. Two things
 * kept that quiet. The generated args type for an empty validator is `{}`,
 * which in TypeScript accepts any object, so `tsc` saw nothing wrong. And the
 * store routes this subscription's errors to `onGatedError`, which returns
 * silently while `isSignedIn` is false -- true on first load, before the
 * Google token arrives -- so a permanent argument error read exactly like
 * "someone is just browsing".
 */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireActor(ctx);
    const rows = await ctx.db.query("auditLogs").order("desc").take(args.limit ?? 200);
    const names = await resolveNames(ctx, rows.map((r) => r.userId));
    return rows.map((r) => ({
      _id: r._id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      change: r.change,
      timestamp: r._creationTime,
      // The resolved name is the whole point of the feed; the raw `userId`
      // that produced it is not. Spreading the row emitted both, which let a
      // member correlate every edit of a person whose name they cannot see.
      actorName: names.get(r.userId) ?? "Unknown member",
    }));
  },
});
