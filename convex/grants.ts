import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertRef, logAudit } from "./lib";
import {
  deadlineTypeValidator,
  grantStatusValidator,
  priorityValidator,
  requirementValidator,
} from "./validators";
import { actorFields, getActor, requireWriter, resolveNames } from "./auth";

/**
 * Every season's label, keyed by id. Bounded: a season is one school year, so
 * this table gains a row a year.
 */
async function resolveSeasonLabels(ctx: QueryCtx): Promise<Map<Id<"seasons">, string>> {
  const seasons = await ctx.db.query("seasons").take(50);
  return new Map(seasons.map((s) => [s._id, s.label]));
}

/**
 * What a grant exposes to a client. An explicit allowlist rather than a
 * rest-spread -- a column added to the schema later has to be opted in here
 * before it can leave the server, instead of leaking by default.
 */
function publicGrantFields(
  names: Map<Id<"users">, string> | null,
  seasonLabels: Map<Id<"seasons">, string>,
  g: Doc<"grants">
) {
  return {
    _id: g._id,
    title: g.title, funder: g.funder, amount: g.amount, currency: g.currency,
    status: g.status, deadline: g.deadline, deadlineType: g.deadlineType,
    deadlineNote: g.deadlineNote, priority: g.priority, seasonId: g.seasonId,
    portalUrl: g.portalUrl, docUrl: g.docUrl, fileNote: g.fileNote,
    requirements: g.requirements, notes: g.notes, order: g.order,
    awardedAmount: g.awardedAmount, awardedDate: g.awardedDate,
    linkedDepositId: g.linkedDepositId, finishedAt: g.finishedAt,
    updatedAt: g.updatedAt,
    /**
     * The season *label*, alongside the id -- symmetric with `expenses.list`
     * and `income.list`, which both emit the pair.
     *
     * A grant's season is human-set authoritative data, exactly like an
     * expense's: `GrantDrawer` is a free-text field somebody typed, and it is
     * routinely not the year the deadline falls in. That is an argument for
     * emitting the label, not for making callers compare ids: the store
     * already filters on label strings (`seasonKey`), so the label is the
     * shape every consumer here speaks, and comparing `seasonId` would need
     * label->id plumbing that expenses and deposits do not need to reach the
     * same answer.
     *
     * `?? ""` only fires for a dangling `seasonId` (the season row was
     * deleted). There is no label to assert then.
     */
    season: seasonLabels.get(g.seasonId) ?? "",
    // Person references resolve only for a signed-in member -- `names` is
    // non-null exactly when `getActor` found one, which is the same gate.
    assigneeName: g.assigneeId ? names?.get(g.assigneeId) : undefined,
    finishedByName: g.finishedById ? names?.get(g.finishedById) : undefined,
    /**
     * The assignee's id, on that same gate: a member gets it, a stranger gets
     * nothing. Emitting it publicly would let anyone correlate which grants
     * share an assignee, which is exactly why `accounts.list`, `teamInfo.list`
     * and `audit.list` drop their `updatedById`/`userId`.
     *
     * It is here because without it a client can *set* an assignee (ids come
     * from `api.users.listUsers`, which is gated the same way) and never read
     * back who is assigned -- it holds only a display string. That made an
     * edit form unable to pre-select the current value, and made an assignee
     * settable but not clearable. Both are fixed by this field plus
     * `update`'s `null`.
     *
     * `finishedById` is deliberately *not* emitted alongside it. There is
     * nothing to round-trip: `finish` stamps it from the actor and no
     * mutation accepts it, so a client could only correlate with it, never
     * use it. The rule is "emit the ids a member can actually send back", not
     * "emit every id to a member".
     */
    assigneeId: names ? g.assigneeId : undefined,
  };
}

/** Public by design -- see PUBLIC_DATA in convex/auth.ts. */
export const list = query({
  args: {
    seasonId: v.optional(v.id("seasons")),
  },
  handler: async (ctx, args) => {
    const grants = args.seasonId
      ? await ctx.db
          .query("grants")
          .withIndex("by_season_id", (q) => q.eq("seasonId", args.seasonId!))
          .collect()
      : await ctx.db.query("grants").collect();
    const sorted = grants.sort((a, b) => a.order - b.order);

    const actor = await getActor(ctx);
    const names = actor
      ? await resolveNames(ctx, sorted.flatMap((g) => [g.assigneeId, g.finishedById]))
      : null;
    const seasonLabels = await resolveSeasonLabels(ctx);

    return sorted.map((g) => publicGrantFields(names, seasonLabels, g));
  },
});

