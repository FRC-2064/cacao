import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import {
  actorArgs,
  annualHistoryValidator,
  sponsorCategoryValidator,
  sponsorStatusValidator,
  sponsorTierValidator,
} from "./validators";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("sponsors").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: v.union(
      v.literal("corporate"),
      v.literal("local_business"),
      v.literal("foundation"),
      v.literal("community_partner"),
      v.literal("in_kind_supplier")
    ),
    tier: v.union(
      v.literal("platinum"),
      v.literal("gold"),
      v.literal("silver"),
      v.literal("bronze"),
      v.literal("panther_partner"),
      v.literal("in_kind"),
      v.literal("none")
    ),
    status: v.union(
      v.literal("lead"),
      v.literal("contacted"),
      v.literal("in_discussion"),
      v.literal("packet_sent"),
      v.literal("pledged"),
      v.literal("paid_active"),
      v.literal("declined"),
      v.literal("stale_renewal_due")
    ),
    totalDonated: v.number(),
    currentYearPledge: v.optional(v.number()),
    lastContactDate: v.optional(v.string()),
    nextFollowUpDate: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    annualHistory: v.array(
      v.object({
        year: v.number(),
        status: v.union(
          v.literal("contacted"),
          v.literal("report_sent"),
          v.literal("pledged"),
          v.literal("received"),
          v.literal("declined"),
          v.literal("pending")
        ),
        amount: v.optional(v.number()),
        notes: v.optional(v.string()),
        contactedDate: v.optional(v.string()),
      })
    ),
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sponsorId = await ctx.db.insert("sponsors", {
      name: args.name,
      category: args.category,
      tier: args.tier,
      status: args.status,
      totalDonated: args.totalDonated,
      currentYearPledge: args.currentYearPledge,
      lastContactDate: args.lastContactDate,
      nextFollowUpDate: args.nextFollowUpDate,
      website: args.website,
      logoUrl: args.logoUrl,
      address: args.address,
      notes: args.notes,
      annualHistory: args.annualHistory,
      primaryContactName: args.primaryContactName,
      primaryContactEmail: args.primaryContactEmail,
      createdAt: now,
      updatedAt: now,
      lastModifiedBy: args.actorName,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "create",
      entityType: "sponsor",
      entityId: sponsorId,
      entityName: args.name,
      summary: `Added new sponsor organization "${args.name}" (${args.tier.toUpperCase()})`,
    });

    return sponsorId;
  },
});

export const logOutreach = mutation({
  args: {
    sponsorId: v.id("sponsors"),
    year: v.number(),
    status: v.union(
      v.literal("contacted"),
      v.literal("report_sent"),
      v.literal("pledged"),
      v.literal("received"),
      v.literal("declined"),
      v.literal("pending")
    ),
    amount: v.optional(v.number()),
    notes: v.optional(v.string()),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const sponsor = await ctx.db.get(args.sponsorId);
    if (!sponsor) throw new Error("Sponsor not found");

    const todayIso = new Date().toISOString().split("T")[0];
    const updatedHistory = sponsor.annualHistory.filter((h) => h.year !== args.year);
    updatedHistory.unshift({
      year: args.year,
      status: args.status,
      amount: args.amount,
      notes: args.notes,
      contactedDate: todayIso,
    });

    const now = Date.now();
    await ctx.db.patch(args.sponsorId, {
      annualHistory: updatedHistory,
      lastContactDate: todayIso,
      updatedAt: now,
      lastModifiedBy: args.actorName,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "outreach_logged",
      entityType: "sponsor",
      entityId: args.sponsorId,
      entityName: sponsor.name,
      summary: `Logged ${args.year} outreach for "${sponsor.name}": ${args.status}`,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("sponsors"),
    name: v.string(),
    category: sponsorCategoryValidator,
    tier: sponsorTierValidator,
    status: sponsorStatusValidator,
    totalDonated: v.number(),
    currentYearPledge: v.optional(v.number()),
    lastContactDate: v.optional(v.string()),
    nextFollowUpDate: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    annualHistory: v.array(annualHistoryValidator),
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const { id, actorName, actorEmail, actorRole, ...fields } = args;
    const sponsor = await ctx.db.get(id);
    if (!sponsor) throw new Error("Sponsor not found");

    await ctx.db.patch(id, {
      ...fields,
      updatedAt: Date.now(),
      lastModifiedBy: actorName,
    });

    await logAudit(ctx, { actorName, actorEmail, actorRole }, {
      action: "update",
      entityType: "sponsor",
      entityId: id,
      entityName: fields.name,
      summary: `Updated sponsor "${fields.name}" details`,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("sponsors"),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const sponsor = await ctx.db.get(args.id);
    if (!sponsor) return;

    await ctx.db.delete(args.id);

    await logAudit(ctx, args, {
      action: "delete",
      entityType: "sponsor",
      entityId: args.id,
      entityName: sponsor.name,
      summary: `Removed sponsor "${sponsor.name}"`,
    });
  },
});
