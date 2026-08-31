/**
 * The shapes the client actually receives.
 *
 * Every read interface in this file describes a **wire projection**, not a
 * stored row. No Convex list query returns a document any more: each one
 * rebuilds every row from an explicit allowlist (see PUBLIC_DATA in
 * `convex/auth.ts`), so the schema and these interfaces are deliberately
 * different shapes and neither is derivable from the other.
 *
 * Three consequences that catch people out:
 *
 *  - **Person ids never cross the wire.** `requesterId`, `purchaserId`,
 *    `assigneeId`, `loggedById`, `setById`, `updatedById`, `userId` and
 *    friends are stripped server-side. What a signed-in member gets instead
 *    is a resolved display name under a `*Name` key. Adding one of the id
 *    fields back here to silence a type error re-opens the leak the branch
 *    closed -- the query would still not send it.
 *  - **`*Name` fields are optional on the public queries.** They resolve only
 *    for a signed-in member and are absent for a stranger. A component that
 *    renders one has to handle its absence.
 *  - **`createdAt` comes from Convex's `_creationTime`,** not a stored
 *    column, and `AuditLog.timestamp` likewise.
 *
 * `src/lib/types.contract.test.ts` asserts each query's element type is
 * assignable to the interface here. If you change a projection, that file is
 * what tells you. `convex/validators.ts` mirrors the string-literal unions;
 * keep schema, validators and this file in step.
 *
 * Ids are plain `string` here, not the branded `Id<"table">` the generated
 * API uses. `Id<T>` is a branded string, so it is assignable *to* `string`
 * and the contract assertions hold either way; narrowing back happens at the
 * mutation boundary (`asId` in `cacaoStore.svelte.ts`), not here.
 */

/**
 * Where a grant sits. The first four are columns on the board -- work in
 * progress. The last three are outcomes: a grant reaches one by being
 * finished, which takes it off the board and into the archive. Tracking the
 * outcome in `status` rather than as a separate archived flag keeps one
 * answer to "where is this grant", instead of two that can disagree.
 */
export type GrantStatus =
  | 'backlog'
  | 'drafting'
  | 'awaiting_approval'
  | 'submitted'
  | 'awarded'
  | 'declined'
  | 'dropped';

/** The three ways a grant can be finished. */
export type GrantOutcome = Extract<GrantStatus, 'awarded' | 'declined' | 'dropped'>;

export const GRANT_OUTCOMES: GrantOutcome[] = ['awarded', 'declined', 'dropped'];

export const GRANT_OUTCOME_META: Record<
  GrantOutcome,
  { label: string; tone: Tone; note: string }
> = {
  awarded: {
    label: 'Awarded',
    tone: 'success',
    note: 'Funded. Records the money as a deposit into the Region 15 account.'
  },
  declined: {
    label: 'Declined',
    tone: 'error',
    note: 'We applied and the funder said no.'
  },
  dropped: {
    label: 'Dropped',
    tone: 'neutral',
    note: 'We stopped pursuing it — ineligible, missed the deadline, not worth it.'
  }
};

export function isGrantOutcome(status: GrantStatus): status is GrantOutcome {
  return status === 'awarded' || status === 'declined' || status === 'dropped';
}

export type DeadlineType = 'fixed' | 'rolling' | 'tbd';

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface RequirementItem {
  id: string;
  title: string;
  done: boolean;
}

