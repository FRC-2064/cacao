import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

/**
 * Which account paid for an expense -- and, crucially, the ability to say
 * "none".
 *
 * On trunk the client sent the slug `'none'` and the server resolved it. This
 * branch replaced the slug with an `accounts` row id, and an id has no way to
 * spell "no account": `undefined` on the wire meant both "the caller did not
 * mention an account" and "the user chose no account", and the server's `??`
 * fallback read both as *leave it alone*.
 *
 * What that costs is not cosmetic. `computeBalances` keeps subtracting a
 * voucher purchase from Hack Club Bank forever, and the ledger's `claimsHcb`
 * stays true, so that expense stays eligible to absorb a bank transaction that
 * actually paid for something else.
 *
 * So `accountId` gets the same three states `donorName` already has: absent
 * leaves the stored account alone, `null` clears it, an id assigns it.
 */

const GOOGLE = 'https://accounts.google.com';

describe('which account paid', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
  let seasonId: Id<'seasons'>;
  let hcbId: Id<'accounts'>;
  let schoolId: Id<'accounts'>;

  beforeEach(async () => {
    t = convexTest(schema);
    as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|writer` });
    const userId = await as.mutation(api.auth.ensureUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch('users', userId, { role: 'student' });
      seasonId = await ctx.db.insert('seasons', {
        label: '2026-2027',
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        isCurrent: true
      });
      hcbId = await ctx.db.insert('accounts', {
        key: 'hcb_bank',
        openingBalance: 0,
        asOfDate: '2026-09-01',
        updatedAt: Date.now(),
        updatedById: userId
      });
      schoolId = await ctx.db.insert('accounts', {
        key: 'school_account',
        openingBalance: 0,
        asOfDate: '2026-09-01',
        updatedAt: Date.now(),
        updatedById: userId
      });
    });
  });

  /** A filed part, already booked against the Hack Club Bank card. */
  const fileAgainstHcb = async () =>
    await as.mutation(api.expenses.add, {
      title: 'Falcon 500',
      vendor: 'WCP',
      amount: 180,
      currency: 'USD',
      category: 'robot_parts' as const,
      status: 'approved' as const,
      seasonId,
      accountId: hcbId
    });

  const editableFields = (id: Id<'expenses'>) => ({
    id,
    title: 'Falcon 500',
    vendor: 'WCP',
    amount: 180,
    currency: 'USD',
    category: 'robot_parts' as const,
    status: 'approved' as const,
    seasonId
  });

  /**
   * The stored `accountId`, or `'unset'` when the column is genuinely gone.
   *
   * Not `?.accountId` straight out of `t.run`: a Convex function that returns
   * `undefined` answers `null`, so the two states this whole test is about
   * would arrive indistinguishable.
   */
  const storedAccountId = async (id: Id<'expenses'>): Promise<string> =>
    await t.run(async (ctx) => {
      const row = await ctx.db.get('expenses', id);
      if (!row) return 'missing';
      return 'accountId' in row ? String(row.accountId) : 'unset';
    });

  const listedAccount = async (id: Id<'expenses'>) =>
    (await t.query(api.expenses.list, {})).find((e) => e._id === id)?.account;

  test('expenses.update clears the account when the caller sends null', async () => {
    const id = await fileAgainstHcb();
    expect(await storedAccountId(id)).toBe(String(hcbId));

    // The mentor paid with a grant voucher instead: "No team account".
    await as.mutation(api.expenses.update, { ...editableFields(id), accountId: null });

    expect(await storedAccountId(id)).toBe('unset');
    // And the public row stops claiming the bank paid for it, which is what
    // `computeBalances` and the ledger's `claimsHcb` both key on.
    expect(await listedAccount(id)).toBeUndefined();
  });

  test('recordPurchase clears the account when the caller sends null', async () => {
    const id = await fileAgainstHcb();

    await as.mutation(api.expenses.recordPurchase, {
      id,
      finalPaidAmount: 175,
      paymentMethod: 'grant_voucher' as const,
      deliveryStatus: 'ordered' as const,
      accountId: null
    });

    expect(await storedAccountId(id)).toBe('unset');
    expect(await listedAccount(id)).toBeUndefined();
    // The rest of the form still saved, so this is a lost field rather than a
    // rejected write -- the failure mode that made it invisible.
    await t.run(async (ctx) => {
      expect((await ctx.db.get('expenses', id))?.paymentMethod).toBe('grant_voucher');
    });
  });

  test('an absent accountId still leaves the stored account alone', async () => {
    const id = await fileAgainstHcb();

    await as.mutation(api.expenses.update, editableFields(id));
    expect(await storedAccountId(id)).toBe(String(hcbId));

    await as.mutation(api.expenses.recordPurchase, {
      id,
      finalPaidAmount: 175,
      paymentMethod: 'hcb_card' as const,
      deliveryStatus: 'ordered' as const
    });
    expect(await storedAccountId(id)).toBe(String(hcbId));
  });

  test('an accountId that is present and set reassigns the account', async () => {
    const id = await fileAgainstHcb();

    await as.mutation(api.expenses.update, { ...editableFields(id), accountId: schoolId });
    expect(await storedAccountId(id)).toBe(String(schoolId));

    await as.mutation(api.expenses.recordPurchase, {
      id,
      finalPaidAmount: 175,
      paymentMethod: 'school_po' as const,
      deliveryStatus: 'ordered' as const,
      accountId: hcbId
    });
    expect(await storedAccountId(id)).toBe(String(hcbId));
  });

  test('a null accountId on expenses.add files the expense against no account', async () => {
    const id = await as.mutation(api.expenses.add, {
      title: 'Voucher part',
      vendor: 'AndyMark',
      amount: 40,
      currency: 'USD',
      category: 'robot_parts' as const,
      status: 'approved' as const,
      seasonId,
      accountId: null
    });

    expect(await storedAccountId(id)).toBe('unset');
    expect(await listedAccount(id)).toBeUndefined();
  });
});
