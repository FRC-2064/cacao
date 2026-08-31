import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { logAudit } from "./lib";
import {
  accountKeyValidator,
  carrierValidator,
  deadlineTypeValidator,
  deliveryStatusValidator,
  expenseCategoryValidator,
  expenseStatusValidator,
  grantStatusValidator,
  incomeCategoryValidator,
  outreachStatusValidator,
  paymentMethodValidator,
  preferredMethodValidator,
  priorityValidator,
  requirementValidator,
  roleValidator,
  sponsorCategoryValidator,
  sponsorStatusValidator,
  sponsorTierValidator,
  wishlistSourceValidator,
} from "./validators";
import { requireAdmin } from "./auth";
import {
  ANONYMOUS_DONOR_NAME,
  isEmailShapedDonorName,
  normalizeDonorName,
} from "./donorNames";

/**
 * One-shot bootstrap for a fresh deployment.
 *
 * The dataset lives in `src/lib/data/teamData.ts` -- generated from the team's
 * two Google Sheets by `scripts/import/generate.ts` -- which imports through
 * the `$lib` Vite alias and so cannot be bundled into a Convex function.
 * Rather than duplicating it here, the admin UI ships the records up as
 * arguments and this mutation writes them in dependency order, rewriting the
 * dataset's string ids to real Convex ids as it goes.
 *
 * Every "who did this" reference (a requester, a logger, an approver) is a
 * required placeholder id in the seed input if the schema itself requires
 * one -- this mutation never invents an attribution nobody supplied. It is
 * fine for `assigneeId`, `purchaserId`, etc. to be entirely absent, because
 * those are optional in the schema too.
 */

function requireRef<T>(map: Map<string, T>, key: string, label: string): T {
  const found = map.get(key);
  if (found === undefined) {
    throw new Error(`Seed data references an unknown ${label} id "${key}"`);
  }
  return found;
}

function optionalRef<T>(
  map: Map<string, T>,
  key: string | undefined,
  label: string
): T | undefined {
  return key === undefined ? undefined : requireRef(map, key, label);
}

export const seedSeason = v.object({
  _id: v.string(),
  label: v.string(),
  startDate: v.string(),
  endDate: v.string(),
  isCurrent: v.boolean(),
});

export const seedDonor = v.object({
  _id: v.string(),
  displayName: v.string(),
  normalizedKey: v.string(),
  isAnonymous: v.boolean(),
});

export const seedUser = v.object({
  _id: v.string(),
  tokenIdentifier: v.string(),
  firstName: v.optional(v.string()),
  lastInitial: v.optional(v.string()),
  role: roleValidator,
  requested: v.boolean(),
  approvedById: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
});

export const seedAccount = v.object({
  _id: v.string(),
  key: accountKeyValidator,
  openingBalance: v.number(),
  asOfDate: v.string(),
  updatedAt: v.number(),
  updatedById: v.string(),
});

export const seedGrant = v.object({
  _id: v.string(),
  title: v.string(),
  funder: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: grantStatusValidator,
  deadline: v.optional(v.string()),
  deadlineType: deadlineTypeValidator,
  deadlineNote: v.optional(v.string()),
  assigneeId: v.optional(v.string()),
  priority: priorityValidator,
  seasonId: v.string(),
  portalUrl: v.optional(v.string()),
  docUrl: v.optional(v.string()),
  fileNote: v.optional(v.string()),
  requirements: v.array(requirementValidator),
  notes: v.optional(v.string()),
  order: v.number(),
  awardedAmount: v.optional(v.number()),
  awardedDate: v.optional(v.string()),
  finishedAt: v.optional(v.number()),
  finishedById: v.optional(v.string()),
  updatedAt: v.number(),
});

export const seedSponsor = v.object({
  _id: v.string(),
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
  primaryContactId: v.optional(v.string()),
  updatedAt: v.number(),
});