/** What `api.grants.list` and `api.grants.getById` emit. */
export interface Grant {
  _id: string;
  title: string;
  funder: string;
  amount: number;
  currency: string;
  status: GrantStatus;
  deadline?: string; // YYYY-MM-DD
  deadlineType: DeadlineType;
  deadlineNote?: string;
  priority: Priority;
  /**
   * The season row this grant belongs to. Do NOT fall back to matching the
   * year out of `deadline`, which is not the same thing -- a rolling or
   * to-be-determined deadline has no year at all.
   */
  seasonId: string;
  /**
   * The season *label* (`YYYY-YYYY`), resolved from `seasonId` server-side --
   * symmetric with `Expense.season` and `IncomeDeposit.season`. A grant's
   * season is human-set authoritative data just as theirs is: it is a
   * free-text field somebody typed, and it is routinely not the year the
   * deadline falls in. Filter grants on this label, which is the shape the
   * store's `seasonKey` already speaks; comparing `seasonId` would need
   * label->id plumbing to reach the same answer.
   *
   * `""` only for a dangling `seasonId` (the season row was deleted).
   */
  season: string;
  portalUrl?: string;
  docUrl?: string;
  fileNote?: string;
  requirements: RequirementItem[];
  notes?: string;
  order: number;
  /**
   * What the funder actually gave, which is rarely the figure that was asked
   * for. `amount` stays the ask, so the board can go on showing the size of
   * the opportunity while the archive shows what came of it.
   */
  awardedAmount?: number;
  /** The day the money was received; drives the deposit's date and season. */
  awardedDate?: string;
  /** The deposit this award created, so it is traceable and never made twice. */
  linkedDepositId?: string;
  finishedAt?: number;
  updatedAt: number;
  /**
   * Resolved server-side from `assigneeId`, which never leaves the server.
   * Absent for a stranger, and absent for a member when the grant is
   * unassigned -- the two cases are not distinguishable client-side.
   */
  assigneeName?: string;
  /** Resolved server-side from `finishedById`. Absent for a stranger. */
  finishedByName?: string;
  /**
   * The assignee's `users` row id -- emitted to a signed-in member only, on
   * the same gate as `assigneeName`, and never to a stranger (opaque ids on a
   * public query still let anyone correlate which grants share an assignee).
   *
   * Both this and the name, because they answer different questions:
   * `assigneeName` is what a card renders, this is what `grants.update` takes
   * back. Without it a client could set an assignee and never read who was
   * assigned, so an edit form could not pre-select the current value and an
   * assignee could be set but never cleared. To clear one, send
   * `assigneeId: null`; omit the field to leave it alone.
   *
   * There is deliberately no `finishedById` beside `finishedByName`: `finish`
   * stamps that from the actor and no mutation accepts it, so a client could
   * only correlate with it, never send it back.
   */
  assigneeId?: string;
}

export type SponsorCategory = 
  | 'corporate'
  | 'local_business'
  | 'foundation'
  | 'community_partner'
  | 'in_kind_supplier';

export type SponsorTier = 
  | 'platinum'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'panther_partner'
  | 'in_kind'
  | 'none';

export type SponsorStatus = 
  | 'lead'
  | 'contacted'
  | 'in_discussion'
  | 'packet_sent'
  | 'pledged'
  | 'paid_active'
  | 'declined'
  | 'stale_renewal_due';

export interface AnnualOutreachRecord {
  _id: string;
  sponsorId: string;
  year: number; // e.g. 2026
  status: 'contacted' | 'report_sent' | 'pledged' | 'received' | 'declined' | 'pending';
  amount?: number;
  notes?: string;
  contactedDate?: string;
}

/**
 * What `api.sponsors.list` emits.
 *
 * `primaryContactName` / `primaryContactEmail` are gone: an adult's name and
 * email live in the gated `contacts` table now, and a public query must not
 * put them back on the open wire. `primaryContactId` is emitted, but only to
 * a signed-in member -- the same gate `contacts.list` itself sits behind, so
 * it hands a stranger nothing and hands a member only a key to a table they
 * could already read. It is here because without it a client could attach a
 * primary contact through `sponsors.create`/`update` and never read back
 * which one, so an edit form could not pre-select it and a contact could be
 * attached but never detached.
 */
