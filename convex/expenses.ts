import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { assertRef, logAudit } from "./lib";
import { resolveDonorByName } from "./donors";
import {
  carrierValidator,
  deliveryStatusValidator,
  expenseCategoryValidator,
  expenseStatusValidator,
  paymentMethodValidator,
} from "./validators";
import { actorFields, getActor, requireWriter, resolveNames } from "./auth";

/**
 * Public by design -- see PUBLIC_DATA in convex/auth.ts -- but every row is
 * rebuilt from an explicit allowlist rather than returned as-is: a column
 * added to the schema later has to be opted in here before it can leave the
 * server, instead of leaking by default.
 */
export const list = query({
  args: { seasonId: v.optional(v.id("seasons")) },
  handler: async (ctx, args) => {
    let expenses = await ctx.db.query("expenses").collect();
    if (args.seasonId) {
      expenses = expenses.filter((e) => e.seasonId === args.seasonId);
    }
    expenses = expenses.sort((a, b) => b._creationTime - a._creationTime);

    const actor = await getActor(ctx);
    const names = actor
      ? await resolveNames(ctx, expenses.flatMap((e) => [e.requesterId, e.purchaserId]))
      : null;
    const isAdmin = actor?.role === "admin";

    const accounts = await ctx.db.query("accounts").take(50);
    const slugById = new Map(accounts.map((a) => [a._id, a.key]));
    // Only the donors these rows actually reference, not a bounded scan of the
    // whole table. A `.take(n)` here is the one bound on this query that is
    // not structurally safe: seasons gain a row a year and `accounts` has two
    // rows, but a school team's donor list across several seasons can
    // plausibly outgrow any number picked today -- and a row past the bound
    // yields `donorName: undefined` silently, dropping a donated expense out of
    // donor reporting with no error. Keyed off the result set instead, there
    // is no bound left to outgrow. The extra reads are bounded by the rows
    // already being returned, and this query `.collect()`s that table anyway.
    const donorIds = [...new Set(expenses.flatMap((d) => (d.donorId ? [d.donorId] : [])))];
    const donorNameById = new Map(
      (await Promise.all(donorIds.map((id) => ctx.db.get("donors", id))))
        .flatMap((d) => (d ? [d] : []))
        .map((d) => [d._id, d.displayName])
    );
    // Bounded: a season is one school year, so this table gains a row a year.
    const seasons = await ctx.db.query("seasons").take(50);
    const seasonLabelById = new Map(seasons.map((s) => [s._id, s.label]));

    return expenses.map((e) => ({
      _id: e._id,
      title: e.title, vendor: e.vendor, amount: e.amount,
      finalPaidAmount: e.finalPaidAmount, currency: e.currency,
      category: e.category, status: e.status, seasonId: e.seasonId,
      paymentMethod: e.paymentMethod, date: e.date,
      orderNumber: e.orderNumber, expectedDeliveryDate: e.expectedDeliveryDate,
      deliveryStatus: e.deliveryStatus, itemLink: e.itemLink, notes: e.notes,
      taxYear: e.taxYear, linkedGrantId: e.linkedGrantId,
      updatedAt: e.updatedAt,
      // The finance modules consume these exact shapes; keep them stable.
      account: e.accountId ? slugById.get(e.accountId) : undefined,
      donorName: e.donorId ? donorNameById.get(e.donorId) : undefined,
      /**
       * The season *label*, alongside the id. Not redundant: `buildLedger`
       * treats a record's own `season` as authoritative -- a human set it --
       * and only infers the season from the record's date when the field is
       * missing. Drop this and every expense silently falls onto date
       * inference, which is wrong for exactly the case the team cares about:
       * a purchase made against one season's budget but invoiced or
       * reimbursed after August lands in the next season with no error and
       * no failing test. `seasonDateRange` parses `YYYY-YYYY`, which is what
       * `label` already is -- there is no separate slug column to invent.
       *
       * `?? ""` only fires for a dangling `seasonId` (the row was deleted).
       * There is no label to assert then, so the empty string deliberately
       * routes that row back through the date fallback, which is the only
       * information left.
       */
      season: seasonLabelById.get(e.seasonId) ?? "",
      createdAt: e._creationTime,
      // Timestamps, not PII -- balances.ts's expenseEffectiveDate() falls
      // back through reimbursedAt -> purchasedAt -> createdAt to find when
      // the money actually moved. Omitting any of these makes every
      // expense fall through to createdAt (when it was filed), silently
      // shifting it to the wrong side of an account's asOfDate cutoff with
      // no error and no failing test.
      approvedAt: e.approvedAt,
      purchasedAt: e.purchasedAt,
      receivedAt: e.receivedAt,
      reimbursedAt: e.reimbursedAt,
      // Person references resolve only for a signed-in member.
      requesterName: names?.get(e.requesterId),
      purchaserName: e.purchaserId ? names?.get(e.purchaserId) : undefined,
      // A tracking number handed to a carrier's site often reveals the delivery
      // address, and a receipt image usually carries a name. Admin only.
      trackingNumber: isAdmin ? e.trackingNumber : undefined,
      carrier: isAdmin ? e.carrier : undefined,
      receiptUrl: isAdmin ? e.receiptUrl : undefined,
    }));
  },
});