/** Public by design -- see PUBLIC_DATA in convex/auth.ts. */
export const getById = query({
  args: { id: v.id("grants") },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get("grants", args.id);
    if (!grant) return null;

    const actor = await getActor(ctx);
    const names = actor
      ? await resolveNames(ctx, [grant.assigneeId, grant.finishedById])
      : null;
    const seasonLabels = await resolveSeasonLabels(ctx);

    return publicGrantFields(names, seasonLabels, grant);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    funder: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: grantStatusValidator,
    deadline: v.optional(v.string()),
    deadlineType: deadlineTypeValidator,
    deadlineNote: v.optional(v.string()),
    /**
     * `null` clears the assignee; omitted leaves it as it is. Convex has no
     * way to transmit `undefined`, so without the `null` member an assignee
     * could be set and never taken off.
     */
    assigneeId: v.optional(v.union(v.id("users"), v.null())),
    priority: priorityValidator,
    seasonId: v.id("seasons"),
    portalUrl: v.optional(v.string()),
    docUrl: v.optional(v.string()),
    fileNote: v.optional(v.string()),
    requirements: v.array(requirementValidator),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    await assertRef(ctx, "seasons", args.seasonId);
    await assertRef(ctx, "users", args.assigneeId ?? undefined);

    const existing = await ctx.db
      .query("grants")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .collect();

    const maxOrder = existing.reduce((max, g) => Math.max(max, g.order), 0);
    const newOrder = maxOrder + 1000;

    const now = Date.now();
    const { assigneeId, ...fields } = args;
    const grantId = await ctx.db.insert("grants", {
      ...fields,
      // `null` is a Convex value and a valid *argument*; it is not a valid
      // column value for `v.optional(v.id("users"))`. Unassigned is the
      // absence of the field, so the wire's "clear it" becomes that here. On
      // a create there is no prior value, so omitted and `null` mean the
      // same thing -- only `update` needs the three-way distinction.
      assigneeId: assigneeId ?? undefined,
      order: newOrder,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "create",
      entityType: "grant",
      entityId: grantId,
    });

    return grantId;
  },
});

export const updateStatusAndOrder = mutation({
  args: {
    id: v.id("grants"),
    /**
     * Board columns only. An outcome is reached through `finish`, never by
     * dragging -- recording an award has to put money in the books, and a
     * drag has nowhere to ask for the amount.
     */
    status: v.union(
      v.literal("backlog"),
      v.literal("drafting"),
      v.literal("awaiting_approval"),
      v.literal("submitted")
    ),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const grant = await ctx.db.get("grants", args.id);
    if (!grant) throw new Error("Grant not found");

    const oldStatus = grant.status;
    const now = Date.now();

    await ctx.db.patch("grants", args.id, {
      status: args.status,
      order: args.order,
      updatedAt: now,
    });

    if (oldStatus !== args.status) {
      await logAudit(ctx, actorFields(actor), {
        action: "status_change",
        entityType: "grant",
        entityId: args.id,
        change: { field: "status", from: oldStatus, to: args.status },
      });
    }
  },
});

