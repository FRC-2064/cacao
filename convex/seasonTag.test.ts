import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { buildLedger, type LedgerDeposit, type LedgerExpense } from '../src/lib/finance/ledger';

const GOOGLE = 'https://accounts.google.com';

/**
 * The season tag has to survive the projection, and nothing but a test can
 * prove it.
 *
 * `buildLedger` treats a record's own season field as authoritative -- a human
 * set it -- and only falls back to inferring the season from the record's
 * date when that field is missing. That fallback is not a safe default: an
 * awarded grant's deposit belongs to the season the grant was *applied for*,
 * not the season the cheque happened to clear in, and grant money routinely
 * lands a season late. If `expenses.list` / `income.list` stop emitting
 * `season`, every record silently drops onto date inference and a chunk of
 * the books moves to the wrong season with no error and no other failing
 * test.
 *
 * So both records below are tagged to 2019-2020 but dated March 2021 --
 * outside that season's September-August range. Included means the tag won.
 * Excluded means the projection dropped it.
 *
 * `grants.list` emits the same pair for the same reason, and is asserted at
 * the bottom: a grant's season is a free-text field somebody typed, and it is
 * routinely not the year the deadline falls in.
 */
test('expenses.list and income.list emit the human-set season, not a date to infer from', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|season-tag` });
  const userId = await as.mutation(api.auth.ensureUser, {});

  const seasonId = await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert('seasons', {
      label: '2019-2020',
      startDate: '2019-09-01',
      endDate: '2020-08-31',
      isCurrent: false
    });
    const accountId = await ctx.db.insert('accounts', {
      key: 'school_account',
      openingBalance: 0,
      asOfDate: '2019-09-01',
      updatedAt: Date.now(),
      updatedById: userId
    });

    // Applied for in the 2019-2020 season; the money arrived in March 2021.
    await ctx.db.insert('incomeDeposits', {
      title: 'Rotary Club grant award',
      amount: 2500,
      category: 'grants',
      accountId,
      date: '2021-03-15',
      loggedById: userId,
      seasonId,
      updatedAt: Date.now()
    });
    // Applied for in 2019-2020, with a deadline in the following calendar
    // year -- so a consumer inferring the season from `deadline` gets it
    // wrong, which is why the label is emitted rather than left to be derived.
    await ctx.db.insert('grants', {
      title: 'Rotary Club grant',
      funder: 'Rotary Club',
      amount: 2500,
      currency: 'USD',
      status: 'awarded',
      deadline: '2020-11-01',
      deadlineType: 'fixed',
      priority: 'medium',
      seasonId,
      requirements: [],
      order: 0,
      updatedAt: Date.now()
    });
    // Bought against that season's budget, invoiced late.
    await ctx.db.insert('expenses', {
      title: 'Swerve modules',
      vendor: 'REV',
      amount: 1240,
      currency: 'USD',
      category: 'robot_parts',
      requesterId: userId,
      status: 'purchased',
      seasonId,
      accountId,
      date: '2021-03-15',
      updatedAt: Date.now()
    });

    return seasonId;
  });

  const expenses = (await t.query(api.expenses.list, {})) as unknown as LedgerExpense[];
  const deposits = (await t.query(api.income.list, {})) as unknown as LedgerDeposit[];

  expect(expenses[0].season).toBe('2019-2020');
  expect(deposits[0].season).toBe('2019-2020');

  const { entries } = buildLedger({
    expenses,
    deposits,
    hcbTransactions: [],
    season: '2019-2020'
  });

  expect(
    entries.some((e) => e.expense?.title === 'Swerve modules'),
    'an expense tagged 2019-2020 must stay in 2019-2020 however late it was dated'
  ).toBe(true);
  expect(
    entries.some((e) => e.deposit?.title === 'Rotary Club grant award'),
    "an award belongs to the season it was applied for, not the season it cleared"
  ).toBe(true);

  // Symmetric with the two above: the label alongside the id, so the store can
  // go on filtering on label strings without label->id plumbing that neither
  // expenses nor deposits need.
  const grants = await t.query(api.grants.list, {});
  expect(grants[0].season).toBe('2019-2020');
  // Alongside the id, not instead of it -- the pair is the contract.
  expect(grants[0].seasonId).toBe(seasonId);
  // `getById` shares `publicGrantFields` with `list`, but that is a fact about
  // today's code, so it is asserted rather than assumed.
  const one = await t.query(api.grants.getById, { id: grants[0]._id });
  expect(one?.season).toBe('2019-2020');
});
