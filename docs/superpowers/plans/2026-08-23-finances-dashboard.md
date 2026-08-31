# Finances Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Finances tab as a Sankey-based money-in/money-out dashboard with live per-account balances, and merge Hack Club Bank transactions into the Expenses and Deposits tabs.

**Architecture:** All financial arithmetic moves into `src/lib/finance/` as pure, framework-free functions with vitest coverage. `cacaoStore.svelte.ts` keeps its reactive role but delegates rollups instead of computing them inline. Svelte components render derived data and contain no arithmetic.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Tailwind 4, Convex, lucide-svelte, vitest (added by this plan). No charting library — the Sankey is hand-rolled SVG.

**Spec:** `docs/superpowers/specs/2026-08-23-finances-dashboard-design.md`

## Global Constraints

- **No emoji in any UI string.** This is the whole point of Task 16; do not add new ones anywhere else either.
- **Svelte 5 runes only** — `$state`, `$derived`, `$props`, `$effect`. No Svelte 4 stores, no `export let`.
- **`src/lib/finance/*.ts` must stay pure.** No `$state`, no imports from `cacaoStore`, no `browser`, no DOM. This is what makes them testable.
- **`MAJOR_DONOR_THRESHOLD = 250`** dollars. A gift of exactly 250 is `major_donors`.
- **Season runs Sept 1 → Aug 31.** `2026-2027` is `2026-09-01` to `2027-08-31`.
- **Dedupe match requires all four conditions:** same direction, amount within `$0.01`, date within ±7 days, and the record already claims HCB.
- **Theme tokens go in all three blocks** of `src/styles/app.css`: bare `:root`, `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`.
- **Convex category unions live in three files** that must stay in step: `convex/validators.ts`, `convex/schema.ts`, `src/lib/types.ts`.
- **Money is stored in dollars** as `number` in this app. HCB's API returns cents — divide by 100 at the boundary, never deeper.

## Build state during execution

Tasks 1–4 are self-contained and leave `npm run check` as green as it started. **Task 5 deliberately breaks `npm run check`** by changing the category unions out from under the components; Tasks 13–17 repair it. Task 18 is the gate that requires it fully green. Do not panic at red type-checks between Tasks 5 and 18 — but do read them, because a *new* kind of error there is a real bug.

---

## Task 1: Vitest setup and the category taxonomy

**Files:**
- Modify: `package.json`, `vite.config.ts`
- Create: `src/lib/finance/categories.ts`
- Test: `src/lib/finance/categories.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Account`, `ExpenseAccount`, `IncomeCategory`, `ExpenseCategory`, `CategoryMeta`, `KeywordRule`, `MAJOR_DONOR_THRESHOLD`, `INCOME_CATEGORY_META`, `EXPENSE_CATEGORY_META`, `ACCOUNT_META`, `DEPOSIT_FORM_CATEGORIES`, `EXPENSE_FORM_CATEGORIES`, `HCB_MEMO_RULES`, `migrateIncomeCategory(old, amount)`, `migrateExpenseCategory(old)`, `classifyHcbTransaction(txn)`, `suggestAccountForPaymentMethod(pm)`, `LOSSY_INCOME_MIGRATIONS`, `LOSSY_EXPENSE_MIGRATIONS`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^3.0.0
```

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block, after `"check:watch"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Add the vitest config to `vite.config.ts`**

Replace the whole file with:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    host: '0.0.0.0'
  },
  test: {
    // The finance modules are pure TypeScript, so no jsdom and no
    // svelte plugin work is needed to exercise them.
    include: ['src/lib/finance/**/*.test.ts'],
    environment: 'node'
  }
});
```

- [ ] **Step 4: Write the failing test**

Create `src/lib/finance/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MAJOR_DONOR_THRESHOLD,
  DEPOSIT_FORM_CATEGORIES,
  EXPENSE_FORM_CATEGORIES,
  INCOME_CATEGORY_META,
  EXPENSE_CATEGORY_META,
  migrateIncomeCategory,
  migrateExpenseCategory,
  classifyHcbTransaction,
  suggestAccountForPaymentMethod
} from './categories';

describe('migrateIncomeCategory', () => {
  it('maps every legacy income category to a new one', () => {
    expect(migrateIncomeCategory('sponsorship_check', 100)).toBe('sponsorships');
    expect(migrateIncomeCategory('fundraiser', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('bottle_can_drive', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('merch_sales', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('camp_registration', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('other_income', 100)).toBe('fundraising');
  });

  it('splits legacy donations at the major-donor threshold', () => {
    expect(migrateIncomeCategory('donation', 250)).toBe('major_donors');
    expect(migrateIncomeCategory('donation', 249.99)).toBe('community_donations');
    expect(migrateIncomeCategory('donation', 1000)).toBe('major_donors');
  });

  it('passes through a value that is already migrated', () => {
    expect(migrateIncomeCategory('fundraising', 10)).toBe('fundraising');
  });
});

describe('migrateExpenseCategory', () => {
  it('maps every legacy expense category to a new one', () => {
    expect(migrateExpenseCategory('robot')).toBe('robot_parts');
    expect(migrateExpenseCategory('tools')).toBe('tools_shop');
    expect(migrateExpenseCategory('events')).toBe('competition_travel');
    expect(migrateExpenseCategory('general')).toBe('team_operations');
  });

  it('passes through a value that is already migrated', () => {
    expect(migrateExpenseCategory('robot_parts')).toBe('robot_parts');
  });
});

describe('form category lists', () => {
  it('never offers grants or sponsorships in the deposit form', () => {
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('grants');
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('sponsorships');
  });

  it('never offers uncategorized in either form', () => {
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('uncategorized');
    expect(EXPENSE_FORM_CATEGORIES).not.toContain('uncategorized');
  });

  it('offers all six real expense categories', () => {
    expect(EXPENSE_FORM_CATEGORIES).toHaveLength(6);
  });

  it('has metadata for every category it offers', () => {
    for (const c of DEPOSIT_FORM_CATEGORIES) expect(INCOME_CATEGORY_META[c]).toBeDefined();
    for (const c of EXPENSE_FORM_CATEGORIES) expect(EXPENSE_CATEGORY_META[c]).toBeDefined();
  });

  it('gives every category a distinct flow color slot', () => {
    const slots = [
      ...Object.values(INCOME_CATEGORY_META).map((m) => m.flow),
      ...Object.values(EXPENSE_CATEGORY_META).map((m) => m.flow)
    ].filter((s) => s !== 'var(--color-flow-muted)');
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe('classifyHcbTransaction', () => {
  it('reads direction from the sign of amount_cents', () => {
    expect(classifyHcbTransaction({ amount_cents: -100, memo: 'x', type: 'card_charge' }).direction).toBe('out');
    expect(classifyHcbTransaction({ amount_cents: 100, memo: 'x', type: 'donation' }).direction).toBe('in');
  });

  it('splits donations at the major-donor threshold', () => {
    expect(
      classifyHcbTransaction({ amount_cents: 25000, memo: 'Donation from Pat', type: 'donation' }).category
    ).toBe('major_donors');
    expect(
      classifyHcbTransaction({ amount_cents: 3226, memo: 'Donation from Maria', type: 'donation' }).category
    ).toBe('community_donations');
  });

  it('files HCB fees under team operations', () => {
    expect(
      classifyHcbTransaction({ amount_cents: -1149, memo: 'Fiscal sponsorship fee', type: 'hcb_fee' }).category
    ).toBe('team_operations');
  });

  it('applies memo keyword rules to card charges', () => {
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'REV ROBOTICS', type: 'card_charge' }).category)
      .toBe('robot_parts');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'andymark inc', type: 'card_charge' }).category)
      .toBe('robot_parts');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'FIRST REGISTRATION', type: 'card_charge' }).category)
      .toBe('registration_fees');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'HAMPTON INN', type: 'card_charge' }).category)
      .toBe('competition_travel');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'HOME DEPOT #123', type: 'card_charge' }).category)
      .toBe('tools_shop');
  });

  it('refuses to guess on Amazon', () => {
    expect(classifyHcbTransaction({ amount_cents: -3189, memo: 'Amazon', type: 'card_charge' }).category)
      .toBe('uncategorized');
  });

  it('falls back to uncategorized for an unrecognised memo', () => {
    expect(
      classifyHcbTransaction({ amount_cents: -8500, memo: 'SOUTHBURY COUNTRY FLOR', type: 'card_charge' }).category
    ).toBe('uncategorized');
  });
});

describe('suggestAccountForPaymentMethod', () => {
  it('maps the three payment methods that touch a real account', () => {
    expect(suggestAccountForPaymentMethod('hcb_card')).toBe('hcb_bank');
    expect(suggestAccountForPaymentMethod('school_po')).toBe('school_account');
    expect(suggestAccountForPaymentMethod('cash')).toBe('cash_box');
  });

  it('returns none for money that never leaves a team account', () => {
    expect(suggestAccountForPaymentMethod('grant_voucher')).toBe('none');
    expect(suggestAccountForPaymentMethod('personal_reimbursement')).toBe('none');
    expect(suggestAccountForPaymentMethod('other')).toBe('none');
    expect(suggestAccountForPaymentMethod(undefined)).toBe('none');
  });
});

