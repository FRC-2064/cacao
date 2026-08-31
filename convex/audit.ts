import { query } from "./_generated/server";
import { requireActor, resolveNames } from "./auth";

/**
 * The audit feed. Gated -- see PUBLIC_DATA in convex/auth.ts -- because every
 * row is stamped with a `userId` and reading it is reading who did what.
 *
 * A deleted entity renders as e.g. "deleted grant": the row's own name is
 * gone with it, and this endpoint does not resurrect it.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    const rows = await ctx.db.query("auditLogs").order("desc").take(200);
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
