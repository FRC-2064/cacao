# Finances Dashboard Redesign

**Date:** 2026-08-23
**Status:** Approved, ready for planning

## Problem

Three things are wrong with the current finance surfaces.

1. **The Finances tab is a report, not a dashboard.** `FinancialsView.svelte` is 570
   lines across six stacked sections that restate what the Sponsors, Deposits, and
   Expenses tabs already show. Nowhere does it answer the question the team actually
   asks: where did our money come from this season, and where did it go?

2. **Hack Club Bank data is invisible where it matters.** The team's real bank
   account is live at `hcb.hackclub.com/the-panther-project`, but only
   `HCBTreasuryCard.svelte` reads it, and only the most recent 40 transactions. The
   Expenses and Deposits tabs show hand-entered records exclusively, so money that
   moved through the HCB card never appears there.

3. **Emoji in UI labels.** Select options across four files carry decorative emoji
   that add nothing and read as unserious.

## Goals

- Finances becomes a single-screen dashboard whose hero is a Sankey flow diagram:
  income sources on the left, a season total in the middle, spend categories on the
  right.
- Expenses and Deposits each show one merged list of hand-entered records *and* HCB
  transactions, deduplicated so nothing is counted twice.
- Category taxonomy is rebuilt around how money actually arrives and leaves.
- No emoji in any UI string.

## Non-goals

- Moving HCB sync server-side into Convex. The org has 181 transactions all-time
  (two API pages); a full client-side pull is cheap and needs no schema table, cron,
  or offline story.
- Click-to-categorize overrides for HCB transactions. This is the natural follow-up
  once we see how far keyword rules get us, but it needs a table and mutations.
- Changing how grants or sponsors are recorded. Both feed the dashboard read-only.

## Decisions taken during design

| Question | Decision |
|---|---|
| Chart form | Real Sankey, hand-rolled SVG. No chart library exists in the project and none is being added. |
| HCB merge strategy | Merge into one list per tab, deduplicating matched transactions. |
| Category taxonomy | Source-shaped: 5 income categories, 6 expense categories, plus an `uncategorized` bucket the classifier may assign but no form offers. |
| Page scope | Sankey-first and lean. Drop the sponsor-tier panel, standalone itemized table, goal progress bar, and HCB treasury card; replace the deposits-only accounts panel with a real balance strip. |
| Time filter | Season, as today. `2026-2027` etc., unchanged. |
| Account balances | Replace the four stat tiles with a per-account balance split. Expenses gain an **explicit** `account` field rather than deriving one from payment method. |
| Balance timescale | A right-now number, independent of the season filter, while everything below it stays season-scoped. |
| Testing | Add vitest, covering the pure finance modules. |

---

## Architecture

A new `src/lib/finance/` folder holds pure, framework-free functions. It takes
plain arrays in and returns plain data out — no runes, no store access, no DOM.
That is what makes it testable, and the dedupe matcher is the piece most worth
testing.

```
src/lib/finance/
  categories.ts   taxonomy, metadata, migration maps, HCB keyword rules
  ledger.ts       merge manual records with HCB transactions, dedupe
  balances.ts     per-account current balance from opening + deposits - expenses
  sankey.ts       node/link layout math -> coordinates and SVG paths
```

`cacaoStore.svelte.ts` keeps its current role but gets thinner in the finance
area: it pulls the full HCB transaction history, and
`getFinancialsForSeason` delegates its rollup work to `ledger.ts` instead of
computing category sums inline. The store must not grow — it is already 1,416
lines and `getFinancialsForSeason` alone is 160 of them.

Components read derived data and render it. They contain no financial arithmetic.

---

## 1. Category taxonomy

### Income (`IncomeCategory`)

| Id | Label | What lands here |
|---|---|---|
| `grants` | Grants | Awarded grants, sourced from the `grants` table |
| `sponsorships` | Sponsorships | Sponsor money, from the `sponsors` table plus deposits |
| `major_donors` | Major donors | Single gifts at or above `MAJOR_DONOR_THRESHOLD` |
| `community_donations` | Community donations | Parents, boosters, small online gifts |
| `fundraising` | Fundraising | Can drives, merch, camps, bake sales |

`MAJOR_DONOR_THRESHOLD = 250` (dollars), exported from `categories.ts`.

