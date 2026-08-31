import {
  classifyHcbTransaction,
  isExpenseCategory,
  isIncomeCategory,
  migrateExpenseCategory,
  migrateIncomeCategory,
  type ExpenseCategory,
  type IncomeCategory,
  type Account,
  type ExpenseAccount
} from './categories';
import { seasonDateRange, withinDateRange as withinRange } from './dates';

// Re-exported because a season range is a ledger concept to every caller that
// asks for one; `dates.ts` merely owns the calendar arithmetic.
export { seasonDateRange };

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
  /** Set when the purchaser waived reimbursement, making this an in-kind gift. */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to the entry date. */
  taxYear?: number;
  season: string;
  paymentMethod?: string;
  /**
   * Which pot the money actually left. A reimbursement paid out of an HCB
   * transfer has `paymentMethod: 'personal_reimbursement'` but
   * `account: 'hcb_bank'` -- the payment method alone would never let it
   * dedupe against the bank transaction that paid it back.
   */
  account?: ExpenseAccount;
  /**
   * The calendar day the money actually moved, as asserted by a human. The
   * timestamps below are audit trail -- when the row was filed, when someone
   * pressed "mark bought" -- which is often days from the real transaction.
   * Absent on a request that has not been purchased yet, which is why
   * `expenseDate` still falls back to them.
   */
  date?: string;
  purchasedAt?: number;
  createdAt: number;
}

