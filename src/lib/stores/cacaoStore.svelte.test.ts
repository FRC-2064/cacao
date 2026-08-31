import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IncomeDeposit } from '$lib/types';

/**
 * Two things this file pins down, neither of which a type error would catch.
 *
 * 1. The pre-migration `localStorage` keys are *deleted*, not merely stopped
 *    being read. Those rows carried student names and email addresses inline
 *    and they survive the database wipe entirely, because they were never in
 *    the database -- they are on the device.
 * 2. A deposit is filed under the season it is tagged with and no other. An
 *    awarded grant's money belongs to the season the grant was applied for and
 *    routinely arrives a season later, so inferring a season from the date
 *    puts it in two places at once.
 */

/** A `localStorage` close enough to a browser's for the store to use. */
const cells = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => cells.get(key) ?? null,
  setItem: (key: string, value: string) => {
    cells.set(key, value);
  },
  removeItem: (key: string) => {
    cells.delete(key);
  },
  clear: () => cells.clear()
};

const V1_ROSTER = 'cacao_users_v1';
const V1_EXPENSES = 'cacao_expenses_v1';
const V2_EXPENSES = 'cacao_expenses_v2';
const SESSION_KEY = 'cacao_session_v1';

let cacao: (typeof import('./cacaoStore.svelte'))['cacao'];

beforeAll(async () => {
  // Everything has to be in place *before* the import: the store is a
  // singleton constructed at module load, and the purge runs in its
  // constructor. This is also the only honest way to test it -- what matters
  // is that a browser holding the old keys is cleaned by loading the app.
  vi.stubGlobal('localStorage', localStorageStub);
  // The constructor kicks off a background HCB sync. A non-ok response is the
  // quiet way out of it -- a rejection would be caught and logged instead.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503 })));

  cells.set(
    V1_ROSTER,
    JSON.stringify([{ name: 'A Student', email: 'a.student@example.org', gradYear: 2027 }])
  );
  cells.set(
    V1_EXPENSES,
    JSON.stringify([{ title: 'Motors', requesterName: 'A Student', requesterEmail: 'a@b.c' }])
  );
  cells.set(V2_EXPENSES, JSON.stringify([]));
  cells.set(SESSION_KEY, 'a-session-secret');

  ({ cacao } = await import('./cacaoStore.svelte'));
});

describe('the pre-migration localStorage purge', () => {
  it('deletes a _v1 key that was present before load', () => {
    expect(cells.has(V1_ROSTER)).toBe(false);
    expect(cells.has(V1_EXPENSES)).toBe(false);
  });

  it('leaves the current _v2 keys alone', () => {
    expect(cells.get(V2_EXPENSES)).toBe('[]');
  });

  it('leaves the auth module its session secret', () => {
    // `cacao_session_v1` matches the old naming but is not one of ours: it
    // holds a session secret rather than a person, and deleting it would sign
    // the browser out on every load.
    expect(cells.get(SESSION_KEY)).toBe('a-session-secret');
  });
});