export const toggleRequirement = mutation({
  args: {
    grantId: v.id("grants"),
    requirementId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const grant = await ctx.db.get("grants", args.grantId);
    if (!grant) throw new Error("Grant not found");

    let nextDone = false;

    const newReqs = grant.requirements.map((r) => {
      if (r.id === args.requirementId) {
        nextDone = !r.done;
        return { ...r, done: nextDone };
      }
      return r;
    });

    const now = Date.now();
    await ctx.db.patch("grants", args.grantId, {
      requirements: newReqs,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "requirement_toggle",
      entityType: "grant",
      entityId: args.grantId,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("grants"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const grant = await ctx.db.get("grants", args.id);
    if (!grant) return;

    await ctx.db.delete("grants", args.id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "grant",
      entityId: args.id,
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
    /**
     * `null` clears the assignee; omitted leaves it as it is. Convex has no
     * way to transmit `undefined`, so without the `null` member an assignee
     * could be set and never taken off.
     */
    assigneeId: v.optional(v.union(v.id("users"), v.null())),
    priority: priorityValidator,
    seasonId: v.id("seasons"),
    portalUrl: v.optional(v.string()),
    docUrl: v.optional(v.string()),
    fileNote: v.optional(v.string()),
    requirements: v.array(requirementValidator),
    notes: v.optional(v.string()),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, assigneeId, ...fields } = args;
    const grant = await ctx.db.get("grants", id);
    if (!grant) throw new Error("Grant not found");
    await assertRef(ctx, "seasons", fields.seasonId);
    await assertRef(ctx, "users", assigneeId ?? undefined);

    // Three states, not two, and the distinction is load-bearing. Omitted
    // leaves the assignee alone -- Convex drops an absent optional argument
    // rather than passing `undefined`, so the key never reaches `patch`, and
    // that is the behaviour every other optional on this mutation already
    // has. `null` writes `undefined`, which removes the column: that is the
    // clear. An id sets it. Collapsing the first two would make every save
    // from a form with no assignee input silently unassign the grant.
    const assigneePatch =
      assigneeId === undefined ? {} : { assigneeId: assigneeId ?? undefined };

    await ctx.db.patch("grants", id, {
      ...fields,
      ...assigneePatch,
      updatedAt: Date.now(),
    });

    if (grant.status !== fields.status) {
      await logAudit(ctx, actorFields(actor), {
        action: "status_change",
        entityType: "grant",
        entityId: id,
        change: { field: "status", from: grant.status, to: fields.status },
      });
    } else {
      await logAudit(ctx, actorFields(actor), {
        action: "update",
        entityType: "grant",
        entityId: id,
      });
    }
  },
});

/**
 * Finish a grant: record its outcome and take it off the board.
 *
 * An award is not just a status change -- the money arrived, so it has to
 * appear in the books. This creates the matching deposit in the same
 * transaction as the status change, so the two can never disagree, and stores
 * the deposit's id on the grant so a second call cannot create it twice.
 */
export const finish = mutation({
  args: {
    id: v.id("grants"),
    outcome: v.union(v.literal("awarded"), v.literal("declined"), v.literal("dropped")),
    /** Required for an award: what the funder actually gave. */
    awardedAmount: v.optional(v.number()),
    /** Required for an award: the day the money was received. */
    awardedDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, outcome, awardedAmount, awardedDate } = args;

    const grant = await ctx.db.get("grants", id);
    if (!grant) throw new Error("Grant not found");
    if (grant.linkedDepositId) {
      throw new Error(
        `"${grant.title}" has already been finished and its deposit recorded. ` +
          "Reopen it first if you need to change the outcome."
      );
    }

    const now = Date.now();
    let depositId: Id<"incomeDeposits"> | undefined;

    if (outcome === "awarded") {
      if (awardedAmount === undefined || awardedAmount <= 0) {
        throw new Error("An awarded grant needs the amount that was actually given");
      }
      if (!awardedDate) {
        throw new Error("An awarded grant needs the date the money was received");
      }

      // Grant money is paid to the school activity account, never into HCB.
      const schoolAccount = await ctx.db
        .query("accounts")
        .withIndex("by_key", (q) => q.eq("key", "school_account"))
        .unique();
      if (!schoolAccount) {
        throw new Error(
          "No school account is configured yet. Ask an admin to set its opening balance first."
        );
      }

      // A real deposit, in the same transaction as the status change, so the
      // award and the money it produced can never disagree.
      //
      // It is therefore the *same money* as `totalAwarded` on the client, and
      // anything that adds the two reports one award twice. Both places that
      // could get this wrong now exclude it deliberately -- see
      // `totalFundraiserIncome` and `incomeByCategory.grants` in
      // `getFinancialsForSeason`.
      depositId = await ctx.db.insert("incomeDeposits", {
        title: grant.title,
        amount: awardedAmount,
        category: "grants",
        accountId: schoolAccount._id,
        date: awardedDate,
        loggedById: actor._id,
        // The award is recorded against the grant's own season -- the
        // application and the money it produced stay traceable to one season
        // even when the deposit lands on a different calendar date.
        seasonId: grant.seasonId,
        notes: `Awarded by ${grant.funder}.`,
        taxYear: Number(awardedDate.slice(0, 4)),
        updatedAt: now,
      });
    }

    await ctx.db.patch("grants", id, {
      status: outcome,
      awardedAmount: outcome === "awarded" ? awardedAmount : undefined,
      awardedDate: outcome === "awarded" ? awardedDate : undefined,
      linkedDepositId: depositId,
      finishedAt: now,
      finishedById: actor._id,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "grant",
      entityId: id,
      change: { field: "status", from: grant.status, to: outcome },
    });

    return depositId;
  },
});

/**
 * Put a finished grant back on the board.
 *
 * The deposit an award created is deliberately left alone. It is a financial
 * record that may already have been reconciled against a bank statement or
 * edited by hand, and deleting one as a side effect of a status change is not
 * a decision this mutation should be making. The link is cleared and the
 * caller is told where the deposit is, so a human can remove it if it was a
 * mistake.
 */
export const reopen = mutation({
  args: {
    id: v.id("grants"),
    status: v.union(
      v.literal("backlog"),
      v.literal("drafting"),
      v.literal("awaiting_approval"),
      v.literal("submitted")
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, status } = args;

    const grant = await ctx.db.get("grants", id);
    if (!grant) throw new Error("Grant not found");

    const previousStatus = grant.status;
    const keptDepositId = grant.linkedDepositId;

    await ctx.db.patch("grants", id, {
      status,
      awardedAmount: undefined,
      awardedDate: undefined,
      linkedDepositId: undefined,
      finishedAt: undefined,
      finishedById: undefined,
      updatedAt: Date.now(),
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "grant",
      entityId: id,
      change: { field: "status", from: previousStatus, to: status },
    });

    return { keptDepositId };
  },
});
