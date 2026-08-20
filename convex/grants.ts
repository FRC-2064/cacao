import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import {
  actorArgs,
  deadlineTypeValidator,
  grantStatusValidator,
  priorityValidator,
  requirementValidator,
} from "./validators";

export const list = query({
  args: {
    season: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const season = args.season;
    const grants = season
      ? await ctx.db
          .query("grants")
          .withIndex("by_season", (q) => q.eq("season", season))
          .collect()
      : await ctx.db.query("grants").collect();
    return grants.sort((a, b) => a.order - b.order);
  },
});

export const getById = query({
  args: { id: v.id("grants") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    funder: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal("backlog"),
      v.literal("drafting"),
      v.literal("awaiting_approval"),
      v.literal("submitted"),
      v.literal("awarded"),
      v.literal("rejected")
    ),
    deadline: v.optional(v.string()),
    deadlineType: v.union(v.literal("fixed"), v.literal("rolling"), v.literal("tbd")),
    deadlineNote: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    assigneeName: v.optional(v.string()),
    priority: v.union(v.literal("urgent"), v.literal("high"), v.literal("medium"), v.literal("low")),
    season: v.string(),
    portalUrl: v.optional(v.string()),
    docUrl: v.optional(v.string()),
    fileNote: v.optional(v.string()),
    requirements: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        done: v.boolean(),
      })
    ),
    notes: v.optional(v.string()),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("grants")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();

    const maxOrder = existing.reduce((max, g) => Math.max(max, g.order), 0);
    const newOrder = maxOrder + 1000;

    const now = Date.now();
    const grantId = await ctx.db.insert("grants", {
      title: args.title,
      funder: args.funder,
      amount: args.amount,
      currency: args.currency,
      status: args.status,
      deadline: args.deadline,
      deadlineType: args.deadlineType,
      deadlineNote: args.deadlineNote,
      assigneeId: args.assigneeId,
      assigneeName: args.assigneeName,
      priority: args.priority,
      season: args.season,
      portalUrl: args.portalUrl,
      docUrl: args.docUrl,
      fileNote: args.fileNote,
      requirements: args.requirements,
      notes: args.notes,
      order: newOrder,
      createdAt: now,
      updatedAt: now,
      lastModifiedBy: args.actorName,
    });

    // Write audit log
    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "create",
      entityType: "grant",
      entityId: grantId,
      entityName: args.title,
      summary: `Created grant "${args.title}" ($${args.amount.toLocaleString()}) in ${args.status}`,
    });

    return grantId;
  },
});

export const updateStatusAndOrder = mutation({
  args: {
    id: v.id("grants"),
    status: v.union(
      v.literal("backlog"),
      v.literal("drafting"),
      v.literal("awaiting_approval"),
      v.literal("submitted"),
      v.literal("awarded"),
      v.literal("rejected")
    ),
    order: v.number(),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.id);
    if (!grant) throw new Error("Grant not found");

    const oldStatus = grant.status;
    const now = Date.now();

    await ctx.db.patch(args.id, {
      status: args.status,
      order: args.order,
      updatedAt: now,
      lastModifiedBy: args.actorName,
    });

    if (oldStatus !== args.status) {
      await ctx.db.insert("auditLogs", {
        timestamp: now,
        actorName: args.actorName,
        actorEmail: args.actorEmail,
        actorRole: args.actorRole,
        action: "status_change",
        entityType: "grant",
        entityId: args.id,
        entityName: grant.title,
        summary: `Moved "${grant.title}" from ${oldStatus} to ${args.status}`,
        details: { oldStatus, newStatus: args.status },
      });
    }
  },
});

export const toggleRequirement = mutation({
  args: {
    grantId: v.id("grants"),
    requirementId: v.string(),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (!grant) throw new Error("Grant not found");

    let reqTitle = "";
    let nextDone = false;

    const newReqs = grant.requirements.map((r) => {
      if (r.id === args.requirementId) {
        reqTitle = r.title;
        nextDone = !r.done;
        return { ...r, done: nextDone };
      }
      return r;
    });

    const now = Date.now();
    await ctx.db.patch(args.grantId, {
      requirements: newReqs,
      updatedAt: now,
      lastModifiedBy: args.actorName,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "requirement_toggle",
      entityType: "grant",
      entityId: args.grantId,
      entityName: grant.title,
      summary: `${nextDone ? "Completed" : "Unchecked"} requirement "${reqTitle}" for "${grant.title}"`,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("grants"),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.id);
    if (!grant) return;

    const now = Date.now();
    await ctx.db.delete(args.id);

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "delete",
      entityType: "grant",
      entityId: args.id,
      entityName: grant.title,
      summary: `Deleted grant "${grant.title}"`,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("grants"),
    title: v.string(),
    funder: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: grantStatusValidator,
    deadline: v.optional(v.string()),
    deadlineType: deadlineTypeValidator,
    deadlineNote: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    assigneeName: v.optional(v.string()),
    priority: priorityValidator,
    season: v.string(),
    portalUrl: v.optional(v.string()),
    docUrl: v.optional(v.string()),
    fileNote: v.optional(v.string()),
    requirements: v.array(requirementValidator),
    notes: v.optional(v.string()),
    order: v.number(),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const { id, actorName, actorEmail, actorRole, ...fields } = args;
    const grant = await ctx.db.get(id);
    if (!grant) throw new Error("Grant not found");

    await ctx.db.patch(id, {
      ...fields,
      updatedAt: Date.now(),
      lastModifiedBy: actorName,
    });

    const actor = { actorName, actorEmail, actorRole };
    if (grant.status !== fields.status) {
      await logAudit(ctx, actor, {
        action: "status_change",
        entityType: "grant",
        entityId: id,
        entityName: fields.title,
        summary: `Moved "${fields.title}" from ${grant.status} to ${fields.status}`,
        details: { oldStatus: grant.status, newStatus: fields.status },
      });
    } else {
      await logAudit(ctx, actor, {
        action: "update",
        entityType: "grant",
        entityId: id,
        entityName: fields.title,
        summary: `Updated grant "${fields.title}" details`,
      });
    }
  },
});
