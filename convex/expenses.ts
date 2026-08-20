import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit, usd } from "./lib";
import {
  actorArgs,
  carrierValidator,
  deliveryStatusValidator,
  expenseCategoryValidator,
  expenseStatusValidator,
  paymentMethodValidator,
} from "./validators";

export const list = query({
  args: { season: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let expenses = await ctx.db.query("expenses").collect();
    if (args.season) {
      expenses = expenses.filter((e) => e.season === args.season);
    }
    return expenses.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const add = mutation({
  args: {
    title: v.string(),
    vendor: v.string(),
    amount: v.number(),
    finalPaidAmount: v.optional(v.number()),
    currency: v.string(),
    category: v.union(
      v.literal("robot_parts"),
      v.literal("electronics"),
      v.literal("tools"),
      v.literal("travel"),
      v.literal("registration"),
      v.literal("food"),
      v.literal("media"),
      v.literal("general")
    ),
    subteam: v.string(),
    requesterName: v.string(),
    requesterEmail: v.string(),
    status: v.union(
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("purchased"),
      v.literal("reimbursed"),
      v.literal("rejected")
    ),
    season: v.string(),
    paymentMethod: v.optional(
      v.union(
        v.literal("hcb_card"),
        v.literal("personal_reimbursement"),
        v.literal("school_po"),
        v.literal("grant_voucher"),
        v.literal("cash"),
        v.literal("other")
      )
    ),
    purchaserName: v.optional(v.string()),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(
      v.union(
        v.literal("UPS"),
        v.literal("FedEx"),
        v.literal("USPS"),
        v.literal("Amazon"),
        v.literal("DHL"),
        v.literal("Local Pickup"),
        v.literal("Other")
      )
    ),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: v.optional(
      v.union(
        v.literal("ordered"),
        v.literal("shipped"),
        v.literal("delivered")
      )
    ),
    receiptUrl: v.optional(v.string()),
    itemLink: v.optional(v.string()),
    notes: v.optional(v.string()),
    linkedGrantId: v.optional(v.string()),
    linkedGrantTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("expenses", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.requesterName,
      actorEmail: args.requesterEmail,
      actorRole: "student",
      action: "create",
      entityType: "system",
      entityId: id,
      entityName: args.title,
      summary: `Created expense request for ${args.title} ($${args.amount})`,
      details: { vendor: args.vendor, category: args.category },
    });

    return id;
  },
});

export const recordPurchase = mutation({
  args: {
    id: v.id("expenses"),
    finalPaidAmount: v.number(),
    paymentMethod: v.union(
      v.literal("hcb_card"),
      v.literal("personal_reimbursement"),
      v.literal("school_po"),
      v.literal("grant_voucher"),
      v.literal("cash"),
      v.literal("other")
    ),
    purchaserName: v.string(),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(
      v.union(
        v.literal("UPS"),
        v.literal("FedEx"),
        v.literal("USPS"),
        v.literal("Amazon"),
        v.literal("DHL"),
        v.literal("Local Pickup"),
        v.literal("Other")
      )
    ),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: v.union(
      v.literal("ordered"),
      v.literal("shipped"),
      v.literal("delivered")
    ),
    receiptUrl: v.optional(v.string()),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "purchased",
      finalPaidAmount: args.finalPaidAmount,
      paymentMethod: args.paymentMethod,
      purchaserName: args.purchaserName,
      orderNumber: args.orderNumber,
      trackingNumber: args.trackingNumber,
      carrier: args.carrier,
      expectedDeliveryDate: args.expectedDeliveryDate,
      deliveryStatus: args.deliveryStatus,
      receiptUrl: args.receiptUrl || existing.receiptUrl,
      purchasedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Recorded purchase for "${existing.title}" via ${args.paymentMethod} ($${args.finalPaidAmount})`,
      details: { orderNumber: args.orderNumber, trackingNumber: args.trackingNumber },
    });
  },
});

export const markDelivered = mutation({
  args: {
    id: v.id("expenses"),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      deliveryStatus: "delivered",
      receivedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Marked "${existing.title}" as delivered/received in shop`,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("expenses"),
    title: v.string(),
    vendor: v.string(),
    amount: v.number(),
    finalPaidAmount: v.optional(v.number()),
    currency: v.string(),
    category: expenseCategoryValidator,
    subteam: v.string(),
    requesterName: v.string(),
    requesterEmail: v.string(),
    status: expenseStatusValidator,
    season: v.string(),
    paymentMethod: v.optional(paymentMethodValidator),
    purchaserName: v.optional(v.string()),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(carrierValidator),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: v.optional(deliveryStatusValidator),
    receiptUrl: v.optional(v.string()),
    itemLink: v.optional(v.string()),
    notes: v.optional(v.string()),
    linkedGrantId: v.optional(v.string()),
    linkedGrantTitle: v.optional(v.string()),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const { id, actorName, actorEmail, actorRole, ...fields } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Expense not found");

    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });

    const actor = { actorName, actorEmail, actorRole };
    if (existing.status !== fields.status) {
      await logAudit(ctx, actor, {
        action: "status_change",
        entityType: "system",
        entityId: id,
        entityName: fields.title,
        summary: `Updated expense status from ${existing.status} to ${fields.status}`,
        details: { oldStatus: existing.status, newStatus: fields.status },
      });
    } else {
      await logAudit(ctx, actor, {
        action: "update",
        entityType: "system",
        entityId: id,
        entityName: fields.title,
        summary: `Updated expense details for "${fields.title}"`,
      });
    }
  },
});

export const approve = mutation({
  args: { id: v.id("expenses"), ...actorArgs },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "approved",
      approvedBy: args.actorName,
      approvedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, args, {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Mentor approved purchase request "${existing.title}" (${usd(existing.amount)})`,
    });
  },
});

/** Mark an approved request as ordered without the full purchase detail form. */
export const purchase = mutation({
  args: { id: v.id("expenses"), ...actorArgs },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "purchased",
      purchasedAt: now,
      finalPaidAmount: existing.finalPaidAmount ?? existing.amount,
      deliveryStatus: existing.deliveryStatus ?? "ordered",
      updatedAt: now,
    });

    await logAudit(ctx, args, {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Marked order as placed/purchased: "${existing.title}"`,
    });
  },
});

export const reimburse = mutation({
  args: { id: v.id("expenses"), ...actorArgs },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "reimbursed",
      reimbursedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, args, {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Reimbursed student/mentor for "${existing.title}" (${usd(existing.amount)})`,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("expenses"), ...actorArgs },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) return;

    await ctx.db.delete(args.id);

    await logAudit(ctx, args, {
      action: "delete",
      entityType: "system",
      entityId: args.id,
      entityName: existing.title,
      summary: `Deleted expense "${existing.title}" (${usd(existing.amount)})`,
    });
  },
});
