import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { ledgerCategoryValidator } from "./validators";
import { actorFields, getActor, requireWriter, resolveNames } from "./auth";

/**
 * Human categories for Hack Club Bank transactions the memo rules could not
 * classify. The transactions themselves live in HCB and are fetched from its
 * API on the client; only the team's own filing decision is stored here,
 * keyed by HCB's transaction id.
 */

/** Public by design -- see PUBLIC_DATA in convex/auth.ts. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("hcbCategories").take(2000);

    const actor = await getActor(ctx);
    const names = actor ? await resolveNames(ctx, rows.map((h) => h.setById)) : null;

    return rows.map((h) => ({
      _id: h._id,
      hcbTransactionId: h.hcbTransactionId, direction: h.direction,
      category: h.category, updatedAt: h.updatedAt,
      // Person references resolve only for a signed-in member.
      setByName: names?.get(h.setById),
    }));
  },
});

/**
 * File a transaction under a category. Upserts, because a transaction has at
 * most one filing and people change their minds.
 */
export const set = mutation({
  args: {
    hcbTransactionId: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
    category: ledgerCategoryValidator,
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { hcbTransactionId, direction, category } = args;

    const existing = await ctx.db
      .query("hcbCategories")
      .withIndex("by_transaction", (q) => q.eq("hcbTransactionId", hcbTransactionId))
      .unique();

    const fields = {
      hcbTransactionId,
      direction,
      category,
      setById: actor._id,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch("hcbCategories", existing._id, fields);
    } else {
      await ctx.db.insert("hcbCategories", fields);
    }

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "system",
      entityId: hcbTransactionId,
    });
  },
});

/** Drop a filing, returning the transaction to automatic classification. */
export const clear = mutation({
  args: {
    hcbTransactionId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { hcbTransactionId } = args;

    const existing = await ctx.db
      .query("hcbCategories")
      .withIndex("by_transaction", (q) => q.eq("hcbTransactionId", hcbTransactionId))
      .unique();

    // Already automatic; clearing twice is not an error worth surfacing.
    if (!existing) return;

    await ctx.db.delete("hcbCategories", existing._id);

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "system",
      entityId: hcbTransactionId,
    });
  },
});