`grants` and `sponsorships` are **not selectable** in the deposit form — that
money is recorded on the Grants and Sponsors tabs and would double-count if it
could also be typed in as a deposit. The form offers only `major_donors`,
`community_donations`, and `fundraising`, and carries a helper line pointing at
the Sponsors tab for anyone holding a sponsor cheque. When the user enters a
donation amount, the form pre-selects `major_donors` or `community_donations` by
comparing against the threshold, and the user may override that choice.

### Reconciliation rule

Because the same dollar can be recorded in two places, each income node has
exactly one authoritative source:

| Node | Sourced from | Never from |
|---|---|---|
| `grants` | `grants` table, `status === 'awarded'` | deposits |
| `sponsorships` | `sponsors` table annual history, `status === 'received'` | deposits |
| `major_donors`, `community_donations`, `fundraising` | `incomeDeposits` and unmatched HCB transactions | grants or sponsors tables |

The Grants and Sponsors tables are the pipeline of record for institutional
money; deposits are the record for everything else.

This leaves one edge case. A legacy deposit migrated from `sponsorship_check`
now carries category `sponsorships`, but the table above says the sponsorships
node ignores deposits — so that money would silently vanish from the totals
rather than double-count. It must not vanish. The breakdown surfaces any such
deposit in a **"needs reconciliation"** group with a note to either record it on
the sponsor's annual history and delete the deposit, or recategorise it. The
current seed data contains zero `sponsorship_check` records, so this affects only
live data, and possibly nothing at all.

### Expenses (`ExpenseCategory`)

| Id | Label | What lands here |
|---|---|---|
| `robot_parts` | Robot & parts | Mechanical, electrical, COTS components |
| `tools_shop` | Tools & shop | Tooling, machinery, consumables |
| `registration_fees` | Registration & fees | FIRST, district events, insurance |
| `competition_travel` | Competition travel | Lodging, buses, food, fuel |
| `outreach_events` | Outreach & events | Demos, camps, community events |
| `team_operations` | Team operations | Apparel, banners, safety, software, bank fees |

### Migration

Existing records must be rewritten, in `seedData.ts` and in any live Convex
deployment.

| Old income | New |
|---|---|
| `sponsorship_check` | `sponsorships` |
| `donation` | `major_donors` if amount >= 250, else `community_donations` |
| `fundraiser` | `fundraising` |
| `bottle_can_drive` | `fundraising` |
| `merch_sales` | `fundraising` |
| `camp_registration` | `fundraising` |
| `other_income` | `fundraising` |

| Old expense | New |
|---|---|
| `robot` | `robot_parts` |
| `tools` | `tools_shop` |
| `events` | `competition_travel` |
| `general` | `team_operations` |

**Two mappings are lossy and need human review after migration.** The
implementation must print the affected records rather than migrate them silently:

- `other_income -> fundraising` is a catch-all being folded into a specific
  bucket. Not strictly correct, but no better home exists in a five-category set.
- `events -> competition_travel` is ambiguous. The old category's label said
  "Events & Travel" while its helper text said "District Registration & Lodging",
  so some of those records genuinely belong in `registration_fees` and some in
  `outreach_events`.

Current seed data contains `robot` x6, `tools` x3, `events` x3, `general` x1,
`bottle_can_drive` x3, `camp_registration` x3, `donation` x2, `merch_sales` x2,
`fundraiser` x1. No `sponsorship_check` or `other_income` records exist, so those
two rows of the table matter only for live data.

### Files carrying the taxonomy

Four places define these unions and must stay in step — `convex/validators.ts`
already documents this requirement:

- `convex/validators.ts` — `expenseCategoryValidator`, `incomeCategoryValidator`
- `convex/schema.ts` — the `incomeDeposits.category` inline union
- `src/lib/types.ts` — `ExpenseCategory`, `IncomeCategory`
- `convex/income.ts` — `add` inlines its category union instead of importing
  `incomeCategoryValidator`. Fix this to import the validator, so there are three
  places to change rather than four.

---

## 2. Classifying HCB transactions

HCB transactions carry no category. They are classified by type, then by memo.

| HCB type | Classification | Confidence |
|---|---|---|
| `donation` | `major_donors` or `community_donations` by amount | High |
| `hcb_fee` | `team_operations` | High |
| `card_charge` | Keyword rules against `memo` | Partial |
| anything else | Keyword rules, then `uncategorized` | Low |

Direction comes from the sign of `amount_cents`: negative is money out, positive
is money in.

