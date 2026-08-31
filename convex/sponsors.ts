import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertRef, logAudit } from "./lib";
import {
  outreachStatusValidator,
  sponsorCategoryValidator,
  sponsorStatusValidator,
  sponsorTierValidator,
} from "./validators";
import { actorFields, getActor, requireWriter } from "./auth";

/**
 * Public by design -- see PUBLIC_DATA in convex/auth.ts. Rebuilt from an
 * explicit allowlist that omits the contact columns entirely -- adult
 * contact details (name, email, phone) live only in the gated `contacts`
 * table now, reachable only through `contacts.list`, which requires a
 * signed-in member.
 *
 * Also assembles `annualHistory` from `sponsorOutreach`, grouped by sponsor,
 * so the frontend shape (an array inline on each sponsor) stays unchanged
 * even though the rows now live in their own table.
 *
 * `primaryContactId` is the one thing a signed-in member sees here that a
 * stranger does not. The contact's name, email and phone stay in `contacts`
 * behind `requireActor` either way; what the id buys is the round-trip -- a
 * client could previously *set* a primary contact through `create`/`update`
 * and never read back which one was set, so an edit form could not pre-select
 * it and a contact could be attached but never detached.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const sponsors = await ctx.db.query("sponsors").collect();
    const outreach = await ctx.db.query("sponsorOutreach").take(2000);
    // The same gate the `*Name` fields use elsewhere: signed in, not admin.
    const isMember = (await getActor(ctx)) !== null;

    // `status` is the outreach union, not `string`: annotating it as `string`
    // widened it on the wire, which meant `AnnualOutreachRecord` in
    // src/lib/types.ts could never be proved to match this projection.
    type OutreachEntry = {
      _id: Id<"sponsorOutreach">;
      sponsorId: Id<"sponsors">;
      year: Doc<"sponsorOutreach">["year"];
      status: Doc<"sponsorOutreach">["status"];
      amount?: number;
      notes?: string;
      contactedDate?: string;
    };
    const historyBySponsor = new Map<Id<"sponsors">, OutreachEntry[]>();
    for (const o of outreach) {
      const entry = {
        _id: o._id, sponsorId: o.sponsorId, year: o.year, status: o.status,
        amount: o.amount, notes: o.notes, contactedDate: o.contactedDate,
      };
      const existing = historyBySponsor.get(o.sponsorId);
      if (existing) existing.push(entry);
      else historyBySponsor.set(o.sponsorId, [entry]);
    }

    return sponsors.map((s) => ({
      _id: s._id,
      name: s.name, category: s.category, tier: s.tier, status: s.status,
      totalDonated: s.totalDonated, currentYearPledge: s.currentYearPledge,
      lastContactDate: s.lastContactDate, nextFollowUpDate: s.nextFollowUpDate,
      website: s.website, logoUrl: s.logoUrl, address: s.address, notes: s.notes,
      updatedAt: s.updatedAt,
      annualHistory: historyBySponsor.get(s._id) ?? [],
      // Member-only, and only the id -- the contact's details still require
      // `api.contacts.list`.
      primaryContactId: isMember ? s.primaryContactId : undefined,
    }));
  },
});

export const create = mutation({
  args: {
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
    /** `null` detaches the primary contact; omitted leaves it as it is. */
    primaryContactId: v.optional(v.union(v.id("contacts"), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    await assertRef(ctx, "contacts", args.primaryContactId ?? undefined);

    const { primaryContactId, ...fields } = args;
    const now = Date.now();
    const sponsorId = await ctx.db.insert("sponsors", {
      ...fields,
      // `null` is a valid argument but not a valid column value; on a create
      // it and an omitted field mean the same thing.
      primaryContactId: primaryContactId ?? undefined,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "create",
      entityType: "sponsor",
      entityId: sponsorId,
    });

    return sponsorId;
  },
});

/**
 * Log a sponsor's outreach for a year. Upserts within the sponsor/year pair,
 * because there is at most one outreach record per sponsor per year and
 * people revisit it as the relationship progresses.
 */
export const logOutreach = mutation({
  args: {
    sponsorId: v.id("sponsors"),
    year: v.number(),
    status: outreachStatusValidator,
    amount: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const sponsor = await ctx.db.get("sponsors", args.sponsorId);
    if (!sponsor) throw new Error("Sponsor not found");

    const todayIso = new Date().toISOString().split("T")[0];

    const existing = await ctx.db
      .query("sponsorOutreach")
      .withIndex("by_sponsor_id", (q) => q.eq("sponsorId", args.sponsorId))
      .collect();
    const existingForYear = existing.find((o) => o.year === args.year);

    if (existingForYear) {
      await ctx.db.patch("sponsorOutreach", existingForYear._id, {
        status: args.status,
        amount: args.amount,
        notes: args.notes,
        contactedDate: todayIso,
      });
    } else {
      await ctx.db.insert("sponsorOutreach", {
        sponsorId: args.sponsorId,
        year: args.year,
        status: args.status,
        amount: args.amount,
        notes: args.notes,
        contactedDate: todayIso,
      });
    }

    const now = Date.now();
    await ctx.db.patch("sponsors", args.sponsorId, {
      lastContactDate: todayIso,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "outreach_logged",
      entityType: "sponsor",
      entityId: args.sponsorId,
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
    /** `null` detaches the primary contact; omitted leaves it as it is. */
    primaryContactId: v.optional(v.union(v.id("contacts"), v.null())),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, primaryContactId, ...fields } = args;
    const sponsor = await ctx.db.get("sponsors", id);
    if (!sponsor) throw new Error("Sponsor not found");
    await assertRef(ctx, "contacts", primaryContactId ?? undefined);

    // Omitted leaves it, `null` detaches, an id attaches -- see the same
    // three-state handling on `grants.update`.
    const contactPatch =
      primaryContactId === undefined
        ? {}
        : { primaryContactId: primaryContactId ?? undefined };

    await ctx.db.patch("sponsors", id, {
      ...fields,
      ...contactPatch,
      updatedAt: Date.now(),
    });

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "sponsor",
      entityId: id,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("sponsors"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const sponsor = await ctx.db.get("sponsors", args.id);
    if (!sponsor) return;

    await ctx.db.delete("sponsors", args.id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "sponsor",
      entityId: args.id,
    });
  },
});
