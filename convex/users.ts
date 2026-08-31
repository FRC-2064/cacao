import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { actorFields, displayName, getActor, requireActor, requireAdmin, requireWriter } from "./auth";
import { logAudit } from "./lib";
import { roleValidator } from "./validators";
import { firstNameProblem } from "./personNames";

/**
 * A first name, checked -- or a thrown message the form can show.
 *
 * The rule itself lives in `convex/personNames.ts`, a leaf module the request
 * form imports too, so the sentence the form shows before submitting and the
 * sentence the server throws are the same sentence. This is the enforcer: the
 * client is not trusted to have run it.
 *
 * `cacaoStore.push` already surfaces a mutation's error message as a toast, so
 * throwing is what puts the reason in front of whoever typed it.
 */
function checkedFirstName(raw: string): string {
  const name = raw.trim();
  const problem = firstNameProblem(name);
  if (problem) throw new Error(problem);
  return name;
}

/**
 * What a roster row exposes to a client. An explicit allowlist rather than a
 * rest-spread: a column added to the schema later has to be opted in here
 * before it can leave the server, instead of leaking by default.
 */
const publicUserFields = (u: Doc<"users">) => ({
  _id: u._id,
  firstName: u.firstName,
  lastInitial: u.lastInitial,
  displayName: displayName(u),
  role: u.role,
  requested: u.requested,
});

/**
 * The roster.
 *
 * Gated, unlike the money: even a bare row is a fact about who is signed in.
 * See PUBLIC_DATA in convex/auth.ts for why the split falls where it does.
 */
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map(publicUserFields);
  },
});

/**
 * Who the caller is, or null.
 *
 * The one query that deliberately answers without a session, because the
 * client needs it to tell "just looking" from "signed in", and those are
 * different screens.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getActor(ctx);
    return user ? publicUserFields(user) : null;
  },
});

/**
 * Edit your own name. Writes only to the caller's own row -- there is no
 * user id argument, so it cannot be pointed at anyone else.
 *
 * **`requireWriter`, not `requireActor`.** A viewer has no name to edit. The
 * design this branch implements is that "a new account holds an opaque
 * identifier and nothing else" (see PUBLIC_DATA in convex/auth.ts) and that a
 * first name and last initial "only enter once someone asks for edit access".
 * Gated on `requireActor` this mutation was a way around that: a signed-in
 * viewer could set a name without ever requesting, which both puts a person's
 * name in the database outside the one flow meant to collect it and makes
 * `requestEditAccess` -- the thing that raises the request an admin acts on --
 * skippable. `requestEditAccess` stays open to viewers precisely because it is
 * the single door.
 *
 * The consequence to keep in mind: a viewer who mistypes their name has to
 * re-submit the request form rather than edit their profile. That is fine --
 * `requestEditAccess` overwrites both fields and can be called again.
 */
export const updateOwnProfile = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastInitial: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireWriter(ctx);
    await ctx.db.patch("users", user._id, {
      ...(args.firstName !== undefined ? { firstName: checkedFirstName(args.firstName) } : {}),
      ...(args.lastInitial !== undefined
        ? { lastInitial: args.lastInitial.trim().slice(0, 1).toUpperCase() }
        : {}),
    });
  },
});

/**
 * Change what someone can do: promote to admin, demote a student, or
 * graduate someone -- graduating is defined as `role: "viewer"`, so this is
 * the only mechanism for it. Also covers revoking access: with `status`
 * gone, "revoked" and "viewer" are the same state, so there is no separate
 * revoke mutation.
 */
export const setUserRole = mutation({
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get("users", args.userId);
    if (!target) throw new Error("User not found.");

    // Graduating, demoting and revoking are all the same operation now that
    // `status` is gone: a viewer can read the public money data and nothing
    // more, so "revoked" and "viewer" are the same state.
    await ctx.db.patch("users", args.userId, { role: args.role, requested: false });

    await logAudit(ctx, actorFields(actor), {
      action: "update",
      entityType: "user",
      entityId: args.userId,
      change: { field: "role", from: target.role, to: args.role },
    });
  },
});

/**
 * Ask for edit access. Sets `requested: true` and, for the first time, puts a
 * name on the row -- the point at which accountability starts to matter.
 */
export const requestEditAccess = mutation({
  args: { firstName: v.string(), lastInitial: v.string() },
  handler: async (ctx, args) => {
    const user = await requireActor(ctx);
    // Checked before anything is written, so a refused name leaves the row
    // exactly as a bare sign-in left it -- an opaque identifier and nothing
    // else -- rather than half-applying and setting `requested`.
    const firstName = checkedFirstName(args.firstName);
    if (firstName === "") throw new Error("A first name is required.");
    await ctx.db.patch("users", user._id, {
      firstName,
      // Truncated on the server, not merely in the form: this is the only
      // place a surname could enter the database.
      lastInitial: args.lastInitial.trim().slice(0, 1).toUpperCase(),
      requested: true,
    });
  },
});

/** Pending requests for the admin feed. */
export const listRequests = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (await ctx.db.query("users").take(200))
      .filter((u) => u.requested)
      .map(publicUserFields);
  },
});

/**
 * Grant edit access.
 *
 * Promotes a `viewer` to `student` -- and only a `viewer`. `requestEditAccess`
 * has no role gate, so any signed-in member (an admin included) can set their
 * own `requested: true`; without this check, an admin approving their own
 * stray request -- or another admin's -- would be silently demoted to
 * `student` by the hardcoded `role: "student"` this used to write
 * unconditionally. If that leaves no admin left on the roster, there is no
 * self-service way back. A non-viewer's role is therefore left untouched --
 * the request flag is still cleared, so it does not linger on the admin
 * feed.
 */
export const approveRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get("users", args.userId);
    if (!target) throw new Error("User not found.");

    const promoted = target.role === "viewer";
    const nextRole = promoted ? "student" : target.role;

    await ctx.db.patch("users", args.userId, {
      role: nextRole,
      requested: false,
      ...(promoted ? { approvedById: actor._id, approvedAt: Date.now() } : {}),
    });

    // Always audited, with the target's real prior role -- never the
    // hardcoded "viewer" this used to log even when the target was not one.
    await logAudit(ctx, actorFields(actor), {
      action: "approve_user",
      entityType: "user",
      entityId: args.userId,
      change: { field: "role", from: target.role, to: nextRole },
    });
  },
});

/**
 * Turn down a request. There is deliberately no record of a decline:
 * rejections are for obvious junk, and an accidental one must leave the
 * student able to ask again.
 *
 * The name goes with the flag. Clearing only `requested` left a refused
 * student's first name and initial on the roster indefinitely, readable by
 * every signed-in member, for an account that was turned down -- the exact
 * thing this branch exists to stop. `requestEditAccess` overwrites both
 * fields, so asking again costs them one form.
 */
export const declineRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    const target = await ctx.db.get("users", args.userId);
    if (!target) throw new Error("User not found.");

    await ctx.db.patch("users", args.userId, {
      requested: false,
      firstName: undefined,
      lastInitial: undefined,
    });

    await logAudit(ctx, actorFields(actor), {
      action: "reject_user",
      entityType: "user",
      entityId: args.userId,
    });
  },
});
