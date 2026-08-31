# Donor Totals

**Date:** 2026-08-25
**Status:** Approved, ready for planning

## Problem

The team is a 501(c)(3), so donors want a figure for what they gave in a calendar
year. Today nothing in the app can answer "how much has this person given us?"

Three obstacles:

1. **Donations arrive through three unrelated paths.** Most come through Hack Club
   Bank as online donations. Some arrive as physical checks and get hand-logged as
   `incomeDeposits`. And some are *in-kind*: a team member buys something with their
   own money and waives reimbursement, so the purchase becomes a gift.

2. **Nothing records who gave.** `incomeDeposits` has no donor field. HCB donations
   carry a donor name, but only in the transaction memo and in a `/donations`
   endpoint the app does not currently call.

3. **In-kind gifts have no representation at all.** An unreimbursed purchase is
   indistinguishable from any other expense.

Names are the only join key available. There is no donor id shared between HCB,
a check, and an expense record.

## Goals

- A Donors view listing every donor with their itemized gifts and a total, filtered
  by tax year, exportable to CSV.
- Cover all three sources — HCB donations, checks logged as deposits, and in-kind
  unreimbursed purchases.
- Consolidate name variants (`"Ruth & Paul Harrison"` vs `"Ruth and Paul Harrison"`)
  so a donor is one row, not four.
- In-kind gifts count as team spending in the Sankey and category breakdown.

## Non-goals

- **This is not a tax document.** It is a reference the team hands a donor so the
  donor can cross-check their own records. The UI and CSV say so explicitly.
- **Not gross-of-fees amounts.** HCB's API reports only what landed in the account;
  there is no gross figure anywhere in the API. Several real donations land as
  `$32.26`, fee already deducted. We show what we received and label it that way.
- **No data migration.** There is no real data in these tables yet.
- **No donor contact management.** That is what `contacts` and `sponsors` are for.
  Sponsors remain companies; this view is people.

## Decisions taken during design

| Question | Decision |
|---|---|
| Where do in-kind gifts live? | Nowhere new. An in-kind gift *is* an expense whose reimbursement was waived, so it becomes a new expense **status**, not a new table. |
| Status or boolean for donated expenses? | Status `'donated'`, because it is more accurate — `reimbursed` and `donated` are mutually exclusive terminal outcomes of a personal purchase. |
| Name matching strictness | Normalize, then **fuzzy-suggest** near matches. A human reviews the list before anything is sent, so a suggestion that a person accepts is safe. Never merge silently. |
| Anonymous donors | Rolled up into a single "Anonymous" row and shown. It is a fun figure, not a person, and it must never merge into a named donor. |
| Reporting period | Explicit `taxYear` field, defaulting to the current calendar year, editable. Not derived from the FRC season, which spans two tax years. |
| Placement | Third view on the Money tab, beside Expenses and Deposits. |
| In-kind in the Sankey | **Included.** Even though it is a gift, it is still team spending, and the Sankey exists to show what the team spends. Requires an offsetting income category so the graph stays balanced. |

## Data model

No new tables.

### `expenses` — new status and two fields

```
status: ... | 'donated'      // NEW terminal state, parallel to 'reimbursed'
donorName?: string           // NEW who waived reimbursement
taxYear?: number             // NEW defaults to current calendar year
```

Choosing a status over a boolean buys a safety property for free:
`expenseDebitsAccount()` in `balances.ts` already returns true only for
`purchased`/`reimbursed`, so a donated expense can never debit an account even if
a stale `account` value is left on the record.

### `incomeDeposits` — two fields

```
donorName?: string           // NEW set for checks and other attributable gifts
taxYear?: number             // NEW defaults to current calendar year
```

`taxYear` is stored rather than derived because a check dated December 28 and
deposited January 3 belongs to whichever year the team decides, and only a human
knows which.

### `categories.ts` — one new income category

```
IncomeCategory: ... | 'in_kind_gifts'
```