export interface LedgerDeposit {
  _id: string;
  title: string;
  amount: number;
  category: string;
  /** Set when this deposit is attributable to a named donor, e.g. a check. */
  donorName?: string;
  /** Explicit calendar year for donor reporting; falls back to `date`. */
  taxYear?: number;
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

/**
 * Bank-transaction id -> the category a human filed it under, overriding the
 * automatic classification. Values are unvalidated strings: they come from
 * stored data that outlives any given version of the taxonomy, so
 * `resolveHcbCategory` checks each one before trusting it.
 */
export type HcbCategoryOverrides = Record<string, string>;

/**
 * A human's filing wins over the memo rules, but only when it belongs to the
 * taxonomy for the direction the money actually moved. That check is not
 * paranoia about hand-edited data: `uncategorized` is a key in *both*
 * taxonomies, so "is this a category we know" would wave through a spend
 * category saved against a deposit. An unusable override falls back to the
 * automatic classification rather than throwing, so one stale row cannot take
 * the whole dashboard down.
 */
export function resolveHcbCategory(
  transactionId: string,
  direction: Direction,
  automatic: IncomeCategory | ExpenseCategory,
  overrides: HcbCategoryOverrides
): IncomeCategory | ExpenseCategory {
  const chosen = overrides[transactionId];
  if (!chosen) return automatic;
  if (direction === 'in') return isIncomeCategory(chosen) ? chosen : automatic;
  return isExpenseCategory(chosen) ? chosen : automatic;
}

/** How many days apart a bank transaction and a logged record may be. */
const MATCH_WINDOW_DAYS = 7;
const MATCH_WINDOW_MS = MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** Amounts must agree within a cent. Compared as integer cents — floating
 * point dollars are not reliable at the boundary (e.g. 16384.01 vs
 * 16384.02 differs by more than 0.01 in IEEE 754). */
const AMOUNT_TOLERANCE_CENTS = 1;

function expenseDate(e: LedgerExpense): string {
  if (e.date) return e.date;
  return new Date(e.purchasedAt ?? e.createdAt).toISOString().slice(0, 10);
}

function expensePaid(e: LedgerExpense): number {
  return e.finalPaidAmount ?? e.amount;
}

/**
 * A rejected or still-pending request never actually left an account, so it
 * must never absorb a bank transaction match and must never count toward a
 * spend total.
 */
export function expenseCountsTowardSpend(e: LedgerExpense): boolean {
  return e.status !== 'rejected' && e.status !== 'pending_approval';
}

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

/**
 * A read-only display row for an expense excluded from spend by
 * `expenseCountsTowardSpend`. `buildLedger` never emits an entry for one of
 * these -- they cannot match a bank transaction, so there is nothing to
 * dedupe -- but a rejected or pending request is still a real record someone
 * may want to see, so the Expenses tab builds this directly rather than
 * losing the row.
 */
export function nonSpendExpenseEntry(e: LedgerExpense): LedgerEntry {
  return {
    id: e._id,
    direction: 'out',
    source: 'logged',
    title: e.title,
    amount: expensePaid(e),
    date: expenseDate(e),
    category: migrateExpenseCategory(e.category),
    expense: e
  };
}

interface Candidate {
  key: string;
  direction: Direction;
  /** Integer cents, so amount comparisons avoid floating-point drift. */
  amountCents: number;
  dateMs: number;
  claimsHcb: boolean;
}

export function buildLedger(input: {
  expenses: LedgerExpense[];
  deposits: LedgerDeposit[];
  hcbTransactions: LedgerHcbTransaction[];
  season: string;
  /**
   * Only ever consulted for a transaction that stayed unmatched. A matched
   * transaction is already represented by the logged record it matched, and
   * that record's own category is what the team edits -- so an assignment
   * saved while a transaction was unmatched goes dormant if it later matches,
   * rather than silently overriding a human-entered record.
   */
  hcbCategoryOverrides?: HcbCategoryOverrides;
}): { entries: LedgerEntry[]; unmatchedHcb: LedgerHcbTransaction[] } {
  const range = seasonDateRange(input.season);

  // A logged record's own season field is authoritative — a human set it.
  // Only fall back to the date when that field is missing. A rejected or
  // still-pending request never actually spent money, so it is excluded
  // here rather than in the matching loop alone -- it must never appear as
  // an outgoing entry, not just be ineligible to match.
  const expenses = input.expenses
    .filter((e) =>
      e.season ? input.season === 'all' || e.season === input.season : withinRange(expenseDate(e), range)
    )
    .filter(expenseCountsTowardSpend);
  const deposits = input.deposits.filter((d) =>
    d.season ? input.season === 'all' || d.season === input.season : withinRange(d.date, range)
  );

  // Sorted only for determinism: with maximum-cardinality matching (below)
  // the processing order can no longer change *how many* transactions
  // match, only which specific transaction wins an over-subscribed record
  // when several transactions compete for the one slot. Sorting means that
  // tiebreak never depends on the order the HCB API happened to return
  // transactions in.
  const transactions = input.hcbTransactions
    .filter((t) => !t.pending && withinRange(t.date, range))
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const candidates: Candidate[] = [
    ...expenses.filter(expenseCanMatchHcb).map((e) => ({
      key: `exp:${e._id}`,
      direction: 'out' as Direction,
      amountCents: Math.round(expensePaid(e) * 100),
      dateMs: Date.parse(expenseDate(e)),
      // A reimbursement paid out of pocket and later repaid from HCB has
      // paymentMethod 'personal_reimbursement' but account 'hcb_bank' -- the
      // money genuinely left the bank, so either signal must qualify it.
      claimsHcb: e.account === 'hcb_bank' || e.paymentMethod === 'hcb_card'
    })),
    ...deposits.map((d) => ({
      key: `dep:${d._id}`,
      direction: 'in' as Direction,
      amountCents: Math.round(d.amount * 100),
      dateMs: Date.parse(d.date),
      claimsHcb: d.depositAccount === 'hcb_bank'
    }))
  ];

  // Nearest-date-greedy is the wrong algorithm here, not just the wrong
  // order: a transaction whose *only* viable record is claimed by some
  // other transaction's merely-nearest choice gets permanently stranded,
  // undercounting real spend and leaving a phantom unmatched transaction
  // (see ledger.test.ts's maximum-cardinality-matching case). Maximising
  // the number of matched pairs is exactly the right objective, because
  // every viable pair left unmatched is either a double-counted
  // transaction or a vanished record -- so this runs Kuhn's algorithm
  // (repeated augmenting-path search) over the bipartite graph of
  // transactions x viable records, which finds a matching of maximum
  // cardinality in O(transactions x candidates).
  //
  // Each transaction's candidate list is precomputed nearest-date-first
  // (record key as a stable secondary tiebreak), so among all maximum
  // matchings the search prefers near-date pairings -- it simply tries
  // them first -- while still finding a full matching when the naive
  // nearest choice would strand a more-constrained transaction.
  const viableCandidatesFor = (t: LedgerHcbTransaction): Candidate[] => {
    const direction: Direction = t.amount_cents >= 0 ? 'in' : 'out';
    const absCents = Math.abs(t.amount_cents);
    const tDateMs = Date.parse(t.date);
    return candidates
      .filter((c) => c.claimsHcb)
      .filter((c) => c.direction === direction)
      .filter((c) => Math.abs(c.amountCents - absCents) <= AMOUNT_TOLERANCE_CENTS)
      .filter((c) => Math.abs(c.dateMs - tDateMs) <= MATCH_WINDOW_MS)
      .sort((a, b) => {
        const da = Math.abs(a.dateMs - tDateMs);
        const db = Math.abs(b.dateMs - tDateMs);
        return da !== db ? da - db : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
  };

  const transactionCandidates = transactions.map(viableCandidatesFor);

  // Kuhn's algorithm: matchedRecord[key] is the transaction currently
  // holding that record (its index into `transactions`), if any.
  const matchedRecord = new Map<string, number>();

  function tryAugment(tIndex: number, visited: Set<string>): boolean {
    for (const candidate of transactionCandidates[tIndex]) {
      if (visited.has(candidate.key)) continue;
      visited.add(candidate.key);
      const holder = matchedRecord.get(candidate.key);
      if (holder === undefined || tryAugment(holder, visited)) {
        matchedRecord.set(candidate.key, tIndex);
        return true;
      }
    }
    return false;
  }

  for (let tIndex = 0; tIndex < transactions.length; tIndex++) {
    tryAugment(tIndex, new Set());
  }

  const matchedByRecord = new Map<string, string>();
  const matchedTransactionIds = new Set<string>();
  for (const [key, tIndex] of matchedRecord) {
    matchedByRecord.set(key, transactions[tIndex].id);
    matchedTransactionIds.add(transactions[tIndex].id);
  }

  const entries: LedgerEntry[] = [
    ...expenses.map<LedgerEntry>((e) => ({
      id: e._id,
      direction: 'out',
      source: 'logged',
      title: e.title,
      amount: expensePaid(e),
      date: expenseDate(e),
      category: migrateExpenseCategory(e.category),
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
      category: migrateIncomeCategory(d.category, d.amount),
      hcbTransactionId: matchedByRecord.get(`dep:${d._id}`),
      deposit: d
    }))
  ];

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

  const unmatchedHcb = transactions.filter((t) => !matchedTransactionIds.has(t.id));

  const overrides = input.hcbCategoryOverrides ?? {};

  for (const t of unmatchedHcb) {
    const { direction, category } = classifyHcbTransaction(t);
    entries.push({
      id: t.id,
      direction,
      source: 'hcb',
      title: t.memo || 'Bank transaction',
      amount: Math.abs(t.amount_cents) / 100,
      date: t.date,
      category: resolveHcbCategory(t.id, direction, category, overrides),
      hcbTransaction: t
    });
  }

  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { entries, unmatchedHcb };
}
