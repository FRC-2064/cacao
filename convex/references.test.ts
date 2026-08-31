import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

/**
 * Referential integrity on the write side.
 *
 * Convex's `v.id("accounts")` validator checks that a string is an id *for
 * that table*. It does not check that the row is still there, and nothing
 * else did either -- so a mutation would happily store a reference to a row
 * that no longer exists.
 *
 * That is not hypothetical. `seed.importAll` wipes every table and re-creates
 * each row with a fresh `_id`; a client holding a pre-import snapshot (an open
 * deposit form, a queued write) posts the old one. The worst landing place is
 * `incomeDeposits.accountId`, which is required and which `income.list` --
 * the *unauthenticated* public financials query -- resolves through a map and
 * throws on. One such row takes the public page down for every visitor, and
 * there is no way back in-app: the mutations that could repair the row need
 * the deposit's id, which comes from the query that is now throwing.
 *
 * The optional case is quieter and worse: a stale `expenses.accountId` does
 * not throw on read, it yields `account: undefined`, and the expense lands in
 * the wrong balance bucket with no error at all.
 */

const GOOGLE = 'https://accounts.google.com';

describe('mutations reject references to rows that do not exist', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
  let seasonId: Id<'seasons'>;
  let deadSeasonId: Id<'seasons'>;
  let accountId: Id<'accounts'>;
  let deadAccountId: Id<'accounts'>;
  let deadDonorId: Id<'donors'>;
  let deadUserId: Id<'users'>;

  beforeEach(async () => {
    t = convexTest(schema);
    as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|writer` });
    const userId = await as.mutation(api.auth.ensureUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch('users', userId, { role: 'admin' });

      seasonId = await ctx.db.insert('seasons', {
        label: '2026-2027',
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        isCurrent: true
      });
      accountId = await ctx.db.insert('accounts', {
        key: 'school_account',
        openingBalance: 100,
        asOfDate: '2026-09-01',
        updatedAt: Date.now(),
        updatedById: userId
      });

      // The rows a pre-import snapshot would still be pointing at. Deleting
      // them here is exactly what `seed.importAll`'s wipe loop does.
      deadAccountId = await ctx.db.insert('accounts', {
        key: 'hcb_bank',
        openingBalance: 0,
        asOfDate: '2026-09-01',
        updatedAt: Date.now(),
        updatedById: userId
      });
      await ctx.db.delete('accounts', deadAccountId);

      deadSeasonId = await ctx.db.insert('seasons', {
        label: '2025-2026',
        startDate: '2025-09-01',
        endDate: '2026-08-31',
        isCurrent: false
      });
      await ctx.db.delete('seasons', deadSeasonId);

      deadDonorId = await ctx.db.insert('donors', {
        displayName: 'Ruth Harrison',
        normalizedKey: 'ruth harrison',
        isAnonymous: false
      });
      await ctx.db.delete('donors', deadDonorId);

      deadUserId = await ctx.db.insert('users', {
        tokenIdentifier: `${GOOGLE}|gone`,
        role: 'student',
        requested: false
      });
      await ctx.db.delete('users', deadUserId);
    });
  });

  const deposit = () => ({
    title: 'Concessions',
    amount: 250,
    category: 'fundraising' as const,
    date: '2026-10-01',
    seasonId,
    accountId
  });

  /**
   * The critical case. Before the write-side check this was *accepted* -- the
   * id validator saw a well-formed `accounts` id and let it through.
   */
  test('income.add refuses a deposit whose account row is gone', async () => {
    await expect(
      as.mutation(api.income.add, { ...deposit(), accountId: deadAccountId })
    ).rejects.toThrow(/accounts/);
  });

  /**
   * The consequence, asserted from the outside: whatever a client tries to
   * post, a stranger can still read the financials afterwards. This is the
   * assertion that actually describes the harm -- `income.list` is the
   * unauthenticated public query, and it has no identity here.
   */
  test('the public financials query survives a client posting a stale account id', async () => {
    await expect(
      as.mutation(api.income.add, { ...deposit(), accountId: deadAccountId })
    ).rejects.toThrow();

    await expect(t.query(api.income.list, {})).resolves.toEqual([]);
  });

  test('income.update refuses a stale account id', async () => {
    const id = await as.mutation(api.income.add, deposit());
    await expect(
      as.mutation(api.income.update, { id, ...deposit(), accountId: deadAccountId })
    ).rejects.toThrow(/accounts/);

    // The stored row is untouched, so the public query is still readable.
    const rows = await t.query(api.income.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].depositAccount).toBe('school_account');
  });

  test('income.add refuses a stale season id', async () => {
    await expect(
      as.mutation(api.income.add, { ...deposit(), seasonId: deadSeasonId })
    ).rejects.toThrow(/seasons/);
  });

  const expense = () => ({
    title: 'Swerve modules',
    vendor: 'REV',
    amount: 1240,
    currency: 'USD',
    category: 'robot_parts' as const,
    status: 'purchased' as const,
    seasonId
  });

  /**
   * The quiet one. `expenses.accountId` is optional, so a stale id never
   * throws on read -- `expenses.list` emits `account: undefined` and the
   * expense silently files under neither account's balance.
   */
  test('expenses.add refuses a stale account id even though it is optional', async () => {
    await expect(
      as.mutation(api.expenses.add, { ...expense(), accountId: deadAccountId })
    ).rejects.toThrow(/accounts/);
  });

  test('expenses.add refuses a stale grant id', async () => {
    await expect(
      as.mutation(api.expenses.add, {
        ...expense(),
        linkedGrantId: 'x' as unknown as Id<'grants'>
      })
    ).rejects.toThrow();
  });

  /**
   * Donors are the one reference a client never sends as an id -- the deposit
   * and expense mutations take a *name* and resolve it here (see
   * `convex/donors.ts`), so there is no stale-id case to reject. Asserted
   * rather than assumed: the argument is gone from the surface.
   */
  test('the deposit mutations take no donor id at all', () => {
    expect(deadDonorId).toBeDefined();
    // @ts-expect-error -- `donorId` is not an argument of `income.add`.
    const rejected: Parameters<typeof api.income.add>[0] = { donorId: deadDonorId };
    expect(rejected).toBeDefined();
  });

  test('expenses.recordPurchase refuses a stale account id', async () => {
    const id = await as.mutation(api.expenses.add, expense());
    await expect(
      as.mutation(api.expenses.recordPurchase, {
        id,
        finalPaidAmount: 1240,
        paymentMethod: 'hcb_card',
        deliveryStatus: 'ordered',
        accountId: deadAccountId
      })
    ).rejects.toThrow(/accounts/);
  });

  const grant = () => ({
    title: 'Community grant',
    funder: 'Rotary',
    amount: 5000,
    currency: 'USD',
    status: 'backlog' as const,
    deadlineType: 'rolling' as const,
    priority: 'medium' as const,
    seasonId,
    requirements: []
  });

  test('grants.create refuses a stale assignee or season id', async () => {
    await expect(
      as.mutation(api.grants.create, { ...grant(), assigneeId: deadUserId })
    ).rejects.toThrow(/users/);
    await expect(
      as.mutation(api.grants.create, { ...grant(), seasonId: deadSeasonId })
    ).rejects.toThrow(/seasons/);
  });

  test('grants.update refuses a stale assignee id', async () => {
    const id = await as.mutation(api.grants.create, grant());
    const stored = await t.run(async (ctx) => await ctx.db.get('grants', id));
    await expect(
      as.mutation(api.grants.update, {
        id,
        ...grant(),
        order: stored!.order,
        assigneeId: deadUserId
      })
    ).rejects.toThrow(/users/);
  });

  test('sponsors.create refuses a stale primary contact id', async () => {
    const deadContactId = await t.run(async (ctx) => {
      const cid = await ctx.db.insert('contacts', {
        name: 'Pat Vendor',
        title: 'Owner',
        email: 'pat@example.com',
        isPrimary: true,
        preferredMethod: 'email' as const,
        updatedAt: Date.now()
      });
      await ctx.db.delete('contacts', cid);
      return cid;
    });

    await expect(
      as.mutation(api.sponsors.create, {
        name: 'Acme',
        category: 'local_business',
        tier: 'bronze',
        status: 'lead',
        totalDonated: 0,
        primaryContactId: deadContactId
      })
    ).rejects.toThrow(/contacts/);
  });

  test('contacts.create refuses a stale sponsor id', async () => {
    const deadSponsorId = await t.run(async (ctx) => {
      const sid = await ctx.db.insert('sponsors', {
        name: 'Gone Ltd',
        category: 'local_business' as const,
        tier: 'none' as const,
        status: 'lead' as const,
        totalDonated: 0,
        updatedAt: Date.now()
      });
      await ctx.db.delete('sponsors', sid);
      return sid;
    });

    await expect(
      as.mutation(api.contacts.create, {
        sponsorId: deadSponsorId,
        name: 'Pat Vendor',
        title: 'Owner',
        email: 'pat@example.com',
        isPrimary: true,
        preferredMethod: 'email'
      })
    ).rejects.toThrow(/sponsors/);
  });

  /** A live reference still goes through -- the check is not a blanket refusal. */
  test('a live reference is still accepted', async () => {
    const id = await as.mutation(api.income.add, {
      ...deposit(),
      donorName: 'Heather Jensen'
    });
    expect(id).toBeDefined();

    const rows = await t.query(api.income.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].donorName).toBe('Heather Jensen');
  });
});
