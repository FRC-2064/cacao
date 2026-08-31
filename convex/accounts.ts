import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { accountKeyValidator } from "./validators";
import { actorFields, requireAdmin } from "./auth";

/**
 * Public by design -- see PUBLIC_DATA in convex/auth.ts -- but the balance is
 * the public fact, not who last verified it. Rebuilt from an explicit
 * allowlist rather than returned as-is, so `updatedById` stays server-side and
 * a column added to the schema later has to be opted in here before it can
 * leave the server.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("accounts").collect();
    return rows.map((a) => ({
      _id: a._id,
      // `src/lib/finance/balances.ts` matches an AccountConfig on `account`,
      // a slug. Keep the key under the name the finance modules read.
      account: a.key,
      openingBalance: a.openingBalance,
      asOfDate: a.asOfDate,
      updatedAt: a.updatedAt,
    }));
  },
});

/**
 * Set or re-baseline an account's verified balance. Upserts, because there is
 * exactly one row per account and the team edits it repeatedly after audits.
 */
export const setBalance = mutation({
  args: {
    key: accountKeyValidator,
    openingBalance: v.number(),
    asOfDate: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const { key, openingBalance, asOfDate } = args;

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    const fields = {
      key,
      openingBalance,
      asOfDate,
      updatedAt: Date.now(),
      updatedById: actor._id,
    };

    if (existing) {
      await ctx.db.patch("accounts", existing._id, fields);
    } else {
      await ctx.db.insert("accounts", fields);
    }

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "system",
      entityId: key,
    });
  },
});
