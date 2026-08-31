import { mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type AnyCtx = QueryCtx | MutationCtx;

/**
 * PUBLIC_DATA -- why some queries have no guard.
 *
 * The team's money is deliberately readable without signing in: grants,
 * sponsors, expenses, deposits, account balances, the wishlist, HCB category
 * filings and the team facts. It is grant-funded, school-affiliated money,
 * and parents, funders and anyone else are welcome to look at it.
 *
 * "Public" describes the money, not the whole row. Every public list query
 * rebuilds each row from an explicit allowlist -- never a rest-spread of the
 * stored document -- so a person or delivery column added to the schema
 * later has to be opted in before it can leave the server:
 *
 *  - Person references (`requesterId`, `purchaserId`, `assigneeId`,
 *    `loggedById`, `setById`, `finishedById`, ...) never cross the wire as
 *    ids. A stranger sees nothing of them. A signed-in member sees the
 *    matching display name (`requesterName`, `assigneeName`, ...), resolved
 *    server-side via `resolveNames` -- never an id the client could use to
 *    look someone up.
 *  - Delivery detail on an expense or deposit -- `trackingNumber`, `carrier`,
 *    `receiptUrl` -- is admin-only, not merely signed-in. A tracking number
 *    handed to a carrier's site often reveals a home address, and a receipt
 *    image usually carries a name.
 *  - `account` and `donorName` are the one exception to "ids never cross the
 *    wire": these are looked up and re-emitted as the stable slug/string the
 *    finance modules (`src/lib/finance/`) already key on, not as the
 *    `accounts`/`donors` row id.
 *
 * Four tables stay behind `requireActor` entirely because they are mostly
 * other people's personal information rather than the team's own record:
 *
 *  - `contacts`  -- sponsor and funder names, emails and phone numbers. The
 *    only place adult contact details live now; `sponsors.list` omits the
 *    contact columns entirely rather than exposing even the linking id.
 *  - `users`     -- the roster. A signed-in row starts as bare as an opaque
 *    token identifier; a first name and last initial only enter once someone
 *    asks for edit access, which is the point at which accountability starts
 *    to matter.
 *  - `auditLogs` -- every entry is stamped with a `userId`.
 *  - `donors`    -- a donor name is a person's name. It reaches the public on
 *    the money queries as `donorName`, which is deliberate (spec section 5:
 *    donors are already public on the team's HCB page), but the *listing* is
 *    a roster of givers and feeds a writer-only typeahead, so nothing needs
 *    it open.
 *
 * Writes are never public. Every mutation still goes through requireWriter or
 * requireAdmin.
 */

/** "Levi F", or a fallback for a viewer who has never asked for edit access. */
export function displayName(user: Doc<"users">): string {
  const parts = [user.firstName, user.lastInitial].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unnamed member";
}

/** The audit-log actor fields, derived from the roster row rather than sent by the client. */
export function actorFields(user: Doc<"users">) {
  return { userId: user._id };
}

/**
 * Display names for the roster rows a result set actually references, keyed
 * by id.
 *
 * Resolved from the ids handed in rather than from a bounded scan of the
 * table. The scan it replaces was `.take(500)`, and every `*Name` field on
 * every public query fed through it: a roster past 500 rows would have
 * resolved a name to `undefined` silently, so an expense or a grant would
 * simply stop showing who filed it, with no error anywhere. Keyed off the
 * result set there is no bound left to outgrow -- the reads are bounded by
 * the rows already being returned, and each caller only ever passes the ids
 * from a set it has just read.
 *
 * Still one read per distinct person rather than an N+1 over rows: the ids
 * are de-duplicated first, so a hundred expenses filed by four people cost
 * four reads. `undefined` entries are dropped, so a caller can pass an
 * optional column straight in.
 */
export async function resolveNames(
  ctx: AnyCtx,
  ids: Iterable<Id<"users"> | undefined>
): Promise<Map<Id<"users">, string>> {
  const unique = [...new Set(ids)].flatMap((id) => (id ? [id] : []));
  const users = await Promise.all(unique.map((id) => ctx.db.get("users", id)));
  return new Map(
    users.flatMap((u) => (u ? [[u._id, displayName(u)] as const] : []))
  );
}

/**
 * The roster row for whoever signed this request, or null.
 *
 * `tokenIdentifier` is `issuer|subject`, so a row claimed against the
 * development Google client can never be matched by a production token, or
 * vice versa. Using `subject` alone would let the two collide.
 */
export async function getActor(ctx: AnyCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/**
 * The signed-in team member, or an error.
 *
 * There is no `status` to reject here: every roster row is fully active the
 * moment it exists. A viewer's limits are enforced by `requireWriter`, not by
 * this function.
 */
export async function requireActor(ctx: AnyCtx): Promise<Doc<"users">> {
  const user = await getActor(ctx);
  if (!user) throw new Error("Not signed in.");
  return user;
}

/** Anyone on the roster who is not a read-only viewer. Mirrors the UI's `isViewer` gate. */
export async function requireWriter(ctx: AnyCtx): Promise<Doc<"users">> {
  const user = await requireActor(ctx);
  if (user.role === "viewer") throw new Error("Viewer accounts cannot make changes.");
  return user;
}

export async function requireAdmin(ctx: AnyCtx): Promise<Doc<"users">> {
  const user = await requireActor(ctx);
  if (user.role !== "admin") throw new Error("Only admins can do that.");
  return user;
}

/**
 * Attach the caller's Google identity to a roster row, creating one if this is
 * the first time we have seen them. Safe to call on every sign-in.
 *
 * A new account holds an opaque identifier and nothing else. A name is
 * collected only if they later ask for edit access, which is the point at
 * which accountability starts to matter.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      role: "viewer",
      requested: false,
    });
  },
});