**Keyword rules** live in `categories.ts` as an ordered array of
`{ pattern: RegExp, category }`, first match wins. Seed rules, case-insensitive:

- `REV ROBOTICS`, `ANDYMARK`, `MCMASTER`, `WCP`, `WEST COAST`, `VEX` -> `robot_parts`
- `FIRST`, `REGISTRATION`, `NEFIRST` -> `registration_fees`
- `MARRIOTT`, `HAMPTON`, `HILTON`, `HOLIDAY INN`, `HOTEL` -> `competition_travel`
- `HOME DEPOT`, `LOWES`, `HARBOR FREIGHT`, `GRAINGER` -> `tools_shop`
- `AMAZON` -> `uncategorized` (deliberately: Amazon sells everything, and
  guessing here would be worse than admitting we do not know)

Anything unmatched becomes **`uncategorized`**, a real category rendered as a
muted grey node in the Sankey and a visible row group in the breakdown. It must
not be hidden or silently folded into `team_operations` — an honest grey blob is
the signal that tells the team which rules to add next.

`uncategorized` exists on both the income and expense side and is excluded from
the deposit and expense forms. It is only ever assigned by the classifier.

---

## 3. The ledger and dedupe

`ledger.ts` exports:

```ts
type LedgerSource = 'logged' | 'hcb';
type Direction = 'in' | 'out';

interface LedgerEntry {
  id: string;
  direction: Direction;
  source: LedgerSource;
  title: string;
  amount: number;          // positive dollars, direction carries the sign
  date: string;            // YYYY-MM-DD
  category: string;
  /** Set on a logged entry that matched an HCB transaction. */
  hcbTransactionId?: string;
  /** The originating record, for rendering and click-through. */
  record?: Expense | IncomeDeposit;
  hcbTransaction?: HCBTransaction;
}

function buildLedger(input: {
  expenses: Expense[];
  deposits: IncomeDeposit[];
  hcbTransactions: HCBTransaction[];
  season: string;
}): { entries: LedgerEntry[]; unmatchedHcb: HCBTransaction[] };
```

### Season filtering

Logged records carry a `season` field. HCB transactions carry only a `date`, so
`ledger.ts` needs a season-to-date-range function:

```ts
function seasonDateRange(season: string): { start: string; end: string } | null;
```

An FRC season runs **September 1 of the first year through August 31 of the
second**, so `2026-2027` yields `2026-09-01` to `2027-08-31`. The literal `all`
returns `null`, meaning no filtering.

The two record kinds filter differently, and this is deliberate:

- **Logged records** filter on their `season` field, which is authoritative
  because a human set it. Only when that field is absent do they fall back to the
  date range.
- **HCB transactions** filter on `date` against the range, since they have
  nothing else.

This preserves the existing behaviour for grants, expenses, and deposits rather
than silently re-bucketing records whose stored season disagrees with their date.

### Matching rule

An HCB transaction folds into a logged record when **all four** hold:

1. **Same direction.** Negative `amount_cents` may only match an expense;
   positive may only match a deposit.
2. **Amount equal within a cent.** `Math.abs(hcbDollars - recordAmount) <= 0.01`,
   where `recordAmount` is `finalPaidAmount ?? amount` for expenses.
3. **Date within +/- 7 days.** Compared against `purchasedAt` for expenses
   (falling back to `createdAt`) and `date` for deposits.
4. **The record already claims HCB.** `paymentMethod === 'hcb_card'` for
   expenses, `depositAccount === 'hcb_bank'` for deposits. A record paid by
   school PO must never absorb a bank transaction.

Matching is greedy and one-to-one: candidates are sorted by absolute date
distance, nearest wins, and each HCB transaction is consumed at most once. A
logged record likewise absorbs at most one transaction.

This is the single most failure-prone piece of the feature. A false match
silently erases a transaction from the totals, which is exactly the kind of bug
that survives a manual eyeball. It gets the heaviest test coverage.

### Rendering

- A matched logged record shows a `cleared` marker — it was entered by hand *and*
  confirmed against the bank.
- An unmatched HCB transaction becomes a `source: 'hcb'` entry, rendered
  **read-only**: no edit, no delete, no status change. It is a mirror of an
  external system, not a record this app owns.
- An unmatched logged record renders exactly as it does today.

---

## 4. Accounts and balances

