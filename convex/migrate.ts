import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireActor } from "./auth";

declare const process: { env: Record<string, string | undefined> };

/**
 * Grant admin to the caller, once, during the cutover.
 *
 * After the wipe no roster row is claimed by anyone and there is no in-app
 * path to an administrator: `ensureUser` writes `role: "viewer"` and nothing
 * else, and `setUserRole` requires an admin to already exist. Without this the
 * deployment is a database nobody can administer.
 *
 * The caller must be **signed in first**, and that check comes before the
 * secret on purpose. Checking the secret first would let an anonymous caller
 * probe it -- a wrong guess answers "Invalid bootstrap secret." and a right
 * one answers "Not signed in.", which tells the guesser they have it. Signing
 * in is not a meaningful barrier to an attacker, but it does mean the two
 * answers are no longer a free oracle.
 *
 * Retire it as soon as the cutover is done: remove
 * `ADMIN_BOOTSTRAP_SECRET` from the deployment, delete this function, and
 * deploy again. A live one-shot escalation path is worth exactly as much as
 * the day you need it and nothing afterwards.
 */
export const claimFirstAdmin = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);

    const expected = process.env.ADMIN_BOOTSTRAP_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("Invalid bootstrap secret.");
    }

    // `take(500)` rather than `collect()`: the roster is a school team, and a
    // bound here is cheaper than reading a table of unknown size to answer a
    // question that only needs "is there one".
    const users = await ctx.db.query("users").take(500);
    if (users.some((u) => u.role === "admin")) {
      throw new Error("An admin already exists.");
    }

    await ctx.db.patch("users", actor._id, { role: "admin" });
  },
});
