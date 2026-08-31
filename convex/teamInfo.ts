import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { actorFields, requireAdmin } from "./auth";

/**
 * The facts grant applications keep asking for: EIN, address, member count.
 * One row per fact, hand-ordered, so a new kind of question costs a row rather
 * than a schema migration.
 */

/**
 * Public by design -- see PUBLIC_DATA in convex/auth.ts -- these are the facts
 * the team puts on grant applications. Who last edited one is not among them,
 * so every row is rebuilt from an explicit allowlist rather than returned
 * as-is: `updatedById` stays server-side, and a column added to the schema
 * later has to be opted in here before it can leave the server.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("teamInfo").withIndex("by_order").collect();
    return rows.map((r) => ({
      _id: r._id,
      label: r.label,
      value: r.value,
      order: r.order,
      updatedAt: r.updatedAt,
    }));
  },
});

export const create = mutation({
  args: {
    label: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const { label, value } = args;

    // Appended to the end; the list is hand-ordered and a new fact has no
    // claim to a position until someone moves it.
    const existing = await ctx.db.query("teamInfo").collect();
    const order = existing.reduce((max, r) => Math.max(max, r.order), -1) + 1;

    const id = await ctx.db.insert("teamInfo", {
      label,
      value,
      order,
      updatedAt: Date.now(),
      updatedById: actor._id,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "create",
      entityType: "team_info",
      entityId: id,
    });

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("teamInfo"),
    label: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const { id, label, value } = args;

    const row = await ctx.db.get("teamInfo", id);
    if (!row) throw new Error("Team info field not found");

    await ctx.db.patch("teamInfo", id, {
      label,
      value,
      updatedAt: Date.now(),
      updatedById: actor._id,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "team_info",
      entityId: id,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("teamInfo"),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const { id } = args;

    const row = await ctx.db.get("teamInfo", id);
    if (!row) return;

    await ctx.db.delete("teamInfo", id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "team_info",
      entityId: id,
    });
  },
});

/**
 * Rewrite the whole ordering in one mutation. The caller sends the ids in their
 * new order, so a drag that moves one row cannot leave the rest inconsistent
 * with it -- which is what patching a single row's `order` would risk.
 */
export const reorder = mutation({
  args: {
    ids: v.array(v.id("teamInfo")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const { ids } = args;

    const now = Date.now();
    for (let i = 0; i < ids.length; i++) {
      await ctx.db.patch("teamInfo", ids[i], { order: i, updatedAt: now, updatedById: actor._id });
    }

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "team_info",
      entityId: "team_info",
    });
  },
});