This is the offsetting income side that keeps the Sankey balanced when in-kind
spend appears on the outgoing side. It needs a `--color-flow-12` custom property
added to all three theme blocks in `src/styles/app.css` (light `:root`, the
`prefers-color-scheme: dark` media block, and `:root[data-theme="dark"]`).

`in_kind_gifts` is **excluded** from `DEPOSIT_FORM_CATEGORIES` and
`HCB_INCOME_CATEGORIES` — it is never hand-assignable, only ever synthesized from
a donated expense. Offering it on a form would let the same gift be entered twice.

## Ledger changes

Two changes in `src/lib/finance/ledger.ts`.

### 1. A donated expense must never match a bank transaction

A donated expense has no bank transaction behind it — the money never moved through
a team account — so it must never be a matching candidate. Left eligible it could
absorb a real transaction's match and strand it, which the existing
maximum-cardinality matching comments correctly identify as the worst failure mode
here.

`claimsHcb` is `e.account === 'hcb_bank' || e.paymentMethod === 'hcb_card'`. So the
hole is not `personal_reimbursement` (that qualifies nothing on its own) but a
**stale `account`**: a personal purchase already marked `account: 'hcb_bank'` in
anticipation of reimbursement keeps that value when the purchaser later waives
repayment. This guard is therefore defense-in-depth against a stale account rather
than a fix for a live stranding bug, and the test that proves it must set
`account: 'hcb_bank'` on the donated expense — with `account: 'none'` the assertion
passes with or without the guard.

Split the two concerns that `expenseCountsTowardSpend` currently conflates:

- `expenseCountsTowardSpend(e)` — unchanged semantics; `donated` **does** count,
  because a gift-funded purchase is still team spending.
- `expenseCanMatchHcb(e)` — NEW. `expenseCountsTowardSpend(e) && e.status !== 'donated'`.
  Used when building the `candidates` list.

### 2. Emit an offsetting income entry per donated expense

For each donated expense, `buildLedger` emits a second, synthetic ledger entry:

```
direction: 'in'
category:  'in_kind_gifts'
amount:    finalPaidAmount ?? amount     // same figure as the spend side
date:      same as the spend entry
id:        `gift:${expense._id}`         // distinct from the spend entry's id
```

This keeps income and spend balanced so the Sankey's `Retained` /
`Drawn from reserves` node stays truthful. The synthetic entry is never eligible
for HCB matching and never reaches `computeBalances`, which reads the deposits
table directly rather than ledger entries — so no account balance moves.

## Donor aggregation

New module `src/lib/finance/donors.ts`. Pure functions, no Svelte, no network —
matching the existing `finance/` modules.

### Sources

Aggregation runs over `buildLedger({ season: 'all' })` output, **not** raw tables.
That is what guarantees a donation logged by hand *and* synced from HCB is counted
once — the dedupe already exists and this reuses it rather than re-deriving it.

| Source | Where the donor name comes from | Amount |
|---|---|---|
| HCB donation | `/donations` endpoint, keyed by transaction id; falls back to a `Donation from (.+)` memo parse | `amount_cents / 100` |
| Check | `incomeDeposits.donorName` | `amount` |
| In-kind | `expenses.donorName` on a `donated` expense | `finalPaidAmount ?? amount` |

Only the spend-side entry of a donated expense contributes to a donor total; the
synthetic `in_kind_gifts` income entry is skipped, or it would double-count.

### Tax year attribution

- Deposits and expenses: the stored `taxYear`, falling back to the year of `date`.
- HCB donations: the year of the **donation** date, not the transaction date. These
  differ — a real example settles on `2026-06-25` for a donation made `2026-06-20` —
  and at a year boundary the donation date is the one that matches what the donor
  believes.

### Name normalization

