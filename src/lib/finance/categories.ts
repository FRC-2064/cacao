/**
 * The finance taxonomy, and every rule for getting a record into it.
 *
 * This module is the source of truth for categories. `src/lib/types.ts` and the
 * Convex validators re-state these unions because Convex needs literal
 * validators at the schema boundary; if you change a union here, change it in
 * `convex/validators.ts` and `convex/schema.ts` too.
 */

/**
 * The two places team money actually sits. Cash collected at a pail shake or a
 * bottle drive is counted as school-account money from the moment it is
 * banked -- it is always moved there -- so a separate cash-on-hand pot would
 * only ever be a staging area someone forgot to empty.
 */
export type Account = 'hcb_bank' | 'school_account';

/** An expense may also draw on nothing at all — a voucher, or an unrepaid personal purchase. */
export type ExpenseAccount = Account | 'none';

export type IncomeCategory =
  | 'grants'
  | 'sponsorships'
  | 'major_donors'
  | 'community_donations'
  | 'fundraising'
  | 'in_kind_gifts'
  | 'uncategorized';

export type ExpenseCategory =
  | 'robot_parts'
  | 'tools_shop'
  | 'registration_fees'
  | 'competition_travel'
  | 'outreach_events'
  | 'team_operations'
  | 'uncategorized';

/** A single gift at or above this many dollars is a major donor. */
export const MAJOR_DONOR_THRESHOLD = 250;

export interface CategoryMeta {
  label: string;
  note: string;
  /** CSS custom property for this category's ribbon in the Sankey. */
  flow: string;
}

export const INCOME_CATEGORY_META: Record<IncomeCategory, CategoryMeta> = {
  grants: { label: 'Grants', note: 'Awarded grants', flow: 'var(--color-flow-1)' },
  sponsorships: { label: 'Sponsorships', note: 'Corporate and local partners', flow: 'var(--color-flow-2)' },
  major_donors: { label: 'Major donors', note: `Single gifts of $${MAJOR_DONOR_THRESHOLD} or more`, flow: 'var(--color-flow-3)' },
  community_donations: { label: 'Community donations', note: 'Parents, boosters, small gifts', flow: 'var(--color-flow-4)' },
  fundraising: { label: 'Fundraising', note: 'Can drives, merch, camps, bake sales', flow: 'var(--color-flow-5)' },
  in_kind_gifts: { label: 'In-kind gifts', note: 'Purchases donated instead of reimbursed', flow: 'var(--color-flow-12)' },
  uncategorized: { label: 'Uncategorized', note: 'Bank activity we could not classify', flow: 'var(--color-flow-muted)' }
};

export const EXPENSE_CATEGORY_META: Record<ExpenseCategory, CategoryMeta> = {
  robot_parts: { label: 'Robot & parts', note: 'Mechanical, electrical, COTS', flow: 'var(--color-flow-6)' },
  tools_shop: { label: 'Tools & shop', note: 'Tooling, machinery, consumables', flow: 'var(--color-flow-7)' },
  registration_fees: { label: 'Registration & fees', note: 'FIRST, district events, insurance', flow: 'var(--color-flow-8)' },
  competition_travel: { label: 'Competition travel', note: 'Lodging, buses, food, fuel', flow: 'var(--color-flow-9)' },
  outreach_events: { label: 'Outreach & events', note: 'Demos, camps, community events', flow: 'var(--color-flow-10)' },
  team_operations: { label: 'Team operations', note: 'Apparel, banners, software, bank fees', flow: 'var(--color-flow-11)' },
  uncategorized: { label: 'Uncategorized', note: 'Bank activity we could not classify', flow: 'var(--color-flow-muted)' }
};

/**
 * Grants and sponsorships are recorded on their own tabs. Offering them here
 * too would let the same dollar be entered twice.
 */
export const DEPOSIT_FORM_CATEGORIES: IncomeCategory[] = [
  'major_donors',
  'community_donations',
  'fundraising'
];

export function isIncomeCategory(id: string): id is IncomeCategory {
  return id in INCOME_CATEGORY_META;
}

export function isExpenseCategory(id: string): id is ExpenseCategory {
  return id in EXPENSE_CATEGORY_META;
}

/**
 * What a human may assign to an unmatched bank transaction that came in.
 * `grants` is absent because grant money is paid to the school account or the
 * FIRST dashboard and never lands in HCB, so offering it here would only
 * create a way to misfile a donation. `uncategorized` is absent because it is
 * not a choice -- clearing the assignment is what returns a transaction to the
 * automatic classification.
 */
export const HCB_INCOME_CATEGORIES: IncomeCategory[] = [
  'sponsorships',
  'major_donors',
  'community_donations',
  'fundraising'
];