export const seedContact = v.object({
  _id: v.string(),
  sponsorId: v.optional(v.string()),
  name: v.string(),
  title: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  isPrimary: v.boolean(),
  preferredMethod: preferredMethodValidator,
  notes: v.optional(v.string()),
  lastContactedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export const seedSponsorOutreach = v.object({
  _id: v.string(),
  sponsorId: v.string(),
  year: v.number(),
  status: outreachStatusValidator,
  amount: v.optional(v.number()),
  notes: v.optional(v.string()),
  contactedDate: v.optional(v.string()),
});

export const seedExpense = v.object({
  _id: v.string(),
  title: v.string(),
  vendor: v.string(),
  amount: v.number(),
  finalPaidAmount: v.optional(v.number()),
  currency: v.string(),
  category: expenseCategoryValidator,
  requesterId: v.string(),
  status: expenseStatusValidator,
  seasonId: v.string(),
  paymentMethod: v.optional(paymentMethodValidator),
  accountId: v.optional(v.string()),
  date: v.optional(v.string()),
  donorId: v.optional(v.string()),
  taxYear: v.optional(v.number()),
  purchaserId: v.optional(v.string()),
  orderNumber: v.optional(v.string()),
  trackingNumber: v.optional(v.string()),
  carrier: v.optional(carrierValidator),
  expectedDeliveryDate: v.optional(v.string()),
  deliveryStatus: v.optional(deliveryStatusValidator),
  receiptUrl: v.optional(v.string()),
  itemLink: v.optional(v.string()),
  notes: v.optional(v.string()),
  linkedGrantId: v.optional(v.string()),
  approvedById: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  purchasedAt: v.optional(v.number()),
  receivedAt: v.optional(v.number()),
  reimbursedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export const seedIncome = v.object({
  _id: v.string(),
  title: v.string(),
  amount: v.number(),
  category: incomeCategoryValidator,
  accountId: v.string(),
  date: v.string(),
  loggedById: v.string(),
  seasonId: v.string(),
  receiptUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
  donorId: v.optional(v.string()),
  taxYear: v.optional(v.number()),
  updatedAt: v.number(),
});

export const seedTeamInfo = v.object({
  _id: v.string(),
  label: v.string(),
  value: v.string(),
  order: v.number(),
  updatedAt: v.number(),
  updatedById: v.string(),
});

export const seedWishlistItem = v.object({
  _id: v.string(),
  tool: v.string(),
  company: v.optional(v.string()),
  cost: v.number(),
  source: wishlistSourceValidator,
  priority: v.number(),
  description: v.optional(v.string()),
  itemLink: v.optional(v.string()),
  updatedAt: v.number(),
});

const TABLES = [
  "seasons",
  "donors",
  "users",
  "accounts",
  "sponsors",
  "contacts",
  "sponsorOutreach",
  "grants",
  "expenses",
  "incomeDeposits",
  "teamInfo",
  "wishlist",
  "auditLogs",
] as const;

/** Row counts per table, so the admin UI can tell an empty deployment from a live one. */
export const status = query({
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      counts[table] = (await ctx.db.query(table).collect()).length;
    }
    return { counts, isEmpty: Object.values(counts).every((n) => n === 0) };
  },
});

export const importAll = mutation({
  args: {
    seasons: v.array(seedSeason),
    donors: v.array(seedDonor),
    users: v.array(seedUser),
    accounts: v.array(seedAccount),
    sponsors: v.array(seedSponsor),
    contacts: v.array(seedContact),
    sponsorOutreach: v.array(seedSponsorOutreach),
    grants: v.array(seedGrant),
    expenses: v.array(seedExpense),
    incomeDeposits: v.array(seedIncome),
    teamInfo: v.array(seedTeamInfo),
    wishlist: v.array(seedWishlistItem),
    /**
     * Which entry in `users` is the admin running this import.
     *
     * `users` is wiped along with every other table, so without this the
     * caller would delete their own roster row mid-transaction and could only
     * get it back by shipping their own `tokenIdentifier` up in the payload --
     * and a payload carrying a *wrong* token would then hand the deployment to
     * nobody, unrecoverably, with no error. So the caller names their row
     * instead of describing it: for this `_id` the payload's `tokenIdentifier`
     * and `role` are ignored outright and the row is written with the
     * caller's own identity and `role: "admin"`. Nothing outside this
     * mutation ever has to know, or transmit, a raw token identifier.
     */
    actorLocalId: v.string(),
    /** Wipe existing rows first. Without this a non-empty deployment is left alone. */
    replace: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);

    // Three ways a payload can lock the caller out of their own deployment.
    // Each ends the same way: the roster is replaced and the caller cannot
    // get back in, with no error at the call site.
    //
    // Their *position* here carries no safety, and an earlier version of this
    // comment claimed it did. A Convex mutation is a transaction: an uncaught
    // throw anywhere in this handler rolls back everything it has written,
    // the delete loop below included. Moving all three checks after that loop
    // leaves the roster and every other table intact just the same -- and
    // leaves the tests in seed.test.ts passing, which is how the false claim
    // survived. They run first because failing before doing work is cheaper
    // and reads more clearly, not because a throw further down would be
    // dangerous.
    //
    // What the checks themselves buy is real: remove 2 or 3 and two tests in
    // seed.test.ts fail.
    //
    // 1. A payload that does not name the caller's row at all.
    if (!args.users.some((u) => u._id === args.actorLocalId)) {
      throw new Error(
        `Seed data has no users entry with _id "${args.actorLocalId}" to carry the importing admin.`
      );
    }
    // 2. Two entries sharing one `_id`. The check above uses `.some()`, so a
    //    duplicate of the actor's `_id` passes it and the insert loop writes
    //    *both* rows with the caller's `tokenIdentifier` and `role: "admin"`.
    //    `getActor` ends in `.unique()`, so from then on every request throws
    //    -- including `ensureUser`, so signing in again does not help. And
    //    there is no second door: `ensureUser` writes `role: "viewer"` for
    //    every new account and `setUserRole` needs an admin, so the app has
    //    no path to mint an admin at all. Recovery is the Convex dashboard.
    //    Duplicates outside the actor's `_id` are rejected too: `requireRef`
    //    would silently resolve every reference to whichever row was
    //    inserted last.
    const ids = args.users.map((u) => u._id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Seed users have duplicate _id values.");
    }
    // 3. A second entry carrying the caller's real identity under a different
    //    `_id`. The actor's row is written with that identity by definition,
    //    so this collides with it and lands in the same `.unique()` failure.
    if (
      args.users.some(
        (u) => u._id !== args.actorLocalId && u.tokenIdentifier === actor.tokenIdentifier
      )
    ) {
      throw new Error("Another seed users entry carries the importing admin's own identity.");
    }
    // 4. Two entries with distinct `_id`s sharing one `tokenIdentifier` that
    //    is not the caller's. `new Set(ids)` misses them because the ids
    //    differ, and check 3 misses them because neither is the caller -- so
    //    this pair used to be accepted outright. The person they describe
    //    then hits `getActor`'s `.unique()` on every request from their first
    //    sign-in, and it is unrecoverable in-app: `convex/users.ts` has no
    //    delete mutation, so nobody can remove either row. Not reachable
    //    while `TEAM_USERS` is `[]`, but the roster payload will not stay
    //    empty forever and this check is one `new Set` wide.
    //
    //    The actor's entry is excluded on purpose: its payload
    //    `tokenIdentifier` is discarded and replaced with the caller's real
    //    one below, so whatever placeholder it carries cannot collide with
    //    anything.
    const tokens = args.users
      .filter((u) => u._id !== args.actorLocalId)
      .map((u) => u.tokenIdentifier);
    if (new Set(tokens).size !== tokens.length) {
      throw new Error("Two seed users entries share one tokenIdentifier.");
    }

    for (const table of TABLES) {
      const existing = await ctx.db.query(table).collect();
      if (existing.length === 0) continue;
      if (!args.replace) {
        throw new Error(
          `Deployment already has data (${table}: ${existing.length} rows). Pass replace: true to overwrite.`
        );
      }
      for (const doc of existing) {
        await ctx.db.delete(table, doc._id);
      }
    }

    const seasonIds = new Map<string, Id<"seasons">>();
    for (const { _id, ...fields } of args.seasons) {
      seasonIds.set(_id, await ctx.db.insert("seasons", fields));
    }

    /**
     * The donor guard, applied where it cannot be skipped.
     *
     * `donors.resolveDonorByName` routes an email-shaped name into the
     * anonymous bucket, so no member can get an address into
     * `donors.displayName` through any mutation. This loop was the exception:
     * it inserted the payload verbatim, and the generator that builds that
     * payload reads the team's real HCB export -- the same source that
     * produced the `"Donation from <address>"` case the read-side rule exists
     * for. `donors.list` and `income.list`'s raw `donorName` both emit this
     * column, so one import could seed an address into the deployment; the app
     * hides it, but the app is not the only thing that can read a deployment.
     *
     * Here rather than in the generator on purpose: this is server-side and
     * unavoidable, where a generator is a step someone can re-run differently.
     *
     * `byKey` merges rather than inserting twice. Two different addresses
     * redact to one name, and `resolveDonorByName`'s `by_normalized_key`
     * lookup ends in `.first()` on the assumption that a key names one row --
     * two rows sharing one would split a household's giving in the report.
     * Deduping every donor by key, not only the redacted ones, is what makes
     * a redacted row join an "Anonymous Donor" the payload already carries;
     * for the rest it is a no-op, since the generator's registry is keyed the
     * same way.
     */
    const donorIds = new Map<string, Id<"donors">>();
    const donorIdByKey = new Map<string, Id<"donors">>();
    for (const { _id, displayName, normalizedKey, isAnonymous } of args.donors) {
      const attributable = isEmailShapedDonorName(displayName)
        ? ANONYMOUS_DONOR_NAME
        : displayName;
      const redacted = attributable !== displayName;
      const key = redacted
        ? normalizeDonorName(attributable) || attributable.toLowerCase()
        : normalizedKey;

      const already = donorIdByKey.get(key);
      if (already !== undefined) {
        donorIds.set(_id, already);
        continue;
      }

      const id = await ctx.db.insert("donors", {
        displayName: attributable,
        normalizedKey: key,
        isAnonymous: redacted ? true : isAnonymous,
      });
      donorIds.set(_id, id);
      donorIdByKey.set(key, id);
    }

    // Users go in without `approvedById` -- a user can be approved by another
    // user in the same batch, and that id does not exist yet. Patched below
    // once every user has a real id.
    //
    // The actor's row is rebuilt from the caller's own authenticated identity
    // rather than from the payload, so the two fields that decide whether they
    // can still get in -- `tokenIdentifier` and `role` -- are never read from
    // data. See `actorLocalId` above.
    const userIds = new Map<string, Id<"users">>();
    const pendingApprovals: { id: Id<"users">; approvedById: string }[] = [];
    for (const { _id, approvedById, tokenIdentifier, role, ...fields } of args.users) {
      const isActor = _id === args.actorLocalId;
      const userId = await ctx.db.insert("users", {
        ...fields,
        tokenIdentifier: isActor ? actor.tokenIdentifier : tokenIdentifier,
        role: isActor ? "admin" : role,
      });
      userIds.set(_id, userId);
      if (approvedById !== undefined) {
        pendingApprovals.push({ id: userId, approvedById });
      }
    }
    for (const { id, approvedById } of pendingApprovals) {
      await ctx.db.patch("users", id, {
        approvedById: requireRef(userIds, approvedById, "user"),
      });
    }

    const accountIds = new Map<string, Id<"accounts">>();
    for (const { _id, updatedById, ...fields } of args.accounts) {
      accountIds.set(
        _id,
        await ctx.db.insert("accounts", {
          ...fields,
          updatedById: requireRef(userIds, updatedById, "user"),
        })
      );
    }

    // Sponsors go in without `primaryContactId` -- the contact rows below
    // reference the sponsor, not the other way around yet. Patched after
    // contacts exist.
    const sponsorIds = new Map<string, Id<"sponsors">>();
    const pendingPrimaryContacts: { id: Id<"sponsors">; contactId: string }[] = [];
    for (const { _id, primaryContactId, ...fields } of args.sponsors) {
      const sponsorId = await ctx.db.insert("sponsors", fields);
      sponsorIds.set(_id, sponsorId);
      if (primaryContactId !== undefined) {
        pendingPrimaryContacts.push({ id: sponsorId, contactId: primaryContactId });
      }
    }

    const contactIds = new Map<string, Id<"contacts">>();
    for (const { _id, sponsorId, ...fields } of args.contacts) {
      contactIds.set(
        _id,
        await ctx.db.insert("contacts", {
          ...fields,
          sponsorId: optionalRef(sponsorIds, sponsorId, "sponsor"),
        })
      );
    }

    for (const { id, contactId } of pendingPrimaryContacts) {
      await ctx.db.patch("sponsors", id, {
        primaryContactId: requireRef(contactIds, contactId, "contact"),
      });
    }

    for (const { _id, sponsorId, ...fields } of args.sponsorOutreach) {
      await ctx.db.insert("sponsorOutreach", {
        ...fields,
        sponsorId: requireRef(sponsorIds, sponsorId, "sponsor"),
      });
    }

    const grantIds = new Map<string, Id<"grants">>();
    for (const { _id, seasonId, assigneeId, finishedById, ...fields } of args.grants) {
      grantIds.set(
        _id,
        await ctx.db.insert("grants", {
          ...fields,
          seasonId: requireRef(seasonIds, seasonId, "season"),
          assigneeId: optionalRef(userIds, assigneeId, "user"),
          finishedById: optionalRef(userIds, finishedById, "user"),
        })
      );
    }

    for (const {
      _id,
      seasonId,
      requesterId,
      accountId,
      donorId,
      linkedGrantId,
      purchaserId,
      approvedById,
      ...fields
    } of args.expenses) {
      await ctx.db.insert("expenses", {
        ...fields,
        seasonId: requireRef(seasonIds, seasonId, "season"),
        requesterId: requireRef(userIds, requesterId, "user"),
        accountId: optionalRef(accountIds, accountId, "account"),
        donorId: optionalRef(donorIds, donorId, "donor"),
        linkedGrantId: optionalRef(grantIds, linkedGrantId, "grant"),
        purchaserId: optionalRef(userIds, purchaserId, "user"),
        approvedById: optionalRef(userIds, approvedById, "user"),
      });
    }

    for (const { _id, seasonId, accountId, loggedById, donorId, ...fields } of args.incomeDeposits) {
      await ctx.db.insert("incomeDeposits", {
        ...fields,
        seasonId: requireRef(seasonIds, seasonId, "season"),
        accountId: requireRef(accountIds, accountId, "account"),
        loggedById: requireRef(userIds, loggedById, "user"),
        donorId: optionalRef(donorIds, donorId, "donor"),
      });
    }

    for (const { _id, updatedById, ...fields } of args.teamInfo) {
      await ctx.db.insert("teamInfo", {
        ...fields,
        updatedById: requireRef(userIds, updatedById, "user"),
      });
    }

    for (const { _id, ...fields } of args.wishlist) {
      await ctx.db.insert("wishlist", fields);
    }

    // `actor._id` names the row this mutation just deleted, and Convex does
    // not reject a dangling `v.id("users")` -- it would be written and then
    // read back as "Unknown member". The one entry that must never be
    // anonymous is the one recording who replaced the whole database, so log
    // against the actor's *new* id. `actorLocalId` is guaranteed present above.
    await logAudit(ctx, { userId: requireRef(userIds, args.actorLocalId, "user") }, {
      action: "import_seed",
      entityType: "system",
      entityId: "seed",
    });

    return {
      seasons: args.seasons.length,
      donors: args.donors.length,
      users: args.users.length,
      accounts: args.accounts.length,
      sponsors: args.sponsors.length,
      contacts: args.contacts.length,
      sponsorOutreach: args.sponsorOutreach.length,
      grants: args.grants.length,
      expenses: args.expenses.length,
      incomeDeposits: args.incomeDeposits.length,
      teamInfo: args.teamInfo.length,
      wishlist: args.wishlist.length,
    };
  },
});
