import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertRef, logAudit } from "./lib";
import { resolveDonorByName } from "./donors";
import { incomeCategoryValidator } from "./validators";
import { actorFields, getActor, requireWriter, resolveNames } from "./auth";

/**
 * Public by design -- see PUBLIC_DATA in convex/auth.ts -- but every row is
 * rebuilt from an explicit allowlist rather than returned as-is.
 */
export const list = query({
  args: { seasonId: v.optional(v.id("seasons")) },
  handler: async (ctx, args) => {
    let deposits = await ctx.db.query("incomeDeposits").collect();
    if (args.seasonId) {
      deposits = deposits.filter((d) => d.seasonId === args.seasonId);
    }
    deposits = deposits.sort((a, b) => b._creationTime - a._creationTime);

    const actor = await getActor(ctx);
    const names = actor ? await resolveNames(ctx, deposits.map((d) => d.loggedById)) : null;
    const isAdmin = actor?.role === "admin";

    const accounts = await ctx.db.query("accounts").take(50);
    const slugById = new Map(accounts.map((a) => [a._id, a.key]));
    // Only the donors these rows actually reference, not a bounded scan of the
    // whole table. A `.take(n)` here is the one bound on this query that is
    // not structurally safe: seasons gain a row a year and `accounts` has two
    // rows, but a school team's donor list across several seasons can
    // plausibly outgrow any number picked today -- and a row past the bound
    // yields `donorName: undefined` silently, dropping a named gift out of
    // donor reporting with no error. Keyed off the result set instead, there
    // is no bound left to outgrow. The extra reads are bounded by the rows
    // already being returned, and this query `.collect()`s that table anyway.
    const donorIds = [...new Set(deposits.flatMap((d) => (d.donorId ? [d.donorId] : [])))];
    const donorNameById = new Map(
      (await Promise.all(donorIds.map((id) => ctx.db.get("donors", id))))
        .flatMap((d) => (d ? [d] : []))
        .map((d) => [d._id, d.displayName])
    );
    // Bounded: a season is one school year, so this table gains a row a year.
    const seasons = await ctx.db.query("seasons").take(50);
    const seasonLabelById = new Map(seasons.map((s) => [s._id, s.label]));

    return deposits.map((d) => {
      // Narrowed with an invariant rather than left optional. `Map.get` types
      // its result `| undefined` by signature, but `incomeDeposits.accountId`
      // is a required `v.id("accounts")` and `add`/`update` now `assertRef`
      // it against the table before writing, so a stored deposit cannot name
      // an account that is not there.
      //
      // An earlier version of this comment justified the throw with "no
      // delete mutation for accounts exists anywhere". That was false, and it
      // was the premise the whole design rested on: `seed.importAll` deletes
      // every account and re-creates it with a fresh `_id`, and Convex's
      // `v.id()` validator checks the table and not the row -- so before the
      // write-side check a client holding a pre-import snapshot could post a
      // stale id and it was accepted. `list` is the *unauthenticated* public
      // query, so one such row took the public financials page down for every
      // visitor, permanently, with no in-app repair: fixing the deposit needs
      // its id, which comes from this query. The invariant is enforced on the
      // write path now (see `assertRef`), which is the only place it can be.
      //
      // The throw stays because the alternative is worse than a 500: carrying
      // the optionality out to the client lets `claimsHcb: d.depositAccount
      // === 'hcb_bank'` go false for a deposit whose lookup slipped, which
      // stops it being eligible for HCB matching and double-counts it against
      // the live bank transaction that recorded it. A referential-integrity
      // violation should be loud, not a silently mis-deduped ledger.
      const depositAccount = slugById.get(d.accountId);
      if (!depositAccount) {
        throw new Error(`deposit ${d._id} references missing account ${d.accountId}`);
      }

      return {
        _id: d._id,
        title: d.title, amount: d.amount, category: d.category,
        seasonId: d.seasonId, date: d.date, notes: d.notes,
        taxYear: d.taxYear, updatedAt: d.updatedAt,
        // The finance modules consume these exact shapes; keep them stable.
        // `LedgerDeposit`/`BalanceDeposit` name this `depositAccount`, not
        // `account` (that's the expense-side field) -- get the key wrong and
        // `claimsHcb: d.depositAccount === 'hcb_bank'` in ledger.ts silently
        // goes false, and an HCB-paid deposit double-counts against the live
        // bank transaction the same way the expense-side bug would have.
        depositAccount,
        donorName: d.donorId ? donorNameById.get(d.donorId) : undefined,
        /**
         * The season *label*, alongside the id. Not redundant: `buildLedger`
         * treats a deposit's own `season` as authoritative -- a human set it --
         * and only infers the season from `date` when the field is missing.
         * The owner has already ruled on the case that makes this load-bearing:
         * an awarded grant's deposit belongs to the season the grant was
         * APPLIED FOR, not the season the money arrived in, and grant money
         * routinely lands a season late. Drop this field and every award
         * silently refiles itself under the year the cheque cleared -- a
         * plausible-looking wrong number, with no error and no failing test.
         *
         * `?? ""` only fires for a dangling `seasonId` (the row was deleted).
         * There is no label to assert then, so the empty string deliberately
         * routes that row back through the date fallback, which is the only
         * information left.
         */
        season: seasonLabelById.get(d.seasonId) ?? "",
        // Person references resolve only for a signed-in member.
        loggedByName: names?.get(d.loggedById),
        // A receipt image usually carries a name. Admin only.
        receiptUrl: isAdmin ? d.receiptUrl : undefined,
      };
    });
  },
});