export interface Sponsor {
  _id: string;
  name: string;
  category: SponsorCategory;
  tier: SponsorTier;
  status: SponsorStatus;
  totalDonated: number;
  currentYearPledge?: number;
  lastContactDate?: string;
  nextFollowUpDate?: string;
  website?: string;
  logoUrl?: string;
  address?: string;
  notes?: string;
  updatedAt: number;
  /**
   * The `contacts` row id of this sponsor's point of contact. Signed-in
   * members only; absent for a stranger, and absent for a member when no
   * contact is attached -- the two are not distinguishable client-side. The
   * contact's own details still come from `api.contacts.list`. Send
   * `primaryContactId: null` to detach one; omit the field to leave it alone.
   */
  primaryContactId?: string;
  /**
   * Outreach history. Stored in its own `sponsorOutreach` table since Task 6
   * -- Convex indexes only top-level fields, so as an embedded array "who did
   * we contact in 2024?" could not be asked across sponsors -- but
   * `sponsors.list` still joins it back onto the parent row, so the client
   * shape is unchanged. Writes go to the outreach table, not through here.
   */
  annualHistory: AnnualOutreachRecord[];
}

/**
 * What `api.contacts.list` emits -- the one read query that still returns
 * stored documents rather than an allowlist projection, because the whole
 * table is behind `requireActor` and every column on it is the point. These
 * are adults at sponsor organisations, not students.
 */
export interface Contact {
  _id: string;
  sponsorId?: string;
  name: string;
  title: string;
  email: string;
  phone?: string;
  isPrimary: boolean;
  preferredMethod: 'email' | 'phone' | 'in_person';
  notes?: string;
  lastContactedAt?: number;
  updatedAt: number;
}

/**
 * What `api.donors.list` emits -- a person or organisation who gave money or
 * goods. Distinct from `DonorTotals` in `$lib/finance/donors`, which is a
 * computed roll-up of gifts; this is the stored row those gifts point at.
 *
 * Donor *names* stay public -- spec section 5 rules on that directly ("they
 * are already public on HCB"), and `expenses.list` and `income.list` still
 * emit each gift's `donorName` to a stranger. Enumerating the whole table is a
 * different artifact, so `donors.list` itself is gated on `requireActor`; its
 * one caller, the donor typeahead, is mounted only in writer-only forms.
 * Contrast `Contact`, gated harder still -- an adult at a sponsor organisation
 * gave the team their email and phone, not their name to publish.
 *
 * Clients never send a `donorId`. `income.add`/`update` and
 * `expenses.add`/`update` take a `donorName` string and resolve or create the
 * row server-side, in the same transaction as the gift, so a deposit can
 * never commit with its donor lost. This list exists so a form can offer the
 * names that already exist rather than inventing a near-duplicate spelling.
 */
export interface Donor {
  _id: string;
  displayName: string;
  /**
   * `displayName` reduced by `normalizeDonorName` -- the join key that makes
   * "Ruth & Paul Harrison" and "Ruth and Paul Harrison" one donor. On the
   * wire because the donor report groups by it client-side and must group by
   * the same key the server matched on.
   */
  normalizedKey: string;
  /** HCB's "Anonymous Donor" and friends. Rolls into one bucket, never merged into a named donor. */
  isAnonymous: boolean;
}

export type UserRole = 'admin' | 'student' | 'viewer';

/**
 * What `api.users.listUsers`, `api.users.listRequests` and `api.users.me`
 * emit (`publicUserFields` in `convex/users.ts`).
 *
 * There is no `email`, no `name`, no `imageUrl`, no `gradYear` and no
 * `status`: the schema has no column any of them could come from. A roster row
 * is an opaque Google token identifier plus, once someone asks for edit
 * access, a first name and a single last initial. `approvedById` /
 * `approvedAt` are stored but not projected -- who approved whom is an audit
 * fact, not a roster fact.
 */
export interface User {
  _id: string;
  firstName?: string;
  /**
   * One character, truncated server-side (see `requestEditAccess` in
   * convex/users.ts). Never trust a client to have already done the
   * truncation -- this is the only thing standing between this field and a
   * surname.
   */
  lastInitial?: string;
  /**
   * `firstName` + `lastInitial` joined, e.g. "Levi F", or "Unnamed member"
   * for a viewer who has never asked for edit access. Built server-side so
   * every surface spells a person the same way. Always present.
   */
  displayName: string;
  role: UserRole;
  /** True while an account is awaiting admin approval. */
  requested: boolean;
}


