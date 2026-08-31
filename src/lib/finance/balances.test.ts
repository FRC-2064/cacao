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

  it('is false for a donated expense, which never moved team money', () => {
    expect(expenseDebitsAccount(expense({ status: 'donated', account: 'none' }))).toBe(false);
  });

  it('is false for a donated expense even with a stale account left on it', () => {
    // Choosing a status rather than a boolean flag is what makes this safe:
    // the status gate runs before the account is ever consulted.
    expect(expenseDebitsAccount(expense({ status: 'donated', account: 'hcb_bank' }))).toBe(false);
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
      expenses: [expense({ account: 'hcb_bank', amount: 200 })]
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
      deposits: [deposit({ depositAccount: 'school_account', amount: 75, date: '2026-06-01' })],
      expenses: []
    });
    expect(balanceOf(result, 'school_account').computed).toBe(75);
    expect(balanceOf(result, 'school_account').openingBalance).toBe(0);
  });

  it('returns a row for both accounts every time', () => {
    const result = computeBalances({ configs: [], deposits: [], expenses: [] });
    expect(result.map((b) => b.account).sort()).toEqual(['hcb_bank', 'school_account']);
  });

  /**
   * Hack Club Bank is read directly from the HCB API on every load, and its
   * transactions are never logged as deposits or expenses. So there are no
   * books of ours to disagree with the bank -- the balance is whatever HCB
   * says it is, or it is unknown. Reconciling the two would only ever be
   * comparing HCB against nothing.
   */
  it('takes the HCB balance from the bank, ignoring any computed figure', () => {
    const result = computeBalances({
      configs: [config({ account: 'hcb_bank', openingBalance: 1000 })],
      deposits: [],
      expenses: [],
      hcbMeasuredBalance: 214.81
    });
    const hcb = balanceOf(result, 'hcb_bank');
    expect(hcb.source).toBe('measured');
    expect(hcb.balance).toBe(214.81);
  });

  /**
   * The alternative -- falling back to a computed figure -- reports $0.00 as
   * though the account were empty, because nothing in the tables draws on
   * hcb_bank. An unknown balance has to read as unknown.
   */
  it('reports the HCB balance as unavailable when the bank cannot be reached', () => {
    const result = computeBalances({
      configs: [config({ account: 'hcb_bank', openingBalance: 1000 })],
      deposits: [],
      expenses: []
    });
    const hcb = balanceOf(result, 'hcb_bank');
    expect(hcb.source).toBe('unavailable');
    expect(hcb.measured).toBeUndefined();
  });

  it('reports unavailable when the cached HCB balance is too old to trust (Finding 7)', () => {
    const result = computeBalances({
      configs: [config({ account: 'hcb_bank', openingBalance: 1000 })],
      deposits: [],
      expenses: [],
      // Still present -- e.g. restored from localStorage after a sync that
      // later stopped succeeding -- but too old to call "live".
      hcbMeasuredBalance: 214.81,
      hcbBalanceIsStale: true
    });
    const hcb = balanceOf(result, 'hcb_bank');
    expect(hcb.source).toBe('unavailable');
    expect(hcb.measured).toBeUndefined();
  });

  it('still prefers measured when it is present and not stale', () => {
    const result = computeBalances({
      configs: [config({ account: 'hcb_bank', openingBalance: 1000 })],
      deposits: [],
      expenses: [],
      hcbMeasuredBalance: 214.81,
      hcbBalanceIsStale: false
    });
    const hcb = balanceOf(result, 'hcb_bank');
    expect(hcb.source).toBe('measured');
    expect(hcb.balance).toBe(214.81);
  });

  it('never marks a non-HCB account unavailable -- its books are the answer', () => {
    const result = computeBalances({
      configs: [config()],
      deposits: [],
      expenses: [],
      hcbMeasuredBalance: 214.81
    });
    expect(balanceOf(result, 'school_account').source).toBe('computed');
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
