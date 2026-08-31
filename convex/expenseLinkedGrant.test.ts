import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

/**
 * Which grant funded an expense -- and, crucially, the ability to say "none".
 *
 * Exactly the collapse `accountId` had (see `expenseAccount.test.ts`), one
 * column over. `linkedGrantId: v.optional(v.id("grants"))` has no `null`
 * member and `update` spreads `...fields` into the patch, so the only way a
 * caller can express "not funded by a grant" is by omitting the key -- and
 * Convex strips `undefined` before the arguments ever reach the server, so an
 * omitted key never reaches `patch` and the old link survives.
 *
 * `ExpenseModal` offers `<option value="">General Team Funds</option>` and
 * sent `linkedGrantId || undefined`. A mentor who files a $600 gearbox against
 * a grant, learns it is not covered and switches the dropdown back sees the
 * change apply optimistically and then silently revert on the next snapshot --
 * while grant-attribution reporting and the CSV export over-report that
 * grant's spend permanently.
 *
 * So `linkedGrantId` gets the same three states: absent leaves the stored
 * grant alone, `null` clears it, an id assigns it.
 */

const GOOGLE = 'https://accounts.google.com';

describe('which grant funded an expense', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
  let seasonId: Id<'seasons'>;
  let grantId: Id<'grants'>;
  let otherGrantId: Id<'grants'>;

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
      const grant = {
        funder: 'Region 15',
        amount: 5000,
        currency: 'USD',
        status: 'awarded' as const,
        deadlineType: 'fixed' as const,
        priority: 'high' as const,
        seasonId,
        requirements: [],
        order: 0,
        updatedAt: Date.now()
      };
      grantId = await ctx.db.insert('grants', { ...grant, title: 'Innovation in FIRST' });
      otherGrantId = await ctx.db.insert('grants', { ...grant, title: 'Gene Haas' });
    });
  });

  /** A $600 gearbox, filed against the grant the mentor thought covered it. */
  const fileAgainstGrant = async () =>
    await as.mutation(api.expenses.add, {
      title: 'Gearbox',
      vendor: 'WCP',
      amount: 600,
      currency: 'USD',
      category: 'robot_parts' as const,
      status: 'approved' as const,
      seasonId,
      linkedGrantId: grantId
    });

  const editableFields = (id: Id<'expenses'>) => ({
    id,
    title: 'Gearbox',
    vendor: 'WCP',
    amount: 600,
    currency: 'USD',
    category: 'robot_parts' as const,
    status: 'approved' as const,
    seasonId
  });

  /**
   * The stored `linkedGrantId`, or `'unset'` when the column is genuinely
   * gone. Not read through a Convex function: one that returns `undefined`
   * answers `null`, so the two states this test is about would arrive
   * indistinguishable.
   */
  const storedGrantId = async (id: Id<'expenses'>): Promise<string> =>
    await t.run(async (ctx) => {
      const row = await ctx.db.get('expenses', id);
      if (!row) return 'missing';
      return 'linkedGrantId' in row ? String(row.linkedGrantId) : 'unset';
    });

  const listedGrantId = async (id: Id<'expenses'>) =>
    (await t.query(api.expenses.list, {})).find((e) => e._id === id)?.linkedGrantId;

  test('expenses.update unlinks the grant when the caller sends null', async () => {
    const id = await fileAgainstGrant();
    expect(await storedGrantId(id)).toBe(String(grantId));

    // "General Team Funds" -- the grant did not cover it after all.
    await as.mutation(api.expenses.update, { ...editableFields(id), linkedGrantId: null });

    expect(await storedGrantId(id)).toBe('unset');
    // And the public row stops attributing the spend to that grant, which is
    // what the CSV export and grant reporting both read.
    expect(await listedGrantId(id)).toBeUndefined();
  });

  test('an absent linkedGrantId still leaves the stored grant alone', async () => {
    const id = await fileAgainstGrant();

    await as.mutation(api.expenses.update, editableFields(id));

    expect(await storedGrantId(id)).toBe(String(grantId));
  });

  test('a linkedGrantId that is present and set re-attributes the expense', async () => {
    const id = await fileAgainstGrant();

    await as.mutation(api.expenses.update, {
      ...editableFields(id),
      linkedGrantId: otherGrantId
    });

    expect(await storedGrantId(id)).toBe(String(otherGrantId));
  });

  test('a null linkedGrantId on expenses.add files the expense against no grant', async () => {
    const id = await as.mutation(api.expenses.add, {
      title: 'Bolts',
      vendor: 'McMaster',
      amount: 40,
      currency: 'USD',
      category: 'robot_parts' as const,
      status: 'approved' as const,
      seasonId,
      linkedGrantId: null
    });

    expect(await storedGrantId(id)).toBe('unset');
    expect(await listedGrantId(id)).toBeUndefined();
  });

  test('a linkedGrantId that names no grant is still refused', async () => {
    const id = await fileAgainstGrant();
    const dangling = await t.run(async (ctx) => {
      const throwaway = await ctx.db.insert('grants', {
        title: 'Deleted',
        funder: 'Nobody',
        amount: 0,
        currency: 'USD',
        status: 'declined' as const,
        deadlineType: 'fixed' as const,
        priority: 'low' as const,
        seasonId,
        requirements: [],
        order: 9,
        updatedAt: Date.now()
      });
      await ctx.db.delete('grants', throwaway);
      return throwaway;
    });

    await expect(
      as.mutation(api.expenses.update, { ...editableFields(id), linkedGrantId: dangling })
    ).rejects.toThrow(/grant/i);
  });
});
