# Donor Totals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the team a Donors view on the Money tab that totals what each person has given — across Hack Club Bank donations, hand-logged checks, and in-kind unreimbursed purchases — filtered by tax year and exportable to CSV.

**Architecture:** No new tables. An in-kind gift is an existing expense whose reimbursement was waived, so it becomes a new expense status `'donated'`. Donor aggregation runs over `buildLedger({ season: 'all' })` output rather than raw tables, which reuses the existing dedupe so a donation logged by hand *and* synced from HCB counts once. Names are consolidated by normalization, with fuzzy near-matches surfaced as suggestions a human accepts.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Convex, TypeScript, Vitest, Tailwind 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-donor-totals-design.md`

## Global Constraints

- **No new npm dependencies.** The Levenshtein implementation is written inline in `donors.ts`.
- **No data migration.** These tables have no real data yet.
- **Taxonomy unions are stated in three places** and must be changed together: `src/lib/finance/categories.ts` (source of truth), `convex/validators.ts`, and `convex/schema.ts`. `src/lib/types.ts` re-exports from `categories.ts`.
- **Tests live beside the module** as `*.test.ts` in `src/lib/finance/`. Run with `npm test`.
- **Baseline is 108 passing tests across 4 files.** Every task must leave the suite green.
- **This is not a tax document.** Any user-facing copy describing totals must say the figure is what the team *received* and that donors should check their own records.
- **Type-check with `npm run check`** (svelte-check). Expense status switches are exhaustive with no `default`, so adding a status surfaces as a type error until every switch handles it.

---

### Task 1: Taxonomy — `donated` status and `in_kind_gifts` category

Adds the two new taxonomy members everything else depends on, and keeps `npm run check` green by handling the new status in the one exhaustive switch that exists today.

**Files:**
- Modify: `src/lib/finance/categories.ts` (`IncomeCategory` union, `INCOME_CATEGORY_META`)
- Modify: `src/lib/types.ts:262-267` (`ExpenseStatus` union)
- Modify: `src/styles/app.css` (three theme blocks)
- Modify: `src/lib/components/expenses/ExpensesList.svelte:113-128` (`statusMeta` switch)
- Test: `src/lib/finance/categories.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `IncomeCategory` gains `'in_kind_gifts'`; `INCOME_CATEGORY_META.in_kind_gifts` exists; `ExpenseStatus` gains `'donated'`; CSS var `--color-flow-12`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/finance/categories.test.ts`:

```ts
describe('in_kind_gifts income category', () => {
  it('is a recognised income category', () => {
    expect(isIncomeCategory('in_kind_gifts')).toBe(true);
  });

  it('is not an expense category', () => {
    expect(isExpenseCategory('in_kind_gifts')).toBe(false);
  });

  it('has its own flow colour, distinct from every other income category', () => {
    const flows = Object.values(INCOME_CATEGORY_META).map((m) => m.flow);
    expect(new Set(flows).size).toBe(flows.length);
    expect(INCOME_CATEGORY_META.in_kind_gifts.flow).toBe('var(--color-flow-12)');
  });

  it('is never offered on the deposit form, so a gift cannot be entered twice', () => {
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('in_kind_gifts');
  });

  it('is never assignable to a bank transaction', () => {
    expect(HCB_INCOME_CATEGORIES).not.toContain('in_kind_gifts');
  });
});
```

Make sure the `import` at the top of the file includes `INCOME_CATEGORY_META`, `DEPOSIT_FORM_CATEGORIES`, and `HCB_INCOME_CATEGORIES` — add whichever are missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- categories`
Expected: FAIL — `isIncomeCategory('in_kind_gifts')` returns `false`.

- [ ] **Step 3: Add the category**

In `src/lib/finance/categories.ts`, add to the `IncomeCategory` union (after `'fundraising'`, before `'uncategorized'`):

```ts
  | 'in_kind_gifts'
```

Add to `INCOME_CATEGORY_META`, after the `fundraising` entry:

```ts
  in_kind_gifts: {
    label: 'In-kind gifts',
    note: 'Purchases donated instead of reimbursed',
    flow: 'var(--color-flow-12)'
  },
```

Leave `DEPOSIT_FORM_CATEGORIES` and `HCB_INCOME_CATEGORIES` alone — the category is synthesized from a donated expense, never hand-assigned.

- [ ] **Step 4: Add the flow colour**

In `src/styles/app.css`, add `--color-flow-12` to all three theme blocks, immediately after each `--color-flow-11` line:

- Light `:root` (near line 88): `  --color-flow-12: #7A6A55;`
- `@media (prefers-color-scheme: dark)` block (near line 246): `  --color-flow-12: #C9B49A;`
- `:root[data-theme="dark"]` block (near line 306): `  --color-flow-12: #C9B49A;`

- [ ] **Step 5: Add the expense status**

In `src/lib/types.ts`, add to the `ExpenseStatus` union after `'reimbursed'`:

```ts
  | 'donated'
```

In `src/lib/components/expenses/ExpensesList.svelte`, add a case to the `statusMeta` switch, after the `reimbursed` case:

```ts
      case 'donated':
        return { label: 'Donated', tone: 'success' };
```

- [ ] **Step 6: Run tests and type-check**