Applied in order: trim, collapse internal whitespace, casefold, strip leading and
trailing punctuation, strip honorifics (`Mr`, `Mrs`, `Ms`, `Dr`), replace `&` with
`and`. This alone collapses the real-world variants observed in the live data
(`"Samantha Christolini "` with a trailing space, `"Ruth & Paul Harrison"`).

Donors are grouped on the normalized key.

### Fuzzy suggestions

After exact-key grouping, compare remaining group keys pairwise and surface those
above a similarity threshold as dismissable "possible duplicate" suggestions. A
small Levenshtein implementation lives in the module; **no new dependency**.

Suggestions are presented for a human to accept — never applied automatically. The
user's reasoning: the list is reviewed before anything goes out, so this is a
consolidation aid rather than an authority.

**Anonymous donors are exempt.** HCB emits `"Anonymous Donor"` for anonymous gifts.
All such gifts roll into a single `Anonymous` row, which is displayed as a normal
row but is never offered as a merge suggestion against a named donor.

## UI

### Money tab gains a third view

`src/routes/money/+page.svelte` extends its existing `SegmentedToggle`:

```
[ Expenses | Deposits | Donors ]
```

### `src/lib/components/donors/DonorsList.svelte`

- Tax-year selector, defaulting to the current calendar year, plus "All time".
- Search box filtering by donor name.
- Table: **Donor · Gifts · Cash · In-kind · Total**, sorted by total descending.
- Expanding a row itemizes that donor's gifts — date, source badge (HCB / Check /
  In-kind), description, amount.
- "Possible duplicates" banner when suggestions exist, with accept/dismiss.
- **Export CSV** for the whole year, and a per-donor export for sending to one
  person.
- A standing caveat line, present in both the UI and the CSV header:
  totals reflect what the team received; processing fees may make this less than
  what the donor was charged, and donors should check their own records.

CSV is generated client-side as a `Blob` and downloaded via an object URL.

### Expenses surface

`ExpenseModal` gains `donated` in its status options, with `donorName` and
`taxYear` fields shown when that status is selected. `ExpensesList` gains a
`Donated` filter tab and a badge, alongside the existing status handling.

### Deposits surface

`LogDepositModal` gains an optional donor name field and a tax-year field
defaulting to the current year.

## Testing

New `src/lib/finance/donors.test.ts` (vitest is configured; four suites already
exist in `src/lib/finance/`):

- Normalization against the real observed variants — trailing whitespace, casing,
  `&` vs `and`, honorifics, punctuation.
- Memo-parse fallback when the donations endpoint has no row for a transaction.
- The dedupe guarantee: a check logged as a deposit *and* present as an HCB
  transaction contributes once.
- In-kind valuation prefers `finalPaidAmount` over `amount`.
- The synthetic `in_kind_gifts` income entry does not double-count into donor totals.
- Tax-year boundary: a donation made Dec 31 and settled Jan 2 files under the
  donation date.
- `Anonymous Donor` gifts aggregate into one row and never merge with a named donor.
- Fuzzy suggestion fires above the threshold and stays silent below it.

Extensions to `src/lib/finance/ledger.test.ts`:

- A donated expense never matches an HCB transaction, and does not strand a real
  transaction that would otherwise match the same record.
- A donated expense emits exactly one spend entry and one offsetting
  `in_kind_gifts` income entry of equal value.

Extensions to `src/lib/finance/balances.test.ts`:

- A donated expense never debits an account, including when a stale `account` value
  is left on the record.

## Risks

- **Name matching is inherently imperfect.** Two different people with the same name
  merge into one row. Mitigated by human review before anything is sent, and by the
  explicit framing that this is a reference rather than a tax document.
- **The `'donated'` status touches roughly six files** that enumerate expense
  statuses (types, Convex validators and schema, the modal, the list, seed data).
  Mechanical, but each one needs finding.
- **The synthetic income entry is a new concept in `buildLedger`.** It must be
  excluded from HCB matching and from donor aggregation. Both are covered by tests
  above, and this is the main thing to get right in review.