/** What a human may assign to an unmatched bank transaction that went out. */
export const HCB_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'robot_parts',
  'tools_shop',
  'registration_fees',
  'competition_travel',
  'outreach_events',
  'team_operations'
];

export const EXPENSE_FORM_CATEGORIES: ExpenseCategory[] = [
  'robot_parts',
  'tools_shop',
  'registration_fees',
  'competition_travel',
  'outreach_events',
  'team_operations'
];

export const ACCOUNT_META: Record<Account, { label: string; note: string }> = {
  hcb_bank: { label: 'Hack Club Bank', note: 'the-panther-project' },
  school_account: { label: 'Region 15 account', note: 'School activity account' }
};

/**
 * Accounts that no longer exist, and where their money now lives. Applied to
 * stored records so a row written before the account was retired still resolves
 * to something real rather than rendering blank.
 */
const LEGACY_ACCOUNTS: Record<string, Account> = {
  cash_box: 'school_account'
};

export function migrateAccount(old: string): Account {
  if (LEGACY_ACCOUNTS[old]) return LEGACY_ACCOUNTS[old];
  return old in ACCOUNT_META ? (old as Account) : 'school_account';
}

const LEGACY_INCOME: Record<string, IncomeCategory> = {
  sponsorship_check: 'sponsorships',
  fundraiser: 'fundraising',
  bottle_can_drive: 'fundraising',
  merch_sales: 'fundraising',
  camp_registration: 'fundraising',
  other_income: 'fundraising'
};

const LEGACY_EXPENSE: Record<string, ExpenseCategory> = {
  robot: 'robot_parts',
  tools: 'tools_shop',
  events: 'competition_travel',
  general: 'team_operations'
};

export function migrateIncomeCategory(old: string, amount: number): IncomeCategory {
  if (old === 'donation') {
    return amount >= MAJOR_DONOR_THRESHOLD ? 'major_donors' : 'community_donations';
  }
  if (LEGACY_INCOME[old]) return LEGACY_INCOME[old];
  if (old in INCOME_CATEGORY_META) return old as IncomeCategory;
  return 'uncategorized';
}

export function migrateExpenseCategory(old: string): ExpenseCategory {
  if (LEGACY_EXPENSE[old]) return LEGACY_EXPENSE[old];
  if (old in EXPENSE_CATEGORY_META) return old as ExpenseCategory;
  return 'uncategorized';
}

export interface KeywordRule {
  pattern: RegExp;
  category: ExpenseCategory;
}

/**
 * First match wins. Amazon is deliberately absent: it sells robot parts, shop
 * tools, and team snacks, so any guess would be wrong often enough to poison
 * the breakdown. An honest `uncategorized` is better than a confident lie.
 */
export const HCB_MEMO_RULES: KeywordRule[] = [
  { pattern: /REV ROBOTICS|ANDYMARK|MCMASTER|WEST COAST PROD|\bWCP\b|\bVEX\b|SWERVE/i, category: 'robot_parts' },
  { pattern: /\bFIRST\b|REGISTRATION|NEFIRST|DISTRICT EVENT/i, category: 'registration_fees' },
  { pattern: /MARRIOTT|HAMPTON|HILTON|HOLIDAY INN|\bHOTEL\b|\bMOTEL\b/i, category: 'competition_travel' },
  { pattern: /HOME DEPOT|LOWES|HARBOR FREIGHT|GRAINGER|FASTENAL/i, category: 'tools_shop' }
];

export interface HcbTransactionLike {
  amount_cents: number;
  memo: string;
  type: string;
}

export interface HcbClassification {
  direction: 'in' | 'out';
  category: IncomeCategory | ExpenseCategory;
}

export function classifyHcbTransaction(txn: HcbTransactionLike): HcbClassification {
  const direction: 'in' | 'out' = txn.amount_cents >= 0 ? 'in' : 'out';
  const dollars = Math.abs(txn.amount_cents) / 100;

  if (txn.type === 'donation') {
    return {
      direction,
      category: dollars >= MAJOR_DONOR_THRESHOLD ? 'major_donors' : 'community_donations'
    };
  }

  if (txn.type === 'hcb_fee' || txn.type === 'bank_fee') {
    return { direction, category: 'team_operations' };
  }

  const memo = txn.memo || '';
  for (const rule of HCB_MEMO_RULES) {
    if (rule.pattern.test(memo)) return { direction, category: rule.category };
  }

  return { direction, category: 'uncategorized' };
}

export function suggestAccountForPaymentMethod(method?: string): ExpenseAccount {
  switch (method) {
    case 'hcb_card':
      return 'hcb_bank';
    case 'school_po':
      return 'school_account';
    case 'cash':
      // Cash is school money that happens to be in a tin; it is banked there.
      return 'school_account';
    default:
      // grant_voucher is vendor credit; personal_reimbursement has not left a
      // team account until it is actually repaid.
      return 'none';
  }
}