Run: `npm test && npm run check`
Expected: all tests PASS. `npm run check` reports no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/finance/categories.ts src/lib/finance/categories.test.ts src/lib/types.ts src/styles/app.css src/lib/components/expenses/ExpensesList.svelte
git commit -m "Add in_kind_gifts income category and donated expense status"
```

---

### Task 2: Ledger — a donated expense never matches a bank transaction

A donated expense has no bank transaction behind it, so it must never be a matching candidate — left eligible it could absorb a real transaction's match and strand it.

`claimsHcb` is `e.account === 'hcb_bank' || e.paymentMethod === 'hcb_card'`, so the hole is a **stale `account`**, not `personal_reimbursement` (which qualifies nothing on its own). A test whose donated expense has `account: 'none'` will pass with or without the guard; the RED phase requires `account: 'hcb_bank'`.

**Files:**
- Modify: `src/lib/finance/ledger.ts` (`LedgerExpense`, `LedgerDeposit`, new `expenseCanMatchHcb`, the `candidates` array)
- Test: `src/lib/finance/ledger.test.ts`

**Interfaces:**
- Consumes: `ExpenseStatus` gained `'donated'` (Task 1)
- Produces: `expenseCanMatchHcb(e: LedgerExpense): boolean`; `LedgerExpense` gains `donorName?: string` and `taxYear?: number`; `LedgerDeposit` gains the same two fields

- [ ] **Step 1: Write the failing test**

Append to `src/lib/finance/ledger.test.ts`:

```ts
describe('donated expenses and HCB matching', () => {
  it('never matches a bank transaction', () => {
    const { entries, unmatchedHcb } = build({
      expenses: [
        expense({
          _id: 'gift1',
          status: 'donated',
          paymentMethod: 'personal_reimbursement',
          account: 'none',
          amount: 500
        })
      ],
      deposits: [],
      hcbTransactions: [txn({ id: 'txnGift', amount_cents: -50000, date: '2026-10-10' })],
      season: '2026-2027'
    });

    const gift = entries.find((e) => e.id === 'gift1');
    expect(gift?.hcbTransactionId).toBeUndefined();
    expect(unmatchedHcb.map((t) => t.id)).toEqual(['txnGift']);
  });

  it('does not strand a real expense that should have matched', () => {
    // Both records look identical to the matcher. If the donated one were
    // eligible it could win the single transaction and strand the real one.
    const { entries } = build({
      expenses: [
        expense({
          _id: 'gift1',
          status: 'donated',
          paymentMethod: 'personal_reimbursement',
          amount: 500
        }),
        expense({
          _id: 'real1',
          status: 'purchased',
          paymentMethod: 'hcb_card',
          account: 'hcb_bank',
          amount: 500
        })
      ],
      deposits: [],
      hcbTransactions: [txn({ id: 'txnReal', amount_cents: -50000, date: '2026-10-10' })],
      season: '2026-2027'
    });

    expect(entries.find((e) => e.id === 'real1')?.hcbTransactionId).toBe('txnReal');
    expect(entries.find((e) => e.id === 'gift1')?.hcbTransactionId).toBeUndefined();
  });

  it('still counts toward spend, because a gift-funded purchase is team spending', () => {
    const { entries } = build({
      expenses: [expense({ _id: 'gift1', status: 'donated', amount: 500 })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });

    const gift = entries.find((e) => e.id === 'gift1');
    expect(gift).toBeDefined();
    expect(gift?.direction).toBe('out');
    expect(gift?.amount).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ledger`
Expected: FAIL — the donated expense matches `txnGift`, so `hcbTransactionId` is set and `unmatchedHcb` is empty.

- [ ] **Step 3: Add the fields and the guard**

In `src/lib/finance/ledger.ts`, add to the `LedgerExpense` interface (after `status`):

```ts
  /** Set when the purchaser waived reimbursement, making this an in-kind gift. */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to the entry date. */
  taxYear?: number;
```

Add to the `LedgerDeposit` interface (after `category`):

```ts
  /** Set when this deposit is attributable to a named donor, e.g. a check. */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to `date`. */
  taxYear?: number;
```

Add this function immediately after `expenseCountsTowardSpend`:

```ts
/**
 * A donated expense is a gift, not a withdrawal -- no money ever moved through
 * a team account, so no bank transaction corresponds to it. It must be barred
 * from matching, or it can absorb a real transaction's match and strand it,
 * which the maximum-cardinality matching below exists specifically to prevent.
 *
 * Deliberately separate from `expenseCountsTowardSpend`: a donated purchase
 * *does* count as team spending (the team acquired the goods), it just cannot
 * be reconciled against the bank.
 */
export function expenseCanMatchHcb(e: LedgerExpense): boolean {
  return expenseCountsTowardSpend(e) && e.status !== 'donated';
}
```

- [ ] **Step 4: Apply the guard in the candidates list**

In `buildLedger`, the `candidates` array spreads `expenses.map(...)`. Change that map to filter first:

```ts
    ...expenses.filter(expenseCanMatchHcb).map((e) => ({
```

Leave the `deposits.map(...)` spread and everything else unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- ledger`
Expected: PASS, including all 46 pre-existing ledger tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/finance/ledger.ts src/lib/finance/ledger.test.ts
git commit -m "Bar donated expenses from matching bank transactions"
```

---

### Task 3: Ledger — offsetting `in_kind_gifts` income entry

In-kind spend appears on the Sankey's outgoing side, so it needs a matching incoming side or the `Retained` / `Drawn from reserves` node absorbs the difference and misreports the season.

**Files:**
- Modify: `src/lib/finance/ledger.ts` (`buildLedger` entries construction)
- Test: `src/lib/finance/ledger.test.ts`

**Interfaces:**
- Consumes: `expenseCanMatchHcb` (Task 2), `'in_kind_gifts'` category (Task 1)
- Produces: for each donated expense, a second `LedgerEntry` with `id: \`gift:${expense._id}\``, `direction: 'in'`, `category: 'in_kind_gifts'`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/finance/ledger.test.ts`:

```ts
describe('in-kind offsetting income', () => {
  it('emits one spend entry and one equal income entry per donated expense', () => {
    const { entries } = build({
      expenses: [expense({ _id: 'gift1', status: 'donated', amount: 500 })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });

    const spend = entries.find((e) => e.id === 'gift1');
    const income = entries.find((e) => e.id === 'gift:gift1');

    expect(spend?.direction).toBe('out');
    expect(income?.direction).toBe('in');
    expect(income?.category).toBe('in_kind_gifts');
    expect(income?.amount).toBe(spend?.amount);
    expect(income?.date).toBe(spend?.date);
  });

  it('uses the final paid amount when one is recorded', () => {
    const { entries } = build({
      expenses: [
        expense({ _id: 'gift1', status: 'donated', amount: 500, finalPaidAmount: 437.19 })
      ],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });

    expect(entries.find((e) => e.id === 'gift:gift1')?.amount).toBe(437.19);
  });

  it('balances the two sides so the season shows no phantom surplus', () => {
    const { entries } = build({
      expenses: [expense({ _id: 'gift1', status: 'donated', amount: 500 })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });

    const totalIn = entries.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
    const totalOut = entries.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
    expect(totalIn).toBe(totalOut);
  });

  it('emits nothing extra for an ordinary expense', () => {
    const { entries } = build({
      expenses: [expense({ _id: 'e1', status: 'purchased' })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });

    expect(entries.filter((e) => e.category === 'in_kind_gifts')).toHaveLength(0);
  });

  it('carries the donor name through on the spend entry', () => {
    const { entries } = build({
      expenses: [expense({ _id: 'gift1', status: 'donated', donorName: 'Dana Vale' })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });

    expect(entries.find((e) => e.id === 'gift1')?.expense?.donorName).toBe('Dana Vale');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ledger`
Expected: FAIL — no entry with id `gift:gift1` exists.

- [ ] **Step 3: Emit the offsetting entry**

In `src/lib/finance/ledger.ts`, inside `buildLedger`, immediately after the `const entries: LedgerEntry[] = [ ... ];` array literal is built, insert:

```ts
  // A donated purchase is money the team never had: someone bought the goods
  // and waived repayment. The spend side above is real (the team acquired the
  // goods, and the Sankey exists to show what the team spends), so the income
  // side has to exist too or the diagram's Retained / Drawn-from-reserves node
  // silently absorbs the difference. This entry is synthetic -- it has no
  // record and no bank transaction behind it -- so it is never eligible for
  // matching, and `computeBalances` never sees it (that reads the deposits
  // table directly, not ledger entries), so no account balance moves.
  for (const e of expenses) {
    if (e.status !== 'donated') continue;
    entries.push({
      id: `gift:${e._id}`,
      direction: 'in',
      source: 'logged',
      title: `In-kind: ${e.title}`,
      amount: expensePaid(e),
      date: expenseDate(e),
      category: 'in_kind_gifts'
    });
  }
```

This must go *before* the `entries.sort(...)` call at the end of the function so the synthetic entries are sorted with the rest.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ledger`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all four suites PASS. The sankey suite is unaffected — it takes pre-summed categories, not ledger entries.

- [ ] **Step 6: Commit**

```bash
git add src/lib/finance/ledger.ts src/lib/finance/ledger.test.ts
git commit -m "Emit offsetting in-kind income so the Sankey stays balanced"
```

---

### Task 4: Balances — a donated expense never debits an account

`expenseDebitsAccount` already returns false for any status other than `purchased`/`reimbursed`, so this task is a regression guard rather than a change. Lock the behaviour down before anything can erode it.

**Files:**
- Test: `src/lib/finance/balances.test.ts`

**Interfaces:**
- Consumes: `ExpenseStatus` gained `'donated'` (Task 1)
- Produces: nothing new

- [ ] **Step 1: Write the test**

Append to `src/lib/finance/balances.test.ts`, inside the existing `describe('expenseDebitsAccount', ...)` block:

```ts
  it('is false for a donated expense, which never moved team money', () => {
    expect(expenseDebitsAccount(expense({ status: 'donated', account: 'none' }))).toBe(false);
  });

  it('is false for a donated expense even with a stale account left on it', () => {
    // Choosing a status rather than a boolean flag is what makes this safe:
    // the status gate runs before the account is ever consulted.
    expect(expenseDebitsAccount(expense({ status: 'donated', account: 'hcb_bank' }))).toBe(false);
  });
```

- [ ] **Step 2: Run the test**

Run: `npm test -- balances`
Expected: PASS immediately — this documents existing behaviour rather than changing it. If either assertion fails, stop: `expenseDebitsAccount` has been changed by an earlier task and the spec's safety argument no longer holds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/finance/balances.test.ts
git commit -m "Lock down that donated expenses never debit an account"
```

---

### Task 5: Convex — schema, validators, and mutation arguments

**Files:**
- Modify: `convex/validators.ts` (`expenseStatusValidator`, `incomeCategoryValidator`, `ledgerCategoryValidator`)
- Modify: `convex/schema.ts` (`expenses` status union + two fields; `incomeDeposits` two fields)
- Modify: `convex/expenses.ts` (status union near line 39, `add`/`update` args)
- Modify: `convex/income.ts` (`add`/`update` args)

**Interfaces:**
- Consumes: taxonomy from Task 1
- Produces: Convex accepts `donorName?: string` and `taxYear?: number` on both `expenses` and `incomeDeposits`, and `'donated'` as an expense status

- [ ] **Step 1: Update the shared validators**

In `convex/validators.ts`:

Add to `expenseStatusValidator`, after `v.literal("reimbursed"),`:

```ts
  v.literal("donated"),
```

Add to `incomeCategoryValidator`, after `v.literal("fundraising"),`:

```ts
  v.literal("in_kind_gifts"),
```

Add the same line to `ledgerCategoryValidator`, after its `v.literal("fundraising"),`.

- [ ] **Step 2: Update the schema**

In `convex/schema.ts`, in the `expenses` table's inline `status` union, add after `v.literal("reimbursed"),`:

```ts
      v.literal("donated"),
```

Add these two fields to the `expenses` table definition, next to `notes`:

```ts
    donorName: v.optional(v.string()),
    taxYear: v.optional(v.number()),
```

Add the same two fields to the `incomeDeposits` table definition, next to `notes`.

- [ ] **Step 3: Update the mutation arguments**

In `convex/expenses.ts`, add `v.literal("donated"),` to the status union near line 39. Then add to the `args` of both the `add` and `update` mutations:

```ts
    donorName: v.optional(v.string()),
    taxYear: v.optional(v.number()),
```

In `convex/income.ts`, add the same two lines to the `args` of both `add` and `update`.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add convex/validators.ts convex/schema.ts convex/expenses.ts convex/income.ts
git commit -m "Accept donorName, taxYear, and the donated status in Convex"
```

---

### Task 6: `donors.ts` — name normalization and gift collection

The core aggregation. Pure functions, no Svelte, no network — matching the other `finance/` modules.

**Files:**
- Create: `src/lib/finance/donors.ts`
- Test: `src/lib/finance/donors.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry`, `LedgerExpense`, `LedgerDeposit` from `./ledger` (Tasks 2–3)
- Produces:
  - `normalizeDonorName(raw: string): string`
  - `isAnonymousDonor(raw: string): boolean`
  - `parseDonationMemo(memo: string): string | null`
  - `ANONYMOUS_KEY: 'anonymous'`
  - `interface HcbDonationRef { transactionId: string; donorName: string; date: string }`
  - `interface DonorGift { id; donorName; source: 'hcb' | 'check' | 'in_kind'; amount; date; taxYear; description }`
  - `interface DonorTotals { key; displayName; gifts; cashTotal; inKindTotal; total; isAnonymous }`
  - `collectGifts(input: { entries: LedgerEntry[]; hcbDonations: HcbDonationRef[]; taxYear: number | 'all' }): DonorGift[]`
  - `groupDonors(gifts: DonorGift[]): DonorTotals[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/finance/donors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLedger, type LedgerExpense, type LedgerDeposit, type LedgerHcbTransaction } from './ledger';
import {
  normalizeDonorName,
  isAnonymousDonor,
  parseDonationMemo,
  collectGifts,
  groupDonors,
  ANONYMOUS_KEY
} from './donors';

const expense = (over: Partial<LedgerExpense> = {}): LedgerExpense => ({
  _id: 'exp1',
  title: 'Polycarbonate sheet',
  vendor: 'McMaster',
  amount: 240,
  finalPaidAmount: undefined,
  category: 'robot_parts',
  status: 'donated',
  season: '2026-2027',
  paymentMethod: 'personal_reimbursement',
  account: 'none',
  purchasedAt: Date.parse('2026-10-10T00:00:00Z'),
  createdAt: Date.parse('2026-10-01T00:00:00Z'),
  ...over
});

const deposit = (over: Partial<LedgerDeposit> = {}): LedgerDeposit => ({
  _id: 'dep1',
  title: 'Check',
  amount: 1000,
  category: 'major_donors',
  depositAccount: 'school_account',
  date: '2026-10-10',
  season: '2026-2027',
  ...over
});

const txn = (over: Partial<LedgerHcbTransaction> = {}): LedgerHcbTransaction => ({
  id: 'txn1',
  amount_cents: 3226,
  memo: 'Donation from Samantha Christolini',
  date: '2026-06-25',
  type: 'donation',
  pending: false,
  ...over
});

/** Gifts for a set of records, always over the full ledger. */
const gifts = (input: {
  expenses?: LedgerExpense[];
  deposits?: LedgerDeposit[];
  hcbTransactions?: LedgerHcbTransaction[];
  hcbDonations?: Parameters<typeof collectGifts>[0]['hcbDonations'];
  taxYear?: number | 'all';
}) => {
  const { entries } = buildLedger({
    expenses: input.expenses ?? [],
    deposits: input.deposits ?? [],
    hcbTransactions: input.hcbTransactions ?? [],
    season: 'all'
  });
  return collectGifts({
    entries,
    hcbDonations: input.hcbDonations ?? [],
    taxYear: input.taxYear ?? 'all'
  });
};

describe('normalizeDonorName', () => {
  it('trims trailing whitespace seen in real HCB data', () => {
    expect(normalizeDonorName('Samantha Christolini ')).toBe(
      normalizeDonorName('Samantha Christolini')
    );
  });

  it('is case insensitive', () => {
    expect(normalizeDonorName('HEATHER JENSEN')).toBe(normalizeDonorName('Heather Jensen'));
  });

  it('collapses internal whitespace', () => {
    expect(normalizeDonorName('Ruth   Harrison')).toBe(normalizeDonorName('Ruth Harrison'));
  });

  it('treats & and and as the same', () => {
    expect(normalizeDonorName('Ruth & Paul Harrison')).toBe(
      normalizeDonorName('Ruth and Paul Harrison')
    );
  });

  it('strips punctuation', () => {
    expect(normalizeDonorName('Dr. Glenn Mott,')).toBe(normalizeDonorName('Glenn Mott'));
  });

  it('strips honorifics', () => {
    expect(normalizeDonorName('Mrs Teresa Carr')).toBe(normalizeDonorName('Teresa Carr'));
  });

  it('returns an empty string for a blank name', () => {
    expect(normalizeDonorName('   ')).toBe('');
  });
});

describe('isAnonymousDonor', () => {
  it('recognises the HCB anonymous label', () => {
    expect(isAnonymousDonor('Anonymous Donor')).toBe(true);
  });

  it('recognises a bare anonymous', () => {
    expect(isAnonymousDonor('anonymous')).toBe(true);
  });

  it('does not match a real name containing the word', () => {
    expect(isAnonymousDonor('Anonymously Yours LLC')).toBe(false);
  });
});

describe('parseDonationMemo', () => {
  it('pulls the donor out of a real HCB memo', () => {
    expect(parseDonationMemo('Donation from Samantha Christolini')).toBe('Samantha Christolini');
  });

  it('is case insensitive on the prefix', () => {
    expect(parseDonationMemo('DONATION FROM Glenn Mott')).toBe('Glenn Mott');
  });

  it('returns null for an unrelated memo', () => {
    expect(parseDonationMemo('REV ROBOTICS')).toBeNull();
  });
});

describe('collectGifts', () => {
  it('reads the donor name from the donations endpoint when available', () => {
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnA', memo: 'Donation from Anonymous Donor' })],
      hcbDonations: [{ transactionId: 'txnA', donorName: 'Heather Jensen', date: '2026-06-20' }]
    });

    expect(result).toHaveLength(1);
    expect(result[0].donorName).toBe('Heather Jensen');
    expect(result[0].source).toBe('hcb');
    expect(result[0].amount).toBeCloseTo(32.26);
  });

  it('falls back to the memo when the donations endpoint has no row', () => {
    const result = gifts({ hcbTransactions: [txn({ id: 'txnA' })] });
    expect(result[0].donorName).toBe('Samantha Christolini');
  });

  it('ignores a non-donation bank transaction', () => {
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnA', type: 'card_charge', memo: 'REV', amount_cents: -4000 })]
    });
    expect(result).toHaveLength(0);
  });

  it('collects a check from a deposit with a donor name', () => {
    const result = gifts({ deposits: [deposit({ donorName: 'Frank Leon', amount: 1000 })] });

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('check');
    expect(result[0].amount).toBe(1000);
    expect(result[0].donorName).toBe('Frank Leon');
  });

  it('ignores a deposit with no donor name', () => {
    expect(gifts({ deposits: [deposit({ donorName: undefined })] })).toHaveLength(0);
  });

  it('collects an in-kind gift from a donated expense', () => {
    const result = gifts({ expenses: [expense({ donorName: 'Dana Vale', amount: 240 })] });

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('in_kind');
    expect(result[0].amount).toBe(240);
  });

  it('prefers the final paid amount for an in-kind gift', () => {
    const result = gifts({
      expenses: [expense({ donorName: 'Dana Vale', amount: 240, finalPaidAmount: 198.4 })]
    });
    expect(result[0].amount).toBe(198.4);
  });

  it('never double-counts the synthetic in_kind_gifts income entry', () => {
    const result = gifts({ expenses: [expense({ donorName: 'Dana Vale', amount: 240 })] });
    expect(result).toHaveLength(1);
  });

  it('ignores an expense that is not donated', () => {
    const result = gifts({
      expenses: [expense({ status: 'purchased', donorName: 'Dana Vale' })]
    });
    expect(result).toHaveLength(0);
  });

  it('counts a check logged by hand and synced from HCB only once', () => {
    // Same amount, same account, same week: buildLedger matches them and the
    // bank transaction stops being a separate entry.
    const result = gifts({
      deposits: [
        deposit({ donorName: 'Frank Leon', amount: 32.26, depositAccount: 'hcb_bank', date: '2026-06-25' })
      ],
      hcbTransactions: [txn({ id: 'txnA', amount_cents: 3226, date: '2026-06-25' })]
    });

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBeCloseTo(32.26);
    expect(result[0].source).toBe('check');
  });
});

describe('tax year attribution', () => {
  it('files an HCB donation by the donation date, not the settlement date', () => {
    // Given on 31 Dec, settled 2 Jan. The donor believes they gave in 2026.
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnA', date: '2027-01-02' })],
      hcbDonations: [{ transactionId: 'txnA', donorName: 'Krista Legg', date: '2026-12-31' }],
      taxYear: 2026
    });

    expect(result).toHaveLength(1);
    expect(result[0].taxYear).toBe(2026);
  });

  it('honours an explicit taxYear on a deposit over its date', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'Frank Leon', date: '2027-01-03', taxYear: 2026 })],
      taxYear: 2026
    });
    expect(result).toHaveLength(1);
  });

  it('falls back to the date year when no taxYear is stored', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'Frank Leon', date: '2026-10-10' })],
      taxYear: 2026
    });
    expect(result[0].taxYear).toBe(2026);
  });

  it('excludes gifts from other years', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'Frank Leon', date: '2025-10-10' })],
      taxYear: 2026
    });
    expect(result).toHaveLength(0);
  });

  it('includes every year when asked for all', () => {
    const result = gifts({
      deposits: [
        deposit({ _id: 'd1', donorName: 'Frank Leon', date: '2025-10-10' }),
        deposit({ _id: 'd2', donorName: 'Frank Leon', date: '2026-10-10' })
      ],
      taxYear: 'all'
    });
    expect(result).toHaveLength(2);
  });
});

describe('groupDonors', () => {
  it('merges name variants into one donor', () => {
    const donors = groupDonors(
      gifts({
        deposits: [
          deposit({ _id: 'd1', donorName: 'Ruth & Paul Harrison', amount: 100 }),
          deposit({ _id: 'd2', donorName: 'Ruth and Paul Harrison', amount: 250 })
        ]
      })
    );

    expect(donors).toHaveLength(1);
    expect(donors[0].total).toBe(350);
    expect(donors[0].gifts).toHaveLength(2);
  });

  it('separates cash and in-kind totals', () => {
    const donors = groupDonors(
      gifts({
        deposits: [deposit({ donorName: 'Dana Vale', amount: 500 })],
        expenses: [expense({ donorName: 'Dana Vale', amount: 240 })]
      })
    );

    expect(donors).toHaveLength(1);
    expect(donors[0].cashTotal).toBe(500);
    expect(donors[0].inKindTotal).toBe(240);
    expect(donors[0].total).toBe(740);
  });

  it('sorts by total, largest first', () => {
    const donors = groupDonors(
      gifts({
        deposits: [
          deposit({ _id: 'd1', donorName: 'Small Giver', amount: 20 }),
          deposit({ _id: 'd2', donorName: 'Big Giver', amount: 5000 })
        ]
      })
    );

    expect(donors.map((d) => d.displayName)).toEqual(['Big Giver', 'Small Giver']);
  });

  it('rolls every anonymous gift into a single shown row', () => {
    const donors = groupDonors(
      gifts({
        hcbTransactions: [
          txn({ id: 'a1', memo: 'Donation from Anonymous Donor', amount_cents: 1000 }),
          txn({ id: 'a2', memo: 'Donation from anonymous', amount_cents: 2500 })
        ]
      })
    );

    const anon = donors.find((d) => d.key === ANONYMOUS_KEY);
    expect(anon).toBeDefined();
    expect(anon?.isAnonymous).toBe(true);
    expect(anon?.displayName).toBe('Anonymous');
    expect(anon?.total).toBe(35);
  });

  it('picks the most frequent spelling as the display name', () => {
    const donors = groupDonors(
      gifts({
        deposits: [
          deposit({ _id: 'd1', donorName: 'heather jensen', amount: 10 }),
          deposit({ _id: 'd2', donorName: 'Heather Jensen', amount: 10 }),
          deposit({ _id: 'd3', donorName: 'Heather Jensen', amount: 10 })
        ]
      })
    );

    expect(donors[0].displayName).toBe('Heather Jensen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- donors`
Expected: FAIL — `Cannot find module './donors'`.

- [ ] **Step 3: Write the module**

Create `src/lib/finance/donors.ts`:

```ts
/**
 * Donor aggregation: who gave us what, in a given calendar year.
 *
 * Gifts reach the team by three unrelated routes -- an online donation through
 * Hack Club Bank, a physical check logged as a deposit, and an in-kind gift
 * where someone bought something and waived reimbursement. Nothing links them
 * but the donor's name, so name is the join key and consolidating spellings is
 * most of the work here.
 *
 * Everything is derived from `buildLedger` output rather than from the raw
 * tables. That is deliberate: the ledger has already collapsed the overlap
 * between a hand-logged record and the bank transaction that paid it, so a
 * check entered by hand *and* synced from HCB is one gift here, not two.
 */

import type { LedgerEntry } from './ledger';

/** The single bucket every anonymous gift rolls into. */
export const ANONYMOUS_KEY = 'anonymous';

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'rev']);

/**
 * Reduce a donor name to a key that survives the spellings people actually
 * use. Built from the variants observed in the live HCB data: trailing
 * whitespace, inconsistent casing, `&` against `and`, and stray punctuation.
 */
export function normalizeDonorName(raw: string): string {
  const collapsed = raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return collapsed
    .split(' ')
    .filter((word) => word.length > 0 && !HONORIFICS.has(word))
    .join(' ');
}

/**
 * HCB labels anonymous gifts "Anonymous Donor". These roll into one row --
 * a fun figure to see -- but must never merge into a named donor, so they are
 * recognised here and excluded from fuzzy suggestions.
 */
export function isAnonymousDonor(raw: string): boolean {
  return /^anonymous(\s+donor)?$/.test(normalizeDonorName(raw));
}

/**
 * The donations endpoint is the reliable source for a donor name, but it can
 * be missing a row (a failed sync, a very recent gift). The memo carries the
 * same name in a fixed shape, so it serves as the fallback.
 */
export function parseDonationMemo(memo: string): string | null {
  const match = memo.match(/^\s*donation from\s+(.+?)\s*$/i);
  return match ? match[1] : null;
}

/** A donation as the HCB `/donations` endpoint reports it. */
export interface HcbDonationRef {
  transactionId: string;
  donorName: string;
  /** YYYY-MM-DD, the date the donor gave -- not the settlement date. */
  date: string;
}

export type GiftSource = 'hcb' | 'check' | 'in_kind';

export interface DonorGift {
  id: string;
  /** The raw spelling this gift carried, before normalization. */
  donorName: string;
  source: GiftSource;
  amount: number;
  date: string;
  taxYear: number;
  description: string;
}

export interface DonorTotals {
  /** Normalized name, or ANONYMOUS_KEY. */
  key: string;
  displayName: string;
  gifts: DonorGift[];
  cashTotal: number;
  inKindTotal: number;
  total: number;
  isAnonymous: boolean;
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * Pull every attributable gift out of the ledger.
 *
 * The synthetic `in_kind_gifts` income entry that `buildLedger` emits for each
 * donated expense is skipped here: the spend-side entry is the one carrying
 * the donor name, and counting both would double every in-kind gift.
 */
export function collectGifts(input: {
  entries: LedgerEntry[];
  hcbDonations: HcbDonationRef[];
  taxYear: number | 'all';
}): DonorGift[] {
  const donationByTxn = new Map(input.hcbDonations.map((d) => [d.transactionId, d]));
  const gifts: DonorGift[] = [];

  for (const entry of input.entries) {
    let gift: DonorGift | null = null;

    if (entry.direction === 'in' && entry.source === 'hcb' && entry.hcbTransaction?.type === 'donation') {
      const ref = donationByTxn.get(entry.hcbTransaction.id);
      const name = ref?.donorName ?? parseDonationMemo(entry.hcbTransaction.memo);
      if (name && name.trim()) {
        const date = ref?.date ?? entry.date;
        gift = {
          id: entry.id,
          donorName: name.trim(),
          source: 'hcb',
          amount: entry.amount,
          date,
          taxYear: yearOf(date),
          description: entry.title
        };
      }
    } else if (entry.direction === 'in' && entry.deposit?.donorName?.trim()) {
      const d = entry.deposit;
      gift = {
        id: entry.id,
        donorName: d.donorName!.trim(),
        source: 'check',
        amount: entry.amount,
        date: entry.date,
        taxYear: d.taxYear ?? yearOf(entry.date),
        description: entry.title
      };
    } else if (
      entry.direction === 'out' &&
      entry.expense?.status === 'donated' &&
      entry.expense.donorName?.trim()
    ) {
      const e = entry.expense;
      gift = {
        id: entry.id,
        donorName: e.donorName!.trim(),
        source: 'in_kind',
        amount: entry.amount,
        date: entry.date,
        taxYear: e.taxYear ?? yearOf(entry.date),
        description: entry.title
      };
    }

    if (!gift) continue;
    if (input.taxYear !== 'all' && gift.taxYear !== input.taxYear) continue;
    gifts.push(gift);
  }

  return gifts;
}

/** The spelling used most often wins; ties break toward the first seen. */
function pickDisplayName(gifts: DonorGift[]): string {
  const counts = new Map<string, number>();
  for (const g of gifts) counts.set(g.donorName, (counts.get(g.donorName) ?? 0) + 1);

  let best = gifts[0].donorName;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

export function groupDonors(gifts: DonorGift[]): DonorTotals[] {
  const buckets = new Map<string, DonorGift[]>();

  for (const gift of gifts) {
    const anonymous = isAnonymousDonor(gift.donorName);
    const key = anonymous ? ANONYMOUS_KEY : normalizeDonorName(gift.donorName);
    if (!key) continue;
    const existing = buckets.get(key);
    if (existing) existing.push(gift);
    else buckets.set(key, [gift]);
  }

  const donors: DonorTotals[] = [];
  for (const [key, bucket] of buckets) {
    const isAnonymous = key === ANONYMOUS_KEY;
    const cashTotal = bucket
      .filter((g) => g.source !== 'in_kind')
      .reduce((sum, g) => sum + g.amount, 0);
    const inKindTotal = bucket
      .filter((g) => g.source === 'in_kind')
      .reduce((sum, g) => sum + g.amount, 0);

    donors.push({
      key,
      displayName: isAnonymous ? 'Anonymous' : pickDisplayName(bucket),
      gifts: [...bucket].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      cashTotal,
      inKindTotal,
      total: cashTotal + inKindTotal,
      isAnonymous
    });
  }

  return donors.sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- donors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/donors.ts src/lib/finance/donors.test.ts
git commit -m "Add donor aggregation across HCB, checks, and in-kind gifts"
```

---

### Task 7: `donors.ts` — fuzzy duplicate suggestions

Normalization catches spelling noise. It cannot catch `Bob Smith` against `Robert Smith`, or a single typo. Those are surfaced for a human to accept, never merged automatically.

**Files:**
- Modify: `src/lib/finance/donors.ts`
- Test: `src/lib/finance/donors.test.ts`

**Interfaces:**
- Consumes: `DonorTotals`, `ANONYMOUS_KEY` (Task 6)
- Produces:
  - `interface DuplicateSuggestion { keys: [string, string]; displayNames: [string, string]; similarity: number }`
  - `nameSimilarity(a: string, b: string): number` — 0 to 1
  - `suggestDuplicates(donors: DonorTotals[], threshold?: number): DuplicateSuggestion[]`
  - `DEFAULT_SIMILARITY_THRESHOLD = 0.85`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/finance/donors.test.ts` (and add `nameSimilarity`, `suggestDuplicates`, `DEFAULT_SIMILARITY_THRESHOLD`, and `type DonorTotals` to the import from `./donors`):

```ts
const donor = (over: Partial<DonorTotals> = {}): DonorTotals => ({
  key: 'heather jensen',
  displayName: 'Heather Jensen',
  gifts: [],
  cashTotal: 100,
  inKindTotal: 0,
  total: 100,
  isAnonymous: false,
  ...over
});

describe('nameSimilarity', () => {
  it('is 1 for identical names', () => {
    expect(nameSimilarity('heather jensen', 'heather jensen')).toBe(1);
  });

  it('is high for a single typo', () => {
    expect(nameSimilarity('heather jensen', 'heather jenson')).toBeGreaterThan(0.9);
  });

  it('is low for two different people', () => {
    expect(nameSimilarity('heather jensen', 'frank leon')).toBeLessThan(0.5);
  });

  it('is 1 for two empty strings', () => {
    expect(nameSimilarity('', '')).toBe(1);
  });
});

describe('suggestDuplicates', () => {
  it('suggests a near-identical pair', () => {
    const suggestions = suggestDuplicates([
      donor({ key: 'heather jensen', displayName: 'Heather Jensen' }),
      donor({ key: 'heather jenson', displayName: 'Heather Jenson' })
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].displayNames).toEqual(['Heather Jensen', 'Heather Jenson']);
  });

  it('stays silent for two clearly different donors', () => {
    expect(
      suggestDuplicates([
        donor({ key: 'heather jensen', displayName: 'Heather Jensen' }),
        donor({ key: 'frank leon', displayName: 'Frank Leon' })
      ])
    ).toHaveLength(0);
  });

  it('never suggests merging the anonymous bucket into a named donor', () => {
    expect(
      suggestDuplicates([
        donor({ key: ANONYMOUS_KEY, displayName: 'Anonymous', isAnonymous: true }),
        donor({ key: 'anonymous yours', displayName: 'Anonymous Yours' })
      ])
    ).toHaveLength(0);
  });

  it('honours a custom threshold', () => {
    const pair = [
      donor({ key: 'heather jensen', displayName: 'Heather Jensen' }),
      donor({ key: 'heather jenson', displayName: 'Heather Jenson' })
    ];

    expect(suggestDuplicates(pair, 0.999)).toHaveLength(0);
    expect(suggestDuplicates(pair, 0.5)).toHaveLength(1);
  });

  it('reports each pair once, not twice', () => {
    const suggestions = suggestDuplicates([
      donor({ key: 'ruth harrison', displayName: 'Ruth Harrison' }),
      donor({ key: 'ruth harrisen', displayName: 'Ruth Harrisen' }),
      donor({ key: 'ruth harrisonn', displayName: 'Ruth Harrisonn' })
    ]);

    const seen = new Set(suggestions.map((s) => [...s.keys].sort().join('|')));
    expect(seen.size).toBe(suggestions.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- donors`
Expected: FAIL — `nameSimilarity` is not exported.

- [ ] **Step 3: Implement similarity and suggestions**

Append to `src/lib/finance/donors.ts`:

```ts
/**
 * Above this, two names are offered as a possible duplicate. Tuned to catch a
 * single-character typo in a typical name while leaving two different people
 * alone. It only ever produces a suggestion for a human to accept, so erring
 * slightly loose is cheap and erring tight loses real merges.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

export interface DuplicateSuggestion {
  keys: [string, string];
  displayNames: [string, string];
  similarity: number;
}

/** Standard iterative Levenshtein, two rows rather than a full matrix. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

/** 1 for identical, 0 for nothing in common. */
export function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Near-identical donor names, offered for a human to accept. Never applied
 * automatically: a wrong merge silently combines two people's giving onto one
 * line, and the whole point of this view is that someone reads it before it
 * goes anywhere.
 *
 * The anonymous bucket is excluded on both sides -- it is a bucket, not a
 * person, and merging it into a named donor would be a real error.
 */
export function suggestDuplicates(
  donors: DonorTotals[],
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD
): DuplicateSuggestion[] {
  const named = donors.filter((d) => !d.isAnonymous && d.key !== ANONYMOUS_KEY);
  const suggestions: DuplicateSuggestion[] = [];

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const similarity = nameSimilarity(named[i].key, named[j].key);
      if (similarity < threshold) continue;
      suggestions.push({
        keys: [named[i].key, named[j].key],
        displayNames: [named[i].displayName, named[j].displayName],
        similarity
      });
    }
  }

  return suggestions.sort((a, b) => b.similarity - a.similarity);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- donors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/finance/donors.ts src/lib/finance/donors.test.ts
git commit -m "Suggest near-duplicate donor names for human review"
```

---

### Task 8: `donors.ts` — CSV export

**Files:**
- Modify: `src/lib/finance/donors.ts`
- Test: `src/lib/finance/donors.test.ts`

**Interfaces:**
- Consumes: `DonorTotals`, `DonorGift` (Task 6)
- Produces:
  - `CSV_CAVEAT: string`
  - `donorsToCsv(donors: DonorTotals[], period: string): string`
  - `giftsToCsv(donor: DonorTotals, period: string): string`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/finance/donors.test.ts` (add `donorsToCsv`, `giftsToCsv`, `CSV_CAVEAT` to the import):

```ts
describe('donorsToCsv', () => {
  it('opens with the caveat so the figure is never mistaken for a receipt', () => {
    const csv = donorsToCsv([donor()], '2026');
    expect(csv.split('\n')[0]).toContain(CSV_CAVEAT);
  });

  it('names the period', () => {
    expect(donorsToCsv([donor()], '2026')).toContain('2026');
  });

  it('writes a header row and one row per donor', () => {
    const csv = donorsToCsv(
      [
        donor({ displayName: 'Big Giver', cashTotal: 5000, inKindTotal: 0, total: 5000 }),
        donor({ key: 'small', displayName: 'Small Giver', cashTotal: 20, inKindTotal: 5, total: 25 })
      ],
      '2026'
    );

    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe('Donor,Gifts,Cash,In-kind,Total');
    expect(lines[2]).toBe('Big Giver,0,5000.00,0.00,5000.00');
    expect(lines[3]).toBe('Small Giver,0,20.00,5.00,25.00');
  });

  it('quotes a name containing a comma', () => {
    const csv = donorsToCsv([donor({ displayName: 'Harrison, Ruth' })], '2026');
    expect(csv).toContain('"Harrison, Ruth"');
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = donorsToCsv([donor({ displayName: 'Bob "Buzz" Smith' })], '2026');
    expect(csv).toContain('"Bob ""Buzz"" Smith"');
  });
});

describe('giftsToCsv', () => {
  it('itemizes one donor with a total row', () => {
    const csv = giftsToCsv(
      donor({
        displayName: 'Dana Vale',
        cashTotal: 500,
        inKindTotal: 240,
        total: 740,
        gifts: [
          {
            id: 'g1',
            donorName: 'Dana Vale',
            source: 'check',
            amount: 500,
            date: '2026-10-10',
            taxYear: 2026,
            description: 'Check'
          },
          {
            id: 'g2',
            donorName: 'Dana Vale',
            source: 'in_kind',
            amount: 240,
            date: '2026-10-11',
            taxYear: 2026,
            description: 'Polycarbonate sheet'
          }
        ]
      }),
      '2026'
    );

    expect(csv).toContain('Date,Source,Description,Amount');
    expect(csv).toContain('2026-10-10,Check,Check,500.00');
    expect(csv).toContain('2026-10-11,In-kind,Polycarbonate sheet,240.00');
    expect(csv).toContain('Total,,,740.00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- donors`
Expected: FAIL — `donorsToCsv` is not exported.

- [ ] **Step 3: Implement the exports**

Append to `src/lib/finance/donors.ts`:

```ts
/**
 * Carried at the top of every export. The team hands this to a donor as a
 * reference for their own records, not as a receipt: HCB reports only what
 * landed in the account, so a processing fee can make this less than what the
 * donor was actually charged, and there is no gross figure in the API to use
 * instead.
 */
export const CSV_CAVEAT =
  'Amounts are what the team received. Processing fees may make this less than what you were charged - please check your own records.';

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const SOURCE_LABELS: Record<GiftSource, string> = {
  hcb: 'Hack Club Bank',
  check: 'Check',
  in_kind: 'In-kind'
};

const money = (n: number) => n.toFixed(2);

export function donorsToCsv(donors: DonorTotals[], period: string): string {
  const rows = [
    csvEscape(`Donor giving - ${period}. ${CSV_CAVEAT}`),
    'Donor,Gifts,Cash,In-kind,Total',
    ...donors.map((d) =>
      [
        csvEscape(d.displayName),
        String(d.gifts.length),
        money(d.cashTotal),
        money(d.inKindTotal),
        money(d.total)
      ].join(',')
    )
  ];
  return rows.join('\n') + '\n';
}

export function giftsToCsv(donor: DonorTotals, period: string): string {
  const rows = [
    csvEscape(`${donor.displayName} - giving for ${period}. ${CSV_CAVEAT}`),
    'Date,Source,Description,Amount',
    ...donor.gifts.map((g) =>
      [
        g.date,
        csvEscape(SOURCE_LABELS[g.source]),
        csvEscape(g.description),
        money(g.amount)
      ].join(',')
    ),
    `Total,,,${money(donor.total)}`
  ];
  return rows.join('\n') + '\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- donors`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/finance/donors.ts src/lib/finance/donors.test.ts
git commit -m "Export donor totals and per-donor gift lists as CSV"
```

---

### Task 9: Store — sync HCB donations and expose donor data

**Files:**
- Modify: `src/lib/types.ts` (add `HCBDonation`)
- Modify: `src/lib/stores/cacaoStore.svelte.ts` (storage key, state, load, persist, `syncHackClubBank`, new `donorGifts` method)

**Interfaces:**
- Consumes: `collectGifts`, `groupDonors`, `HcbDonationRef` (Tasks 6–7)
- Produces:
  - `cacao.hcbDonations: HCBDonation[]`
  - `cacao.donorData(taxYear: number | 'all'): { donors: DonorTotals[]; suggestions: DuplicateSuggestion[] }`
  - `cacao.donorTaxYears(): number[]`

- [ ] **Step 1: Add the HCB donation type**

In `src/lib/types.ts`, after the `HCBTransaction` interface:

```ts
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
```

- [ ] **Step 2: Add storage and state**

In `src/lib/stores/cacaoStore.svelte.ts`:

Add to `STORAGE_KEYS` after `HCB_CATEGORIES`:

```ts
  HCB_DONATIONS: 'cacao_hcb_donations_v1'
```

Add to the class state, next to `hcbTransactions`:

```ts
  hcbDonations = $state<HCBDonation[]>([]);
```

Add `HCBDonation` to the type import from `$lib/types`.

In each of the two places that load `STORAGE_KEYS.HCB_TXNS` (near lines 166 and 183), add alongside:

```ts
        this.hcbDonations = loadStored(STORAGE_KEYS.HCB_DONATIONS, []);
```

In each of the two places that save `STORAGE_KEYS.HCB_TXNS` (near lines 400 and 415), add alongside:

```ts
      saveStored(STORAGE_KEYS.HCB_DONATIONS, this.hcbDonations);
```

- [ ] **Step 3: Fetch donations during sync**

In `syncHackClubBank`, immediately after the transactions paging loop's closing `if (all.length > 0) { ... }` block and before `this.hcbLastSyncedAt = Date.now();`:

```ts
      // 3. Donations carry the donor's name and the date the donor gave, which
      // the transaction feed does not. The memo has the name too, but only as
      // free text -- this is the structured source, keyed by transaction id.
      const donations: HCBDonation[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetch(
          `https://hcb.hackclub.com/api/v3/organizations/${slug}/donations?per_page=${PER_PAGE}&page=${page}`
        );
        if (!res.ok) break;
        const batch: HCBDonation[] = await res.json();
        donations.push(...batch);
        if (batch.length < PER_PAGE) break;
      }
      if (donations.length > 0) {
        this.hcbDonations = donations;
        saveStored(STORAGE_KEYS.HCB_DONATIONS, donations);
      }
```

- [ ] **Step 4: Expose donor data**

Add these methods to the class, near the other finance derivations:

```ts
  /**
   * Donor totals for a calendar year. Built over the full ledger rather than
   * the raw tables so a gift logged by hand *and* synced from the bank counts
   * once -- `buildLedger` already collapses that overlap.
   */
  donorData(taxYear: number | 'all') {
    const { entries } = buildLedger({
      expenses: this.expenses,
      deposits: this.incomeDeposits,
      hcbTransactions: this.hcbTransactions,
      season: 'all',
      hcbCategoryOverrides: this.hcbCategoryOverrides
    });

    const hcbDonations: HcbDonationRef[] = this.hcbDonations
      .filter((d) => d.transaction?.id && d.donor?.name)
      .map((d) => ({
        transactionId: d.transaction!.id,
        donorName: d.donor!.name!,
        date: d.date.slice(0, 10)
      }));

    const donors = groupDonors(collectGifts({ entries, hcbDonations, taxYear }));
    return { donors, suggestions: suggestDuplicates(donors) };
  }

  /** Every calendar year that has at least one attributable gift, newest first. */
  donorTaxYears(): number[] {
    const { donors } = this.donorData('all');
    const years = new Set<number>();
    for (const d of donors) for (const g of d.gifts) years.add(g.taxYear);
    return [...years].sort((a, b) => b - a);
  }
```

Add to the imports at the top of the file:

```ts
import { collectGifts, groupDonors, suggestDuplicates, type HcbDonationRef } from '$lib/finance/donors';
```

`buildLedger` is already imported.

- [ ] **Step 5: Type-check**

Run: `npm run check && npm test`
Expected: no new errors, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/stores/cacaoStore.svelte.ts
git commit -m "Sync HCB donations and expose donor totals from the store"
```

---

### Task 10: Forms — record a donated expense and a check's donor

**Files:**
- Modify: `src/lib/components/expenses/ExpenseModal.svelte`
- Modify: `src/lib/components/expenses/ExpensesList.svelte:102-108` (`statusFilters`)
- Modify: `src/lib/components/deposits/LogDepositModal.svelte`

**Interfaces:**
- Consumes: `'donated'` status (Task 1), Convex fields (Task 5)
- Produces: expenses and deposits can carry `donorName` and `taxYear`

- [ ] **Step 1: Add the donated status to the expense modal**

In `src/lib/components/expenses/ExpenseModal.svelte`, add to `statusOptions` after the `reimbursed` entry:

```ts
    { value: 'donated', label: 'Donated (not reimbursed)' },
```

Add state alongside the other field declarations:

```ts
  let donorName = $state('');
  let taxYear = $state<number>(new Date().getFullYear());
```

In the `$effect` that populates the form from `expense`, add to the populated branch:

```ts
      donorName = expense.donorName || '';
      taxYear = expense.taxYear ?? new Date().getFullYear();
```

and to the reset branch:

```ts
      donorName = '';
      taxYear = new Date().getFullYear();
```

Add the fields to the form markup, shown only for the donated status. Place them next to the payment-method field:

```svelte
{#if status === 'donated'}
  <M3Input label="Donor name" bind:value={donorName} placeholder="Who waived reimbursement" />
  <M3Input label="Tax year" type="number" bind:value={taxYear} />
{/if}
```

Include both in the object passed to the create and update store calls:

```ts
        donorName: status === 'donated' ? donorName.trim() || undefined : undefined,
        taxYear: status === 'donated' ? Number(taxYear) || undefined : undefined,
```

- [ ] **Step 2: Add the filter tab**

In `src/lib/components/expenses/ExpensesList.svelte`, add to `statusFilters` after the `reimbursed` entry:

```ts
    { id: 'donated', label: 'Donated' }
```

- [ ] **Step 3: Add donor fields to the deposit modal**

In `src/lib/components/deposits/LogDepositModal.svelte`, add state:

```ts
  let donorName = $state('');
  let taxYear = $state<number>(new Date().getFullYear());
```

In the `$effect`, populated branch:

```ts
      donorName = deposit.donorName || '';
      taxYear = deposit.taxYear ?? new Date().getFullYear();
```

Reset branch:

```ts
      donorName = '';
      taxYear = new Date().getFullYear();
```

Add to the markup, after the title field:

```svelte
<M3Input
  label="Donor name (optional)"
  bind:value={donorName}
  placeholder="Who this gift is from, for donor totals"
/>
<M3Input label="Tax year" type="number" bind:value={taxYear} />
```

Add to both the `updateIncomeDeposit` and `addIncomeDeposit` calls:

```ts
        donorName: donorName.trim() || undefined,
        taxYear: Number(taxYear) || undefined,
```

- [ ] **Step 4: Add the fields to the app types**

In `src/lib/types.ts`, add to the `Expense` interface next to `notes`:

```ts
  /** Set when the purchaser waived reimbursement, making this an in-kind gift. */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to the entry date. */
  taxYear?: number;
```

Add the same two fields to the `IncomeDeposit` interface next to `notes`.

- [ ] **Step 5: Type-check and test**

Run: `npm run check && npm test`
Expected: no new errors, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/components/expenses/ExpenseModal.svelte src/lib/components/expenses/ExpensesList.svelte src/lib/components/deposits/LogDepositModal.svelte
git commit -m "Record donor name and tax year on expenses and deposits"
```

---

### Task 11: Donors view on the Money tab

**Files:**
- Create: `src/lib/components/donors/DonorsList.svelte`
- Modify: `src/routes/money/+page.svelte`

**Interfaces:**
- Consumes: `cacao.donorData`, `cacao.donorTaxYears` (Task 9); `donorsToCsv`, `giftsToCsv`, `CSV_CAVEAT` (Task 8)
- Produces: the finished view

- [ ] **Step 1: Create the component**

Create `src/lib/components/donors/DonorsList.svelte`:

```svelte
<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { donorsToCsv, giftsToCsv, CSV_CAVEAT, type DonorTotals } from '$lib/finance/donors';
  import { Download, Search, Users } from 'lucide-svelte';

  const ALL = 'all' as const;

  let selectedYear = $state<number | typeof ALL>(new Date().getFullYear());
  let query = $state('');
  let expandedKey = $state<string | null>(null);
  let dismissed = $state<Set<string>>(new Set());

  const years = $derived(cacao.donorTaxYears());
  const data = $derived(cacao.donorData(selectedYear));

  const donors = $derived(
    query.trim()
      ? data.donors.filter((d) => d.displayName.toLowerCase().includes(query.trim().toLowerCase()))
      : data.donors
  );

  const suggestions = $derived(
    data.suggestions.filter((s) => !dismissed.has([...s.keys].sort().join('|')))
  );

  const periodLabel = $derived(selectedYear === ALL ? 'all time' : String(selectedYear));

  const grandTotal = $derived(donors.reduce((sum, d) => sum + d.total, 0));

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  function download(filename: string, contents: string) {
    const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    download(`donors-${periodLabel}.csv`, donorsToCsv(donors, periodLabel));
  }

  function exportOne(donor: DonorTotals) {
    const slug = donor.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    download(`${slug}-${periodLabel}.csv`, giftsToCsv(donor, periodLabel));
  }

  function dismiss(keys: [string, string]) {
    dismissed = new Set([...dismissed, [...keys].sort().join('|')]);
  }

  const sourceLabel = (source: string) =>
    source === 'hcb' ? 'Hack Club Bank' : source === 'check' ? 'Check' : 'In-kind';
</script>

<div class="flex flex-wrap items-center gap-3 mb-4">
  <div class="flex items-center gap-2">
    <label for="donor-year" class="type-label">Tax year</label>
    <select id="donor-year" class="m3-select" bind:value={selectedYear}>
      {#each years as year (year)}
        <option value={year}>{year}</option>
      {/each}
      <option value={ALL}>All time</option>
    </select>
  </div>

  <div class="flex items-center gap-2 flex-1 min-w-[12rem]">
    <Search size={16} aria-hidden="true" />
    <input
      class="m3-input flex-1"
      type="search"
      placeholder="Search donors"
      bind:value={query}
      aria-label="Search donors"
    />
  </div>

  <button type="button" class="m3-button" onclick={exportAll} disabled={donors.length === 0}>
    <Download size={16} aria-hidden="true" />
    Export CSV
  </button>
</div>

<p class="type-body-sm opacity-70 mb-4">{CSV_CAVEAT}</p>

{#if suggestions.length > 0}
  <div class="m3-card p-3 mb-4">
    <p class="type-label mb-2">Possible duplicates</p>
    {#each suggestions as suggestion (suggestion.keys.join('|'))}
      <div class="flex items-center justify-between gap-3 py-1">
        <span class="type-body-sm">
          "{suggestion.displayNames[0]}" and "{suggestion.displayNames[1]}" look like the same person.
        </span>
        <button type="button" class="m3-button-text" onclick={() => dismiss(suggestion.keys)}>
          Dismiss
        </button>
      </div>
    {/each}
    <p class="type-body-sm opacity-70 mt-2">
      Rename one of them on its original record to combine them.
    </p>
  </div>
{/if}

{#if donors.length === 0}
  <div class="m3-card p-6 text-center">
    <Users size={24} aria-hidden="true" class="mx-auto mb-2 opacity-60" />
    <p class="type-body">No donations recorded for {periodLabel}.</p>
    <p class="type-body-sm opacity-70 mt-1">
      Donations sync from Hack Club Bank. Add a donor name to a deposit, or mark an expense
      as donated, to include it here.
    </p>
  </div>
{:else}
  <div class="m3-card overflow-x-auto">
    <table class="w-full text-left">
      <thead>
        <tr>
          <th class="p-3 type-label">Donor</th>
          <th class="p-3 type-label text-right">Gifts</th>
          <th class="p-3 type-label text-right">Cash</th>
          <th class="p-3 type-label text-right">In-kind</th>
          <th class="p-3 type-label text-right">Total</th>
          <th class="p-3"><span class="sr-only">Export</span></th>
        </tr>
      </thead>
      <tbody>
        {#each donors as donor (donor.key)}
          <tr>
            <td class="p-3">
              <button
                type="button"
                class="m3-button-text"
                aria-expanded={expandedKey === donor.key}
                onclick={() => (expandedKey = expandedKey === donor.key ? null : donor.key)}
              >
                {donor.displayName}
              </button>
            </td>
            <td class="p-3 text-right type-num">{donor.gifts.length}</td>
            <td class="p-3 text-right type-num">{money(donor.cashTotal)}</td>
            <td class="p-3 text-right type-num">{money(donor.inKindTotal)}</td>
            <td class="p-3 text-right type-num">{money(donor.total)}</td>
            <td class="p-3 text-right">
              <button type="button" class="m3-button-text" onclick={() => exportOne(donor)}>
                <Download size={14} aria-hidden="true" />
                <span class="sr-only">Export {donor.displayName}</span>
              </button>
            </td>
          </tr>
          {#if expandedKey === donor.key}
            <tr>
              <td colspan="6" class="p-3">
                <ul class="flex flex-col gap-1">
                  {#each donor.gifts as gift (gift.id)}
                    <li class="flex items-center justify-between gap-3 type-body-sm">
                      <span>{gift.date}</span>
                      <span class="opacity-70">{sourceLabel(gift.source)}</span>
                      <span class="flex-1">{gift.description}</span>
                      <span class="type-num">{money(gift.amount)}</span>
                    </li>
                  {/each}
                </ul>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td class="p-3 type-label">{donors.length} donors</td>
          <td colspan="3"></td>
          <td class="p-3 text-right type-num">{money(grandTotal)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
{/if}
```

If any of `m3-select`, `m3-input`, `m3-button`, `m3-button-text`, or `m3-card` is not an existing class in `src/styles/app.css`, substitute the nearest equivalent already used by `DepositsList.svelte` rather than inventing new classes.

- [ ] **Step 2: Add the third view to the Money route**

Replace the contents of `src/routes/money/+page.svelte`:

```svelte
<script lang="ts">
  import ExpensesList from '$lib/components/expenses/ExpensesList.svelte';
  import DepositsList from '$lib/components/deposits/DepositsList.svelte';
  import DonorsList from '$lib/components/donors/DonorsList.svelte';
  import SegmentedToggle from '$lib/components/layout/SegmentedToggle.svelte';
  import { Receipt, Landmark, HeartHandshake } from 'lucide-svelte';

  let view = $state<'expenses' | 'deposits' | 'donors'>('expenses');

  const viewOptions = [
    { value: 'expenses', label: 'Expenses', icon: Receipt },
    { value: 'deposits', label: 'Deposits', icon: Landmark },
    { value: 'donors', label: 'Donors', icon: HeartHandshake }
  ];
</script>

<SegmentedToggle
  options={viewOptions}
  bind:value={view}
  class="mb-4"
  ariaLabel="Money view"
/>

{#if view === 'expenses'}
  <ExpensesList />
{:else if view === 'deposits'}
  <DepositsList />
{:else}
  <DonorsList />
{/if}
```

- [ ] **Step 3: Type-check and test**

Run: `npm run check && npm test`
Expected: no new errors, all tests PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/donors/DonorsList.svelte src/routes/money/+page.svelte
git commit -m "Add the Donors view to the Money tab"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `expenses` gains `donated`, `donorName`, `taxYear` | 1, 5, 10 |
| `incomeDeposits` gains `donorName`, `taxYear` | 5, 10 |
| `in_kind_gifts` category + `--color-flow-12` | 1 |
| Excluded from `DEPOSIT_FORM_CATEGORIES` / `HCB_INCOME_CATEGORIES` | 1 |
| `expenseCanMatchHcb` guard | 2 |
| Offsetting synthetic income entry | 3 |
| Donated never debits an account | 4 |
| Three gift sources, deduped via the ledger | 6 |
| Tax-year attribution by donation date | 6 |
| Name normalization | 6 |
| Fuzzy suggestions, human-confirmed | 7 |
| Anonymous rolled into one shown row | 6, 7 |
| CSV export, both shapes | 8 |
| HCB `/donations` sync | 9 |
| Money tab third view, year selector, search, expand, export | 11 |
| Caveat copy in UI and CSV | 8, 11 |

**Type consistency:** `DonorGift`, `DonorTotals`, `DuplicateSuggestion`, `HcbDonationRef`, and `GiftSource` are defined in Task 6/7 and used unchanged in 8, 9, and 11. `collectGifts` takes `{ entries, hcbDonations, taxYear }` in every reference. `donorsToCsv` and `giftsToCsv` both take `(…, period: string)` throughout.

**Deviation note:** the spec describes accepting a duplicate suggestion as a merge. This plan's Task 11 surfaces suggestions with a Dismiss action and directs the user to rename the underlying record instead, because persisting an accepted merge would need a `donorAliases` table that the spec does not define. Renaming the record achieves the same consolidation with no new schema. Flag to the user at execution time if a persisted merge is wanted.

## Corrections made during execution

Two of this plan's tests were found to be **vacuous** while executing Tasks 6–8 —
they passed against a deliberately broken implementation — and were fixed in place:

1. `suggestDuplicates > 'never suggests merging the anonymous bucket into a named
   donor'` paired `'anonymous'` with `'anonymous yours'`, whose similarity is 0.60,
   well under the 0.85 threshold. The pair would never be suggested with or without
   the exemption. Fixed by using `'anonymouse'` (similarity 0.90) and asserting the
   pair clears the threshold, so the test cannot silently drift back below it.
2. `suggestDuplicates > 'reports each pair once, not twice'` asserted only
   `seen.size === suggestions.length`, which holds trivially for an empty array.
   Fixed by asserting the expected count of 3 first.

The lesson for future plans: when a task's RED phase is a module-missing error, that
failure proves nothing about the individual assertions. Mutate the implementation
afterwards and confirm each test catches it.