The team holds money in three places, and the dashboard must answer "how much do
we have right now" for each. Nothing in the app does this today —
`depositsByAccount` sums deposits per account and never subtracts anything.

### The account type

`Account = 'hcb_bank' | 'school_account' | 'cash_box'`

This is the existing `DepositAccount` type renamed. Deposits keep their field
name `depositAccount` to avoid a rename across the schema, Convex functions, form,
list, and seed data for no behavioural gain.

### Expenses gain an explicit account

Expenses currently record `paymentMethod` — *how* something was paid — which is
not the same as *which pot the money left*. Three payment methods map cleanly and
two do not, so the account is stored explicitly rather than derived:

```ts
account?: Account | 'none';
```

- **Undefined** means not yet determined: the expense is still pending or
  approved but unpurchased.
- **`'none'`** means deliberately no team account — a grant voucher is vendor
  credit that never touches team cash, and a personal purchase awaiting
  reimbursement has cost the team nothing yet.

The form pre-selects from `paymentMethod` and lets the user override:

| paymentMethod | Suggested account |
|---|---|
| `hcb_card` | `hcb_bank` |
| `school_po` | `school_account` |
| `cash` | `cash_box` |
| `grant_voucher` | `none` |
| `personal_reimbursement` | `none` |
| `other` | `none` |

`personal_reimbursement` is the case worth care. While the expense sits at status
`purchased`, a student is out of pocket and no team account has moved. Only when
it reaches `reimbursed` does money leave a real account — so `MarkPurchasedModal`
leaves the account unset, and the reimbursement step asks which account repaid
them.

### Which expenses debit an account

An expense reduces a balance only when **all three** hold: status is `purchased`
or `reimbursed`, `account` is set, and `account` is not `'none'`. The amount used
is `finalPaidAmount ?? amount`.

Approved-but-unpurchased expenses do **not** debit. They are money committed, not
money gone, and the breakdown may show them as a separate "committed" figure.

### Opening balances

A new Convex table, at most three rows, admin-editable:

```ts
accounts: defineTable({
  account: accountValidator,
  openingBalance: v.number(),
  asOfDate: v.string(),      // YYYY-MM-DD
  updatedAt: v.number(),
  updatedBy: v.string(),
}).index("by_account", ["account"])
```

`asOfDate` is not decoration. Without it, deposits already reflected in the
opening balance would be counted a second time. Only activity **on or after**
`asOfDate` adjusts the balance:

```
balance(account) = openingBalance
                 + deposits to that account dated >= asOfDate
                 - debiting expenses on that account dated >= asOfDate
```

An account with no row yet is treated as `openingBalance: 0` with `asOfDate` at
the epoch, so the strip renders sensibly before anyone configures it.

### Re-baselining after an audit

The opening balance is not one-time setup. The team periodically checks the app's
figure against the real account, and that audit is how drift gets corrected:
write the true balance into `openingBalance` and set `asOfDate` to the audit
date. Everything before that date is now settled history, and the running
calculation restarts from a known-good number.

This makes accumulated error self-limiting, which is why drift is a nuisance
rather than a correctness threat. Two consequences for the implementation:

- The admin surface is an **edit** form, reached repeatedly, not a first-run
  wizard. Both fields stay editable with the current values pre-filled.
- The strip shows each account's `asOfDate` so anyone can see how stale the
  baseline is. An account last audited a year ago deserves less trust than one
  audited last week, and the UI should not flatten that difference.

Audit history is not retained — only the current baseline. Keeping a log of past
audits is a reasonable later addition, but nothing in this design needs it.

### HCB is measured, not computed

For `hcb_bank` the API returns the real balance, so the strip shows that rather
than our arithmetic. The computed figure is still calculated and compared: a
disagreement means something is miscategorised or a transaction was never logged,
which is exactly what the team wants to know. Show the drift when it exceeds a
dollar.

If the HCB sync has never succeeded, or its cache is stale, fall back to the
computed balance and label it as such. The strip must never render a blank or a
stale number presented as live.

### These balances ignore the season filter

This is the one place on the page that is not season-scoped, by explicit
decision. "How much do we have right now" is a single present-tense number; it
does not have a 2024-2025 value. Switching the season dropdown must leave the
strip unchanged.

That is a real trap for a reader who assumes the whole page moves together, so
the strip is labelled with an explicit as-of date and sits visually apart from
the season-filtered content below it.

## 5. Sankey

