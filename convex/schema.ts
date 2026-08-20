import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { auditActionValidator } from "./validators";

export default defineSchema({
  grants: defineTable({
    title: v.string(),
    funder: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal("backlog"),
      v.literal("drafting"),
      v.literal("awaiting_approval"),
      v.literal("submitted"),
      v.literal("awarded"),
      v.literal("rejected")
    ),
    deadline: v.optional(v.string()),
    deadlineType: v.union(v.literal("fixed"), v.literal("rolling"), v.literal("tbd")),
    deadlineNote: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    assigneeName: v.optional(v.string()),
    priority: v.union(v.literal("urgent"), v.literal("high"), v.literal("medium"), v.literal("low")),
    season: v.string(),
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
    createdAt: v.number(),
    updatedAt: v.number(),
    lastModifiedBy: v.string(),
  })
    .index("by_status", ["status"])
    .index("by_season", ["season"])
    .index("by_assignee", ["assigneeName"]),

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
    annualHistory: v.array(
      v.object({
        year: v.number(),
        status: v.union(
          v.literal("contacted"),
          v.literal("report_sent"),
          v.literal("pledged"),
          v.literal("received"),
          v.literal("declined"),
          v.literal("pending")
        ),
        amount: v.optional(v.number()),
        notes: v.optional(v.string()),
        contactedDate: v.optional(v.string()),
      })
    ),
    primaryContactName: v.optional(v.string()),
    primaryContactEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastModifiedBy: v.string(),
  })
    .index("by_tier", ["tier"])
    .index("by_status", ["status"]),

  contacts: defineTable({
    sponsorId: v.optional(v.string()),
    sponsorName: v.optional(v.string()),
    name: v.string(),
    title: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    isPrimary: v.boolean(),
    preferredMethod: v.union(v.literal("email"), v.literal("phone"), v.literal("in_person")),
    notes: v.optional(v.string()),
    lastContactedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_sponsor", ["sponsorId"]),

  users: defineTable({
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
    gradYear: v.optional(v.number()),
    subteam: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("pending"), v.literal("graduated"), v.literal("rejected")),
    requestReason: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
    lastActiveAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  accessRequests: defineTable({
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
  }).index("by_status", ["status"]),

  auditLogs: defineTable({
    timestamp: v.number(),
    actorName: v.string(),
    actorEmail: v.string(),
    actorRole: v.union(v.literal("admin"), v.literal("student"), v.literal("viewer"), v.literal("graduated")),
    action: auditActionValidator,
    entityType: v.union(v.literal("grant"), v.literal("sponsor"), v.literal("contact"), v.literal("user"), v.literal("system")),
    entityId: v.string(),
    entityName: v.string(),
    summary: v.string(),
    details: v.optional(v.any()),
  }).index("by_timestamp", ["timestamp"]),

  expenses: defineTable({
    title: v.string(),
    vendor: v.string(),
    amount: v.number(),
    finalPaidAmount: v.optional(v.number()),
    currency: v.string(),
    category: v.union(
      v.literal("robot_parts"),
      v.literal("electronics"),
      v.literal("tools"),
      v.literal("travel"),
      v.literal("registration"),
      v.literal("food"),
      v.literal("media"),
      v.literal("general")
    ),
    subteam: v.string(),
    requesterName: v.string(),
    requesterEmail: v.string(),
    status: v.union(
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("purchased"),
      v.literal("reimbursed"),
      v.literal("rejected")
    ),
    season: v.string(),
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
    purchaserName: v.optional(v.string()),
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
    linkedGrantId: v.optional(v.string()),
    linkedGrantTitle: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    purchasedAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
    reimbursedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_season", ["season"])
    .index("by_subteam", ["subteam"]),

  incomeDeposits: defineTable({
    title: v.string(),
    amount: v.number(),
    category: v.union(
      v.literal("fundraiser"),
      v.literal("donation"),
      v.literal("merch_sales"),
      v.literal("bottle_can_drive"),
      v.literal("camp_registration"),
      v.literal("sponsorship_check"),
      v.literal("other_income")
    ),
    depositAccount: v.union(
      v.literal("hcb_bank"),
      v.literal("school_account"),
      v.literal("cash_box")
    ),
    date: v.string(),
    loggedByName: v.string(),
    loggedByEmail: v.string(),
    season: v.string(),
    receiptUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_account", ["depositAccount"])
    .index("by_season", ["season"]),
});