describe('getFinancialsForSeason', () => {
  const deposit = (over: Partial<IncomeDeposit>): IncomeDeposit => ({
    _id: 'dep_1',
    title: 'Robotics Innovation grant',
    amount: 5000,
    category: 'grants',
    depositAccount: 'school_account',
    date: '2026-10-15',
    seasonId: 'season_2025',
    season: '2025-2026',
    updatedAt: 0,
    ...over
  });

  it('files a deposit under the season it is tagged with, not the year it is dated', () => {
    // A fundraiser pledged during 2025-2026 whose cheque arrived in October
    // 2026. Deliberately not a `grants` deposit: those are excluded from
    // `totalFundraiserIncome` -- see the double-count test below -- so one
    // would assert 0 here for a reason that has nothing to do with seasons.
    cacao.grants = [];
    cacao.expenses = [];
    cacao.sponsors = [];
    cacao.hcbTransactions = [];
    cacao.incomeDeposits = [deposit({ category: 'community_donations' })];

    const tagged = cacao.getFinancialsForSeason('2025-2026');
    const dated = cacao.getFinancialsForSeason('2026-2027');

    expect(tagged.totalFundraiserIncome).toBe(5000);
    expect(tagged.depositsCount).toBe(1);

    // The failure this guards against: with date inference ORed in, the same
    // $5,000 also shows up here, and the award is counted in two seasons.
    expect(dated.totalFundraiserIncome).toBe(0);
    expect(dated.depositsCount).toBe(0);
  });

  it('files a grant under its season tag, not the year its deadline falls in', () => {
    // Applied for in 2025-2026 against a deadline in the following calendar
    // year, plus a rolling grant that has no deadline year to infer from at
    // all -- which is why `Grant.season` says not to infer one.
    cacao.incomeDeposits = [];
    cacao.grants = [
      {
        _id: 'g1',
        title: 'Late-deadline award',
        funder: 'A Foundation',
        amount: 1000,
        awardedAmount: 1000,
        currency: 'USD',
        status: 'awarded',
        deadline: '2026-11-01',
        deadlineType: 'fixed',
        priority: 'high',
        seasonId: 'season_2025',
        season: '2025-2026',
        requirements: [],
        order: 0,
        updatedAt: 0
      },
      {
        _id: 'g2',
        title: 'Rolling award',
        funder: 'B Trust',
        amount: 500,
        awardedAmount: 500,
        currency: 'USD',
        status: 'awarded',
        deadlineType: 'rolling',
        priority: 'medium',
        seasonId: 'season_2025',
        season: '2025-2026',
        requirements: [],
        order: 1,
        updatedAt: 0
      }
    ];

    expect(cacao.getFinancialsForSeason('2025-2026').awardedCount).toBe(2);
    expect(cacao.getFinancialsForSeason('2026-2027').awardedCount).toBe(0);
  });

  /**
   * The comment the arithmetic rested on -- "Grants and sponsorships are
   * recorded on their own tabs, never as deposits" -- was false.
   * `grants.finish` inserts an `incomeDeposits` row with `category: "grants"`
   * in the same transaction as the status change, deliberately, so the award
   * and the money it produced can never disagree. That makes one award count
   * once in `totalAwarded` and again in `totalFundraiserIncome`, and
   * `totalRaised` adds the two.
   *
   * What a user saw: one $5,000 grant reported as 40% of a $25,000 season
   * goal, while the Sankey on the same page said $5,000. Two headline numbers
   * disagreeing, with the wrong one being the one quoted to funders.
   */
  it('counts an awarded grant once, not twice, towards the season goal', () => {
    cacao.expenses = [];
    cacao.sponsors = [];
    cacao.hcbTransactions = [];
    cacao.grants = [
      {
        _id: 'g_awarded',
        title: 'Robotics Innovation grant',
        funder: 'A Foundation',
        amount: 5000,
        awardedAmount: 5000,
        awardedDate: '2026-10-15',
        currency: 'USD',
        status: 'awarded',
        deadlineType: 'fixed',
        priority: 'high',
        seasonId: 'season_2026',
        season: '2026-2027',
        requirements: [],
        order: 0,
        updatedAt: 0
      }
    ];
    // Exactly what `grants.finish` leaves behind on the server.
    cacao.incomeDeposits = [
      deposit({
        _id: 'dep_from_grant',
        category: 'grants',
        season: '2026-2027',
        seasonId: 'season_2026'
      })
    ];

    const fin = cacao.getFinancialsForSeason('2026-2027');

    expect(fin.totalAwarded).toBe(5000);
    // The award is `totalAwarded`'s to report. Counting it here as well is
    // the double-count.
    expect(fin.totalFundraiserIncome).toBe(0);
    // `totalRaised` is not returned -- it exists only to drive this. $5,000 of
    // the $25,000 2026-2027 goal is 20%, not the 40% the double-count showed.
    expect(fin.goalProgressPct).toBe(20);
    // The ledger figure the rest of the app surfaces, including the Sankey on
    // the same page, has always been right. The two headline numbers must not
    // be able to disagree again.
    expect(fin.totalIn).toBe(5000);
  });

  it('still counts a non-grant deposit as fundraiser income', () => {
    cacao.grants = [];
    cacao.expenses = [];
    cacao.sponsors = [];
    cacao.hcbTransactions = [];
    cacao.incomeDeposits = [
      deposit({ category: 'community_donations', season: '2026-2027', seasonId: 'season_2026' })
    ];

    const fin = cacao.getFinancialsForSeason('2026-2027');
    expect(fin.totalFundraiserIncome).toBe(5000);
    expect(fin.goalProgressPct).toBe(20);
  });

  it('still counts every deposit under "all"', () => {
    cacao.incomeDeposits = [deposit({}), deposit({ _id: 'dep_2', season: '2026-2027' })];
    expect(cacao.getFinancialsForSeason('all').depositsCount).toBe(2);
  });
});