describe('MAJOR_DONOR_THRESHOLD', () => {
  it('is 250 dollars', () => {
    expect(MAJOR_DONOR_THRESHOLD).toBe(250);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./categories"`.

- [ ] **Step 6: Write the implementation**

Create `src/lib/finance/categories.ts`:

```ts
/**
 * The finance taxonomy, and every rule for getting a record into it.
 *
 * This module is the source of truth for categories. `src/lib/types.ts` and the
 * Convex validators re-state these unions because Convex needs literal
 * validators at the schema boundary; if you change a union here, change it in
 * `convex/validators.ts` and `convex/schema.ts` too.
 */

export type Account = 'hcb_bank' | 'school_account' | 'cash_box';

/** An expense may also draw on nothing at all — a voucher, or an unrepaid personal purchase. */
export type ExpenseAccount = Account | 'none';

export type IncomeCategory =
  | 'grants'
  | 'sponsorships'
  | 'major_donors'
  | 'community_donations'
  | 'fundraising'
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
  school_account: { label: 'Region 15 account', note: 'School activity account' },
  cash_box: { label: 'Cash on hand', note: 'Pit and shop cash box' }
};

/** Legacy ids whose new home is a judgment call, not a clean rename. */
export const LOSSY_INCOME_MIGRATIONS = ['other_income'];
export const LOSSY_EXPENSE_MIGRATIONS = ['events'];

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
      return 'cash_box';
    default:
      // grant_voucher is vendor credit; personal_reimbursement has not left a
      // team account until it is actually repaid.
      return 'none';
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all `categories.test.ts` tests green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/lib/finance/categories.ts src/lib/finance/categories.test.ts
git commit -m "Add finance category taxonomy with vitest coverage"
```

---

## Task 2: Account balances

**Files:**
- Create: `src/lib/finance/balances.ts`
- Test: `src/lib/finance/balances.test.ts`

**Interfaces:**
- Consumes: `Account`, `ExpenseAccount`, `ACCOUNT_META` from `./categories`
- Produces: `AccountConfig`, `AccountBalance`, `BalanceExpense`, `BalanceDeposit`, `expenseEffectiveDate(e)`, `expenseDebitsAccount(e)`, `computeBalances(input)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/finance/balances.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeBalances,
  expenseDebitsAccount,
  expenseEffectiveDate,
  type BalanceExpense,
  type BalanceDeposit,
  type AccountConfig
} from './balances';

const config = (over: Partial<AccountConfig> = {}): AccountConfig => ({
  account: 'school_account',
  openingBalance: 1000,
  asOfDate: '2026-01-01',
  ...over
});

const expense = (over: Partial<BalanceExpense> = {}): BalanceExpense => ({
  amount: 100,
  finalPaidAmount: undefined,
  status: 'purchased',
  account: 'school_account',
  purchasedAt: Date.parse('2026-06-01T12:00:00Z'),
  reimbursedAt: undefined,
  createdAt: Date.parse('2026-05-01T12:00:00Z'),
  ...over
});

const deposit = (over: Partial<BalanceDeposit> = {}): BalanceDeposit => ({
  amount: 500,
  depositAccount: 'school_account',
  date: '2026-06-01',
  ...over
});

const balanceOf = (result: ReturnType<typeof computeBalances>, account: string) =>
  result.find((b) => b.account === account)!;

describe('expenseDebitsAccount', () => {
  it('is true for a purchased expense on a real account', () => {
    expect(expenseDebitsAccount(expense({ status: 'purchased' }))).toBe(true);
  });

  it('is true for a reimbursed expense on a real account', () => {
    expect(expenseDebitsAccount(expense({ status: 'reimbursed' }))).toBe(true);
  });

  it('is false for an approved but unpurchased expense', () => {
    expect(expenseDebitsAccount(expense({ status: 'approved' }))).toBe(false);
  });

  it('is false for a pending or rejected expense', () => {
    expect(expenseDebitsAccount(expense({ status: 'pending_approval' }))).toBe(false);
    expect(expenseDebitsAccount(expense({ status: 'rejected' }))).toBe(false);
  });

  it('is false when the account is none', () => {
    expect(expenseDebitsAccount(expense({ account: 'none' }))).toBe(false);
  });

  it('is false when the account is undefined', () => {
    expect(expenseDebitsAccount(expense({ account: undefined }))).toBe(false);
  });
});

describe('expenseEffectiveDate', () => {
  it('prefers the reimbursement date when reimbursed', () => {
    const e = expense({
      status: 'reimbursed',
      reimbursedAt: Date.parse('2026-07-15T00:00:00Z'),
      purchasedAt: Date.parse('2026-06-01T00:00:00Z')
    });
    expect(expenseEffectiveDate(e)).toBe('2026-07-15');
  });

  it('uses the purchase date otherwise', () => {
    expect(expenseEffectiveDate(expense())).toBe('2026-06-01');
  });

  it('falls back to the created date when never purchased', () => {
    expect(expenseEffectiveDate(expense({ purchasedAt: undefined }))).toBe('2026-05-01');
  });
});

describe('computeBalances', () => {
  it('returns the opening balance when nothing has happened', () => {
    const result = computeBalances({ configs: [config()], deposits: [], expenses: [] });
    expect(balanceOf(result, 'school_account').computed).toBe(1000);
  });

  it('adds deposits and subtracts purchased expenses', () => {
    const result = computeBalances({
      configs: [config()],
      deposits: [deposit({ amount: 500 })],
      expenses: [expense({ amount: 200 })]
    });
    expect(balanceOf(result, 'school_account').computed).toBe(1300);
  });

  it('excludes activity dated before the as-of date', () => {
    const result = computeBalances({
      configs: [config({ asOfDate: '2026-06-01' })],
      deposits: [deposit({ date: '2026-05-31', amount: 500 })],
      expenses: []
    });
    expect(balanceOf(result, 'school_account').computed).toBe(1000);
  });

  it('includes activity dated exactly on the as-of date', () => {
    const result = computeBalances({
      configs: [config({ asOfDate: '2026-06-01' })],
      deposits: [deposit({ date: '2026-06-01', amount: 500 })],
      expenses: []
    });
    expect(balanceOf(result, 'school_account').computed).toBe(1500);
  });

  it('debits finalPaidAmount when present, not the estimate', () => {
    const result = computeBalances({
      configs: [config()],
      deposits: [],
      expenses: [expense({ amount: 200, finalPaidAmount: 150 })]
    });
    expect(balanceOf(result, 'school_account').computed).toBe(850);
  });

  it('ignores expenses charged to a different account', () => {
    const result = computeBalances({
      configs: [config()],
      deposits: [],
      expenses: [expense({ account: 'cash_box', amount: 200 })]
    });
    expect(balanceOf(result, 'school_account').computed).toBe(1000);
  });

  it('never lets a grant voucher touch a balance', () => {
    const result = computeBalances({
      configs: [config()],
      deposits: [],
      expenses: [expense({ account: 'none', amount: 999 })]
    });
    expect(balanceOf(result, 'school_account').computed).toBe(1000);
  });

  it('treats an unconfigured account as opening zero', () => {
    const result = computeBalances({
      configs: [],
      deposits: [deposit({ depositAccount: 'cash_box', amount: 75, date: '2026-06-01' })],
      expenses: []
    });
    expect(balanceOf(result, 'cash_box').computed).toBe(75);
    expect(balanceOf(result, 'cash_box').openingBalance).toBe(0);
  });

  it('returns a row for all three accounts every time', () => {
    const result = computeBalances({ configs: [], deposits: [], expenses: [] });
    expect(result.map((b) => b.account).sort()).toEqual(['cash_box', 'hcb_bank', 'school_account']);
  });

  it('prefers the measured HCB balance over the computed one', () => {
    const result = computeBalances({
      configs: [config({ account: 'hcb_bank', openingBalance: 1000 })],
      deposits: [],
      expenses: [],
      hcbMeasuredBalance: 214.81
    });
    const hcb = balanceOf(result, 'hcb_bank');
    expect(hcb.source).toBe('measured');
    expect(hcb.balance).toBe(214.81);
    expect(hcb.computed).toBe(1000);
    // Negative: the bank holds less than our records claim.
    expect(hcb.drift).toBeCloseTo(-785.19, 2);
  });

  it('falls back to computed when no measured HCB balance is available', () => {
    const result = computeBalances({
      configs: [config({ account: 'hcb_bank', openingBalance: 1000 })],
      deposits: [],
      expenses: []
    });
    const hcb = balanceOf(result, 'hcb_bank');
    expect(hcb.source).toBe('computed');
    expect(hcb.balance).toBe(1000);
    expect(hcb.drift).toBeUndefined();
  });

  it('never reports drift for a non-HCB account', () => {
    const result = computeBalances({
      configs: [config()],
      deposits: [],
      expenses: [],
      hcbMeasuredBalance: 214.81
    });
    expect(balanceOf(result, 'school_account').drift).toBeUndefined();
  });

  it('is unaffected by season: the same input always gives the same answer', () => {
    // The deposit and the expense sit in different FRC seasons, and both are
    // after the as-of date, so both must count regardless of any season notion.
    const input = {
      configs: [config({ asOfDate: '2024-01-01' })],
      deposits: [deposit({ date: '2024-10-01', amount: 500 })],
      expenses: [expense({ amount: 200, purchasedAt: Date.parse('2027-03-01T00:00:00Z') })]
    };
    // No season parameter exists on this function by design. Two identical
    // calls must agree, and the 2024 deposit and 2027 expense both count.
    expect(balanceOf(computeBalances(input), 'school_account').computed).toBe(1300);
    expect(balanceOf(computeBalances(input), 'school_account').computed).toBe(1300);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./balances"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/finance/balances.ts`:

```ts
import type { Account, ExpenseAccount } from './categories';

/**
 * Current account balances. Deliberately season-agnostic: "how much do we have
 * right now" is a single present-tense number, so this function takes no season
 * and callers must not filter its inputs by one.
 */

export const ALL_ACCOUNTS: Account[] = ['hcb_bank', 'school_account', 'cash_box'];

export interface AccountConfig {
  account: Account;
  openingBalance: number;
  /** YYYY-MM-DD. Activity before this date is already inside openingBalance. */
  asOfDate: string;
}

/** The subset of an Expense this module needs, so tests need not build whole records. */
export interface BalanceExpense {
  amount: number;
  finalPaidAmount?: number;
  status: string;
  account?: ExpenseAccount;
  purchasedAt?: number;
  reimbursedAt?: number;
  createdAt: number;
}

export interface BalanceDeposit {
  amount: number;
  depositAccount: Account;
  date: string;
}

export interface AccountBalance {
  account: Account;
  openingBalance: number;
  asOfDate: string;
  /** What our arithmetic says. */
  computed: number;
  /** What the bank says, when we can ask. HCB only. */
  measured?: number;
  /** measured - computed, when both exist and differ by more than a dollar. */
  drift?: number;
  /** The number to display. */
  balance: number;
  source: 'measured' | 'computed';
}

const EPOCH_DATE = '1970-01-01';

function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The date the money actually moved, which is not always the purchase date. */
export function expenseEffectiveDate(e: BalanceExpense): string {
  if (e.status === 'reimbursed' && e.reimbursedAt) return toDateString(e.reimbursedAt);
  if (e.purchasedAt) return toDateString(e.purchasedAt);
  return toDateString(e.createdAt);
}

/**
 * Money is only gone once it is actually gone. An approved-but-unpurchased
 * expense is a commitment, not a withdrawal.
 */
export function expenseDebitsAccount(e: BalanceExpense): boolean {
  if (e.status !== 'purchased' && e.status !== 'reimbursed') return false;
  if (!e.account || e.account === 'none') return false;
  return true;
}

export function computeBalances(input: {
  configs: AccountConfig[];
  deposits: BalanceDeposit[];
  expenses: BalanceExpense[];
  /** Live HCB balance in dollars, when the sync has succeeded. */
  hcbMeasuredBalance?: number;
}): AccountBalance[] {
  const { configs, deposits, expenses, hcbMeasuredBalance } = input;

  return ALL_ACCOUNTS.map((account) => {
    const cfg = configs.find((c) => c.account === account);
    const openingBalance = cfg?.openingBalance ?? 0;
    const asOfDate = cfg?.asOfDate ?? EPOCH_DATE;

    const credits = deposits
      .filter((d) => d.depositAccount === account && d.date >= asOfDate)
      .reduce((sum, d) => sum + d.amount, 0);

    const debits = expenses
      .filter((e) => expenseDebitsAccount(e) && e.account === account)
      .filter((e) => expenseEffectiveDate(e) >= asOfDate)
      .reduce((sum, e) => sum + (e.finalPaidAmount ?? e.amount), 0);

    const computed = openingBalance + credits - debits;

    const measured = account === 'hcb_bank' ? hcbMeasuredBalance : undefined;
    const hasMeasured = typeof measured === 'number';
    const rawDrift = hasMeasured ? measured - computed : undefined;

    return {
      account,
      openingBalance,
      asOfDate,
      computed,
      measured,
      // Sub-dollar disagreement is rounding, not a problem worth surfacing.
      drift: rawDrift !== undefined && Math.abs(rawDrift) > 1 ? rawDrift : undefined,
      balance: hasMeasured ? measured : computed,
      source: hasMeasured ? 'measured' : 'computed'
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, both test files green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/balances.ts src/lib/finance/balances.test.ts
git commit -m "Add per-account balance computation"
```

---

## Task 3: The ledger and dedupe

**Files:**
- Create: `src/lib/finance/ledger.ts`
- Test: `src/lib/finance/ledger.test.ts`

**Interfaces:**
- Consumes: `classifyHcbTransaction`, `migrateIncomeCategory`, `migrateExpenseCategory` from `./categories`
- Produces: `seasonDateRange(season)`, `LedgerEntry`, `LedgerExpense`, `LedgerDeposit`, `LedgerHcbTransaction`, `buildLedger(input)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/finance/ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  seasonDateRange,
  buildLedger,
  type LedgerExpense,
  type LedgerDeposit,
  type LedgerHcbTransaction
} from './ledger';

const expense = (over: Partial<LedgerExpense> = {}): LedgerExpense => ({
  _id: 'exp1',
  title: 'Swerve modules',
  vendor: 'REV',
  amount: 1240,
  finalPaidAmount: undefined,
  category: 'robot_parts',
  status: 'purchased',
  season: '2026-2027',
  paymentMethod: 'hcb_card',
  purchasedAt: Date.parse('2026-10-10T00:00:00Z'),
  createdAt: Date.parse('2026-10-01T00:00:00Z'),
  ...over
});

const deposit = (over: Partial<LedgerDeposit> = {}): LedgerDeposit => ({
  _id: 'dep1',
  title: 'Donation from Pat',
  amount: 300,
  category: 'major_donors',
  depositAccount: 'hcb_bank',
  date: '2026-10-10',
  season: '2026-2027',
  ...over
});

const txn = (over: Partial<LedgerHcbTransaction> = {}): LedgerHcbTransaction => ({
  id: 'txn1',
  amount_cents: -124000,
  memo: 'REV ROBOTICS',
  date: '2026-10-10',
  type: 'card_charge',
  pending: false,
  ...over
});

const build = (over: Parameters<typeof buildLedger>[0]) => buildLedger(over);

describe('seasonDateRange', () => {
  it('runs September through August', () => {
    expect(seasonDateRange('2026-2027')).toEqual({ start: '2026-09-01', end: '2027-08-31' });
  });

  it('returns null for all', () => {
    expect(seasonDateRange('all')).toBeNull();
  });

  it('returns null for an unparseable season', () => {
    expect(seasonDateRange('nonsense')).toBeNull();
  });
});

describe('buildLedger season filtering', () => {
  it("honours a record's season field over its date", () => {
    const result = build({
      expenses: [expense({ season: '2025-2026', purchasedAt: Date.parse('2026-10-10T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(0);
  });

  it('places an HCB transaction by its date', () => {
    const inSeason = build({
      expenses: [], deposits: [], hcbTransactions: [txn({ date: '2026-09-01' })], season: '2026-2027'
    });
    expect(inSeason.entries).toHaveLength(1);

    const outOfSeason = build({
      expenses: [], deposits: [], hcbTransactions: [txn({ date: '2026-08-31' })], season: '2026-2027'
    });
    expect(outOfSeason.entries).toHaveLength(0);
  });

  it('filters nothing when the season is all', () => {
    const result = build({
      expenses: [expense({ season: '2019-2020' })],
      deposits: [],
      hcbTransactions: [txn({ date: '2001-01-01' })],
      season: 'all'
    });
    expect(result.entries).toHaveLength(2);
  });
});

describe('buildLedger dedupe', () => {
  it('folds a matching transaction into the logged expense', () => {
    const result = build({
      expenses: [expense()],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].source).toBe('logged');
    expect(result.entries[0].hcbTransactionId).toBe('txn1');
    expect(result.unmatchedHcb).toHaveLength(0);
  });

  it('does not match when the amount differs by more than a cent', () => {
    const result = build({
      expenses: [expense({ amount: 1240 })],
      deposits: [],
      hcbTransactions: [txn({ amount_cents: -124500 })],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(2);
    expect(result.unmatchedHcb).toHaveLength(1);
  });

  it('does not match when the dates are more than seven days apart', () => {
    const result = build({
      expenses: [expense({ purchasedAt: Date.parse('2026-10-01T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [txn({ date: '2026-10-10' })],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(2);
  });

  it('matches at exactly seven days apart', () => {
    const result = build({
      expenses: [expense({ purchasedAt: Date.parse('2026-10-03T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [txn({ date: '2026-10-10' })],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
  });

  it('never lets a school PO expense absorb a bank transaction', () => {
    const result = build({
      expenses: [expense({ paymentMethod: 'school_po' })],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(2);
    expect(result.unmatchedHcb).toHaveLength(1);
  });

  it('matches an expense on finalPaidAmount rather than the estimate', () => {
    const result = build({
      expenses: [expense({ amount: 1300, finalPaidAmount: 1240 })],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].hcbTransactionId).toBe('txn1');
  });

  it('respects direction: a charge never matches a deposit', () => {
    const result = build({
      expenses: [],
      deposits: [deposit({ amount: 1240 })],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    expect(result.unmatchedHcb).toHaveLength(1);
  });

  it('matches a positive transaction to a deposit', () => {
    const result = build({
      expenses: [],
      deposits: [deposit({ amount: 300 })],
      hcbTransactions: [txn({ id: 'txn2', amount_cents: 30000, type: 'donation', memo: 'Donation from Pat' })],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].hcbTransactionId).toBe('txn2');
  });

  it('consumes each transaction at most once', () => {
    const result = build({
      expenses: [expense({ _id: 'a' }), expense({ _id: 'b' })],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    const matched = result.entries.filter((e) => e.hcbTransactionId);
    expect(matched).toHaveLength(1);
  });

  it('lets each record absorb at most one transaction', () => {
    const result = build({
      expenses: [expense()],
      deposits: [],
      hcbTransactions: [txn({ id: 't1' }), txn({ id: 't2' })],
      season: '2026-2027'
    });
    expect(result.unmatchedHcb).toHaveLength(1);
  });

  it('gives the nearest date the match when two records both qualify', () => {
    const result = build({
      expenses: [
        expense({ _id: 'far', purchasedAt: Date.parse('2026-10-06T00:00:00Z') }),
        expense({ _id: 'near', purchasedAt: Date.parse('2026-10-10T00:00:00Z') })
      ],
      deposits: [],
      hcbTransactions: [txn({ date: '2026-10-10' })],
      season: '2026-2027'
    });
    const matched = result.entries.find((e) => e.hcbTransactionId);
    expect(matched?.id).toBe('near');
  });

  it('surfaces an unmatched transaction as a read-only hcb entry', () => {
    const result = build({
      expenses: [],
      deposits: [],
      hcbTransactions: [txn({ memo: 'SOUTHBURY COUNTRY FLOR', amount_cents: -85000 })],
      season: '2026-2027'
    });
    expect(result.entries[0].source).toBe('hcb');
    expect(result.entries[0].category).toBe('uncategorized');
    expect(result.entries[0].amount).toBe(850);
    expect(result.entries[0].direction).toBe('out');
  });
});

describe('buildLedger totals', () => {
  it('equals logged totals plus unmatched HCB totals', () => {
    const result = build({
      expenses: [expense({ amount: 1240 })],
      deposits: [deposit({ amount: 300 })],
      hcbTransactions: [
        txn(),                                              // matches the expense
        txn({ id: 'extra', amount_cents: -5000, memo: 'SP ZWIFT INC.' })
      ],
      season: '2026-2027'
    });
    const out = result.entries.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
    const inn = result.entries.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
    expect(out).toBe(1240 + 50);
    expect(inn).toBe(300);
  });

  it('skips pending HCB transactions', () => {
    const result = build({
      expenses: [], deposits: [], hcbTransactions: [txn({ pending: true })], season: '2026-2027'
    });
    expect(result.entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./ledger"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/finance/ledger.ts`:

```ts
import {
  classifyHcbTransaction,
  type ExpenseCategory,
  type IncomeCategory,
  type Account
} from './categories';

/**
 * One merged view of money movement: records the team typed in, plus bank
 * transactions that were never typed in, with the overlap between them
 * collapsed so nothing is counted twice.
 */

export type Direction = 'in' | 'out';
export type LedgerSource = 'logged' | 'hcb';

export interface LedgerExpense {
  _id: string;
  title: string;
  vendor: string;
  amount: number;
  finalPaidAmount?: number;
  category: string;
  status: string;
  season: string;
  paymentMethod?: string;
  purchasedAt?: number;
  createdAt: number;
}

export interface LedgerDeposit {
  _id: string;
  title: string;
  amount: number;
  category: string;
  depositAccount: Account;
  date: string;
  season: string;
}

export interface LedgerHcbTransaction {
  id: string;
  amount_cents: number;
  memo: string;
  date: string;
  type: string;
  pending: boolean;
}

export interface LedgerEntry {
  id: string;
  direction: Direction;
  source: LedgerSource;
  title: string;
  /** Always a positive dollar figure; `direction` carries the sign. */
  amount: number;
  date: string;
  category: IncomeCategory | ExpenseCategory;
  /** Set on a logged entry that was confirmed against a bank transaction. */
  hcbTransactionId?: string;
  expense?: LedgerExpense;
  deposit?: LedgerDeposit;
  hcbTransaction?: LedgerHcbTransaction;
}

/** How many days apart a bank transaction and a logged record may be. */
const MATCH_WINDOW_DAYS = 7;
const MATCH_WINDOW_MS = MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.01;

/** FRC seasons run September through August, so a season is not a calendar year. */
export function seasonDateRange(season: string): { start: string; end: string } | null {
  if (season === 'all') return null;
  const match = season.match(/^(\d{4})-(\d{4})$/);
  if (!match) return null;
  return { start: `${match[1]}-09-01`, end: `${match[2]}-08-31` };
}

function expenseDate(e: LedgerExpense): string {
  return new Date(e.purchasedAt ?? e.createdAt).toISOString().slice(0, 10);
}

function expensePaid(e: LedgerExpense): number {
  return e.finalPaidAmount ?? e.amount;
}

function withinRange(date: string, range: { start: string; end: string } | null): boolean {
  if (!range) return true;
  return date >= range.start && date <= range.end;
}

interface Candidate {
  key: string;
  direction: Direction;
  amount: number;
  dateMs: number;
  claimsHcb: boolean;
}

export function buildLedger(input: {
  expenses: LedgerExpense[];
  deposits: LedgerDeposit[];
  hcbTransactions: LedgerHcbTransaction[];
  season: string;
}): { entries: LedgerEntry[]; unmatchedHcb: LedgerHcbTransaction[] } {
  const range = seasonDateRange(input.season);

  // A logged record's own season field is authoritative — a human set it.
  // Only fall back to the date when that field is missing.
  const expenses = input.expenses.filter((e) =>
    e.season ? input.season === 'all' || e.season === input.season : withinRange(expenseDate(e), range)
  );
  const deposits = input.deposits.filter((d) =>
    d.season ? input.season === 'all' || d.season === input.season : withinRange(d.date, range)
  );

  // Bank transactions have only a date to go on.
  const transactions = input.hcbTransactions.filter(
    (t) => !t.pending && withinRange(t.date, range)
  );

  const candidates: Candidate[] = [
    ...expenses.map((e) => ({
      key: `exp:${e._id}`,
      direction: 'out' as Direction,
      amount: expensePaid(e),
      dateMs: Date.parse(expenseDate(e)),
      claimsHcb: e.paymentMethod === 'hcb_card'
    })),
    ...deposits.map((d) => ({
      key: `dep:${d._id}`,
      direction: 'in' as Direction,
      amount: d.amount,
      dateMs: Date.parse(d.date),
      claimsHcb: d.depositAccount === 'hcb_bank'
    }))
  ];

  const matchedByRecord = new Map<string, string>();
  const consumedRecords = new Set<string>();
  const matchedTransactionIds = new Set<string>();

  for (const t of transactions) {
    const direction: Direction = t.amount_cents >= 0 ? 'in' : 'out';
    const dollars = Math.abs(t.amount_cents) / 100;
    const tDateMs = Date.parse(t.date);

    const viable = candidates
      .filter((c) => !consumedRecords.has(c.key))
      .filter((c) => c.claimsHcb)
      .filter((c) => c.direction === direction)
      .filter((c) => Math.abs(c.amount - dollars) <= AMOUNT_TOLERANCE)
      .filter((c) => Math.abs(c.dateMs - tDateMs) <= MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(a.dateMs - tDateMs) - Math.abs(b.dateMs - tDateMs));

    const winner = viable[0];
    if (winner) {
      matchedByRecord.set(winner.key, t.id);
      consumedRecords.add(winner.key);
      matchedTransactionIds.add(t.id);
    }
  }

  const entries: LedgerEntry[] = [
    ...expenses.map<LedgerEntry>((e) => ({
      id: e._id,
      direction: 'out',
      source: 'logged',
      title: e.title,
      amount: expensePaid(e),
      date: expenseDate(e),
      category: e.category as ExpenseCategory,
      hcbTransactionId: matchedByRecord.get(`exp:${e._id}`),
      expense: e
    })),
    ...deposits.map<LedgerEntry>((d) => ({
      id: d._id,
      direction: 'in',
      source: 'logged',
      title: d.title,
      amount: d.amount,
      date: d.date,
      category: d.category as IncomeCategory,
      hcbTransactionId: matchedByRecord.get(`dep:${d._id}`),
      deposit: d
    }))
  ];

  const unmatchedHcb = transactions.filter((t) => !matchedTransactionIds.has(t.id));

  for (const t of unmatchedHcb) {
    const { direction, category } = classifyHcbTransaction(t);
    entries.push({
      id: t.id,
      direction,
      source: 'hcb',
      title: t.memo || 'Bank transaction',
      amount: Math.abs(t.amount_cents) / 100,
      date: t.date,
      category,
      hcbTransaction: t
    });
  }

  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { entries, unmatchedHcb };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, three test files green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/ledger.ts src/lib/finance/ledger.test.ts
git commit -m "Add merged HCB and manual record ledger with dedupe"
```

---

## Task 4: Sankey layout

**Files:**
- Create: `src/lib/finance/sankey.ts`
- Test: `src/lib/finance/sankey.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SankeyInput`, `SankeyNode`, `SankeyLink`, `SankeyLayout`, `layoutSankey(input)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/finance/sankey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutSankey, type SankeyInput } from './sankey';

const base: SankeyInput = {
  incoming: [
    { id: 'grants', label: 'Grants', value: 6000, color: 'var(--color-flow-1)' },
    { id: 'fundraising', label: 'Fundraising', value: 2000, color: 'var(--color-flow-5)' }
  ],
  outgoing: [
    { id: 'robot_parts', label: 'Robot & parts', value: 4000, color: 'var(--color-flow-6)' },
    { id: 'tools_shop', label: 'Tools & shop', value: 2000, color: 'var(--color-flow-7)' }
  ],
  width: 800,
  height: 400
};

describe('layoutSankey', () => {
  it('emits a node per category plus the centre total', () => {
    const { nodes } = layoutSankey(base);
    expect(nodes.filter((n) => n.column === 'in')).toHaveLength(2);
    expect(nodes.filter((n) => n.column === 'out')).toHaveLength(2);
    expect(nodes.filter((n) => n.column === 'total')).toHaveLength(1);
  });

  it('sizes node height in proportion to value', () => {
    const { nodes } = layoutSankey(base);
    const grants = nodes.find((n) => n.id === 'grants')!;
    const fundraising = nodes.find((n) => n.id === 'fundraising')!;
    expect(grants.height / fundraising.height).toBeCloseTo(3, 5);
  });

  it('scales both sides against the same total so they stay comparable', () => {
    const { nodes } = layoutSankey(base);
    const inHeight = nodes.filter((n) => n.column === 'in').reduce((s, n) => s + n.height, 0);
    const outHeight = nodes.filter((n) => n.column === 'out').reduce((s, n) => s + n.height, 0);
    // Income is 8000 and spending 6000, so the out column must be visibly shorter.
    expect(outHeight).toBeLessThan(inHeight);
    expect(outHeight / inHeight).toBeCloseTo(6000 / 8000, 5);
  });

  it('keeps every node inside the canvas', () => {
    const { nodes } = layoutSankey(base);
    for (const n of nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height).toBeLessThanOrEqual(base.height + 0.001);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(base.width + 0.001);
    }
  });

  it('emits one link per category, each carrying an svg path', () => {
    const { links } = layoutSankey(base);
    expect(links).toHaveLength(4);
    for (const l of links) {
      expect(l.path.startsWith('M')).toBe(true);
      expect(l.path).toContain('C');
      expect(l.width).toBeGreaterThan(0);
    }
  });

  it('omits zero-value categories rather than drawing them flat', () => {
    const { nodes, links } = layoutSankey({
      ...base,
      incoming: [...base.incoming, { id: 'empty', label: 'Empty', value: 0, color: 'x' }]
    });
    expect(nodes.find((n) => n.id === 'empty')).toBeUndefined();
    expect(links.find((l) => l.from === 'empty')).toBeUndefined();
  });

  it('lays out a single category on one side', () => {
    const { nodes } = layoutSankey({
      ...base,
      incoming: [{ id: 'only', label: 'Only', value: 100, color: 'x' }]
    });
    expect(nodes.find((n) => n.id === 'only')).toBeDefined();
  });

  it('returns empty output for empty input without throwing', () => {
    const result = layoutSankey({ ...base, incoming: [], outgoing: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });

  it('reports the two totals it was given', () => {
    const { totalIn, totalOut } = layoutSankey(base);
    expect(totalIn).toBe(8000);
    expect(totalOut).toBe(6000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./sankey"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/finance/sankey.ts`:

```ts
/**
 * Sankey layout: pure geometry, no SVG elements and no Svelte. Returns
 * coordinates and path strings for a component to render.
 *
 * Three columns — income sources, a single season total, spend categories.
 * Both sides are scaled against the larger of the two totals so that a season
 * which spent less than it raised visibly shows a shorter outgoing column.
 */

export interface SankeyCategory {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface SankeyInput {
  incoming: SankeyCategory[];
  outgoing: SankeyCategory[];
  width: number;
  height: number;
}

export interface SankeyNode {
  id: string;
  label: string;
  value: number;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: 'in' | 'total' | 'out';
}

export interface SankeyLink {
  id: string;
  from: string;
  to: string;
  path: string;
  width: number;
  color: string;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIn: number;
  totalOut: number;
}

const NODE_WIDTH = 14;
const GAP = 8;

/** A filled ribbon: along the top edge, down the far side, back along the bottom. */
function ribbon(x0: number, y0: number, x1: number, y1: number, thickness: number): string {
  const midX = (x0 + x1) / 2;
  return [
    `M ${x0} ${y0}`,
    `C ${midX} ${y0}, ${midX} ${y1}, ${x1} ${y1}`,
    `L ${x1} ${y1 + thickness}`,
    `C ${midX} ${y1 + thickness}, ${midX} ${y0 + thickness}, ${x0} ${y0 + thickness}`,
    'Z'
  ].join(' ');
}

export function layoutSankey(input: SankeyInput): SankeyLayout {
  const { width, height } = input;

  // A zero-value category would render as an invisible sliver and an
  // unreachable label, so drop it rather than draw it.
  const incoming = input.incoming.filter((c) => c.value > 0);
  const outgoing = input.outgoing.filter((c) => c.value > 0);

  const totalIn = incoming.reduce((s, c) => s + c.value, 0);
  const totalOut = outgoing.reduce((s, c) => s + c.value, 0);

  if (incoming.length === 0 && outgoing.length === 0) {
    return { nodes: [], links: [], totalIn: 0, totalOut: 0 };
  }

  const scaleBasis = Math.max(totalIn, totalOut) || 1;
  const maxCount = Math.max(incoming.length, outgoing.length);
  const usableHeight = Math.max(height - GAP * Math.max(maxCount - 1, 0), 1);
  const scale = usableHeight / scaleBasis;

  const inX = 0;
  const totalX = (width - NODE_WIDTH) / 2;
  const outX = width - NODE_WIDTH;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  const totalHeight = Math.max(totalIn, totalOut) * scale;
  const totalY = (height - totalHeight) / 2;

  nodes.push({
    id: '__total__',
    label: 'Total',
    value: Math.max(totalIn, totalOut),
    color: 'var(--color-outline)',
    x: totalX,
    y: totalY,
    width: NODE_WIDTH,
    height: totalHeight,
    column: 'total'
  });

  // Income column, top-aligned against the centre bar so ribbons stay untangled.
  let cursorIn = totalY;
  let stackIn = (height - (totalIn * scale + GAP * Math.max(incoming.length - 1, 0))) / 2;
  for (const c of incoming) {
    const h = c.value * scale;
    nodes.push({
      id: c.id, label: c.label, value: c.value, color: c.color,
      x: inX, y: stackIn, width: NODE_WIDTH, height: h, column: 'in'
    });
    links.push({
      id: `in:${c.id}`,
      from: c.id,
      to: '__total__',
      path: ribbon(inX + NODE_WIDTH, stackIn, totalX, cursorIn, h),
      width: h,
      color: c.color
    });
    stackIn += h + GAP;
    cursorIn += h;
  }

  let cursorOut = totalY;
  let stackOut = (height - (totalOut * scale + GAP * Math.max(outgoing.length - 1, 0))) / 2;
  for (const c of outgoing) {
    const h = c.value * scale;
    nodes.push({
      id: c.id, label: c.label, value: c.value, color: c.color,
      x: outX, y: stackOut, width: NODE_WIDTH, height: h, column: 'out'
    });
    links.push({
      id: `out:${c.id}`,
      from: '__total__',
      to: c.id,
      path: ribbon(totalX + NODE_WIDTH, cursorOut, outX, stackOut, h),
      width: h,
      color: c.color
    });
    stackOut += h + GAP;
    cursorOut += h;
  }

  return { nodes, links, totalIn, totalOut };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, four test files green. If the "keeps every node inside the canvas" test fails, the stack starting offsets are wrong — they must centre each column's total stacked height, gaps included.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/sankey.ts src/lib/finance/sankey.test.ts
git commit -m "Add Sankey layout geometry"
```

---

## Task 5: Taxonomy cutover in types, validators, and schema

This task changes the category unions everywhere they are declared. **It will break `npm run check`** in the components that still reference old category ids. That is expected and Tasks 13–17 fix it.

**Files:**
- Modify: `src/lib/types.ts`, `convex/validators.ts`, `convex/schema.ts`, `convex/income.ts:19-33`, `convex/expenses.ts`

**Interfaces:**
- Consumes: the category unions from Task 1
- Produces: `Account`, `ExpenseAccount` exported from `src/lib/types.ts`; `Expense.account`; `accountValidator`, updated `expenseCategoryValidator` and `incomeCategoryValidator`

- [ ] **Step 1: Re-export the taxonomy from `src/lib/types.ts`**

Replace the `ExpenseCategory` union (currently at `src/lib/types.ts:251-255`) with an import plus re-export, so there is one source of truth:

```ts
// Imported as well as re-exported: `export type { X } from '...'` creates no
// local binding, and the Expense interface below needs these names in scope.
import type {
  Account,
  ExpenseAccount,
  ExpenseCategory,
  IncomeCategory
} from '$lib/finance/categories';

export type { Account, ExpenseAccount, ExpenseCategory, IncomeCategory };
```

Then delete the old `IncomeCategory` union at `src/lib/types.ts:311-318` and change `export type DepositAccount = 'hcb_bank' | 'school_account' | 'cash_box';` to:

```ts
/** Kept as an alias so existing deposit code reads naturally. */
export type DepositAccount = Account;
```

- [ ] **Step 2: Add the account field to the Expense interface**

In `src/lib/types.ts`, inside `export interface Expense`, immediately after the `paymentMethod?: PaymentMethod;` line, add:

```ts
  /**
   * Which pot the money left. Distinct from paymentMethod, which is only *how*
   * it was paid: a grant voucher never touches a team account, and a personal
   * purchase does not either until it is reimbursed. Undefined means not yet
   * determined; 'none' means deliberately no account.
   */
  account?: ExpenseAccount;
```

- [ ] **Step 3: Update the Convex validators**

In `convex/validators.ts`, replace `expenseCategoryValidator` and `incomeCategoryValidator`, and add two new validators:

```ts
export const expenseCategoryValidator = v.union(
  v.literal("robot_parts"),
  v.literal("tools_shop"),
  v.literal("registration_fees"),
  v.literal("competition_travel"),
  v.literal("outreach_events"),
  v.literal("team_operations"),
  v.literal("uncategorized")
);

export const incomeCategoryValidator = v.union(
  v.literal("grants"),
  v.literal("sponsorships"),
  v.literal("major_donors"),
  v.literal("community_donations"),
  v.literal("fundraising"),
  v.literal("uncategorized")
);

export const accountValidator = v.union(
  v.literal("hcb_bank"),
  v.literal("school_account"),
  v.literal("cash_box")
);

/** An expense may draw on no account at all. */
export const expenseAccountValidator = v.union(
  accountValidator,
  v.literal("none")
);
```

Leave `depositAccountValidator` as it is — it already matches `accountValidator` and is referenced elsewhere.

- [ ] **Step 4: Update the Convex schema**

In `convex/schema.ts`, import `expenseAccountValidator` and `incomeCategoryValidator` alongside the existing imports:

```ts
import {
  auditActionValidator,
  expenseCategoryValidator,
  expenseAccountValidator,
  incomeCategoryValidator,
} from "./validators";
```

In the `expenses` table, immediately after the `paymentMethod` field, add:

```ts
    account: v.optional(expenseAccountValidator),
```

In the `incomeDeposits` table, replace the inline `category: v.union(...)` block with:

```ts
    category: incomeCategoryValidator,
```

- [ ] **Step 5: Stop `convex/income.ts` from inlining its category union**

In `convex/income.ts`, in the `add` mutation's args (currently lines 19-33), replace the inline `category: v.union(...)` block with `category: incomeCategoryValidator,` and the inline `depositAccount: v.union(...)` block with `depositAccount: depositAccountValidator,`. Both validators are already imported at the top of the file.

- [ ] **Step 6: Thread the account field through the Convex expense mutations**

In `convex/expenses.ts`, add `account: v.optional(expenseAccountValidator),` to the args of both the `add` mutation (near line 31, beside `category`) and the `update` mutation (near line 217). Import `expenseAccountValidator` from `./validators`.

- [ ] **Step 7: Verify the finance tests still pass and check the expected breakage**

Run: `npm test`
Expected: PASS — the pure modules do not depend on any of this.

Run: `npm run check`
Expected: FAIL, with errors confined to components referencing old category literals (`'robot'`, `'fundraiser'`, etc.) in `FinancialsView.svelte`, `ExpensesList.svelte`, `LogDepositModal.svelte`, `AddExpenseModal.svelte`, `ExpenseModal.svelte`, and `seedData.ts`. Write the error count down — Task 18 requires it to reach zero. Any error mentioning a *different* kind of problem is a real bug in this task, not expected breakage.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts convex/validators.ts convex/schema.ts convex/income.ts convex/expenses.ts
git commit -m "Cut over category unions to the new finance taxonomy"
```

---

## Task 6: Accounts table and Convex functions

**Files:**
- Create: `convex/accounts.ts`
- Modify: `convex/schema.ts`

**Interfaces:**
- Consumes: `accountValidator`, `actorArgs` from `./validators`
- Produces: `api.accounts.list`, `api.accounts.setBalance`

- [ ] **Step 1: Add the accounts table to the schema**

In `convex/schema.ts`, inside `defineSchema({ ... })`, after the `incomeDeposits` table, add:

```ts
  /**
   * One row per account, holding the balance the team last verified against
   * the real account. Re-baselined at each audit rather than set once.
   */
  accounts: defineTable({
    account: accountValidator,
    openingBalance: v.number(),
    asOfDate: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_account", ["account"]),
```

Add `accountValidator` to the import list at the top of the file.

- [ ] **Step 2: Write the Convex functions**

Create `convex/accounts.ts`:

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { logAudit } from "./lib";
import { actorArgs, accountValidator } from "./validators";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("accounts").collect();
  },
});

/**
 * Set or re-baseline an account's verified balance. Upserts, because there is
 * exactly one row per account and the team edits it repeatedly after audits.
 */
export const setBalance = mutation({
  args: {
    account: accountValidator,
    openingBalance: v.number(),
    asOfDate: v.string(),
    ...actorArgs,
  },
  handler: async (ctx, args) => {
    const { account, openingBalance, asOfDate, actorName, actorEmail, actorRole } = args;

    if (actorRole !== "admin") {
      throw new Error("Only admins can set account balances");
    }

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_account", (q) => q.eq("account", account))
      .unique();

    const fields = {
      account,
      openingBalance,
      asOfDate,
      updatedAt: Date.now(),
      updatedBy: actorName,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("accounts", fields);
    }

    await logAudit(ctx, { actorName, actorEmail, actorRole }, {
      action: "update",
      entityType: "system",
      entityId: account,
      entityName: account,
      summary: `Set ${account} verified balance to $${openingBalance.toFixed(2)} as of ${asOfDate}`,
    });
  },
});
```

- [ ] **Step 3: Verify the Convex types generate**

Run: `npx convex codegen`
Expected: succeeds, and `convex/_generated/api.d.ts` now mentions `accounts`.

If no Convex deployment is configured in this environment, skip this step — `npm run check` in Task 18 will catch a broken reference.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/accounts.ts
git commit -m "Add accounts table for verified balances"
```

---

## Task 7: Migrate the seed data

**Files:**
- Modify: `src/lib/data/seedData.ts`

**Interfaces:**
- Consumes: `migrateIncomeCategory`, `migrateExpenseCategory` from Task 1
- Produces: seed records carrying new category ids and explicit accounts

- [ ] **Step 1: List the records that need review before touching anything**

Run:

```bash
grep -n "category: 'events'" src/lib/data/seedData.ts
```

Expected: 3 matches. These are the ambiguous ones — the old "Events & Travel" category whose helper text said "District Registration & Lodging". Read each record's `title` and `vendor` and decide per record between `registration_fees`, `competition_travel`, and `outreach_events`. Do not blind-map them.

Record your three decisions in the commit message.

- [ ] **Step 2: Rewrite the expense categories**

Apply these renames throughout `src/lib/data/seedData.ts`, **except** the three `'events'` records you just judged individually:

```bash
sed -i "s/category: 'robot'/category: 'robot_parts'/g;
        s/category: 'tools'/category: 'tools_shop'/g;
        s/category: 'general'/category: 'team_operations'/g" src/lib/data/seedData.ts
```

Then hand-edit each of the three `category: 'events'` records to the category you chose in Step 1.

Note: `sed` here is safe because sponsor records use a disjoint set of category values (`corporate`, `local_business`, `foundation`, `in_kind_supplier`), so none of these patterns can hit a sponsor.

- [ ] **Step 3: Rewrite the income categories**

The two `donation` records must be split by amount, so check each one's `amount` field first:

```bash
grep -n -B4 "category: 'donation'" src/lib/data/seedData.ts
```

For each, use `major_donors` if `amount >= 250`, otherwise `community_donations`. Then apply the unambiguous renames:

```bash
sed -i "s/category: 'fundraiser'/category: 'fundraising'/g;
        s/category: 'bottle_can_drive'/category: 'fundraising'/g;
        s/category: 'merch_sales'/category: 'fundraising'/g;
        s/category: 'camp_registration'/category: 'fundraising'/g" src/lib/data/seedData.ts
```

- [ ] **Step 4: Add explicit accounts to the seed expenses**

Every seed expense needs an `account` field consistent with its `paymentMethod`. Add one line to each expense record, immediately after its `paymentMethod` line:

- `paymentMethod: 'hcb_card'` (7 records) → `account: 'hcb_bank',`
- `paymentMethod: 'school_po'` (3 records) → `account: 'school_account',`
- `paymentMethod: 'grant_voucher'` (1 record) → `account: 'none',`
- `paymentMethod: 'personal_reimbursement'` (2 records) → `account: 'none',` **unless** the record's status is `reimbursed`, in which case use `account: 'hcb_bank',` since the team repaid it from the bank.

Check the two reimbursement records' status before choosing:

```bash
grep -n -A6 "paymentMethod: 'personal_reimbursement'" src/lib/data/seedData.ts
```

- [ ] **Step 5: Verify no legacy ids survive**

Run:

```bash
grep -nE "category: '(robot|tools|events|general|fundraiser|donation|merch_sales|bottle_can_drive|camp_registration|sponsorship_check|other_income)'" src/lib/data/seedData.ts
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/seedData.ts
git commit -m "Migrate seed data to the new finance taxonomy

The three legacy 'events' records were judged individually rather than
blind-mapped: <record> -> <category> for each."
```

---

## Task 8: Store wiring — full HCB pull, accounts, derived finance

**Files:**
- Modify: `src/lib/stores/cacaoStore.svelte.ts`

**Interfaces:**
- Consumes: `buildLedger`, `computeBalances`, `layoutSankey` inputs from Tasks 2–4; `api.accounts.list` from Task 6
- Produces: `cacao.accountConfigs`, `cacao.accountBalances`, `cacao.getFinancialsForSeason(season)` returning `{ entries, incomeByCategory, expensesByCategory, totalIn, totalOut, net }`

- [ ] **Step 1: Add the accounts state field**

In the state block near `hcbSlug` (around line 111), add:

```ts
  accountConfigs = $state<AccountConfig[]>([]);
```

Import the type at the top:

```ts
import type { AccountConfig } from '$lib/finance/balances';
```

- [ ] **Step 2: Subscribe to the accounts table**

In `subscribeToConvex`, add `'accounts'` to the `pending` Set, and add a subscription alongside the others:

```ts
    track(
      client.onUpdate(
        api.accounts.list,
        {},
        (rows) => {
          this.accountConfigs = rows;
          settle('accounts');
        },
        onError
      )
    );
```

- [ ] **Step 3: Page through the whole HCB transaction history**

In `syncHackClubBank`, replace the single transactions fetch (the `// 2. Fetch recent transactions feed` block) with:

```ts
      // 2. Page through the full transaction history. The org has a couple of
      // hundred records all-time, so a complete pull is cheap and the Sankey
      // needs more than the most recent page.
      const all: HCBTransaction[] = [];
      const PER_PAGE = 100;
      const MAX_PAGES = 10; // runaway guard, not an expected limit
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetch(
          `https://hcb.hackclub.com/api/v3/organizations/${slug}/transactions?per_page=${PER_PAGE}&page=${page}`
        );
        if (!res.ok) break;
        const batch: HCBTransaction[] = await res.json();
        all.push(...batch);
        if (batch.length < PER_PAGE) break;
      }
      if (all.length > 0) {
        this.hcbTransactions = all;
        saveStored(STORAGE_KEYS.HCB_TXNS, all);
      }
```

- [ ] **Step 4: Add the derived balances getter**

Add a getter beside `get metrics()`:

```ts
  /**
   * Current balances. Deliberately not season-scoped — "how much do we have
   * right now" is one present-tense number, so this ignores selectedSeason.
   */
  get accountBalances() {
    return computeBalances({
      configs: this.accountConfigs,
      deposits: this.incomeDeposits,
      expenses: this.expenses,
      hcbMeasuredBalance: this.hcbOrg ? (this.hcbOrg.balances?.balance_cents ?? 0) / 100 : undefined
    });
  }
```

Import at the top: `import { computeBalances } from '$lib/finance/balances';`

- [ ] **Step 5: Replace the category rollups in `getFinancialsForSeason`**

Import at the top:

```ts
import { buildLedger } from '$lib/finance/ledger';
import { INCOME_CATEGORY_META, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
import type { IncomeCategory, ExpenseCategory } from '$lib/finance/categories';
```

Inside `getFinancialsForSeason`, delete the `depositsByCategory`, `depositsByAccount`, `expensesByCategory`, and `categoryCounts` object literals (roughly lines 1270-1315) and replace them with:

```ts
    const { entries } = buildLedger({
      expenses: this.expenses,
      deposits: this.incomeDeposits,
      hcbTransactions: this.hcbTransactions,
      season: seasonKey
    });

    const sumBy = <K extends string>(dir: 'in' | 'out', keys: K[]) =>
      Object.fromEntries(
        keys.map((k) => [k, entries
          .filter((e) => e.direction === dir && e.category === k)
          .reduce((s, e) => s + e.amount, 0)])
      ) as Record<K, number>;

    const incomeByCategory = sumBy('in', Object.keys(INCOME_CATEGORY_META) as IncomeCategory[]);
    const expensesByCategory = sumBy('out', Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[]);

    // Grants and sponsorships are recorded on their own tabs, never as deposits,
    // so they are added to the income side here rather than read from the ledger.
    incomeByCategory.grants = totalAwarded;
    incomeByCategory.sponsorships = totalSponsorFunding;

    const totalIn = Object.values(incomeByCategory).reduce((s, n) => s + n, 0);
    const totalOut = Object.values(expensesByCategory).reduce((s, n) => s + n, 0);
```

- [ ] **Step 6: Update the return object**

In the returned object, remove `depositsByCategory`, `depositsByAccount`, `expensesByCategory`, `categoryCounts`, `totalRaised`, `totalSpent`, and `netBalance`, and add:

```ts
      entries,
      incomeByCategory,
      expensesByCategory,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
```

Keep `totalAwarded`, `awardedCount`, `awardedGrants`, `totalSponsorFunding`, `totalSponsorReceived`, `totalSponsorPledged`, and `contributingSponsors` — the breakdown still uses them.

- [ ] **Step 7: Verify**

Run: `npm test`
Expected: PASS.

Run: `npm run check`
Expected: still failing, but the error count should have *dropped* — `FinancialsView.svelte` will now report missing properties like `totalRaised`, which Task 13 fixes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/cacaoStore.svelte.ts
git commit -m "Wire store to finance modules and pull full HCB history"
```

---

## Task 9: Flow color tokens

**Files:**
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: nothing
- Produces: `--color-flow-1` … `--color-flow-11`, `--color-flow-muted`

- [ ] **Step 1: Add the light-theme tokens**

In `src/styles/app.css`, in the bare `:root` block, after the `--color-brand-bone` line, add:

```css
  /* Sankey flow palette. Eleven hues, because the six Material tones cannot
     tell eleven categories apart. Income reads cool, spending reads warm. */
  --color-flow-1: #1B6B5A;
  --color-flow-2: #2A7DA8;
  --color-flow-3: #3F6BC4;
  --color-flow-4: #6B5BC4;
  --color-flow-5: #2E8B57;
  --color-flow-6: #C0392B;
  --color-flow-7: #D4762A;
  --color-flow-8: #B8860B;
  --color-flow-9: #A0522D;
  --color-flow-10: #B04A6E;
  --color-flow-11: #7A5C3E;
  --color-flow-muted: #9A9494;
```

- [ ] **Step 2: Add the dark-theme tokens to both dark blocks**

Add this identical block inside **both** `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and `:root[data-theme="dark"] { ... }`:

```css
  /* Lifted lightness and reduced saturation so ribbons stay distinguishable
     against the dark surface without glowing. */
  --color-flow-1: #5FCFB5;
  --color-flow-2: #6FC2E8;
  --color-flow-3: #8AA8F0;
  --color-flow-4: #B09CF0;
  --color-flow-5: #6FCF97;
  --color-flow-6: #F08A7E;
  --color-flow-7: #F0A868;
  --color-flow-8: #E0C264;
  --color-flow-9: #D9A184;
  --color-flow-10: #E895B4;
  --color-flow-11: #C4A98A;
  --color-flow-muted: #8A8585;
```

- [ ] **Step 3: Verify all three blocks define every token**

Run:

```bash
grep -c "color-flow-1:" src/styles/app.css
```

Expected: `3`. If it prints anything else, one of the blocks is missing the palette and dark mode will fall back to unset colors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/app.css
git commit -m "Add theme-aware Sankey flow palette"
```

---

## Task 10: SankeyFlow component

**Files:**
- Create: `src/lib/components/analytics/SankeyFlow.svelte`

**Interfaces:**
- Consumes: `layoutSankey`, `SankeyCategory` from `$lib/finance/sankey`
- Produces: `<SankeyFlow {incoming} {outgoing} {seasonLabel} />`

- [ ] **Step 1: Write the component**

Create `src/lib/components/analytics/SankeyFlow.svelte`:

```svelte
<script lang="ts">
  import { layoutSankey, type SankeyCategory } from '$lib/finance/sankey';

  interface Props {
    incoming: SankeyCategory[];
    outgoing: SankeyCategory[];
    seasonLabel: string;
  }

  let { incoming, outgoing, seasonLabel }: Props = $props();

  const WIDTH = 900;
  const HEIGHT = 420;
  /** Room for the labels that sit outside the node bars. */
  const PAD_X = 150;

  const layout = $derived(
    layoutSankey({ incoming, outgoing, width: WIDTH - PAD_X * 2, height: HEIGHT })
  );

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const pct = (value: number, total: number) =>
    total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';

  const isEmpty = $derived(layout.nodes.length === 0);
</script>

{#if isEmpty}
  <div class="card-elevated p-10 text-center" style="color: var(--color-on-surface-variant)">
    <p class="type-title-sm">No money recorded for {seasonLabel}</p>
    <p class="type-body-sm mt-1">Log a deposit or an expense and the flow will appear here.</p>
  </div>
{:else}
  <!-- Below sm the diagram is unreadable, so the breakdown below the chart
       serves as both the mobile view and the accessible text equivalent. -->
  <div class="card-elevated hidden p-4 sm:block">
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      class="h-auto w-full"
      role="img"
      aria-labelledby="sankey-title sankey-desc"
    >
      <title id="sankey-title">Money in and out for {seasonLabel}</title>
      <desc id="sankey-desc">
        {money(layout.totalIn)} in from {incoming.length} sources,
        {money(layout.totalOut)} out across {outgoing.length} categories.
        The same figures are listed in the breakdown below this chart.
      </desc>

      <g transform={`translate(${PAD_X}, 0)`} aria-hidden="true">
        {#each layout.links as link (link.id)}
          <path d={link.path} fill={link.color} opacity="0.35" />
        {/each}

        {#each layout.nodes as node (node.id)}
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill={node.color}
            rx="2"
          />
        {/each}
      </g>

      <g aria-hidden="true" style="font-size: 12px">
        {#each layout.nodes.filter((n) => n.column === 'in') as node (node.id)}
          <text
            x={PAD_X - 10}
            y={node.y + node.height / 2}
            text-anchor="end"
            dominant-baseline="middle"
            fill="var(--color-on-surface)"
          >
            <tspan font-weight="600">{node.label}</tspan>
            <tspan x={PAD_X - 10} dy="14" fill="var(--color-on-surface-variant)">
              {money(node.value)} ({pct(node.value, layout.totalIn)})
            </tspan>
          </text>
        {/each}

        {#each layout.nodes.filter((n) => n.column === 'out') as node (node.id)}
          <text
            x={WIDTH - PAD_X + 10}
            y={node.y + node.height / 2}
            dominant-baseline="middle"
            fill="var(--color-on-surface)"
          >
            <tspan font-weight="600">{node.label}</tspan>
            <tspan x={WIDTH - PAD_X + 10} dy="14" fill="var(--color-on-surface-variant)">
              {money(node.value)} ({pct(node.value, layout.totalOut)})
            </tspan>
          </text>
        {/each}
      </g>
    </svg>
  </div>
{/if}
```

- [ ] **Step 2: Verify it type-checks in isolation**

Run: `npm run check 2>&1 | grep -i "SankeyFlow" || echo "no SankeyFlow errors"`
Expected: `no SankeyFlow errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/analytics/SankeyFlow.svelte
git commit -m "Add SankeyFlow chart component"
```

---

## Task 11: CategoryBreakdown component

**Files:**
- Create: `src/lib/components/analytics/CategoryBreakdown.svelte`

**Interfaces:**
- Consumes: `LedgerEntry` from `$lib/finance/ledger`; `INCOME_CATEGORY_META`, `EXPENSE_CATEGORY_META` from `$lib/finance/categories`
- Produces: `<CategoryBreakdown {entries} {incomeByCategory} {expensesByCategory} {totalIn} {totalOut} />`

- [ ] **Step 1: Write the component**

Create `src/lib/components/analytics/CategoryBreakdown.svelte`:

```svelte
<script lang="ts">
  import type { LedgerEntry } from '$lib/finance/ledger';
  import { INCOME_CATEGORY_META, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import { ChevronRight, Landmark } from 'lucide-svelte';

  interface Props {
    entries: LedgerEntry[];
    incomeByCategory: Record<string, number>;
    expensesByCategory: Record<string, number>;
    totalIn: number;
    totalOut: number;
  }

  let { entries, incomeByCategory, expensesByCategory, totalIn, totalOut }: Props = $props();

  let expanded = $state<string | null>(null);

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  interface Row {
    id: string;
    label: string;
    note: string;
    color: string;
    value: number;
    pct: number;
  }

  function rowsFrom(
    totals: Record<string, number>,
    meta: Record<string, { label: string; note: string; flow: string }>,
    total: number
  ): Row[] {
    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([id, value]) => ({
        id,
        label: meta[id].label,
        note: meta[id].note,
        color: meta[id].flow,
        value,
        pct: total > 0 ? Math.round((value / total) * 100) : 0
      }))
      .sort((a, b) => b.value - a.value);
  }

  const incomeRows = $derived(rowsFrom(incomeByCategory, INCOME_CATEGORY_META, totalIn));
  const expenseRows = $derived(rowsFrom(expensesByCategory, EXPENSE_CATEGORY_META, totalOut));

  function entriesFor(direction: 'in' | 'out', category: string) {
    return entries.filter((e) => e.direction === direction && e.category === category);
  }

  function toggle(key: string) {
    expanded = expanded === key ? null : key;
  }
</script>

{#snippet column(title: string, rows: Row[], direction: 'in' | 'out', total: number)}
  <section class="card-elevated space-y-3 p-5">
    <div class="flex items-baseline justify-between">
      <h2 class="type-title">{title}</h2>
      <span class="type-label type-num">{money(total)}</span>
    </div>

    <div class="space-y-1">
      {#each rows as row (row.id)}
        {@const key = `${direction}:${row.id}`}
        {@const isOpen = expanded === key}
        <div>
          <button
            type="button"
            class="w-full p-2.5 text-left transition-colors hover:bg-[var(--color-surface-container)]"
            style="border-radius: var(--shape-m)"
            aria-expanded={isOpen}
            onclick={() => toggle(key)}
          >
            <div class="flex items-center gap-2">
              <ChevronRight
                size={14}
                class="shrink-0 transition-transform"
                style={isOpen ? 'transform: rotate(90deg)' : ''}
              />
              <span class="type-label flex-1 truncate">{row.label}</span>
              <span class="type-num type-label-sm" style="color: var(--color-on-surface-variant)">
                {row.pct}%
              </span>
              <span class="type-label type-num w-24 text-right">{money(row.value)}</span>
            </div>
            <div class="progress-track mt-1.5 ml-6" style="height: 6px">
              <span class="progress-bar" style={`width: ${row.pct}%; background: ${row.color}`}></span>
            </div>
          </button>

          {#if isOpen}
            <ul class="ml-6 space-y-1 py-2">
              {#each entriesFor(direction, row.id) as entry (entry.id)}
                <li class="flex items-center gap-2 px-2.5 py-1 text-sm">
                  <span class="min-w-0 flex-1 truncate" style="color: var(--color-on-surface-variant)">
                    {entry.title}
                  </span>
                  {#if entry.source === 'hcb'}
                    <span class="chip chip-sm" title="From Hack Club Bank, never logged here">
                      <Landmark size={11} />
                      HCB
                    </span>
                  {:else if entry.hcbTransactionId}
                    <span class="chip chip-sm chip-success" title="Logged here and confirmed against the bank">
                      Cleared
                    </span>
                  {/if}
                  <span class="type-num shrink-0 text-xs">{money(entry.amount)}</span>
                </li>
              {:else}
                <li class="px-2.5 py-1 text-sm" style="color: var(--color-on-surface-variant)">
                  Nothing itemised — this total comes from the Grants or Sponsors tab.
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        <p class="py-6 text-center type-body-sm" style="color: var(--color-on-surface-variant)">
          Nothing recorded yet.
        </p>
      {/each}
    </div>
  </section>
{/snippet}

<div class="grid gap-4 lg:grid-cols-2">
  {@render column('Money in', incomeRows, 'in', totalIn)}
  {@render column('Money out', expenseRows, 'out', totalOut)}
</div>
```

- [ ] **Step 2: Verify**

Run: `npm run check 2>&1 | grep -i "CategoryBreakdown" || echo "no CategoryBreakdown errors"`
Expected: `no CategoryBreakdown errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/analytics/CategoryBreakdown.svelte
git commit -m "Add category breakdown with inline ledger drilldown"
```

---

## Task 12: AccountBalances component

**Files:**
- Create: `src/lib/components/analytics/AccountBalances.svelte`

**Interfaces:**
- Consumes: `AccountBalance` from `$lib/finance/balances`; `ACCOUNT_META` from `$lib/finance/categories`
- Produces: `<AccountBalances {balances} />`

- [ ] **Step 1: Write the component**

Create `src/lib/components/analytics/AccountBalances.svelte`:

```svelte
<script lang="ts">
  import type { AccountBalance } from '$lib/finance/balances';
  import { ACCOUNT_META } from '$lib/finance/categories';
  import { Landmark, School, Package, TriangleAlert } from 'lucide-svelte';

  interface Props {
    balances: AccountBalance[];
  }

  let { balances }: Props = $props();

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  const ICONS = { hcb_bank: Landmark, school_account: School, cash_box: Package };

  const total = $derived(balances.reduce((sum, b) => sum + b.balance, 0));
</script>

<section class="card-elevated space-y-4 p-5">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <div>
      <h2 class="type-title">What we have right now</h2>
      <!-- The season dropdown does not apply here, and saying so prevents the
           strip reading as though it were filtered along with the rest. -->
      <p class="type-body-sm text-xs" style="color: var(--color-on-surface-variant)">
        Current balances across all accounts, not filtered by season
      </p>
    </div>
    <p class="stat-value type-num">{money(total)}</p>
  </div>

  <div class="grid gap-3 sm:grid-cols-3">
    {#each balances as bal (bal.account)}
      {@const meta = ACCOUNT_META[bal.account]}
      {@const Icon = ICONS[bal.account]}
      <div class="p-3" style="border-radius: var(--shape-m); background: var(--color-surface-container)">
        <div class="flex items-center gap-2">
          <Icon size={16} style="color: var(--color-on-surface-variant)" />
          <span class="type-label-sm truncate">{meta.label}</span>
        </div>

        <p class="stat-value mt-1 text-xl type-num">{money(bal.balance)}</p>

        <p class="type-label-sm mt-0.5 text-xs" style="color: var(--color-on-surface-variant)">
          {#if bal.source === 'measured'}
            Live balance from Hack Club Bank
          {:else}
            Verified {bal.asOfDate}, plus activity since
          {/if}
        </p>

        {#if bal.drift !== undefined}
          <p class="type-label-sm mt-1.5 flex items-start gap-1 text-xs" style="color: var(--color-error)">
            <TriangleAlert size={12} class="mt-0.5 shrink-0" />
            <span>
              Our records say {money(bal.computed)} — off by {money(Math.abs(bal.drift))}.
              Something is miscategorised or was never logged.
            </span>
          </p>
        {/if}
      </div>
    {/each}
  </div>
</section>
```

- [ ] **Step 2: Verify**

Run: `npm run check 2>&1 | grep -i "AccountBalances" || echo "no AccountBalances errors"`
Expected: `no AccountBalances errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/analytics/AccountBalances.svelte
git commit -m "Add account balance strip"
```

---

## Task 13: Rewrite FinancialsView and delete HCBTreasuryCard

**Files:**
- Rewrite: `src/lib/components/analytics/FinancialsView.svelte`
- Delete: `src/lib/components/expenses/HCBTreasuryCard.svelte`

**Interfaces:**
- Consumes: everything from Tasks 8, 10, 11, 12
- Produces: the finished Finances page

- [ ] **Step 1: Replace the whole file**

Overwrite `src/lib/components/analytics/FinancialsView.svelte`:

```svelte
<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import SankeyFlow from './SankeyFlow.svelte';
  import CategoryBreakdown from './CategoryBreakdown.svelte';
  import AccountBalances from './AccountBalances.svelte';
  import { INCOME_CATEGORY_META, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import type { SankeyCategory } from '$lib/finance/sankey';
  import { Calendar } from 'lucide-svelte';

  let selectedYearSeason = $state<string>('2026-2027');

  const availableSeasons = [
    { value: '2026-2027', label: '2026-2027' },
    { value: '2025-2026', label: '2025-2026' },
    { value: '2024-2025', label: '2024-2025' },
    { value: 'all', label: 'All time' }
  ];

  const seasonLabel = $derived(
    availableSeasons.find((s) => s.value === selectedYearSeason)?.label ?? selectedYearSeason
  );

  const fin = $derived(cacao.getFinancialsForSeason(selectedYearSeason));

  function toCategories(
    totals: Record<string, number>,
    meta: Record<string, { label: string; flow: string }>
  ): SankeyCategory[] {
    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([id, value]) => ({ id, label: meta[id].label, value, color: meta[id].flow }))
      .sort((a, b) => b.value - a.value);
  }

  const incoming = $derived(toCategories(fin.incomeByCategory, INCOME_CATEGORY_META));
  const outgoing = $derived(toCategories(fin.expensesByCategory, EXPENSE_CATEGORY_META));
</script>

<PageHeader title="Finances" description={`Where the money came from and went in ${seasonLabel}`}>
  {#snippet actions()}
    <div class="relative flex items-center">
      <Calendar size={16} class="pointer-events-none absolute left-3" style="color: var(--color-primary)" />
      <select
        bind:value={selectedYearSeason}
        class="select-input cursor-pointer rounded-full py-2 pl-9 pr-8 text-sm font-medium"
        style="background: var(--color-surface-container); border: 1px solid var(--color-outline-variant);"
        aria-label="Filter finances by season"
      >
        {#each availableSeasons as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
  {/snippet}
</PageHeader>

<div class="space-y-6">
  <!-- Present tense, and deliberately outside the season filter. -->
  <AccountBalances balances={cacao.accountBalances} />

  <SankeyFlow {incoming} {outgoing} {seasonLabel} />

  <CategoryBreakdown
    entries={fin.entries}
    incomeByCategory={fin.incomeByCategory}
    expensesByCategory={fin.expensesByCategory}
    totalIn={fin.totalIn}
    totalOut={fin.totalOut}
  />
</div>
```

- [ ] **Step 2: Delete the treasury card**

```bash
git rm src/lib/components/expenses/HCBTreasuryCard.svelte
```

- [ ] **Step 3: Confirm nothing still imports it**

Run:

```bash
grep -rn "HCBTreasuryCard" src/ || echo "no references"
```

Expected: `no references`.

- [ ] **Step 4: Verify**

Run: `npm run check 2>&1 | grep -iE "FinancialsView|HCBTreasury" || echo "no errors in the rewritten view"`
Expected: `no errors in the rewritten view`.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/components/analytics/FinancialsView.svelte src/lib/components/expenses/HCBTreasuryCard.svelte
git commit -m "Rewrite Finances as a Sankey dashboard"
```

---

## Task 14: Expense forms — account field, new categories, no emoji

**Files:**
- Modify: `src/lib/components/expenses/AddExpenseModal.svelte`, `src/lib/components/expenses/ExpenseModal.svelte`, `src/lib/components/expenses/MarkPurchasedModal.svelte`

**Interfaces:**
- Consumes: `EXPENSE_FORM_CATEGORIES`, `EXPENSE_CATEGORY_META`, `ACCOUNT_META`, `suggestAccountForPaymentMethod` from `$lib/finance/categories`
- Produces: expenses carrying `category` in the new taxonomy and an explicit `account`

- [ ] **Step 1: Build the shared option lists in each expense modal**

In each of the three files, add to the `<script>` block:

```ts
  import {
    EXPENSE_FORM_CATEGORIES,
    EXPENSE_CATEGORY_META,
    ACCOUNT_META,
    suggestAccountForPaymentMethod
  } from '$lib/finance/categories';

  const categoryOptions = EXPENSE_FORM_CATEGORIES.map((id) => ({
    value: id,
    label: EXPENSE_CATEGORY_META[id].label
  }));

  const accountOptions = [
    ...Object.entries(ACCOUNT_META).map(([value, meta]) => ({ value, label: meta.label })),
    { value: 'none', label: 'No team account (voucher or unrepaid personal purchase)' }
  ];
```

Replace each file's existing hand-written category option array with `categoryOptions`.

- [ ] **Step 2: Strip the emoji from `MarkPurchasedModal.svelte`**

Replace the `paymentMethodOptions` and `deliveryStatusOptions` arrays (currently lines 41-64) with:

```ts
  const paymentMethodOptions = $derived([
    ...(expense?.paymentMethod === 'hcb_card'
      ? [{ value: 'hcb_card', label: 'Hack Club Bank debit card' }]
      : []),
    { value: 'personal_reimbursement', label: 'Personal card (reimbursement needed)' },
    { value: 'school_po', label: 'Region 15 school PO or check' },
    { value: 'grant_voucher', label: 'Grant voucher or vendor credit' },
    { value: 'cash', label: 'Cash' }
  ]);

  const deliveryStatusOptions = [
    { value: 'ordered', label: 'Order placed' },
    { value: 'shipped', label: 'Shipped' },
    { value: 'delivered', label: 'Delivered' }
  ];
```

- [ ] **Step 3: Add the account selector to `MarkPurchasedModal.svelte`**

Add state, and an effect that follows the payment method until the user overrides it:

```ts
  let account = $state<string>('none');
  let accountTouched = $state(false);

  // The account follows the payment method until someone deliberately changes
  // it — the two usually agree, but not for vouchers or reimbursements.
  $effect(() => {
    if (!accountTouched) account = suggestAccountForPaymentMethod(paymentMethod);
  });
```

Add the select to the form markup, directly after the payment method select:

```svelte
<M3Select
  label="Which account paid"
  bind:value={account}
  options={accountOptions}
  helper="Choose 'no team account' for vouchers, or for a personal purchase not yet repaid"
  onchange={() => (accountTouched = true)}
/>
```

Include `account` in the object passed to `cacao.updateExpense(...)` in `handleSubmit`.

- [ ] **Step 4: Strip the emoji from `ExpenseModal.svelte`**

Replace the `✨ Saved $... on discount!` line (around line 254) with:

```svelte
            Saved ${(amount - finalPaidAmount).toFixed(2)} on this purchase
```

- [ ] **Step 5: Verify no emoji remain in the expense components**

Run:

```bash
grep -rP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]" src/lib/components/expenses/ || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/expenses/
git commit -m "Add explicit account to expense forms and drop emoji labels"
```

---

## Task 15: Merged Expenses list

**Files:**
- Modify: `src/lib/components/expenses/ExpensesList.svelte`

**Interfaces:**
- Consumes: `buildLedger` output via `cacao.getFinancialsForSeason`
- Produces: an Expenses tab showing logged records and unmatched HCB charges together

- [ ] **Step 1: Replace the filtered list with ledger entries**

In the `<script>` block, replace the `filteredExpenses` derivation with:

```ts
  import { buildLedger } from '$lib/finance/ledger';
  import { EXPENSE_FORM_CATEGORIES, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import { Landmark } from 'lucide-svelte';

  let sourceFilter = $state<'all' | 'logged' | 'hcb'>('all');

  const ledger = $derived(
    buildLedger({
      expenses: cacao.expenses,
      deposits: [],
      hcbTransactions: cacao.hcbTransactions,
      season: cacao.selectedSeason
    })
  );

  const rows = $derived.by(() => {
    let list = ledger.entries.filter((e) => e.direction === 'out');
    if (sourceFilter !== 'all') list = list.filter((e) => e.source === sourceFilter);
    if (statusFilter !== 'all') {
      list = list.filter((e) => e.expense?.status === statusFilter);
    }
    if (categoryFilter !== 'all') list = list.filter((e) => e.category === categoryFilter);
    return list;
  });

  const expenseCategories = EXPENSE_FORM_CATEGORIES.map((id) => ({
    id,
    label: EXPENSE_CATEGORY_META[id].label
  }));
```

- [ ] **Step 2: Add the source filter chips**

Beside the existing status filter chips, add:

```svelte
<button
  type="button"
  aria-pressed={sourceFilter === 'all'}
  onclick={() => (sourceFilter = 'all')}
  class="filter-chip"
>
  All sources
</button>
<button
  type="button"
  aria-pressed={sourceFilter === 'hcb'}
  onclick={() => (sourceFilter = 'hcb')}
  class="filter-chip"
>
  Bank only
  <span class="type-num opacity-70">
    {ledger.entries.filter((e) => e.direction === 'out' && e.source === 'hcb').length}
  </span>
</button>
```

- [ ] **Step 3: Render both kinds of row**

Change the table body to iterate `rows`. An HCB-sourced row is read-only — no click handler, no delete, no edit:

```svelte
{#each rows as row (row.id)}
  <tr
    class={row.source === 'hcb' || isViewer ? '' : 'row-interactive'}
    onclick={() => {
      if (row.source === 'logged' && !isViewer && row.expense) {
        selectedExpenseForEdit = cacao.expenses.find((e) => e._id === row.expense!._id) ?? null;
      }
    }}
  >
    <td class="max-w-sm">
      <p class="type-label truncate">{row.title}</p>
      <p class="type-label-sm mt-0.5 truncate" style="color: var(--color-on-surface-variant)">
        {row.expense?.vendor ?? 'Hack Club Bank'}
      </p>
    </td>

    <td class="type-label type-num">${row.amount.toFixed(2)}</td>

    <td style="color: var(--color-on-surface-variant)">
      {EXPENSE_CATEGORY_META[row.category as keyof typeof EXPENSE_CATEGORY_META]?.label ?? row.category}
    </td>

    <td class="type-num" style="color: var(--color-on-surface-variant)">{row.date}</td>

    <td>
      {#if row.source === 'hcb'}
        <span class="chip chip-sm" title="On the bank feed, never logged here">
          <Landmark size={11} />
          Bank only
        </span>
      {:else if row.hcbTransactionId}
        <span class="chip chip-sm chip-success" title="Logged here and confirmed against the bank">
          Cleared
        </span>
      {:else if row.expense}
        <span class={`chip chip-sm ${TONE_CHIP[statusMeta(row.expense as never).tone]}`}>
          {statusMeta(row.expense as never).label}
        </span>
      {/if}
    </td>
  </tr>
{/each}
```

- [ ] **Step 4: Move the HCB sync button into the page header**

In the `PageHeader` `actions` snippet, before the export button, add:

```svelte
<button
  type="button"
  class="btn btn-outlined"
  disabled={cacao.isHcbSyncing}
  onclick={() => cacao.syncHackClubBank(true)}
>
  <RefreshCw size={18} class={cacao.isHcbSyncing ? 'animate-spin' : ''} />
  <span>Sync bank</span>
</button>
```

Import `RefreshCw` from `lucide-svelte`.

- [ ] **Step 5: Verify**

Run: `npm run check 2>&1 | grep -i "ExpensesList" || echo "no ExpensesList errors"`
Expected: `no ExpensesList errors`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/expenses/ExpensesList.svelte
git commit -m "Merge HCB charges into the Expenses tab"
```

---

## Task 16: Merged Deposits list and deposit form

**Files:**
- Modify: `src/lib/components/deposits/DepositsList.svelte`, `src/lib/components/deposits/LogDepositModal.svelte`

**Interfaces:**
- Consumes: `buildLedger`, `DEPOSIT_FORM_CATEGORIES`, `INCOME_CATEGORY_META`, `MAJOR_DONOR_THRESHOLD`, `ACCOUNT_META`
- Produces: a Deposits tab showing logged deposits and unmatched HCB income together

- [ ] **Step 1: Replace the emoji option lists in `LogDepositModal.svelte`**

Replace `categoryOptions` and `accountOptions` (currently lines 45-62) with:

```ts
  import {
    DEPOSIT_FORM_CATEGORIES,
    INCOME_CATEGORY_META,
    ACCOUNT_META,
    MAJOR_DONOR_THRESHOLD
  } from '$lib/finance/categories';

  const categoryOptions = DEPOSIT_FORM_CATEGORIES.map((id) => ({
    value: id,
    label: INCOME_CATEGORY_META[id].label
  }));

  const accountOptions = Object.entries(ACCOUNT_META).map(([value, meta]) => ({
    value,
    label: meta.label
  }));
```

- [ ] **Step 2: Change the default category and suggest by amount**

Change the initial state from `'fundraiser'` to `'fundraising'` in both the `$state` declaration and the `$effect` reset branch. Then add, after the existing `$effect`:

```ts
  let categoryTouched = $state(false);

  // A gift's size decides which donor bucket it belongs in, so suggest that as
  // the amount is typed — but stop as soon as the user picks for themselves.
  $effect(() => {
    if (categoryTouched) return;
    if (category !== 'major_donors' && category !== 'community_donations') return;
    category = amount >= MAJOR_DONOR_THRESHOLD ? 'major_donors' : 'community_donations';
  });
```

Set `categoryTouched = true` from the category select's `onchange`.

- [ ] **Step 3: Add the helper pointing at the Sponsors tab**

On the category `M3Select`, add:

```svelte
helper="Sponsor cheques and grant awards belong on the Sponsors and Grants tabs, not here"
```

- [ ] **Step 4: Merge HCB income into `DepositsList.svelte`**

Mirror Task 15. Replace `filteredDeposits` with:

```ts
  import { buildLedger } from '$lib/finance/ledger';
  import { DEPOSIT_FORM_CATEGORIES, INCOME_CATEGORY_META } from '$lib/finance/categories';

  let sourceFilter = $state<'all' | 'logged' | 'hcb'>('all');

  const ledger = $derived(
    buildLedger({
      expenses: [],
      deposits: cacao.incomeDeposits,
      hcbTransactions: cacao.hcbTransactions,
      season: cacao.selectedSeason
    })
  );

  const rows = $derived.by(() => {
    let list = ledger.entries.filter((e) => e.direction === 'in');
    if (sourceFilter !== 'all') list = list.filter((e) => e.source === sourceFilter);
    if (depositCategoryFilter !== 'all') list = list.filter((e) => e.category === depositCategoryFilter);
    return list;
  });

  const depositCategories = DEPOSIT_FORM_CATEGORIES;
```

Update the table body to iterate `rows`, using the same read-only treatment for `source === 'hcb'` rows as Task 15 Step 3, and replace `titleCase(cat)` with `INCOME_CATEGORY_META[cat].label` in the filter chips.

- [ ] **Step 5: Add the sync button to the Deposits header**

Same button as Task 15 Step 4.

- [ ] **Step 6: Verify no emoji remain anywhere**

Run:

```bash
grep -rP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]" src/ || echo "clean"
```

Expected: `clean`. If `src/lib/data/seedData.ts` still matches, remove the warning emoji from that sponsor note now.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/deposits/ src/lib/data/seedData.ts
git commit -m "Merge HCB income into the Deposits tab and drop emoji labels"
```

---

## Task 17: Admin panel account balance editing

**Files:**
- Modify: `src/lib/components/admin/AdminPanel.svelte`, `src/lib/stores/cacaoStore.svelte.ts`

**Interfaces:**
- Consumes: `api.accounts.setBalance` from Task 6; `cacao.accountBalances` from Task 8
- Produces: `cacao.setAccountBalance(account, openingBalance, asOfDate)`

- [ ] **Step 1: Add the store method**

In `cacaoStore.svelte.ts`, beside the other mutation methods:

```ts
  setAccountBalance(account: Account, openingBalance: number, asOfDate: string) {
    if (this.currentUser.role !== 'admin') {
      this.showToast('Only admins can set account balances', 'error');
      return;
    }

    const existing = this.accountConfigs.find((c) => c.account === account);
    const next = { account, openingBalance, asOfDate };
    this.accountConfigs = existing
      ? this.accountConfigs.map((c) => (c.account === account ? next : c))
      : [...this.accountConfigs, next];

    this.push(api.accounts.setBalance, { ...next, ...this.actor });
    this.showToast(`Set ${account} balance to $${openingBalance.toFixed(2)}`);
  }
```

Import `Account` from `$lib/finance/categories`.

- [ ] **Step 2: Add the admin section**

In `AdminPanel.svelte`, add a section rendering one row per account with a number input for the balance, a date input for the as-of date, and a save button. Pre-fill both from `cacao.accountBalances`.

```svelte
<section class="card-elevated space-y-3 p-5">
  <div>
    <h2 class="type-title">Account balances</h2>
    <!-- This is re-run after each audit, not filled in once. -->
    <p class="type-body-sm" style="color: var(--color-on-surface-variant)">
      After checking an account against its real statement, enter the true balance
      and the date you checked it. Activity after that date is added automatically.
    </p>
  </div>

  {#each cacao.accountBalances as bal (bal.account)}
    {@const meta = ACCOUNT_META[bal.account]}
    <div class="flex flex-wrap items-end gap-3 p-3" style="border-radius: var(--shape-m); background: var(--color-surface-container)">
      <span class="type-label min-w-32 flex-1">{meta.label}</span>
      <M3Input
        label="Verified balance"
        type="number"
        value={String(bal.openingBalance)}
        onchange={(e) => (drafts[bal.account] = { ...drafts[bal.account], openingBalance: Number(e.currentTarget.value) })}
      />
      <M3Input
        label="As of"
        type="date"
        value={bal.asOfDate}
        onchange={(e) => (drafts[bal.account] = { ...drafts[bal.account], asOfDate: e.currentTarget.value })}
      />
      <button
        type="button"
        class="btn btn-filled"
        onclick={() =>
          cacao.setAccountBalance(
            bal.account,
            drafts[bal.account]?.openingBalance ?? bal.openingBalance,
            drafts[bal.account]?.asOfDate ?? bal.asOfDate
          )}
      >
        Save
      </button>
    </div>
  {/each}
</section>
```

Declare the draft state near the top of the script:

```ts
  let drafts = $state<Record<string, { openingBalance: number; asOfDate: string }>>({});
```

Import `ACCOUNT_META` and `M3Input`.

- [ ] **Step 3: Verify**

Run: `npm run check 2>&1 | grep -i "AdminPanel" || echo "no AdminPanel errors"`
Expected: `no AdminPanel errors`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/admin/AdminPanel.svelte src/lib/stores/cacaoStore.svelte.ts
git commit -m "Add admin account balance re-baselining"
```

---

## Task 18: Full verification

**Files:** none — this task only verifies.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. Four test files, all green.

- [ ] **Step 2: Run the type checker**

Run: `npm run check`
Expected: **zero errors**. This is the gate — the count you noted in Task 5 must now be zero. If anything remains, fix it before continuing; do not proceed with known type errors.

- [ ] **Step 3: Confirm no legacy category ids survive anywhere**

Run:

```bash
grep -rnE "'(robot|tools|events|general|fundraiser|merch_sales|bottle_can_drive|camp_registration|sponsorship_check|other_income)'" src/ convex/ --include=*.ts --include=*.svelte | grep -v node_modules || echo "clean"
```

Expected: `clean`. A hit in `categories.ts` is fine — that file must keep the legacy names to migrate them; anywhere else is a miss.

- [ ] **Step 4: Confirm no emoji survive**

Run:

```bash
grep -rP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]" src/ convex/ || echo "clean"
```

Expected: `clean`.

- [ ] **Step 5: Drive the app**

Run: `npm run dev`, then check each of these by hand. The type checker cannot catch any of them.

- Finances page renders the Sankey with ribbons whose thickness matches the numbers.
- Switching the season dropdown changes the Sankey and breakdown but leaves the balance strip **unchanged**.
- Toggling the OS or app theme keeps all eleven ribbon colors distinguishable.
- Narrowing the browser below the `sm` breakpoint hides the Sankey and leaves the breakdown readable.
- Expenses tab shows both logged rows and bank-only rows; bank-only rows do not open an edit modal.
- Deposits tab likewise.
- "Sync bank" pulls more than 40 transactions — check `cacao.hcbTransactions.length` in the console; the org currently has 181.
- Admin can set an account balance and the strip updates.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "Fix issues found in final verification"
```

---

## Self-review notes

**Spec coverage.** Every numbered spec section maps to a task: §1 taxonomy → Tasks 1, 5, 7; §2 HCB classification → Task 1; §3 ledger and dedupe → Task 3; §4 accounts and balances → Tasks 2, 6, 8, 12, 17; §5 Sankey → Tasks 4, 9, 10; §6 page composition → Tasks 11, 13; §7 HCB pull → Task 8; §8 emoji → Tasks 14, 16; §9 testing → Tasks 1–4.

**Known gap, deliberately left.** The spec's "needs reconciliation" group for legacy `sponsorship_check` deposits (spec §1) has no task. Current seed data contains zero such records, and the migration in Task 7 maps them to `sponsorships` where the breakdown will show them under an income category the deposit form cannot produce — visible, not vanished. Building a dedicated warning UI for a case that may not exist in live data is speculative; if the live deployment turns out to have such records, add it then.

**Live data migration.** Task 7 migrates `seedData.ts` only. A live Convex deployment with existing records will reject them against the new validators until it is reseeded via the admin panel's reset, or migrated with a one-off mutation. Confirm which applies before deploying.
