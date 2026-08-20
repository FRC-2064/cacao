import { v } from "convex/values";

/**
 * Shared validators. These mirror the unions in `schema.ts` and the string
 * literal types in `src/lib/types.ts`; keep all three in step.
 */

export const roleValidator = v.union(
  v.literal("admin"),
  v.literal("student"),
  v.literal("viewer"),
  v.literal("graduated")
);

/** Every mutation records who did it, so the audit log never has a blank actor. */
export const actorArgs = {
  actorName: v.string(),
  actorEmail: v.string(),
  actorRole: roleValidator,
};

/** Mirrors `AuditAction` in src/lib/types.ts. */
export const auditActionValidator = v.union(
  v.literal("create"),
  v.literal("update"),
  v.literal("delete"),
  v.literal("status_change"),
  v.literal("assign"),
  v.literal("requirement_toggle"),
  v.literal("approve_user"),
  v.literal("reject_user"),
  v.literal("graduate_batch"),
  v.literal("outreach_logged"),
  v.literal("import_seed")
);

export const grantStatusValidator = v.union(
  v.literal("backlog"),
  v.literal("drafting"),
  v.literal("awaiting_approval"),
  v.literal("submitted"),
  v.literal("awarded"),
  v.literal("rejected")
);

export const deadlineTypeValidator = v.union(
  v.literal("fixed"),
  v.literal("rolling"),
  v.literal("tbd")
);

export const priorityValidator = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low")
);

export const requirementValidator = v.object({
  id: v.string(),
  title: v.string(),
  done: v.boolean(),
});

export const sponsorCategoryValidator = v.union(
  v.literal("corporate"),
  v.literal("local_business"),
  v.literal("foundation"),
  v.literal("community_partner"),
  v.literal("in_kind_supplier")
);

export const sponsorTierValidator = v.union(
  v.literal("platinum"),
  v.literal("gold"),
  v.literal("silver"),
  v.literal("bronze"),
  v.literal("panther_partner"),
  v.literal("in_kind"),
  v.literal("none")
);

export const sponsorStatusValidator = v.union(
  v.literal("lead"),
  v.literal("contacted"),
  v.literal("in_discussion"),
  v.literal("packet_sent"),
  v.literal("pledged"),
  v.literal("paid_active"),
  v.literal("declined"),
  v.literal("stale_renewal_due")
);

export const outreachStatusValidator = v.union(
  v.literal("contacted"),
  v.literal("report_sent"),
  v.literal("pledged"),
  v.literal("received"),
  v.literal("declined"),
  v.literal("pending")
);

export const annualHistoryValidator = v.object({
  year: v.number(),
  status: outreachStatusValidator,
  amount: v.optional(v.number()),
  notes: v.optional(v.string()),
  contactedDate: v.optional(v.string()),
});

export const preferredMethodValidator = v.union(
  v.literal("email"),
  v.literal("phone"),
  v.literal("in_person")
);

export const expenseCategoryValidator = v.union(
  v.literal("robot_parts"),
  v.literal("electronics"),
  v.literal("tools"),
  v.literal("travel"),
  v.literal("registration"),
  v.literal("food"),
  v.literal("media"),
  v.literal("general")
);

export const expenseStatusValidator = v.union(
  v.literal("pending_approval"),
  v.literal("approved"),
  v.literal("purchased"),
  v.literal("reimbursed"),
  v.literal("rejected")
);

export const paymentMethodValidator = v.union(
  v.literal("hcb_card"),
  v.literal("personal_reimbursement"),
  v.literal("school_po"),
  v.literal("grant_voucher"),
  v.literal("cash"),
  v.literal("other")
);

export const carrierValidator = v.union(
  v.literal("UPS"),
  v.literal("FedEx"),
  v.literal("USPS"),
  v.literal("Amazon"),
  v.literal("DHL"),
  v.literal("Local Pickup"),
  v.literal("Other")
);

export const deliveryStatusValidator = v.union(
  v.literal("ordered"),
  v.literal("shipped"),
  v.literal("delivered")
);

export const incomeCategoryValidator = v.union(
  v.literal("fundraiser"),
  v.literal("donation"),
  v.literal("merch_sales"),
  v.literal("bottle_can_drive"),
  v.literal("camp_registration"),
  v.literal("sponsorship_check"),
  v.literal("other_income")
);

export const depositAccountValidator = v.union(
  v.literal("hcb_bank"),
  v.literal("school_account"),
  v.literal("cash_box")
);

export const userStatusValidator = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("graduated"),
  v.literal("rejected")
);
