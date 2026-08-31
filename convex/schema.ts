import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  accountKeyValidator,
  auditActionValidator,
  entityTypeValidator,
  grantStatusValidator,
  ledgerCategoryValidator,
  expenseCategoryValidator,
  incomeCategoryValidator,
  outreachStatusValidator,
  roleValidator,
  wishlistSourceValidator,
} from "./validators";

export default defineSchema({
  grants: defineTable({
    title: v.string(),
    funder: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: grantStatusValidator,
    deadline: v.optional(v.string()),
    deadlineType: v.union(v.literal("fixed"), v.literal("rolling"), v.literal("tbd")),
    deadlineNote: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    priority: v.union(v.literal("urgent"), v.literal("high"), v.literal("medium"), v.literal("low")),
    seasonId: v.id("seasons"),
    portalUrl: v.optional(v.string()),
    docUrl: v.optional(v.string()),
    fileNote: v.optional(v.string()),
    requirements: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        done: v.boolean(),
      })
    ),
    notes: v.optional(v.string()),
    order: v.number(),
    /** What the funder gave, as opposed to `amount`, which stays the ask. */
    awardedAmount: v.optional(v.number()),
    awardedDate: v.optional(v.string()),
    /** The deposit an award created, so it is traceable and never made twice. */
    linkedDepositId: v.optional(v.id("incomeDeposits")),
    finishedAt: v.optional(v.number()),
    finishedById: v.optional(v.id("users")),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_season_id", ["seasonId"])
    .index("by_assignee_id", ["assigneeId"]),

  sponsors: defineTable({
    name: v.string(),
    category: v.union(
      v.literal("corporate"),
      v.literal("local_business"),
      v.literal("foundation"),
      v.literal("community_partner"),
      v.literal("in_kind_supplier")
    ),
    tier: v.union(
      v.literal("platinum"),
      v.literal("gold"),
      v.literal("silver"),
      v.literal("bronze"),
      v.literal("panther_partner"),
      v.literal("in_kind"),
      v.literal("none")
    ),
    status: v.union(
      v.literal("lead"),
      v.literal("contacted"),
      v.literal("in_discussion"),
      v.literal("packet_sent"),
      v.literal("pledged"),
      v.literal("paid_active"),
      v.literal("declined"),
      v.literal("stale_renewal_due")
    ),
    totalDonated: v.number(),
    currentYearPledge: v.optional(v.number()),
    lastContactDate: v.optional(v.string()),
    nextFollowUpDate: v.optional(v.string()),
    website: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    primaryContactId: v.optional(v.id("contacts")),
    updatedAt: v.number(),
  })
    .index("by_tier", ["tier"])
    .index("by_status", ["status"]),

  contacts: defineTable({
    sponsorId: v.optional(v.id("sponsors")),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    preferredMethod: v.union(v.literal("email"), v.literal("phone"), v.literal("in_person")),
    notes: v.optional(v.string()),
    lastContactedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_sponsor", ["sponsorId"]),

  users: defineTable({
    /**
     * The Google identity this row belongs to, as `issuer|subject`. This is the
     * only thing that proves who a request is from -- the roster row is looked
     * up by it, never by an email or role the client asserts.
     */
    tokenIdentifier: v.string(),
    firstName: v.optional(v.string()),
    /**
     * One character, truncated server-side (see `requestEditAccess`). Convex
     * has no length-constraint validator, so this comment is the only thing
     * standing between this column and a surname -- never trust a client to
     * have already done the truncation.
     */
    lastInitial: v.optional(v.string()),
    role: roleValidator,
    /** True while an account is awaiting admin approval. */
    requested: v.boolean(),
    approvedById: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
  }).index("by_token_identifier", ["tokenIdentifier"]),

  auditLogs: defineTable({
    userId: v.id("users"),
    action: auditActionValidator,
    entityType: entityTypeValidator,
    entityId: v.string(),
    /**
     * A single field-level change, not a free-form payload -- an unbounded
     * `v.any()` here would be exactly the `details: v.any()` column this
     * change deleted, reintroduced under a new name.
     */
    change: v.optional(
      v.object({
        field: v.string(),
        from: v.string(),
        to: v.string(),
      })
    ),
  }).index("by_user_id", ["userId"]),

  expenses: defineTable({
    title: v.string(),
    vendor: v.string(),
    amount: v.number(),
    finalPaidAmount: v.optional(v.number()),
    currency: v.string(),
    category: expenseCategoryValidator,
    requesterId: v.id("users"),
    status: v.union(
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("purchased"),
      v.literal("reimbursed"),
      v.literal("donated"),
      v.literal("rejected")
    ),
    seasonId: v.id("seasons"),
    paymentMethod: v.optional(
      v.union(
        v.literal("hcb_card"),
        v.literal("personal_reimbursement"),
        v.literal("school_po"),
        v.literal("grant_voucher"),
        v.literal("cash"),
        v.literal("other")
      )
    ),
    accountId: v.optional(v.id("accounts")),
    /**
     * The calendar day (YYYY-MM-DD) the money actually moved, as asserted by a
     * human. Distinct from the timestamps below, which are audit trail: when
     * the request was filed, when someone pressed "mark bought". Optional
     * because a request that has not been purchased yet has no day to assert --
     * it gets one at "mark bought". Until then the ledger falls back to the
     * timestamps.
     */
    date: v.optional(v.string()),
    purchaserId: v.optional(v.id("users")),
    orderNumber: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(
      v.union(
        v.literal("UPS"),
        v.literal("FedEx"),
        v.literal("USPS"),
        v.literal("Amazon"),
        v.literal("DHL"),
        v.literal("Local Pickup"),
        v.literal("Other")
      )
    ),
    expectedDeliveryDate: v.optional(v.string()),
    deliveryStatus: v.optional(
      v.union(
        v.literal("ordered"),
        v.literal("shipped"),
        v.literal("delivered")
      )
    ),
    receiptUrl: v.optional(v.string()),
    itemLink: v.optional(v.string()),
    notes: v.optional(v.string()),
    donorId: v.optional(v.id("donors")),
    taxYear: v.optional(v.number()),
    linkedGrantId: v.optional(v.id("grants")),
    approvedById: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    purchasedAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
    reimbursedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_season_id", ["seasonId"]),

  incomeDeposits: defineTable({
    title: v.string(),
    amount: v.number(),
    category: incomeCategoryValidator,
    accountId: v.id("accounts"),
    date: v.string(),
    loggedById: v.id("users"),
    seasonId: v.id("seasons"),
    receiptUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    donorId: v.optional(v.id("donors")),
    taxYear: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_account_id", ["accountId"])
    .index("by_season_id", ["seasonId"]),

  /**
   * A human's category for a Hack Club Bank transaction that the memo rules
   * could not classify (or classified wrongly). One row per transaction;
   * deleting the row returns the transaction to automatic classification.
   * Keyed by HCB's own transaction id, which is stable across syncs -- the
   * transactions themselves are never stored, they are fetched from the API.
   */
  hcbCategories: defineTable({
    hcbTransactionId: v.string(),
    /** Which way the money moved, so the category can be checked against the right taxonomy. */
    direction: v.union(v.literal("in"), v.literal("out")),
    category: ledgerCategoryValidator,
    setById: v.id("users"),
    updatedAt: v.number(),
  }).index("by_transaction", ["hcbTransactionId"]),

  /**
   * The boilerplate every grant application asks for -- EIN, address, member
   * count -- as one row per fact rather than a single record with fixed
   * columns. Applications keep asking for things nobody anticipated (a DUNS
   * number, last year's operating budget), and a row is cheaper to add than a
   * schema migration.
   */
  teamInfo: defineTable({
    label: v.string(),
    value: v.string(),
    /** Display position; the list is hand-ordered, not sorted. */
    order: v.number(),
    updatedAt: v.number(),
    updatedById: v.id("users"),
  }).index("by_order", ["order"]),

  /**
   * Kit the team wants but has not bought: the standing answer to "what would
   * you do with the money" that grant applications ask for.
   */
  wishlist: defineTable({
    tool: v.string(),
    /** Vendor or maker. Free text -- "N/A" is a legitimate answer here. */
    company: v.optional(v.string()),
    cost: v.number(),
    /** How the team expects to pay for it, not a link to a specific grant. */
    source: wishlistSourceValidator,
    /** 1-10 as the team scores it, 10 being most wanted. */
    priority: v.number(),
    description: v.optional(v.string()),
    itemLink: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_priority", ["priority"]),

  /**
   * One row per account, holding the balance the team last verified against
   * the real account. Re-baselined at each audit rather than set once.
   */
  accounts: defineTable({
    key: accountKeyValidator,
    openingBalance: v.number(),
    asOfDate: v.string(),
    updatedAt: v.number(),
    updatedById: v.id("users"),
  }).index("by_key", ["key"]),

  /**
   * A signed-in browser. Holds the Google refresh token so an expired ID token
   * can be replaced without sending the user back through Google.
   *
   * The refresh token is scoped to `openid` alone: the only thing it can ever
   * obtain is the user's `sub`. It cannot read email, profile, or any API.
   *
   * `secretHash` is a SHA-256 of the secret the browser holds. Storing the
   * hash means a database leak does not hand over live sessions.
   */
  sessions: defineTable({
    secretHash: v.string(),
    refreshToken: v.string(),
    tokenIdentifier: v.string(),
    expiresAt: v.number(),
  })
    .index("by_secret_hash", ["secretHash"])
    .index("by_expires_at", ["expiresAt"]),

  /**
   * One competition season -- the unit grants, expenses, and deposits are
   * grouped by. Replaces the free-text `season` string columns with a real
   * row, so a season can be renamed once instead of in every record.
   */
  seasons: defineTable({
    label: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    /** At most one season is current at a time; the app reads this to default forms. */
    isCurrent: v.boolean(),
  }).index("by_is_current", ["isCurrent"]),

  /**
   * A person or entity who gave money or goods, tracked separately from
   * `contacts` (a sponsor's point of contact) and `users` (a team member).
   * Ledger rows point here instead of carrying a free-text donor name.
   */
  donors: defineTable({
    displayName: v.string(),
    /** Lowercased/trimmed `displayName`, so the same donor entered twice is caught. */
    normalizedKey: v.string(),
    isAnonymous: v.boolean(),
  }).index("by_normalized_key", ["normalizedKey"]),

  /**
   * One row per sponsor per year of outreach, replacing the `annualHistory`
   * array that used to live inline on `sponsors`.
   */
  sponsorOutreach: defineTable({
    sponsorId: v.id("sponsors"),
    year: v.number(),
    status: outreachStatusValidator,
    amount: v.optional(v.number()),
    notes: v.optional(v.string()),
    contactedDate: v.optional(v.string()),
  })
    .index("by_sponsor_id", ["sponsorId"])
    .index("by_year", ["year"]),
});
