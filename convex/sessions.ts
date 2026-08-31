import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * SHA-256 of a session secret. Web Crypto is available in the Convex runtime,
 * so no dependency is needed. The database never holds the secret itself.
 */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const create = internalMutation({
  args: {
    secretHash: v.string(),
    refreshToken: v.string(),
    tokenIdentifier: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("sessions", args),
});

export const bySecretHash = internalQuery({
  args: { secretHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("sessions")
      .withIndex("by_secret_hash", (q) => q.eq("secretHash", args.secretHash))
      .unique(),
});

export const remove = internalMutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.delete("sessions", args.id);
  },
});

/** Sign-out: drop the session identified by the hash of its secret, if one exists. */
export const removeBySecretHash = internalMutation({
  args: { secretHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_secret_hash", (q) => q.eq("secretHash", args.secretHash))
      .unique();
    if (session) await ctx.db.delete("sessions", session._id);
  },
});

/** How many expired rows a single sweep removes. A cron interval catches up over later runs. */
const REAP_BATCH_SIZE = 100;

/**
 * Drop sessions past their expiry. Nothing else visits a session row once its
 * ID token has stopped being refreshed, so without this sweep a dead row --
 * and the live Google refresh token inside it -- sits in the table forever.
 */
export const reapExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("sessions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now()))
      .take(REAP_BATCH_SIZE);
    for (const session of expired) {
      await ctx.db.delete("sessions", session._id);
    }
  },
});
