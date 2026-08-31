import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { wishlistSourceValidator } from "./validators";
import { actorFields, requireWriter } from "./auth";

/**
 * Kit the team wants but has not bought. Doubles as the standing answer to the
 * "what would you do with the funding" question on grant applications, which
 * is why anyone on the team can add to it -- the list is only useful if it is
 * the whole team's list, not the mentors'.
 *
 * Deliberately carries no person column at all -- not even an id -- because
 * this table is the shared team wish, not a record of who typed it in.
 */

/**
 * Public by design -- see PUBLIC_DATA in convex/auth.ts. Rebuilt from an
 * explicit allowlist like every other public list, even though this table
 * carries no person column to begin with -- a column added later still has
 * to be opted in here before it can leave the server.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    /**
     * 500 is a justified ceiling here, not an unexamined one -- the same
     * question was asked of `resolveNames` and of the donor lookups on
     * `expenses.list`/`income.list`, and those two were rekeyed off the
     * result set because their bounds genuinely could be outgrown.
     *
     * This table cannot reach it the same way. Every row is typed by a person
     * through `create` below; there is no importer, no HCB sync, and no
     * per-transaction row -- unlike `donors`, which grows by one row per new
     * name the bank hands us and so has no natural ceiling at all. The
     * wishlist is a document a team writes for grant applications ("what
     * would you do with the funding"), and one with 500 entries has stopped
     * being usable as that document long before it stops being readable here.
     *
     * The failure mode is also the mild one: a row past the bound does not
     * render, on a page whose whole content is this list, seen by the people
     * who typed it. Nothing is silently mis-computed -- contrast a donor name
     * resolving to `undefined`, which drops a real gift out of donor
     * reporting while every total still looks plausible.
     *
     * If it ever does need to grow: paginate, do not raise the number. That
     * is a two-sided change -- `cacaoStore.svelte.ts` consumes this as a
     * plain array -- which is why it is not made here.
     */
    const items = await ctx.db.query("wishlist").take(500);
    return items.map((w) => ({
      _id: w._id,
      tool: w.tool, company: w.company, cost: w.cost,
      source: w.source, priority: w.priority, description: w.description,
      itemLink: w.itemLink, updatedAt: w.updatedAt,
    }));
  },
});

/** 10 is most wanted. Anything outside 1-10 is a typo, not a stronger opinion. */
function clampPriority(priority: number): number {
  if (!Number.isFinite(priority)) return 5;
  return Math.min(10, Math.max(1, Math.round(priority)));
}

export const create = mutation({
  args: {
    tool: v.string(),
    company: v.optional(v.string()),
    cost: v.number(),
    source: wishlistSourceValidator,
    priority: v.number(),
    description: v.optional(v.string()),
    itemLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);

    const now = Date.now();
    const id = await ctx.db.insert("wishlist", {
      ...args,
      priority: clampPriority(args.priority),
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "create",
      entityType: "wishlist",
      entityId: id,
    });

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("wishlist"),
    tool: v.string(),
    company: v.optional(v.string()),
    cost: v.number(),
    source: wishlistSourceValidator,
    priority: v.number(),
    description: v.optional(v.string()),
    itemLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, ...fields } = args;

    const item = await ctx.db.get("wishlist", id);
    if (!item) throw new Error("Wishlist item not found");

    await ctx.db.patch("wishlist", id, {
      ...fields,
      priority: clampPriority(fields.priority),
      updatedAt: Date.now(),
    });

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "wishlist",
      entityId: id,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("wishlist"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id } = args;

    const item = await ctx.db.get("wishlist", id);
    if (!item) return;

    await ctx.db.delete("wishlist", id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "wishlist",
      entityId: id,
    });
  },
});