/**
 * Which account paid, three-state -- the same contract `donorName` has.
 *
 * On trunk the client sent the slug `'none'` and `'none'` was a real member of
 * the account validator, so the server could tell "the user chose no account"
 * from "the caller did not mention one". An `accounts` row id cannot spell
 * `'none'`, and collapsing both onto `undefined` made `??` read a deliberate
 * clear as *leave it alone*: a voucher purchase went on being subtracted from
 * Hack Club Bank forever, and the ledger's `claimsHcb` stayed true, so it
 * stayed eligible to absorb the bank transaction that actually paid for
 * something else.
 *
 * So the key's *presence* decides, never its value:
 *
 * - key absent: leave whatever account the row has.
 * - key present and `null`: the user chose "No team account". Clear it --
 *   `ctx.db.patch` removes a field set to `undefined`.
 * - key present and an id: assign it.
 */
const optionalAccountId = v.optional(v.union(v.id("accounts"), v.null()));

/** `null` and absent both mean "no account" to `ctx.db.insert` and `assertRef`. */
const accountIdOrUndefined = (id: Id<"accounts"> | null | undefined) => id ?? undefined;

/**
 * The `accountId` fragment for a `patch`: an empty object when the caller said
 * nothing, so `patch` never touches the column.
 */
const accountPatch = (id: Id<"accounts"> | null | undefined) =>
  id === undefined ? {} : { accountId: id ?? undefined };

/**
 * Which grant funded this expense -- the same three states, for the same
 * reason.
 *
 * `linkedGrantId` had exactly the collapse `accountId` above had.
 * `v.optional(v.id("grants"))` has no way to spell "not funded by a grant",
 * and `update` spreads `...fields` into the patch, so an omitted key -- which
 * is all a client could send, since Convex strips `undefined` -- never reached
 * `patch` and the old link survived. `ExpenseModal`'s dropdown offers "General
 * Team Funds" as an explicit choice, so a mentor unlinking a grant watched the
 * change apply and then silently revert on the next snapshot, while grant
 * reporting and the CSV export went on charging that grant for the spend.
 *
 * The `null` must not reach `patch` either: the *schema* column is still
 * `v.optional(v.id("grants"))`, and a stored `null` would fail its validator.
 * `undefined` is what removes a field.
 */
const optionalLinkedGrantId = v.optional(v.union(v.id("grants"), v.null()));

/** `null` and absent both mean "no grant" to `ctx.db.insert` and `assertRef`. */
const linkedGrantIdOrUndefined = (id: Id<"grants"> | null | undefined) => id ?? undefined;

/**
 * The `linkedGrantId` fragment for a `patch`: an empty object when the caller
 * said nothing, so `patch` never touches the column.
 */
const linkedGrantPatch = (id: Id<"grants"> | null | undefined) =>
  id === undefined ? {} : { linkedGrantId: id ?? undefined };

export const add = mutation({
  args: {
    title: v.string(),
    vendor: v.string(),
    amount: v.number(),
    finalPaidAmount: v.optional(v.number()),
    currency: v.string(),
    category: expenseCategoryValidator,
    accountId: optionalAccountId,
    date: v.optional(v.string()),
    status: expenseStatusValidator,
    seasonId: v.id("seasons"),
    paymentMethod: v.optional(paymentMethodValidator),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(carrierValidator),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: v.optional(deliveryStatusValidator),
    receiptUrl: v.optional(v.string()),
    itemLink: v.optional(v.string()),
    notes: v.optional(v.string()),
    /**
     * The donor's name as the form collected it, not an id -- the client has
     * no way to mint one, and `donors.resolveDonorByName` finds or creates
     * the row here, in this transaction, so a deposit can never commit with
     * its donor lost. Absent on `update` leaves the existing donor alone;
     * blank clears it.
     */
    donorName: v.optional(v.string()),
    taxYear: v.optional(v.number()),
    linkedGrantId: optionalLinkedGrantId,
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    // `accountId` is optional here, which makes a stale one quieter than the
    // deposit case and worse: nothing throws, `list` emits
    // `account: undefined`, and the expense files under neither account's
    // balance. See `assertRef`.
    await assertRef(ctx, "accounts", accountIdOrUndefined(args.accountId));
    await assertRef(ctx, "seasons", args.seasonId);
    await assertRef(ctx, "grants", linkedGrantIdOrUndefined(args.linkedGrantId));

    const { donorName, accountId, linkedGrantId, ...fields } = args;
    const now = Date.now();
    const id = await ctx.db.insert("expenses", {
      ...fields,
      // An insert has nothing to preserve, so a `null` and an absent id are
      // the same thing here: no account, and no linked grant.
      accountId: accountIdOrUndefined(accountId),
      linkedGrantId: linkedGrantIdOrUndefined(linkedGrantId),
      donorId: await resolveDonorByName(ctx, donorName),
      requesterId: actor._id,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "create",
      entityType: "system",
      entityId: id,
    });

    return id;
  },
});