`sankey.ts` is pure layout math with no SVG strings and no Svelte:

```ts
interface SankeyInput {
  incoming: { id: string; label: string; value: number }[];
  outgoing: { id: string; label: string; value: number }[];
  width: number;
  height: number;
}

function layoutSankey(input: SankeyInput): {
  nodes: { id: string; label: string; value: number; x: number; y: number;
           width: number; height: number; column: 'in' | 'total' | 'out' }[];
  links: { id: string; from: string; to: string; path: string; width: number }[];
};
```

Three columns: sources at left, a single total bar at centre, destinations at
right. Node height is proportional to value against `max(totalIn, totalOut)`, so
the two sides stay visually comparable when income and spending differ. Links are
filled cubic-bezier ribbons — top edge out, down the far side, bottom edge back,
close.

`SankeyFlow.svelte` renders the result and owns responsiveness: below the `sm`
breakpoint it does not render the diagram at all, falling back to the two ranked
bar columns.

### Colors

The existing `Tone` system has six values (`neutral`, `primary`, `secondary`,
`tertiary`, `success`, `error`) and is wired to Material 3 tokens. The Sankey
needs eleven distinguishable hues plus grey for `uncategorized`, so stretching
`TONE_VAR` is the wrong move.

Add `--color-flow-1` through `--color-flow-11` plus `--color-flow-muted` to
`src/styles/app.css`. They must be defined in **all three** blocks the file
already maintains: bare `:root`, the `prefers-color-scheme: dark` block guarded
by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. Income
categories draw from the cooler end, expense categories from the warmer end, and
they must stay distinguishable in both themes.

### Accessibility

The SVG carries a `<title>` and `<desc>` summarising the season's totals;
individual ribbons are `aria-hidden` since they are decorative given the
breakdown below. The category breakdown section is the chart's text equivalent
and must therefore always render, on every breakpoint.

---

## 6. Page composition

`FinancialsView.svelte` shrinks from 570 lines to roughly 250:

1. **Page header** — title, season dropdown. Unchanged behaviour.
2. **`AccountBalances`** — a three-way split showing what each account holds
   right now: Hack Club Bank, Region 15 school account, cash on hand, and a
   combined total. Season-independent, per §4.
3. **`SankeyFlow`** — the hero. Season-filtered.
4. **`CategoryBreakdown`** — two columns, income and expenses. Each category is a
   row with a proportional bar, dollar amount, and percentage; clicking expands
   its ledger entries inline. Season-filtered.

The season's in / out / net totals are carried by the Sankey itself — its two
outer columns and centre bar are already labelled with those figures, so a
separate row of stat tiles would only restate them.

Everything else is deleted from this page: the sponsor-tier panel (duplicates
Sponsors), the deposits-only accounts panel (replaced by the balance strip, which
actually subtracts), the standalone itemized purchases table (duplicates
Expenses), the goal progress bar, the four stat tiles, and the HCB treasury card.

Because the strip and the sections below it answer questions on different
timescales, the boundary between them must be legible — the strip carries an
as-of date, the sections carry the season name.

`HCBTreasuryCard.svelte` is deleted outright. Its balance becomes the fourth stat
tile; its Sync button moves into the Deposits and Expenses page headers, where
someone looking at transaction lists would actually reach for it.

---

## 7. HCB pull

`syncHackClubBank` currently requests `per_page=40` once. Change it to page
through `per_page=100` until a page returns fewer than 100 records, capped at 10
pages as a runaway guard. The org currently returns 181 records across two pages.

Everything else about the sync stays: same endpoints, same localStorage cache
keys, same failure behaviour (warn, keep cached data, toast only when the user
asked for the sync).

---

## 8. Emoji removal

| File | What |
|---|---|
| `LogDepositModal.svelte` | 7 category labels, 3 account labels |
| `MarkPurchasedModal.svelte` | 5 payment labels, 3 delivery labels |
| `ExpenseModal.svelte` | the `Saved $X on discount!` line |
| `seedData.ts` | one sponsor note |

Strip the emoji and the space after it; leave the wording otherwise intact except
where the category rename requires new text.

---

## 9. Testing

Add vitest to `devDependencies` with a `test` script. It reuses the existing
`vite.config.ts` via a `test` block rather than adding a second config file, so
the `$lib` alias resolves without duplicated setup. No jsdom and no testing
library — only the pure modules are covered, and component rendering is out of
scope.

