import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { actorArgs, preferredMethodValidator } from "./validators";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("contacts").collect();
  },
});

export const create = mutation({
  args: {
    sponsorId: v.optional(v.string()),
    sponsorName: v.optional(v.string()),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    preferredMethod: v.union(v.literal("email"), v.literal("phone"), v.literal("in_person")),
    notes: v.optional(v.string()),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const contactId = await ctx.db.insert("contacts", {
      sponsorId: args.sponsorId,
      sponsorName: args.sponsorName,
      name: args.name,
      title: args.title,
      email: args.email,
      phone: args.phone,
      isPrimary: args.isPrimary,
      preferredMethod: args.preferredMethod,
      notes: args.notes,
      lastContactedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      timestamp: now,
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "create",
      entityType: "contact",
      entityId: contactId,
      entityName: args.name,
      summary: `Added contact "${args.name}" (${args.title}${args.sponsorName ? ` at ${args.sponsorName}` : ""})`,
    });

    return contactId;
  },
});

export const remove = mutation({
  args: {
    id: v.id("contacts"),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.id);
    if (!contact) return;

    await ctx.db.delete(args.id);

    await ctx.db.insert("auditLogs", {
      timestamp: Date.now(),
      actorName: args.actorName,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action: "delete",
      entityType: "contact",
      entityId: args.id,
      entityName: contact.name,
      summary: `Removed contact "${contact.name}"`,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("contacts"),
    sponsorId: v.optional(v.string()),
    sponsorName: v.optional(v.string()),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    preferredMethod: preferredMethodValidator,
    notes: v.optional(v.string()),
    lastContactedAt: v.optional(v.number()),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const { id, actorName, actorEmail, actorRole, ...fields } = args;
    const contact = await ctx.db.get(id);
    if (!contact) throw new Error("Contact not found");

    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });

    await logAudit(ctx, { actorName, actorEmail, actorRole }, {
      action: "update",
      entityType: "contact",
      entityId: id,
      entityName: fields.name,
      summary: `Updated contact "${fields.name}"`,
    });
  },
});