export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'status_change'
  | 'assign'
  | 'requirement_toggle'
  | 'approve_user'
  | 'reject_user'
  | 'graduate_batch'
  | 'outreach_logged'
  | 'import_seed';

export type EntityType = 'grant' | 'sponsor' | 'contact' | 'user' | 'team_info' | 'wishlist' | 'system';

/**
 * What `api.audit.list` emits.
 *
 * The stored `userId` is deliberately not projected: the feed is gated, so the
 * resolved name is always available and is the whole point, while emitting the
 * id alongside it would let a member correlate every edit made by a person
 * whose name they are not otherwise shown. `entityName`, `summary` and
 * `details` no longer exist at all -- an entity is named by resolving
 * `entityId` at read time, which means a *deleted* entity can no longer be
 * named. That loss is accepted, not a bug to fix here.
 */
export interface AuditLog {
  _id: string;
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  /**
   * A single field-level change, not a free-form payload -- an unbounded
   * record here would be exactly the `details: any` column this change
   * deleted, reintroduced under a new name.
   */
  change?: { field: string; from: string; to: string };
  /** From Convex's `_creationTime`; there is no stored timestamp column. */
  timestamp: number;
  /**
   * Resolved from `userId` server-side. Unlike the `*Name` fields on the
   * public queries this is never absent -- the feed requires a signed-in
   * caller, and an unresolvable id reads as "Unknown member".
   */
  actorName: string;
}

/** M3 color role a status maps onto. Keeps view code free of raw colors. */
export type Tone = 'neutral' | 'primary' | 'secondary' | 'tertiary' | 'success' | 'error';

export interface ColumnDefinition {
  /** Board columns are pipeline stages only; outcomes are not draggable. */
  id: BoardGrantStatus;
  title: string;
  description: string;
  tone: Tone;
}

export const GRANT_COLUMNS: ColumnDefinition[] = [
  {
    id: 'backlog',
    title: 'Backlog',
    description: 'Opportunities identified & researching eligibility',
    tone: 'neutral'
  },
  {
    id: 'drafting',
    title: 'Drafting',
    description: 'Writing essays, assembling budget & required files',
    tone: 'secondary'
  },
  {
    id: 'awaiting_approval',
    title: 'Review',
    description: 'Draft completed; mentor review & sign-off needed',
    tone: 'tertiary'
  },
  {
    id: 'submitted',
    title: 'Submitted',
    description: 'Application sent; awaiting decision from committee',
    tone: 'primary'
  },
];

/**
 * Board columns are the pipeline only. A finished grant is not a column you
 * drag into -- it is an outcome you record, because recording an award also
 * has to put the money in the books.
 */
export const GRANT_BOARD_STATUSES: GrantStatus[] = GRANT_COLUMNS.map((c) => c.id);

/** A status a grant can actually be dragged into. */
export type BoardGrantStatus = Exclude<GrantStatus, GrantOutcome>;

/** CSS custom property holding the fill color for a tone (dots, bars, icons). */
export const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--color-outline)',
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  tertiary: 'var(--color-tertiary)',
  success: 'var(--color-success)',
  error: 'var(--color-error)'
};

/**
 * Label + tone for any grant status, so tables, drawers and the archive all
 * agree with the board. Built from the board columns plus the outcomes, which
 * no longer have columns of their own.
 */
export const GRANT_STATUS_META = {
  ...Object.fromEntries(GRANT_COLUMNS.map((c) => [c.id, { label: c.title, tone: c.tone }])),
  ...Object.fromEntries(
    GRANT_OUTCOMES.map((o) => [o, { label: GRANT_OUTCOME_META[o].label, tone: GRANT_OUTCOME_META[o].tone }])
  )
} as Record<GrantStatus, { label: string; tone: Tone }>;