**`ledger.test.ts`** carries the weight:

- exact-amount match within the date window folds correctly
- amount off by more than a cent does not match
- date outside +/- 7 days does not match
- an expense paid by `school_po` never absorbs an HCB transaction
- one HCB transaction cannot be consumed by two records
- one record cannot absorb two HCB transactions
- nearest-date wins when two records are otherwise equal candidates
- an expense with `finalPaidAmount` matches on that, not on `amount`
- direction is respected: a negative transaction never matches a deposit
- a logged record's `season` field wins over its date when the two disagree
- an HCB transaction dated `2026-08-31` falls in season `2025-2026`, and one
  dated `2026-09-01` falls in `2026-2027`
- season `all` filters nothing out
- totals after merge equal logged totals plus unmatched HCB totals

**`categories.test.ts`**:

- every old category id maps to exactly one new id
- keyword rules resolve their examples
- `AMAZON` resolves to `uncategorized`, not a guess
- donation threshold splits at exactly 250 (250 is major, 249.99 is community)

**`balances.test.ts`**:

- opening balance with no activity returns the opening balance unchanged
- a deposit dated before `asOfDate` is excluded; one dated on `asOfDate` is included
- a `purchased` expense reduces its account
- a `reimbursed` expense reduces its account
- an `approved` expense does **not** reduce any account
- an expense with `account: 'none'` reduces nothing
- an expense with an undefined account reduces nothing
- a `grant_voucher` expense never touches a balance
- an expense with `finalPaidAmount` debits that, not `amount`
- an account with no configured row behaves as opening balance zero
- balances ignore the season filter entirely: the same input yields the same
  result for `2024-2025`, `2026-2027`, and `all`

**`sankey.test.ts`**:

- node heights are proportional to values
- heights sum correctly within a column
- empty input produces no nodes and does not throw
- a single category on one side still lays out
- zero-value categories are omitted rather than rendered at zero height

---

## Files

**New**
`src/lib/finance/categories.ts`, `ledger.ts`, `balances.ts`, `sankey.ts`
`src/lib/finance/categories.test.ts`, `ledger.test.ts`, `balances.test.ts`,
`sankey.test.ts`
`src/lib/components/analytics/SankeyFlow.svelte`
`src/lib/components/analytics/CategoryBreakdown.svelte`
`src/lib/components/analytics/AccountBalances.svelte`
`convex/accounts.ts`

**Rewritten**
`src/lib/components/analytics/FinancialsView.svelte`

**Modified**
`src/lib/components/expenses/ExpensesList.svelte`
`src/lib/components/deposits/DepositsList.svelte`
`src/lib/components/deposits/LogDepositModal.svelte`
`src/lib/components/expenses/AddExpenseModal.svelte`
`src/lib/components/expenses/ExpenseModal.svelte`
`src/lib/components/expenses/MarkPurchasedModal.svelte`
`src/lib/stores/cacaoStore.svelte.ts`
`src/lib/types.ts`
`src/lib/data/seedData.ts`
`src/styles/app.css`
`convex/schema.ts`, `convex/validators.ts`, `convex/income.ts`, `convex/expenses.ts`
`src/lib/components/admin/AdminPanel.svelte`
`package.json`, `vite.config.ts`

**Deleted**
`src/lib/components/expenses/HCBTreasuryCard.svelte`

---

## Risks

- **A false dedupe match hides money.** Mitigated by requiring all four
  conditions including the payment-method check, and by the test list above.
- **Category migration is lossy** for `other_income` and `events`. Mitigated by
  printing affected records for human review rather than migrating silently.
- **Eleven-hue palette may not survive dark mode.** Both themes get checked
  before the work is called done.
- **A wrong `account` on an expense silently skews a balance**, and unlike a
  dedupe error it is invisible — the number just drifts. Accepted rather than
  engineered around: the team audits against the real accounts periodically and
  re-baselines, which caps how far any error can accumulate. The HCB
  measured-vs-computed check catches it earlier on that one account.
- **Opening balances are trusted input.** A wrong figure or `asOfDate` makes
  every balance derived from it wrong until the next audit. Mitigated by showing
  both values on the strip, so a stale or implausible baseline is visible rather
  than buried in an admin screen.
- **Keyword rules will not cover every card charge.** This is accepted, not
  mitigated — `uncategorized` is the designed outcome, and the override table is
  the planned follow-up.
