import { v } from "convex/values";

/**
 * Shared validators. These mirror the unions in `schema.ts` and the string
 * literal types in `src/lib/types.ts`; keep all three in step.
 */

export const roleValidator = v.union(
  v.literal("admin"),
  v.literal("student"),
  v.literal("viewer")
);

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

/**
 * The first four are board columns; the last three are outcomes a grant
 * reaches by being finished. `rejected` was the old name for `declined`, and
 * carried no way to say "we stopped pursuing it" -- which is a different
 * thing from a funder saying no.
 */
export const grantStatusValidator = v.union(
  v.literal("backlog"),
  v.literal("drafting"),
  v.literal("awaiting_approval"),
  v.literal("submitted"),
  v.literal("awarded"),
  v.literal("declined"),
  v.literal("dropped")
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

export const preferredMethodValidator = v.union(
  v.literal("email"),
  v.literal("phone"),
  v.literal("in_person")
);

export const expenseCategoryValidator = v.union(
  v.literal("robot_parts"),
  v.literal("tools_shop"),
  v.literal("registration_fees"),
  v.literal("competition_travel"),
  v.literal("outreach_events"),
  v.literal("team_operations"),
  v.literal("uncategorized")
);

export const expenseStatusValidator = v.union(
  v.literal("pending_approval"),
  v.literal("approved"),
  v.literal("purchased"),
  v.literal("reimbursed"),
  v.literal("donated"),
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
  v.literal("grants"),
  v.literal("sponsorships"),
  v.literal("major_donors"),
  v.literal("community_donations"),
  v.literal("fundraising"),
  v.literal("in_kind_gifts"),
  v.literal("uncategorized")
);

/**
 * Any category a ledger entry can carry, income or spend. Spelled out flat
 * rather than as `v.union(incomeCategoryValidator, expenseCategoryValidator)`
 * because both of those contain `uncategorized`, and a union with a duplicate
 * member is a trap for the next person reading it. Which side of the taxonomy
 * a value belongs to is checked where it is used, not here.
 */
export const ledgerCategoryValidator = v.union(
  v.literal("grants"),
  v.literal("sponsorships"),
  v.literal("major_donors"),
  v.literal("community_donations"),
  v.literal("fundraising"),
  v.literal("in_kind_gifts"),
  v.literal("robot_parts"),
  v.literal("tools_shop"),
  v.literal("registration_fees"),
  v.literal("competition_travel"),
  v.literal("outreach_events"),
  v.literal("team_operations"),
  v.literal("uncategorized")
);

/**
 * How the team expects to fund a wishlist item. Mirrors the "Source" column of
 * the team's wishlist sheet, which only ever holds these two answers.
 */
export const wishlistSourceValidator = v.union(
  v.literal("grant"),
  v.literal("purchase")
);

/**
 * The two places team money sits. Cash collected at fundraisers is banked into
 * the school account, so there is no separate cash-on-hand pot. Mirrors
 * `Account` in `src/lib/finance/categories.ts`.
 */
export const accountKeyValidator = v.union(
  v.literal("hcb_bank"),
  v.literal("school_account")
);

/** Mirrors the inline union on `auditLogs.entityType` in `schema.ts`. */
export const entityTypeValidator = v.union(
  v.literal("grant"),
  v.literal("sponsor"),
  v.literal("contact"),
  v.literal("user"),
  v.literal("team_info"),
  v.literal("wishlist"),
  v.literal("system")
);