/** Chip class for a tone, matching the `.chip-*` variants in app.css. */
export const TONE_CHIP: Record<Tone, string> = {
  neutral: '',
  primary: 'chip-primary',
  secondary: 'chip-secondary',
  tertiary: 'chip-tertiary',
  success: 'chip-success',
  error: 'chip-error'
};

// ── Expense & Purchase Request Types ────────────────────────────────────────

// Imported as well as re-exported: `export type { X } from '...'` creates no
// local binding, and the Expense interface below needs these names in scope.
import type {
  Account,
  ExpenseAccount,
  ExpenseCategory,
  IncomeCategory
} from '$lib/finance/categories';

export type { Account, ExpenseAccount, ExpenseCategory, IncomeCategory };

export type ExpenseStatus =
  | 'pending_approval'
  | 'approved'
  | 'purchased'
  | 'reimbursed'
  | 'donated'
  | 'rejected';

export type PaymentMethod =
  | 'hcb_card'
  | 'personal_reimbursement'
  | 'school_po'
  | 'grant_voucher'
  | 'cash'
  | 'other';

export type CarrierType = 'UPS' | 'FedEx' | 'USPS' | 'Amazon' | 'DHL' | 'Local Pickup' | 'Other';

export type DeliveryStatus = 'ordered' | 'shipped' | 'delivered';

/**
 * What `api.expenses.list` emits. Structurally a `LedgerExpense` (see
 * `src/lib/finance/ledger.ts`), which is why `season`, `account`, `donorName`
 * and `createdAt` appear under those exact names rather than as the ids the
 * table stores.
 */
export interface Expense {
  _id: string;
  title: string;
  vendor: string;
  amount: number; // Requested estimated amount
  finalPaidAmount?: number; // Actual amount paid after markdown/discounts/shipping
  currency: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  seasonId: string;
  /**
   * The season *label* (`YYYY-YYYY`), resolved from `seasonId` server-side.
   * Both are on the wire and both are needed: `seasonId` is what a mutation
   * takes, `season` is what `buildLedger` filters on.
   *
   * This is the authoritative season for the record -- a human set it -- and
   * `buildLedger` only infers a season from the date when it is missing. That
   * inference is wrong for the ordinary case of a purchase made against one
   * season's budget and invoiced or reimbursed after August. Never make this
   * optional to silence a type error: the empty string is the *only*
   * legitimate absence (a deleted season row), and it deliberately routes
   * that record back through date inference.
   */
  season: string;
  paymentMethod?: PaymentMethod;
  /**
   * Which pot the money left, as the account **key slug** (`hcb_bank` /
   * `school_account`), not the `accounts` row id -- `ledger.ts` compares
   * `e.account === 'hcb_bank'` literally to decide whether a record can
   * dedupe against a live bank transaction. Distinct from `paymentMethod`,
   * which is only *how* it was paid: a grant voucher never touches a team
   * account, and a personal purchase does not either until it is reimbursed.
   * Undefined means not yet determined. Note the deposit side calls the same
   * idea `depositAccount`; the two names are not interchangeable.
   */
  account?: ExpenseAccount;
  /**
   * The calendar day (YYYY-MM-DD) the money actually moved, as asserted by a
   * human. The timestamps at the bottom of this interface are audit trail --
   * when the request was filed, when someone pressed "mark bought" -- which is
   * often days from the real transaction. Absent until the purchase actually
   * happens -- a pending request has no transaction day to assert.
   */
  date?: string;
  orderNumber?: string; // e.g. AM-104928, WCP-4491
  /** Admin-only: a tracking number looked up on a carrier's site often reveals an address. */
  trackingNumber?: string;
  /** Admin-only, for the same reason as `trackingNumber`. */
  carrier?: CarrierType;
  expectedDeliveryDate?: string;
  deliveryStatus?: DeliveryStatus;
  /** Admin-only: a receipt image usually carries a buyer's name. */
  receiptUrl?: string;
  itemLink?: string;
  notes?: string;
  /**
   * The donor's display name, resolved from `donorId`. Set when the purchaser
   * waived reimbursement, making this an in-kind gift. Donor names are public
   * -- they are already public on HCB -- so unlike the `*Name` fields below
   * this one resolves for a stranger too.
   */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to the entry date. */
  taxYear?: number;
  linkedGrantId?: string;
  approvedAt?: number;
  purchasedAt?: number;
  receivedAt?: number;
  reimbursedAt?: number;
  updatedAt: number;
  /**
   * When the row was created, sourced from Convex's `_creationTime` rather
   * than a stored column. `src/lib/finance/balances.ts` and `ledger.ts` fall
   * back to it when neither `date` nor `purchasedAt` is set.
   */
  createdAt: number;
  /**
   * Resolved from `requesterId`, which never leaves the server. Absent for a
   * stranger -- the money is public, the person who asked for it is not.
   */
  requesterName?: string;
  /** Resolved from `purchaserId`. Absent for a stranger, and for an unpurchased request. */
  purchaserName?: string;
}

