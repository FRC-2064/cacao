export type GrantStatus = 
  | 'backlog'
  | 'drafting'
  | 'awaiting_approval'
  | 'submitted'
  | 'awarded'
  | 'rejected';

export type DeadlineType = 'fixed' | 'rolling' | 'tbd';

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface RequirementItem {
  id: string;
  title: string;
  done: boolean;
}

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
  assigneeId?: string;
  assigneeName?: string;
  priority: Priority;
  season: string; // e.g. "2026-2027"
  portalUrl?: string;
  docUrl?: string;
  fileNote?: string;
  requirements: RequirementItem[];
  notes?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
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
  year: number; // e.g. 2026
  status: 'contacted' | 'report_sent' | 'pledged' | 'received' | 'declined' | 'pending';
  amount?: number;
  notes?: string;
  contactedDate?: string;
}

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
  annualHistory: AnnualOutreachRecord[];
  primaryContactName?: string;
  primaryContactEmail?: string;
  createdAt: number;
  updatedAt: number;
  lastModifiedBy: string;
}

export interface Contact {
  _id: string;
  sponsorId?: string;
  sponsorName?: string;
  name: string;
  title: string;
  email: string;
  phone?: string;
  isPrimary: boolean;
  preferredMethod: 'email' | 'phone' | 'in_person';
  notes?: string;
  lastContactedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type UserRole = 'admin' | 'student' | 'viewer' | 'graduated';
export type UserStatus = 'active' | 'pending' | 'graduated' | 'rejected';

export interface User {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  gradYear?: number;
  subteam?: string;
  status: UserStatus;
  requestReason?: string;
  approvedBy?: string;
  approvedAt?: number;
  createdAt: number;
  lastActiveAt?: number;
}

export interface AccessRequest {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  gradYear: number;
  subteam: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
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

export interface AuditLog {
  _id: string;
  timestamp: number;
  actorName: string;
  actorEmail: string;
  actorRole: UserRole;
  action: AuditAction;
  entityType: 'grant' | 'sponsor' | 'contact' | 'user' | 'system';
  entityId: string;
  entityName: string;
  summary: string;
  details?: Record<string, any>;
}

/** M3 color role a status maps onto. Keeps view code free of raw colors. */
export type Tone = 'neutral' | 'primary' | 'secondary' | 'tertiary' | 'success' | 'error';

export interface ColumnDefinition {
  id: GrantStatus;
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
  {
    id: 'awarded',
    title: 'Awarded',
    description: 'Grant approved! Check/credit received by team',
    tone: 'success'
  },
  {
    id: 'rejected',
    title: 'Closed',
    description: 'Not funded or closed for this competition cycle',
    tone: 'error'
  }
];

/** CSS custom property holding the fill color for a tone (dots, bars, icons). */
export const TONE_VAR: Record<Tone, string> = {
  neutral: 'var(--color-outline)',
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  tertiary: 'var(--color-tertiary)',
  success: 'var(--color-success)',
  error: 'var(--color-error)'
};

/** Label + tone for a grant status, so tables and drawers agree with the board. */
export const GRANT_STATUS_META = Object.fromEntries(
  GRANT_COLUMNS.map((c) => [c.id, { label: c.title, tone: c.tone }])
) as Record<GrantStatus, { label: string; tone: Tone }>;

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

export type ExpenseCategory =
  | 'robot_parts'
  | 'electronics'
  | 'tools'
  | 'travel'
  | 'registration'
  | 'food'
  | 'media'
  | 'general';

export type ExpenseStatus =
  | 'pending_approval'
  | 'approved'
  | 'purchased'
  | 'reimbursed'
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

export interface Expense {
  _id: string;
  title: string;
  vendor: string;
  amount: number; // Requested estimated amount
  finalPaidAmount?: number; // Actual amount paid after markdown/discounts/shipping
  currency: string;
  category: ExpenseCategory;
  subteam: string;
  requesterName: string;
  requesterEmail: string;
  status: ExpenseStatus;
  season: string;
  paymentMethod?: PaymentMethod;
  purchaserName?: string; // Mentor/student who placed the order or cardholder
  orderNumber?: string; // e.g. AM-104928, WCP-4491
  trackingNumber?: string;
  carrier?: CarrierType;
  expectedDeliveryDate?: string;
  deliveryStatus?: DeliveryStatus;
  receiptUrl?: string;
  itemLink?: string;
  notes?: string;
  linkedGrantId?: string;
  linkedGrantTitle?: string;
  approvedBy?: string;
  approvedAt?: number;
  purchasedAt?: number;
  receivedAt?: number;
  reimbursedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ── Fundraiser & Income Deposit Types ────────────────────────────────────────

export type IncomeCategory =
  | 'fundraiser'
  | 'donation'
  | 'merch_sales'
  | 'bottle_can_drive'
  | 'camp_registration'
  | 'sponsorship_check'
  | 'other_income';

export type DepositAccount = 'hcb_bank' | 'school_account' | 'cash_box';

export interface IncomeDeposit {
  _id: string;
  title: string;
  amount: number;
  category: IncomeCategory;
  depositAccount: DepositAccount;
  date: string; // YYYY-MM-DD
  loggedByName: string;
  loggedByEmail: string;
  season: string;
  receiptUrl?: string; // Deposit slip / stripe / square / receipt link
  notes?: string;
  createdAt: number;
  updatedAt: number;
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

