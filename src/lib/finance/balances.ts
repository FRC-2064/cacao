import type { Account, ExpenseAccount } from './categories';

/**
 * Current account balances. Deliberately season-agnostic: "how much do we have
 * right now" is a single present-tense number, so this function takes no season
 * and callers must not filter its inputs by one.
 */

export const ALL_ACCOUNTS: Account[] = ['hcb_bank', 'school_account'];

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
  /**
   * What our arithmetic says. Meaningful for the school account and the cash
   * box, whose activity is logged. Not meaningful for HCB -- see `source`.
   */
  computed: number;
  /** What the bank says, when we can ask. HCB only. */
  measured?: number;
  /** The number to display. Zero and meaningless when source is 'unavailable'. */
  balance: number;
  /**
   * Where `balance` came from.
   *
   * - `computed` -- our own books, for accounts whose activity we log.
   * - `measured` -- read from Hack Club Bank just now.
   * - `unavailable` -- HCB could not be reached, so the balance is unknown.
   *
   * There is deliberately no reconciliation between `computed` and `measured`.
   * HCB transactions are fetched live and never written to the deposits or
   * expenses tables, so `computed` for hcb_bank is not a rival claim about the
   * balance -- it is the sum of an empty set. Comparing the two produced a
   * standing "off by $214.81" warning that only ever meant "we do not keep
   * books for this account", which is by design.
   */
  source: 'measured' | 'computed' | 'unavailable';
}

/** Sentinel `asOfDate` for an account with no configured baseline. */
export const EPOCH_DATE = '1970-01-01';

/**
 * How long a successful HCB sync is trusted as "live" before the UI must
 * fall back to the computed balance. The app syncs on load and offers a
 * manual "Sync bank" button, so a healthy session re-syncs at least once a
 * day; a cache older than that means recent syncs are failing, and showing
 * it under the words "Live balance" would be dishonest.
 */
export const HCB_STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  /**
   * True when the last successful HCB sync is too old to trust as "live"
   * (see `HCB_STALE_AFTER_MS`). This module never reads the clock itself --
   * the caller computes this from `hcbLastSyncedAt` and today's date. When
   * true, the hcb_bank row falls back to `computed` and is labelled as such,
   * even though a (stale) measured value may still be cached.
   */
  hcbBalanceIsStale?: boolean;
}): AccountBalance[] {
  const { configs, deposits, expenses, hcbMeasuredBalance, hcbBalanceIsStale } = input;

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

    const measured = account === 'hcb_bank' && !hcbBalanceIsStale ? hcbMeasuredBalance : undefined;
    const hasMeasured = typeof measured === 'number';

    // For HCB the bank is the only source there is. Falling back to `computed`
    // would assert $0.00 -- which reads as "the account is empty" rather than
    // "we could not reach the bank", and those are very different claims to
    // put in front of someone deciding whether the team can afford something.
    const source: AccountBalance['source'] =
      account === 'hcb_bank' ? (hasMeasured ? 'measured' : 'unavailable') : 'computed';

    return {
      account,
      openingBalance,
      asOfDate,
      computed,
      measured,
      balance: hasMeasured ? measured : source === 'unavailable' ? 0 : computed,
      source
    };
  });
}