// ── Fundraiser & Income Deposit Types ────────────────────────────────────────

/** Kept as an alias so existing deposit code reads naturally. */
export type DepositAccount = Account;

/**
 * What `api.income.list` emits. Structurally a `LedgerDeposit` (see
 * `src/lib/finance/ledger.ts`).
 */
export interface IncomeDeposit {
  _id: string;
  title: string;
  amount: number;
  category: IncomeCategory;
  /**
   * The account **key slug**, not the `accounts` row id, and named
   * `depositAccount` rather than `account` because that is the name
   * `LedgerDeposit`/`BalanceDeposit` read -- `claimsHcb: d.depositAccount ===
   * 'hcb_bank'` goes silently false under any other spelling, and the deposit
   * then double-counts against the bank transaction that recorded it.
   *
   * Required, not optional. The server resolves it through a map, whose
   * `.get` is typed `| undefined` by signature -- but `incomeDeposits.
   * accountId` is a required `v.id("accounts")` and `income.add`/`update`
   * confirm the account row exists before writing the reference, so a stored
   * deposit cannot name an account that is not there.
   *
   * Do not restate this as "no delete mutation for `accounts` exists": that
   * claim was here, and it was false. `seed.importAll` wipes and re-creates
   * every account with a fresh `_id`, and a `v.id()` validator checks the
   * table and not the row -- which is exactly how a stale id used to get
   * written. The guarantee lives on the write path, not in the absence of a
   * delete.
   *
   * `income.list` still throws on a miss rather than emitting `undefined`,
   * because an optional here is not neutral: it makes `claimsHcb` go false
   * for the missing case and double-counts the deposit against the bank
   * transaction that recorded it. Loud beats silently mis-deduped.
   */
  depositAccount: DepositAccount;
  date: string; // YYYY-MM-DD
  seasonId: string;
  /**
   * The season *label* (`YYYY-YYYY`), resolved from `seasonId` server-side.
   * Authoritative: an awarded grant's deposit belongs to the season the grant
   * was applied for, not the season the money landed in, and grant money
   * routinely arrives a season late. `buildLedger` only falls back to
   * inferring the season from `date` when this is missing, so making it
   * optional to silence a type error silently refiles awards under the wrong
   * year. The empty string is the only legitimate absence (a deleted season).
   */
  season: string;
  /** Admin-only: a deposit slip or receipt image usually carries a name. */
  receiptUrl?: string;
  notes?: string;
  /**
   * The donor's display name, resolved from `donorId`. Set when this deposit
   * is attributable to a named donor, e.g. a check. Public, like the money.
   */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to `date`. */
  taxYear?: number;
  updatedAt: number;
  /** Resolved from `loggedById`, which never leaves the server. Absent for a stranger. */
  loggedByName?: string;
}

// ── Hack Club Bank (HCB) API Types ──────────────────────────────────────────

