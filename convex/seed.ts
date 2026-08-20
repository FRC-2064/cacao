import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import {
  actorArgs,
  annualHistoryValidator,
  carrierValidator,
  deadlineTypeValidator,
  deliveryStatusValidator,
  depositAccountValidator,
  expenseCategoryValidator,
  expenseStatusValidator,
  grantStatusValidator,
  incomeCategoryValidator,
  paymentMethodValidator,
  preferredMethodValidator,
  priorityValidator,
  requirementValidator,
  roleValidator,
  sponsorCategoryValidator,
  sponsorStatusValidator,
  sponsorTierValidator,
  userStatusValidator,
} from "./validators";

/**
 * One-shot bootstrap for a fresh deployment.
 *
 * The starter dataset lives in `src/lib/data/seedData.ts`, which imports through
 * the `$lib` Vite alias and so cannot be bundled into a Convex function. Rather
 * than duplicating 800 lines here, the admin UI ships the records up as
 * arguments and this mutation writes them in dependency order, rewriting the
 * seed's string ids to real Convex ids as it goes.
 */

const seedGrant = v.object({
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
  assigneeName: v.optional(v.string()),
  priority: priorityValidator,
  season: v.string(),
  portalUrl: v.optional(v.string()),
  docUrl: v.optional(v.string()),
  fileNote: v.optional(v.string()),
  requirements: v.array(requirementValidator),
  notes: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastModifiedBy: v.string(),
});

const seedSponsor = v.object({
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
  annualHistory: v.array(annualHistoryValidator),
  primaryContactName: v.optional(v.string()),
  primaryContactEmail: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastModifiedBy: v.string(),
});

const seedContact = v.object({
  _id: v.string(),
  sponsorId: v.optional(v.string()),
  sponsorName: v.optional(v.string()),
  name: v.string(),
  title: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  isPrimary: v.boolean(),
  preferredMethod: preferredMethodValidator,
  notes: v.optional(v.string()),
  lastContactedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const seedUser = v.object({
  _id: v.string(),
  name: v.string(),
  email: v.string(),
  role: roleValidator,
  gradYear: v.optional(v.number()),
  subteam: v.optional(v.string()),
  status: userStatusValidator,
  requestReason: v.optional(v.string()),
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  createdAt: v.number(),
  lastActiveAt: v.optional(v.number()),
});

const seedAccessRequest = v.object({
  _id: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  gradYear: v.number(),
  subteam: v.string(),
  notes: v.optional(v.string()),
  status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
  submittedAt: v.number(),
  reviewedAt: v.optional(v.number()),
  reviewedBy: v.optional(v.string()),
});

const seedExpense = v.object({
  _id: v.string(),
  title: v.string(),
  vendor: v.string(),
  amount: v.number(),
  finalPaidAmount: v.optional(v.number()),
  currency: v.string(),
  category: expenseCategoryValidator,
  subteam: v.string(),
  requesterName: v.string(),
  requesterEmail: v.string(),
  status: expenseStatusValidator,
  season: v.string(),
  paymentMethod: v.optional(paymentMethodValidator),
  purchaserName: v.optional(v.string()),
  orderNumber: v.optional(v.string()),
  trackingNumber: v.optional(v.string()),
  carrier: v.optional(carrierValidator),
  expectedDeliveryDate: v.optional(v.string()),
  deliveryStatus: v.optional(deliveryStatusValidator),
  receiptUrl: v.optional(v.string()),
  itemLink: v.optional(v.string()),
  notes: v.optional(v.string()),
  linkedGrantId: v.optional(v.string()),
  linkedGrantTitle: v.optional(v.string()),
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  purchasedAt: v.optional(v.number()),
  receivedAt: v.optional(v.number()),
  reimbursedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const seedIncome = v.object({
  _id: v.string(),
  title: v.string(),
  amount: v.number(),
  category: incomeCategoryValidator,
  depositAccount: depositAccountValidator,
  date: v.string(),
  loggedByName: v.string(),
  loggedByEmail: v.string(),
  season: v.string(),
  receiptUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const TABLES = [
  "grants",
  "sponsors",
  "contacts",
  "users",
  "accessRequests",
  "expenses",
  "incomeDeposits",
  "auditLogs",
] as const;

/** Row counts per table, so the admin UI can tell an empty deployment from a live one. */
export const status = query({
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      counts[table] = (await ctx.db.query(table).collect()).length;
    }
    return { counts, isEmpty: Object.values(counts).every((n) => n === 0) };
  },
});

export const importAll = mutation({
  args: {
    grants: v.array(seedGrant),
    sponsors: v.array(seedSponsor),
    contacts: v.array(seedContact),
    users: v.array(seedUser),
    accessRequests: v.array(seedAccessRequest),
    expenses: v.array(seedExpense),
    incomeDeposits: v.array(seedIncome),
    /** Wipe existing rows first. Without this a non-empty deployment is left alone. */
    replace: v.optional(v.boolean()),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    for (const table of TABLES) {
      const existing = await ctx.db.query(table).collect();
      if (existing.length === 0) continue;
      if (!args.replace) {
        throw new Error(
          `Deployment already has data (${table}: ${existing.length} rows). Pass replace: true to overwrite.`
        );
      }
      for (const doc of existing) {
        await ctx.db.delete(doc._id);
      }
    }

    // Sponsors and grants go in first so contacts and expenses can point at
    // their new ids instead of the seed file's placeholder strings.
    const sponsorIds = new Map<string, string>();
    for (const { _id, ...fields } of args.sponsors) {
      sponsorIds.set(_id, await ctx.db.insert("sponsors", fields));
    }

    const grantIds = new Map<string, string>();
    for (const { _id, ...fields } of args.grants) {
      grantIds.set(_id, await ctx.db.insert("grants", fields));
    }

    for (const { _id, ...fields } of args.contacts) {
      await ctx.db.insert("contacts", {
        ...fields,
        sponsorId: fields.sponsorId ? sponsorIds.get(fields.sponsorId) : undefined,
      });
    }

    for (const { _id, ...fields } of args.expenses) {
      await ctx.db.insert("expenses", {
        ...fields,
        linkedGrantId: fields.linkedGrantId ? grantIds.get(fields.linkedGrantId) : undefined,
      });
    }

    for (const { _id, ...fields } of args.users) {
      await ctx.db.insert("users", fields);
    }
    for (const { _id, ...fields } of args.accessRequests) {
      await ctx.db.insert("accessRequests", fields);
    }
    for (const { _id, ...fields } of args.incomeDeposits) {
      await ctx.db.insert("incomeDeposits", fields);
    }

    await logAudit(ctx, args, {
      action: "import_seed",
      entityType: "system",
      entityId: "seed",
      entityName: "Starter dataset",
      summary:
        `Imported starter data: ${args.grants.length} grants, ${args.sponsors.length} sponsors, ` +
        `${args.contacts.length} contacts, ${args.expenses.length} expenses, ` +
        `${args.incomeDeposits.length} deposits`,
    });

    return {
      grants: args.grants.length,
      sponsors: args.sponsors.length,
      contacts: args.contacts.length,
      users: args.users.length,
      expenses: args.expenses.length,
      incomeDeposits: args.incomeDeposits.length,
    };
  },
});
