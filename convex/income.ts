import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { actorArgs, depositAccountValidator, incomeCategoryValidator } from "./validators";

export const list = query({
  args: { season: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let deposits = await ctx.db.query("incomeDeposits").collect();
    if (args.season) {
      deposits = deposits.filter((d) => d.season === args.season);
    }
    return deposits.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const add = mutation({
  args: {
    title: v.string(),
    amount: v.number(),
    category: v.union(
      v.literal("fundraiser"),
      v.literal("donation"),
      v.literal("merch_sales"),
      v.literal("bottle_can_drive"),
      v.literal("camp_registration"),
      v.literal("sponsorship_check"),
      v.literal("other_income")
    ),
    depositAccount: v.union(
      v.literal("hcb_bank"),
      v.literal("school_account"),
      v.literal("cash_box")
    ),
    date: v.string(),
    loggedByName: v.string(),
    loggedByEmail: v.string(),
    season: v.string(),
    receiptUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("incomeDeposits", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.loggedByName,
      actorEmail: args.loggedByEmail,
      actorRole: "student",
      action: "create",
      entityType: "system",
      entityId: id,
      entityName: args.title,
      summary: `Logged bank deposit of $${args.amount} for "${args.title}" (${args.depositAccount})`,
      details: { category: args.category, depositAccount: args.depositAccount },
    });

    return id;
  },
});

export const remove = mutation({
  args: {
    id: v.id("incomeDeposits"),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Deposit not found");

    await ctx.db.delete(args.id);

    await ctx.db.insert("auditLogs", {
      timestamp: Date.now(),
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "delete",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Deleted bank deposit entry "${existing.title}" ($${existing.amount})`,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("incomeDeposits"),
    title: v.string(),
    amount: v.number(),
    category: incomeCategoryValidator,
    depositAccount: depositAccountValidator,
    date: v.string(),
    loggedByName: v.string(),
    loggedByEmail: v.string(),
    season: v.string(),
    receiptUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const { id, actorName, actorEmail, actorRole, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Deposit not found");

    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });

    await logAudit(ctx, { actorName, actorEmail, actorRole }, {
      action: "update",
      entityType: "system",
      entityId: id,
      entityName: fields.title,
      summary: `Updated deposit details for "${fields.title}"`,
    });
  },
});