export interface HCBUser {
  id: string;
  full_name: string;
  photo?: string;
  admin?: boolean;
}

export interface HCBBalances {
  balance_cents: number;
  fee_balance_cents: number;
  incoming_balance_cents: number;
  total_raised: number;
}

export interface HCBOrganization {
  id: string;
  name: string;
  slug: string;
  website?: string;
  category?: string;
  transparent: boolean;
  balances: HCBBalances;
  logo?: string;
  donation_link?: string;
  users?: HCBUser[];
  created_at?: string;
}

/**
 * The team's own category for a Hack Club Bank transaction whose memo the
 * automatic rules could not classify (or classified wrongly). Keyed by HCB's
 * transaction id; the absence of a row means "classify it automatically".
 */
export interface HcbCategoryRow {
  /**
   * Optional only because the store builds an optimistic row before the
   * server has assigned one. `hcbCategories.list` always emits it.
   */
  _id?: string;
  hcbTransactionId: string;
  direction: 'in' | 'out';
  /**
   * Deliberately wider than the two taxonomies: a filing outlives any given
   * version of them, so `resolveHcbCategory` in `ledger.ts` re-checks each
   * value against the direction the money actually moved before trusting it.
   */
  category: string;
  updatedAt: number;
  /** Resolved from `setById`, which never leaves the server. Absent for a stranger. */
  setByName?: string;
}

// ── Seasons ─────────────────────────────────────────────────────────────────

/**
 * What `api.seasons.list` emits, newest first.
 *
 * A season carries no personal data, so this is the one list with no gate and
 * no actor resolution behind it. `label` is `YYYY-YYYY` -- the format
 * `seasonDateRange` in `src/lib/finance/dates.ts` parses, and the same string
 * that arrives as `season` on an expense or a deposit.
 */
export interface Season {
  _id: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** At most one season is current at a time; forms default to it. */
  isCurrent: boolean;
}

export interface HCBTransaction {
  id: string;
  amount_cents: number;
  memo: string;
  date: string;
  type: string;
  pending: boolean;
  receipts?: {
    count: number;
    missing: boolean;
  };
  user?: HCBUser | null;
  card_charge?: {
    id: string;
    href: string;
  };
}

/**
 * A donation as reported by `/organizations/{slug}/donations`. Its `date` is
 * when the donor gave, which is not the transaction's settlement date -- at a
 * year boundary they fall on opposite sides, and the donation date is the one
 * that matches what the donor believes.
 */
export interface HCBDonation {
  id: string;
  amount_cents: number;
  date: string;
  donor?: { name?: string; anonymous?: boolean } | null;
  transaction?: { id: string } | null;
}


// ── Team Info & Wishlist ────────────────────────────────────────────────────

/**
 * One fact grant applications ask for. Modelled as a list of label/value rows
 * rather than a record with fixed columns because applications keep asking for
 * things nobody anticipated, and a row is cheaper to add than a migration.
 */
export interface TeamInfoField {
  _id: string;
  label: string;
  value: string;
  /** Display position; the list is hand-ordered, not sorted. */
  order: number;
  updatedAt: number;
  /**
   * No `updatedById` and no resolved name: `teamInfo.list` is public and
   * projects neither. The EIN is the public fact; who typed it in is not.
   * `auditLogs` records that.
   */
}

/** How the team expects to pay for a wishlist item. */
export type WishlistSource = 'grant' | 'purchase';

export interface WishlistItem {
  _id: string;
  tool: string;
  /** Vendor or maker. Free text -- "N/A" is a legitimate answer. */
  company?: string;
  cost: number;
  source: WishlistSource;
  /** 1-10 as the team scores it, 10 being most wanted. */
  priority: number;
  description?: string;
  itemLink?: string;
  updatedAt: number;
}

export const WISHLIST_SOURCE_META: Record<WishlistSource, { label: string; tone: Tone }> = {
  grant: { label: 'Grant funded', tone: 'tertiary' },
  purchase: { label: 'Direct purchase', tone: 'secondary' }
};