export const recordPurchase = mutation({
  args: {
    id: v.id("expenses"),
    finalPaidAmount: v.number(),
    paymentMethod: paymentMethodValidator,
    accountId: optionalAccountId,
    date: v.optional(v.string()),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(carrierValidator),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: deliveryStatusValidator,
    receiptUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("expenses", args.id);
    if (!existing) throw new Error("Expense not found");
    await assertRef(ctx, "accounts", accountIdOrUndefined(args.accountId));

    const now = Date.now();
    await ctx.db.patch("expenses", args.id, {
      status: "purchased",
      finalPaidAmount: args.finalPaidAmount,
      paymentMethod: args.paymentMethod,
      // Spread, not `?? existing.accountId`: "the user chose no account" is
      // the modal's *default* selection, and `??` read it as "leave it alone".
      ...accountPatch(args.accountId),
      date: args.date ?? existing.date,
      purchaserId: actor._id,
      orderNumber: args.orderNumber,
      trackingNumber: args.trackingNumber,
      carrier: args.carrier,
      expectedDeliveryDate: args.expectedDeliveryDate,
      deliveryStatus: args.deliveryStatus,
      receiptUrl: args.receiptUrl || existing.receiptUrl,
      purchasedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      change: { field: "status", from: existing.status, to: "purchased" },
    });
  },
});

export const markDelivered = mutation({
  args: {
    id: v.id("expenses"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("expenses", args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch("expenses", args.id, {
      deliveryStatus: "delivered",
      receivedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      change: { field: "deliveryStatus", from: existing.deliveryStatus ?? "", to: "delivered" },
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
    accountId: optionalAccountId,
    date: v.optional(v.string()),
    status: expenseStatusValidator,
    seasonId: v.id("seasons"),
    paymentMethod: v.optional(paymentMethodValidator),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(carrierValidator),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: v.optional(deliveryStatusValidator),
    receiptUrl: v.optional(v.string()),
    itemLink: v.optional(v.string()),
    notes: v.optional(v.string()),
    /**
     * The donor's name as the form collected it, not an id -- the client has
     * no way to mint one, and `donors.resolveDonorByName` finds or creates
     * the row here, in this transaction, so a deposit can never commit with
     * its donor lost. Absent on `update` leaves the existing donor alone;
     * blank clears it.
     */
    donorName: v.optional(v.string()),
    taxYear: v.optional(v.number()),
    linkedGrantId: optionalLinkedGrantId,
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, donorName, accountId, linkedGrantId, ...fields } = args;
    const existing = await ctx.db.get("expenses", id);
    if (!existing) throw new Error("Expense not found");
    await assertRef(ctx, "accounts", accountIdOrUndefined(accountId));
    await assertRef(ctx, "seasons", fields.seasonId);
    await assertRef(ctx, "grants", linkedGrantIdOrUndefined(linkedGrantId));

    // Absent leaves the donor alone, blank clears it -- see `income.update`.
    const donorPatch =
      donorName === undefined ? {} : { donorId: await resolveDonorByName(ctx, donorName) };

    await ctx.db.patch("expenses", id, {
      ...fields,
      ...accountPatch(accountId),
      ...linkedGrantPatch(linkedGrantId),
      ...donorPatch,
      updatedAt: Date.now(),
    });

    if (existing.status !== fields.status) {
      await logAudit(ctx, actorFields(actor), {
        action: "status_change",
        entityType: "system",
        entityId: id,
        change: { field: "status", from: existing.status, to: fields.status },
      });
    } else {
      await logAudit(ctx, actorFields(actor), {
        action: "update",
        entityType: "system",
        entityId: id,
      });
    }
  },
});

export const approve = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("expenses", args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch("expenses", args.id, {
      status: "approved",
      approvedById: actor._id,
      approvedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      change: { field: "status", from: existing.status, to: "approved" },
    });
  },
});

/** Mark an approved request as ordered without the full purchase detail form. */
export const purchase = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("expenses", args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch("expenses", args.id, {
      status: "purchased",
      purchasedAt: now,
      finalPaidAmount: existing.finalPaidAmount ?? existing.amount,
      deliveryStatus: existing.deliveryStatus ?? "ordered",
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      change: { field: "status", from: existing.status, to: "purchased" },
    });
  },
});

export const reimburse = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("expenses", args.id);
    if (!existing) throw new Error("Expense not found");

    const now = Date.now();
    await ctx.db.patch("expenses", args.id, {
      status: "reimbursed",
      reimbursedAt: now,
      updatedAt: now,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "status_change",
      entityType: "system",
      entityId: args.id,
      change: { field: "status", from: existing.status, to: "reimbursed" },
    });
  },
});

export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("expenses", args.id);
    if (!existing) return;

    await ctx.db.delete("expenses", args.id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "system",
      entityId: args.id,
    });
  },
});
