import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { normalizeDonorName } from './donorNames';

/**
 * Donors: the surface that did not exist.
 *
 * `income.add`/`update` and `expenses.add`/`update` took
 * `donorId: v.optional(v.id("donors"))`, and there was no donors query and no
 * create mutation anywhere in `convex/` -- so the two client forms that
 * collect a donor name had no way to send it, and the only donor rows on the
 * deployment were the ones the seed import wrote.
 *
 * The property under test is the one that matters: a member filling in a
 * deposit form can attribute it to a donor, existing or new, without the
 * client inventing an id and without a second round-trip that could leave the
 * deposit saved and its donor lost.
 */

const GOOGLE = 'https://accounts.google.com';

describe('attributing money to a donor', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
  let seasonId: Id<'seasons'>;
  let accountId: Id<'accounts'>;

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
      accountId = await ctx.db.insert('accounts', {
        key: 'school_account',
        openingBalance: 0,
        asOfDate: '2026-09-01',
        updatedAt: Date.now(),
        updatedById: userId
      });
    });
  });

  const deposit = (donorName?: string) => ({
    title: 'Cheque',
    amount: 500,
    category: 'community_donations' as const,
    date: '2026-10-01',
    seasonId,
    accountId,
    ...(donorName === undefined ? {} : { donorName })
  });

  test('a new donor is created by the deposit that names them', async () => {
    await as.mutation(api.income.add, deposit('Heather Jensen'));

    const donors = await as.query(api.donors.list, {});
    expect(donors.map((d) => d.displayName)).toEqual(['Heather Jensen']);
    expect((await t.query(api.income.list, {}))[0].donorName).toBe('Heather Jensen');
  });

  /**
   * One transaction, not two. A `donors.findOrCreate` the client called
   * before `income.add` could commit while the deposit failed, leaving an
   * orphan donor and an unattributed gift.
   */
  test('a failed deposit creates no donor', async () => {
    await expect(
      as.mutation(api.income.add, {
        ...deposit('Ephemeral Giver'),
        seasonId: 'nope' as unknown as Id<'seasons'>
      })
    ).rejects.toThrow();

    expect(await as.query(api.donors.list, {})).toEqual([]);
  });

  test('an existing donor is reused, not duplicated', async () => {
    await as.mutation(api.income.add, deposit('Heather Jensen'));
    await as.mutation(api.income.add, deposit('Heather Jensen'));

    expect(await as.query(api.donors.list, {})).toHaveLength(1);
  });

  /**
   * The reason the matching rule is shared rather than reimplemented. Two
   * spellings drifting apart do not raise an error -- they split one
   * household's giving across two rows and halve their total in the report.
   */
  test('two spellings of one donor do not produce two rows', async () => {
    await as.mutation(api.income.add, deposit('Ruth & Paul Harrison'));
    await as.mutation(api.income.add, deposit('  ruth and paul   harrison '));
    await as.mutation(api.income.add, deposit('Dr. Ruth and Paul Harrison,'));

    const donors = await as.query(api.donors.list, {});
    expect(donors).toHaveLength(1);
    // The first spelling seen is the one that gets displayed.
    expect(donors[0].displayName).toBe('Ruth & Paul Harrison');
    expect(donors[0].normalizedKey).toBe(normalizeDonorName('Ruth and Paul Harrison'));
  });

  test('an expense and a deposit naming one donor share the row', async () => {
    await as.mutation(api.income.add, deposit('Heather Jensen'));
    await as.mutation(api.expenses.add, {
      title: 'Donated laptop',
      vendor: 'n/a',
      amount: 400,
      currency: 'USD',
      category: 'robot_parts',
      status: 'donated',
      seasonId,
      donorName: 'HEATHER JENSEN'
    });

    expect(await as.query(api.donors.list, {})).toHaveLength(1);
    expect((await t.query(api.expenses.list, {}))[0].donorName).toBe('Heather Jensen');
  });

  test('an anonymous gift is flagged as one', async () => {
    await as.mutation(api.income.add, deposit('Anonymous Donor'));
    const donors = await as.query(api.donors.list, {});
    expect(donors[0].isAnonymous).toBe(true);
  });

  test('a blank donor name attributes to nobody and creates no row', async () => {
    await as.mutation(api.income.add, deposit('   '));
    expect(await as.query(api.donors.list, {})).toEqual([]);
    expect((await t.query(api.income.list, {}))[0].donorName).toBeUndefined();
  });

  /**
   * The distinction 12c's store had to work around by omitting the key: an
   * update from a form with no donor input must not wipe the donor.
   */
  test('an update that omits the donor leaves it alone, and a blank one clears it', async () => {
    const id = await as.mutation(api.income.add, deposit('Heather Jensen'));

    await as.mutation(api.income.update, { id, ...deposit(), amount: 600 });
    expect((await t.query(api.income.list, {}))[0].donorName).toBe('Heather Jensen');

    await as.mutation(api.income.update, { id, ...deposit(''), amount: 600 });
    expect((await t.query(api.income.list, {}))[0].donorName).toBeUndefined();
    // Clearing an attribution does not delete the donor -- other gifts and
    // past tax years still point at them.
    expect(await as.query(api.donors.list, {})).toHaveLength(1);
  });

  test('a signed-in member sees the donor list; a stranger does not', async () => {
    await as.mutation(api.income.add, deposit('Heather Jensen'));
    expect((await as.query(api.donors.list, {})).map((d) => d.displayName)).toEqual([
      'Heather Jensen'
    ]);
    // `donors.list` was public until this endpoint was gated -- its own
    // docstring justified that by donor names already being public on the
    // money queries. It feeds a writer-only typeahead, so nothing needed it
    // open. Asserted here as well as in `gates.test.ts` because the old title
    // of this test said the opposite, which is the reading that left it public.
    await expect(t.query(api.donors.list, {})).rejects.toThrow('Not signed in.');
  });

  test('a viewer cannot create a donor by naming one', async () => {
    const viewer = t.withIdentity({ tokenIdentifier: `${GOOGLE}|viewer` });
    await viewer.mutation(api.auth.ensureUser, {});

    await expect(viewer.mutation(api.income.add, deposit('Sneaky'))).rejects.toThrow(/Viewer/);
    expect(await as.query(api.donors.list, {})).toEqual([]);
  });
});

