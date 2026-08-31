import { describe, it, expect } from 'vitest';
import {
  seasonDateRange,
  buildLedger,
  nonSpendExpenseEntry,
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

  it("falls back to the date when a record's season field is absent", () => {
    const inSeason = build({
      expenses: [expense({ season: '', purchasedAt: Date.parse('2026-10-10T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });
    expect(inSeason.entries).toHaveLength(1);

    const outOfSeason = build({
      expenses: [expense({ season: '', purchasedAt: Date.parse('2025-01-10T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
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

  // These specific values are not arbitrary: at amount=16384.01 the naive
  // dollar-float comparison computes |16384.01 - 16384.02| as
  // 0.010000000002037268 (just over 0.01), so it would wrongly reject a
  // genuine one-cent match. Do not "simplify" these back to round numbers —
  // round numbers do not expose the float bug and the coverage is lost.
  it('matches a genuine one-cent gap that a dollar-float comparison would miss', () => {
    const result = build({
      expenses: [expense({ amount: 16384.01 })],
      deposits: [],
      hcbTransactions: [txn({ amount_cents: -1638402 })],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
    expect(result.unmatchedHcb).toHaveLength(0);
  });

  it('does not match a 49-cent gap at the same float-hazardous amount', () => {
    const result = build({
      expenses: [expense({ amount: 16384.01 })],
      deposits: [],
      hcbTransactions: [txn({ amount_cents: -1638450 })],
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

  it('never lets a non-hcb deposit absorb a bank transaction', () => {
    const result = build({
      expenses: [],
      deposits: [deposit({ depositAccount: 'school_account', amount: 300 })],
      hcbTransactions: [txn({ id: 'txn2', amount_cents: 30000, type: 'donation', memo: 'Donation from Pat' })],
      season: '2026-2027'
    });
    expect(result.unmatchedHcb).toHaveLength(1);
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

describe('buildLedger dedupe is order-independent (Finding 2)', () => {
  // Two logged expenses whose windows overlap, and two bank transactions that
  // between them can only be assigned one correct way: T2 (Oct 15) is more
  // than 7 days from A (Oct 5), so T2 can only ever match B: T1 (Oct 8) is
  // within range of both, but is only needed for A once B is spoken for.
  // A naive "each transaction takes its nearest still-open candidate,
  // processed in feed order" reads T1 first, greedily hands it B (2 days
  // beats 3), and leaves T2 -- now stranded, since A is 10 days from Oct 15,
  // outside the 7-day window -- unmatched. That mints a spurious extra $100
  // of spend: A ($100) + B ($100) + unmatched T2 ($100) = $300 for $200 of
  // real spend. The fix must produce $200 no matter which order the two
  // transactions arrive in from the HCB API.
  const expenseA = () =>
    expense({ _id: 'a', title: 'A', amount: 100, purchasedAt: Date.parse('2026-10-05T00:00:00Z') });
  const expenseB = () =>
    expense({ _id: 'b', title: 'B', amount: 100, purchasedAt: Date.parse('2026-10-10T00:00:00Z') });
  const t1 = () => txn({ id: 't1', date: '2026-10-08', amount_cents: -10000 });
  const t2 = () => txn({ id: 't2', date: '2026-10-15', amount_cents: -10000 });

  const outTotal = (result: ReturnType<typeof build>) =>
    result.entries.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);

  it('totals $200 when the feed lists the earlier transaction first', () => {
    const result = build({
      expenses: [expenseA(), expenseB()],
      deposits: [],
      hcbTransactions: [t1(), t2()],
      season: '2026-2027'
    });
    expect(outTotal(result)).toBe(200);
    expect(result.unmatchedHcb).toHaveLength(0);
  });

  it('totals $200 when the feed lists the later transaction first (opposite order)', () => {
    const result = build({
      expenses: [expenseA(), expenseB()],
      deposits: [],
      hcbTransactions: [t2(), t1()],
      season: '2026-2027'
    });
    expect(outTotal(result)).toBe(200);
    expect(result.unmatchedHcb).toHaveLength(0);
  });
});

describe('buildLedger dedupe uses maximum-cardinality matching, not nearest-date greedy', () => {
  // This is the reviewer-executed counter-example that proved greedy-by-
  // nearest-date is the wrong algorithm, not just wrongly ordered.
  //
  // X purchased Oct 10, Y purchased Oct 13, both $100 / hcb_card.
  // T_early dated Oct 4, T_late dated Oct 10, both -$100.
  //
  // Viable pairs (within the +/-7-day window): T_early-X (6 days),
  // T_late-X (0 days), T_late-Y (3 days). T_early-Y is 9 days apart, so it
  // is NOT viable -- T_early can only ever match X.
  //
  // A nearest-date-greedy matcher, no matter what order it processes
  // transactions in, can pick T_late-X first because 0 days beats every
  // other distance. That strands T_early with no viable partner (Y is out
  // of window), producing outTotal=300 and one unmatched transaction for
  // what is genuinely $200 of real spend. The only algorithm that gets
  // this right notices T_early has just one option and reserves X for it,
  // freeing T_late for Y: T_early-X and T_late-Y is the unique matching
  // that uses both transactions.
  //
  // Do not "simplify" these dates back to something that lets greedy pass
  // by accident -- the 0-day and 9-day figures are exactly what make the
  // greedy choice look locally correct while being globally wrong.
  const expenseX = () =>
    expense({ _id: 'x', title: 'X', amount: 100, purchasedAt: Date.parse('2026-10-10T00:00:00Z') });
  const expenseY = () =>
    expense({ _id: 'y', title: 'Y', amount: 100, purchasedAt: Date.parse('2026-10-13T00:00:00Z') });
  const tEarly = () => txn({ id: 't_early', date: '2026-10-04', amount_cents: -10000 });
  const tLate = () => txn({ id: 't_late', date: '2026-10-10', amount_cents: -10000 });

  const outTotal = (result: ReturnType<typeof build>) =>
    result.entries.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);

  it('matches both transactions for $200 total, where nearest-date greedy would strand one at $300', () => {
    const result = build({
      expenses: [expenseX(), expenseY()],
      deposits: [],
      hcbTransactions: [tEarly(), tLate()],
      season: '2026-2027'
    });
    expect(outTotal(result)).toBe(200);
    expect(result.unmatchedHcb).toHaveLength(0);

    const x = result.entries.find((e) => e.id === 'x');
    const y = result.entries.find((e) => e.id === 'y');
    expect(x?.hcbTransactionId).toBe('t_early');
    expect(y?.hcbTransactionId).toBe('t_late');
  });

  it('still matches both regardless of the feed order the transactions arrive in', () => {
    const result = build({
      expenses: [expenseX(), expenseY()],
      deposits: [],
      hcbTransactions: [tLate(), tEarly()],
      season: '2026-2027'
    });
    expect(outTotal(result)).toBe(200);
    expect(result.unmatchedHcb).toHaveLength(0);
  });

  // Mirror-image case: constructed so that greedy processing in ASCENDING
  // date order fails (the earlier transaction is the unconstrained one and
  // grabs the shared candidate first), proving the fix is a real bipartite
  // matcher and not logic tuned only to rescue the descending-order
  // counter-example above.
  //
  // P purchased Oct 3, Q purchased Oct 10, both $100.
  // T1 dated Oct 9: 6 days from P (viable), 1 day from Q (viable, nearer).
  // T2 dated Oct 16: 13 days from P (NOT viable), 6 days from Q (viable).
  //
  // T2 can only ever match Q. Ascending-order-first greedy visits T1
  // (Oct 9) before T2 (Oct 16), and T1's nearest candidate is Q (1 day
  // beats 6) -- so it takes Q. T2 is then left with only P, out of window,
  // and goes unmatched: P ($100) + Q ($100) + unmatched T2 ($100) = $300
  // for $200 of real spend. The unique matching that uses both
  // transactions is T1-P and T2-Q.
  const expenseP = () =>
    expense({ _id: 'p', title: 'P', amount: 100, purchasedAt: Date.parse('2026-10-03T00:00:00Z') });
  const expenseQ = () =>
    expense({ _id: 'q', title: 'Q', amount: 100, purchasedAt: Date.parse('2026-10-10T00:00:00Z') });
  const t1 = () => txn({ id: 't1', date: '2026-10-09', amount_cents: -10000 });
  const t2 = () => txn({ id: 't2', date: '2026-10-16', amount_cents: -10000 });

  it('matches both in the ascending-order trap case too', () => {
    const result = build({
      expenses: [expenseP(), expenseQ()],
      deposits: [],
      hcbTransactions: [t1(), t2()],
      season: '2026-2027'
    });
    expect(outTotal(result)).toBe(200);
    expect(result.unmatchedHcb).toHaveLength(0);

    const p = result.entries.find((e) => e.id === 'p');
    const q = result.entries.find((e) => e.id === 'q');
    expect(p?.hcbTransactionId).toBe('t1');
    expect(q?.hcbTransactionId).toBe('t2');
  });
});

describe('buildLedger dedupe: more transactions than viable records', () => {
  it('leaves the surplus transactions unmatched and never double-matches a record', () => {
    // One expense, three same-amount transactions all within window: only
    // one can win, the other two must surface as unmatched hcb entries.
    // The record is dated Oct 12 so that the nearest candidate (t3, 0 days)
    // is also the one the kept descending-date processing order visits
    // first -- the two tiebreaks agree, so the winner is unambiguous
    // without relying on augmenting-path implementation details.
    const result = build({
      expenses: [expense({ _id: 'only', amount: 100, purchasedAt: Date.parse('2026-10-12T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [
        txn({ id: 't1', date: '2026-10-08', amount_cents: -10000 }),
        txn({ id: 't2', date: '2026-10-10', amount_cents: -10000 }),
        txn({ id: 't3', date: '2026-10-12', amount_cents: -10000 })
      ],
      season: '2026-2027'
    });
    const matched = result.entries.filter((e) => e.hcbTransactionId);
    expect(matched).toHaveLength(1);
    expect(matched[0].hcbTransactionId).toBe('t3'); // nearest date wins the tiebreak
    expect(result.unmatchedHcb).toHaveLength(2);
    // No record absorbs two transactions and no transaction is consumed
    // twice: exactly one of the three transactions is matched, and the
    // single expense entry carries exactly one hcbTransactionId.
    const hcbIds = result.entries.filter((e) => e.hcbTransactionId).map((e) => e.hcbTransactionId);
    expect(new Set(hcbIds).size).toBe(hcbIds.length);
  });

  it('matches as many as possible (maximum cardinality) when several transactions compete for fewer records', () => {
    // Two expenses, three transactions. All three transactions are viable
    // against both expenses (same amount, all within window of both), so
    // greedy-by-nearest and maximum-cardinality agree only two can match --
    // but a naive implementation could accidentally leave both records
    // matched to the same transaction id, or drop a match it didn't need
    // to. Assert exactly two matches, one surplus, and one-to-one holds.
    const result = build({
      expenses: [
        expense({ _id: 'e1', amount: 100, purchasedAt: Date.parse('2026-10-09T00:00:00Z') }),
        expense({ _id: 'e2', amount: 100, purchasedAt: Date.parse('2026-10-11T00:00:00Z') })
      ],
      deposits: [],
      hcbTransactions: [
        txn({ id: 't1', date: '2026-10-08', amount_cents: -10000 }),
        txn({ id: 't2', date: '2026-10-10', amount_cents: -10000 }),
        txn({ id: 't3', date: '2026-10-12', amount_cents: -10000 })
      ],
      season: '2026-2027'
    });
    const matched = result.entries.filter((e) => e.hcbTransactionId);
    expect(matched).toHaveLength(2);
    expect(result.unmatchedHcb).toHaveLength(1);
    const hcbIds = matched.map((e) => e.hcbTransactionId);
    expect(new Set(hcbIds).size).toBe(hcbIds.length);
    const recordIds = matched.map((e) => e.id);
    expect(new Set(recordIds).size).toBe(recordIds.length);
  });
});

describe('HCB reimbursements dedupe by account (Finding 3)', () => {
  it('matches a personal_reimbursement expense paid back from hcb_bank', () => {
    const result = build({
      expenses: [
        expense({
          paymentMethod: 'personal_reimbursement',
          account: 'hcb_bank',
          status: 'reimbursed'
        })
      ],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].hcbTransactionId).toBe('txn1');
    expect(result.unmatchedHcb).toHaveLength(0);
  });

  it('still never lets a school PO or cash expense absorb a bank transaction', () => {
    const result = build({
      expenses: [expense({ paymentMethod: 'personal_reimbursement', account: 'school_account' })],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    expect(result.unmatchedHcb).toHaveLength(1);
  });

  // Regression guard for the wire boundary: convex/expenses.ts must map the
  // stored accountId back to its slug before this record ever reaches
  // buildLedger. If it ever emitted an id instead, `account === 'hcb_bank'`
  // below would silently evaluate to false, the expense would stop matching
  // the live HCB transaction that paid it, and the dashboard would show it
  // twice with no error and no failing type check.
  it('an hcb_card expense with account hcb_bank collapses against its matching HCB transaction into one entry', () => {
    const result = build({
      expenses: [
        expense({
          paymentMethod: 'hcb_card',
          account: 'hcb_bank',
          status: 'purchased'
        })
      ],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    const outgoing = result.entries.filter((e) => e.direction === 'out');
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].hcbTransactionId).toBe('txn1');
    expect(result.unmatchedHcb).toHaveLength(0);
  });
});

describe('rejected and pending expenses never count as spend (Finding 5)', () => {
  it('excludes a rejected expense from the outgoing entries and total', () => {
    const result = build({
      expenses: [expense({ status: 'rejected' })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(0);
  });

  it('excludes a pending_approval expense from the outgoing entries and total', () => {
    const result = build({
      expenses: [expense({ status: 'pending_approval' })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(0);
  });

  it('never lets a rejected expense absorb a bank transaction', () => {
    const result = build({
      expenses: [expense({ status: 'rejected' })],
      deposits: [],
      hcbTransactions: [txn()],
      season: '2026-2027'
    });
    // The expense itself never appears; the transaction it would have
    // wrongly claimed surfaces as its own unmatched (and still counted)
    // bank entry instead.
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].source).toBe('hcb');
    expect(result.unmatchedHcb).toHaveLength(1);
  });

  it('does not affect a normal in-season total', () => {
    const result = build({
      expenses: [expense({ status: 'purchased' }), expense({ _id: 'exp2', status: 'rejected' })],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });
    const out = result.entries.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
    expect(out).toBe(1240);
  });
});

describe('nonSpendExpenseEntry', () => {
  it('builds a display-only row for a rejected request, matching what buildLedger would have produced', () => {
    const e = expense({ status: 'rejected' });
    const row = nonSpendExpenseEntry(e);
    expect(row.direction).toBe('out');
    expect(row.source).toBe('logged');
    expect(row.amount).toBe(1240);
    expect(row.expense).toBe(e);
    expect(row.hcbTransactionId).toBeUndefined();
  });
});

describe('buildLedger — human category assignments for bank transactions', () => {
  const uncategorizedSpend = txn({
    id: 'txn_spend',
    amount_cents: -8000,
    // Deliberately not matched by any HCB_MEMO_RULES pattern, so the automatic
    // classification is `uncategorized` and the assignment has something to do.
    memo: 'SQ *BLUE BARN 447',
    date: '2026-10-05'
  });

  const uncategorizedIncome = txn({
    id: 'txn_income',
    amount_cents: 45000,
    memo: 'ACH CREDIT KELLER FOUNDATION',
    type: 'ach_transfer',
    date: '2026-10-06'
  });

  const baseInput = {
    expenses: [] as LedgerExpense[],
    deposits: [] as LedgerDeposit[],
    hcbTransactions: [uncategorizedSpend, uncategorizedIncome],
    season: '2026-2027'
  };

  it('falls back to the automatic classification when nothing is assigned', () => {
    const { entries } = build(baseInput);
    expect(entries.find((e) => e.id === 'txn_spend')!.category).toBe('uncategorized');
    expect(entries.find((e) => e.id === 'txn_income')!.category).toBe('uncategorized');
  });

  it('uses a human assignment in place of the automatic classification', () => {
    const { entries } = build({
      ...baseInput,
      hcbCategoryOverrides: { txn_spend: 'competition_travel', txn_income: 'major_donors' }
    });
    expect(entries.find((e) => e.id === 'txn_spend')!.category).toBe('competition_travel');
    expect(entries.find((e) => e.id === 'txn_income')!.category).toBe('major_donors');
  });

  it('lets a human assignment override a memo rule that guessed wrong', () => {
    const misread = txn({ id: 'txn_misread', amount_cents: -20000, memo: 'HOME DEPOT', date: '2026-10-07' });
    const auto = build({ ...baseInput, hcbTransactions: [misread] });
    expect(auto.entries[0].category).toBe('tools_shop');

    const { entries } = build({
      ...baseInput,
      hcbTransactions: [misread],
      hcbCategoryOverrides: { txn_misread: 'outreach_events' }
    });
    expect(entries[0].category).toBe('outreach_events');
  });

  // `uncategorized` is the one id both taxonomies share, so a mismatched
  // assignment cannot be caught by "is this a known category" alone -- it has
  // to be checked against the taxonomy for the direction the money moved.
  it('ignores an assignment from the wrong side of the taxonomy', () => {
    const { entries } = build({
      ...baseInput,
      // An income category on a spend, and a spend category on income.
      hcbCategoryOverrides: { txn_spend: 'major_donors', txn_income: 'robot_parts' }
    });
    expect(entries.find((e) => e.id === 'txn_spend')!.category).toBe('uncategorized');
    expect(entries.find((e) => e.id === 'txn_income')!.category).toBe('uncategorized');
  });

  it('ignores an assignment naming a category that no longer exists', () => {
    const { entries } = build({
      ...baseInput,
      hcbCategoryOverrides: { txn_spend: 'retired_category' }
    });
    expect(entries.find((e) => e.id === 'txn_spend')!.category).toBe('uncategorized');
  });

  it('ignores an assignment for a transaction that is not in the ledger', () => {
    const { entries } = build({
      ...baseInput,
      hcbCategoryOverrides: { txn_nonexistent: 'robot_parts' }
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.category === 'uncategorized')).toBe(true);
  });

  // A transaction that matched a logged record is represented by that record,
  // whose category the team edits on the record itself. An assignment saved
  // while the transaction was unmatched must not start overriding the record.
  it('does not apply an assignment to a transaction that matched a logged record', () => {
    const { entries } = build({
      expenses: [expense({ _id: 'exp_matched', category: 'robot_parts' })],
      deposits: [],
      hcbTransactions: [txn({ id: 'txn_matched' })],
      season: '2026-2027',
      hcbCategoryOverrides: { txn_matched: 'outreach_events' }
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('logged');
    expect(entries[0].category).toBe('robot_parts');
  });

  it('shifts the assigned amount out of uncategorized in the totals', () => {
    const { entries } = build({
      ...baseInput,
      hcbCategoryOverrides: { txn_spend: 'competition_travel' }
    });
    const uncategorizedOut = entries.filter((e) => e.direction === 'out' && e.category === 'uncategorized');
    expect(uncategorizedOut).toHaveLength(0);
    expect(entries.find((e) => e.category === 'competition_travel')!.amount).toBe(80);
  });
});

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

  it('never matches even with a stale hcb_bank account left on the record', () => {
    // The status gate has to run before `claimsHcb` is consulted. Without it a
    // record that was HCB-eligible before reimbursement was waived keeps its
    // account value and stays eligible, absorbing a real transaction's match.
    const { entries, unmatchedHcb } = build({
      expenses: [
        expense({
          _id: 'gift1',
          status: 'donated',
          paymentMethod: 'personal_reimbursement',
          account: 'hcb_bank',
          amount: 500
        })
      ],
      deposits: [],
      hcbTransactions: [txn({ id: 'txnGift', amount_cents: -50000, date: '2026-10-10' })],
      season: '2026-2027'
    });

    expect(entries.find((e) => e.id === 'gift1')?.hcbTransactionId).toBeUndefined();
    expect(unmatchedHcb.map((t) => t.id)).toEqual(['txnGift']);
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

describe('expense transaction date', () => {
  it("uses the expense's own date over its purchase timestamp", () => {
    const result = build({
      expenses: [
        expense({
          date: '2026-10-02',
          purchasedAt: Date.parse('2026-10-10T00:00:00Z'),
          createdAt: Date.parse('2026-10-01T00:00:00Z')
        })
      ],
      deposits: [],
      hcbTransactions: [],
      season: 'all'
    });
    expect(result.entries[0].date).toBe('2026-10-02');
  });

  it('falls back to the purchase timestamp when no date was set', () => {
    const result = build({
      expenses: [expense({ date: undefined, purchasedAt: Date.parse('2026-10-10T00:00:00Z') })],
      deposits: [],
      hcbTransactions: [],
      season: 'all'
    });
    expect(result.entries[0].date).toBe('2026-10-10');
  });

  it('falls back to the created timestamp when a request was never purchased', () => {
    const result = build({
      expenses: [
        expense({ date: undefined, purchasedAt: undefined, createdAt: Date.parse('2026-10-01T00:00:00Z') })
      ],
      deposits: [],
      hcbTransactions: [],
      season: 'all'
    });
    expect(result.entries[0].date).toBe('2026-10-01');
  });

  it('matches a bank transaction against the set date, not the purchase timestamp', () => {
    // The timestamp is 40 days from the charge -- outside the 7-day window --
    // so a match here can only come from the date the team asserted.
    const result = build({
      expenses: [
        expense({ date: '2026-10-10', purchasedAt: Date.parse('2026-11-19T00:00:00Z') })
      ],
      deposits: [],
      hcbTransactions: [txn({ date: '2026-10-10' })],
      season: 'all'
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].hcbTransactionId).toBe('txn1');
    expect(result.unmatchedHcb).toHaveLength(0);
  });

  it('places a record in a season by its date when the season field is absent', () => {
    const result = build({
      expenses: [
        expense({ season: '', date: '2026-10-10', createdAt: Date.parse('2025-01-01T00:00:00Z') })
      ],
      deposits: [],
      hcbTransactions: [],
      season: '2026-2027'
    });
    expect(result.entries).toHaveLength(1);
  });

  it('carries the set date onto a rejected request row', () => {
    expect(nonSpendExpenseEntry(expense({ status: 'rejected', date: '2026-10-02' })).date).toBe(
      '2026-10-02'
    );
  });
});