export const add = mutation({
  args: {
    title: v.string(),
    amount: v.number(),
    category: incomeCategoryValidator,
    accountId: v.id("accounts"),
    date: v.string(),
    seasonId: v.id("seasons"),
    receiptUrl: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    // Every reference is confirmed before the row is written. `accountId` is
    // the one that matters most: `list` below resolves it and throws, and
    // `list` is the unauthenticated public query. See `assertRef`.
    await assertRef(ctx, "accounts", args.accountId);
    await assertRef(ctx, "seasons", args.seasonId);

    const { donorName, ...fields } = args;
    const now = Date.now();
    const id = await ctx.db.insert("incomeDeposits", {
      ...fields,
      donorId: await resolveDonorByName(ctx, donorName),
      loggedById: actor._id,
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

export const remove = mutation({
  args: {
    id: v.id("incomeDeposits"),
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const existing = await ctx.db.get("incomeDeposits", args.id);
    if (!existing) throw new Error("Deposit not found");

    await ctx.db.delete("incomeDeposits", args.id);

    await logAudit(ctx, actorFields(actor), {
      action: "delete",
      entityType: "system",
      entityId: args.id,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("incomeDeposits"),
    title: v.string(),
    amount: v.number(),
    category: incomeCategoryValidator,
    accountId: v.id("accounts"),
    date: v.string(),
    seasonId: v.id("seasons"),
    receiptUrl: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const actor = await requireWriter(ctx);
    const { id, donorName, ...fields } = args;
    const existing = await ctx.db.get("incomeDeposits", id);
    if (!existing) throw new Error("Deposit not found");
    await assertRef(ctx, "accounts", fields.accountId);
    await assertRef(ctx, "seasons", fields.seasonId);

    // An omitted `donorName` is not a cleared donor. Convex drops absent
    // optional args rather than passing `undefined`, so the key never reaches
    // `patch` and the stored `donorId` is left as it is -- which is what a
    // form that does not edit the donor field should do. A `donorName` that
    // is present and blank resolves to `undefined`, and *that* patch does
    // clear it. Merging the two cases would make every save from a form
    // without a donor input silently drop the donor.
    const donorPatch =
      donorName === undefined ? {} : { donorId: await resolveDonorByName(ctx, donorName) };

    await ctx.db.patch("incomeDeposits", id, {
      ...fields,
      ...donorPatch,
      updatedAt: Date.now(),
    });

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "system",
      entityId: id,
    });
  },
});