/**
 * The write side of a rule that only existed on the read side.
 *
 * `donorNames.ts` builds `isEmailShapedDonorName` and the finance module
 * applies it -- but only when rendering. A member typing an address into a
 * deposit's donor box wrote it straight to `donors.displayName`, which
 * `donors.list` emits to any member and `income.list`'s `donorName` emits to
 * anyone at all, both unredacted. Read-side redaction with no write-side
 * guard, on a branch about not publishing addresses.
 */
describe('an address typed into the donor box', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
  let seasonId: Id<'seasons'>;
  let accountId: Id<'accounts'>;

  beforeEach(async () => {
    t = convexTest(schema);
    as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|writer-email` });
    const userId = await as.mutation(api.auth.ensureUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch('users', userId, { role: 'student' });
      seasonId = await ctx.db.insert('seasons', {
        label: '2026-2027',
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        isCurrent: true
      });
      accountId = await ctx.db.insert('accounts', {
        key: 'school_account',
        openingBalance: 0,
        asOfDate: '2026-09-01',
        updatedAt: Date.now(),
        updatedById: userId
      });
    });
  });

  const deposit = (donorName: string) => ({
    title: 'Cheque',
    amount: 500,
    category: 'community_donations' as const,
    date: '2026-10-01',
    seasonId,
    accountId,
    donorName
  });

  test('never reaches the public donor list', async () => {
    await as.mutation(api.income.add, deposit('A.Rivera0106@example.com'));

    const donors = await as.query(api.donors.list, {});
    expect(donors.map((d) => d.displayName)).toEqual(['Anonymous Donor']);
    expect(donors[0].isAnonymous).toBe(true);
    // The address is not on the wire anywhere, under any field.
    expect(JSON.stringify(await t.query(api.income.list, {}))).not.toContain('@example.com');
  });

  test('is caught inside a name, not only as the whole of one', async () => {
    // "John Smith (john@example.com)" is the same disclosure as the bare
    // address, which is why the test is containment rather than a full match.
    await as.mutation(api.income.add, deposit('John Smith (john@example.com)'));

    const donors = await as.query(api.donors.list, {});
    expect(donors.map((d) => d.displayName)).toEqual(['Anonymous Donor']);
  });

  test('and the money is still recorded, because the deposit is not refused', async () => {
    await as.mutation(api.income.add, deposit('A.Rivera0106@example.com'));

    const deposits = await t.query(api.income.list, {});
    expect(deposits).toHaveLength(1);
    expect(deposits[0].amount).toBe(500);
    expect(deposits[0].donorName).toBe('Anonymous Donor');
  });

  test('a real name is left exactly as typed', async () => {
    await as.mutation(api.income.add, deposit('Ruth & Paul Harrison'));

    const donors = await as.query(api.donors.list, {});
    expect(donors.map((d) => d.displayName)).toEqual(['Ruth & Paul Harrison']);
    expect(donors[0].isAnonymous).toBe(false);
  });
});
