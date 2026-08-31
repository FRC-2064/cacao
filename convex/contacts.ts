import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertRef, logAudit } from "./lib";
import { preferredMethodValidator } from "./validators";
import { actorFields, requireActor, requireWriter } from "./auth";

/**
 * Gated to signed-in members, and the whole table is the documented exception
 * in section 6 of the design: a sponsor's point of contact is an adult acting
 * for their business, and this table exists specifically to hold their name,
 * email and phone.
 *
 * Rebuilt from an explicit allowlist all the same. Every other list query in
 * this directory carries the note that a column added to the schema later has
 * to be opted in here before it can leave the server; this was the one read
 * path returning whole documents, which made that claim false system-wide and
 * left this table -- the one holding the most identifying data in the app --
 * as the single place where a new column leaks by default. Being gated is not
 * the same property: the gate decides *who* reads, the allowlist decides
 * *what* they read, and a column nobody meant to publish (an address, a home
 * number) would reach every signed-in student the moment it was added.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    const contacts = await ctx.db.query("contacts").collect();
    return contacts.map((c) => ({
      _id: c._id,
      sponsorId: c.sponsorId,
      name: c.name,
      title: c.title,
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
      preferredMethod: c.preferredMethod,
      notes: c.notes,
      lastContactedAt: c.lastContactedAt,
      updatedAt: c.updatedAt,
    }));
  },
});

export const create = mutation({
  args: {
    sponsorId: v.optional(v.id("sponsors")),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    preferredMethod: preferredMethodValidator,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    await assertRef(ctx, "sponsors", args.sponsorId);

    const now = Date.now();
    const contactId = await ctx.db.insert("contacts", {
      ...args,
      lastContactedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "create",
      entityType: "contact",
      entityId: contactId,
    });

    return contactId;
  },
});

export const remove = mutation({
  args: {
    id: v.id("contacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const contact = await ctx.db.get("contacts", args.id);
    if (!contact) return;

    await ctx.db.delete("contacts", args.id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "contact",
      entityId: args.id,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("contacts"),
    sponsorId: v.optional(v.id("sponsors")),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    preferredMethod: preferredMethodValidator,
    notes: v.optional(v.string()),
    lastContactedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, ...fields } = args;
    const contact = await ctx.db.get("contacts", id);
    if (!contact) throw new Error("Contact not found");
    await assertRef(ctx, "sponsors", fields.sponsorId);

    await ctx.db.patch("contacts", id, { ...fields, updatedAt: Date.now() });

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "contact",
      entityId: id,
    });
  },
});
