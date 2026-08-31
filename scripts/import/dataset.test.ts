import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLedger,
  type LedgerDeposit,
  type LedgerExpense,
  type LedgerHcbTransaction
} from '../../src/lib/finance/ledger';
import type { Account } from '../../src/lib/finance/categories';
import * as teamData from '../../src/lib/data/teamData';
import {
  IMPORT_ACTOR_ID,
  TEAM_ACCOUNTS,
  TEAM_CONTACTS,
  TEAM_DONORS,
  TEAM_EXPENSES,
  TEAM_GRANTS,
  TEAM_INCOME_DEPOSITS,
  TEAM_INFO,
  TEAM_SEASONS,
  TEAM_SPONSOR_OUTREACH,
  TEAM_SPONSORS,
  TEAM_USERS,
  TEAM_WISHLIST
} from '../../src/lib/data/teamData';
import { doNotPursueReason } from './mapping';

/**
 * Checks on the generated dataset itself, rather than on the rules that made
 * it. The point of the import was that the team's spreadsheet and the live HCB
 * feed describe overlapping money, and only one of them may be counted. These
 * assert that the overlap really is gone -- a regression here silently
 * misstates how much the team has, which is the one thing this app must not do.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const hcb = JSON.parse(
  readFileSync(join(HERE, 'data', 'hcb-transactions.json'), 'utf8')
) as LedgerHcbTransaction[];

const accountKey = new Map(TEAM_ACCOUNTS.map((a) => [a._id, a.key]));
const seasonLabel = new Map(TEAM_SEASONS.map((s) => [s._id, s.label]));
const donorName = new Map(TEAM_DONORS.map((d) => [d._id, d.displayName]));

/**
 * The dataset now stores references where the finance modules still read
 * names and slugs -- `accountId` for `account`, `seasonId` for `season`,
 * `donorId` for `donorName`. Convex resolves them on the read path (see the
 * list-query projections); here the lookup tables the generator emitted do
 * the same job, so these tests go on exercising the real ledger rather than a
 * reimplementation of it.
 */
const ledgerExpenses: LedgerExpense[] = TEAM_EXPENSES.map((e) => ({
  ...e,
  account: e.accountId ? accountKey.get(e.accountId) : 'none',
  season: seasonLabel.get(e.seasonId) ?? '',
  donorName: e.donorId ? donorName.get(e.donorId) : undefined,
  createdAt: e.updatedAt
}));

const ledgerDeposits: LedgerDeposit[] = TEAM_INCOME_DEPOSITS.map((d) => ({
  ...d,
  depositAccount: accountKey.get(d.accountId) as Account,
  season: seasonLabel.get(d.seasonId) ?? '',
  donorName: d.donorId ? donorName.get(d.donorId) : undefined
}));

describe('the imported dataset against the live HCB feed', () => {
  const ledger = buildLedger({
    expenses: ledgerExpenses,
    deposits: ledgerDeposits,
    hcbTransactions: hcb,
    season: 'all'
  });

  /**
   * The ledger only collapses a logged record into a bank transaction when the
   * record claims an HCB account. Every imported record deliberately claims
   * the school account or none, so a match here would mean the same dollar is
   * in the dataset twice under two different accounts.
   */
  it('leaves no imported record matched to a bank transaction', () => {
    const matched = ledger.entries.filter((e) => e.hcbTransactionId);
    expect(matched).toEqual([]);
  });

  it('leaves every bank transaction to the live feed', () => {
    const settled = hcb.filter((t) => !t.pending);
    expect(ledger.unmatchedHcb).toHaveLength(settled.length);
  });

  /**
   * The in-kind banner is the one imported record that generates income as
   * well as spend: someone bought it and waived repayment, so the goods are
   * real spend and the gift is real income.
   */
  it('emits an in-kind gift for the donated purchase', () => {
    const gifts = ledger.entries.filter((e) => e.category === 'in_kind_gifts');
    expect(gifts).toHaveLength(1);
    expect(gifts[0].amount).toBeCloseTo(265.22, 2);
  });

  it('draws imported spend only from accounts the bank feed does not report', () => {
    for (const e of TEAM_EXPENSES) {
      expect(e.accountId && accountKey.get(e.accountId)).not.toBe('hcb_bank');
    }
  });

  it('deposits imported income only outside the HCB account', () => {
    for (const d of TEAM_INCOME_DEPOSITS) {
      expect(accountKey.get(d.accountId)).not.toBe('hcb_bank');
    }
  });
});

/**
 * The whole point of the change this dataset was regenerated for. Every
 * collection below is read by students, or by anyone the app is shown to;
 * none of them has any business carrying an email address. `TEAM_CONTACTS` is
 * the single deliberate exception -- a sponsor's point of contact is an adult
 * acting for their business, and the `contacts` table exists to hold exactly
 * that -- so it is asserted separately, and asserted to be the *only* place an
 * address survives.
 */
describe('personal data in the generated dataset', () => {
  /**
   * Everything the module exports except the one exception, taken from the
   * module namespace rather than listed by hand: a collection added to the
   * generator later is inside this scan the moment it exists, instead of
   * sitting silently outside a list nobody remembered to extend.
   */
  const { TEAM_CONTACTS: _sponsorContacts, ...studentFacing } = teamData;

  it('contains no email address anywhere outside the sponsor contacts', () => {
    expect(JSON.stringify(studentFacing)).not.toMatch(/@/);
  });

  /**
   * An empty array serialises to `[]` and satisfies the scan above without
   * asserting anything, so every collection it covers has to be pinned
   * non-empty somewhere. Most are, by the tests further down; these three
   * were not.
   */
  it('scans collections that actually have rows in them', () => {
    expect(Object.keys(studentFacing)).toContain('TEAM_INCOME_DEPOSITS');
    expect(TEAM_INCOME_DEPOSITS.length).toBeGreaterThan(0);
    expect(Object.keys(studentFacing)).toContain('TEAM_ACCOUNTS');
    expect(TEAM_ACCOUNTS.length).toBeGreaterThan(0);
    expect(Object.keys(studentFacing)).toContain('TEAM_DONORS');
    expect(TEAM_DONORS.length).toBeGreaterThan(0);
  });

  it('seeds no user, so nobody is in the roster who has not signed in', () => {
    expect(TEAM_USERS).toEqual([]);
  });

  /**
   * The sheets' "done by" and "Assigned Student" columns named the students
   * who did the outreach. They were carried into contact notes and grant
   * assignees before this change; nothing may put them back.
   */
  it('names no student on a contact, sponsor or grant', () => {
    for (const c of TEAM_CONTACTS) {
      expect(c.notes ?? '').not.toMatch(/researched by/i);
    }
    for (const g of TEAM_GRANTS) {
      expect(g.assigneeId).toBeUndefined();
      expect(g.finishedById).toBeUndefined();
    }
  });

  it('drops the team-info line carrying a mentor phone number and email', () => {
    expect(TEAM_INFO.map((f) => f.label)).not.toContain('Mentor Contact');
  });

  /**
   * The budget sheet's description column is free text a human typed about
   * whoever wrote the cheque, and it becomes `incomeDeposits.title`,
   * `donors.displayName` and a quoted sponsor `note` -- all three emitted by
   * *unauthenticated* queries. Three of its rows named a person: an adult
   * sponsor contact whose details otherwise sit behind `requireActor`, a
   * student's surname, and a student's first name. `publicDepositTitle` in
   * mapping.ts rewrites them; this is the assertion that they stay rewritten
   * through a regeneration.
   *
   * Scanned over the whole namespace, not the three collections known to be
   * involved: the same string reached the dataset by three different routes,
   * and a fourth is exactly what this would otherwise miss. `TEAM_CONTACTS`
   * is in scope here even though it is the section 6 exception -- that
   * exception covers a *contact row*, not a person's surname pasted into a
   * deposit title, and `contact_1`'s own `name` field is the one legitimate
   * place `Dumoullin` appears.
   */
  it('names no student through a deposit title, a donor name or a sponsor note', () => {
    const { TEAM_CONTACTS: contactRows, TEAM_DONORS: donorRows, ...rest } = teamData;
    // `Buckley` survives, deliberately and only as a donor attribution -- the
    // owner's ruling is that who gave money is already public on the team's
    // HCB page, while a student's own name is not. `Seamus` identified a
    // student by first name and `Dumoullin` an adult contact whose details
    // live behind `requireActor`; neither may appear anywhere.
    expect(JSON.stringify({ ...rest, TEAM_DONORS: donorRows })).not.toMatch(/Dumoullin|Seamus/i);
    expect(donorRows.map((d) => d.displayName)).toContain('Buckley Family');
    // The one legitimate occurrence, asserted rather than merely tolerated:
    // if it disappears, the exception is no longer carrying its weight and
    // the scan above has stopped proving anything.
    expect(contactRows.map((c) => c.name)).toContain('Dumoullin');
    for (const c of contactRows) {
      expect(c.notes ?? '').not.toMatch(/Seamus/i);
    }
  });
});

/**
 * `convex/seed.ts` rewrites these local string ids to real Convex ids, and its
 * `requireRef` throws rather than writing a reference that resolves to
 * nothing. Every id the dataset emits therefore has to point at a row the
 * dataset also emits -- with one documented exception, the import actor, which
 * the caller supplies.
 */
describe('the dataset against what convex/seed.ts will accept', () => {
  const ids = (rows: { _id: string }[]) => new Set(rows.map((r) => r._id));
  const seasons = ids(TEAM_SEASONS);
  const donors = ids(TEAM_DONORS);
  const accounts = ids(TEAM_ACCOUNTS);
  const sponsors = ids(TEAM_SPONSORS);
  const contacts = ids(TEAM_CONTACTS);

  it('resolves every season, donor and account reference', () => {
    for (const g of TEAM_GRANTS) expect(seasons).toContain(g.seasonId);
    for (const e of TEAM_EXPENSES) {
      expect(seasons).toContain(e.seasonId);
      if (e.accountId) expect(accounts).toContain(e.accountId);
      if (e.donorId) expect(donors).toContain(e.donorId);
    }
    for (const d of TEAM_INCOME_DEPOSITS) {
      expect(seasons).toContain(d.seasonId);
      expect(accounts).toContain(d.accountId);
      if (d.donorId) expect(donors).toContain(d.donorId);
    }
  });

  it('resolves every sponsor and contact reference', () => {
    for (const o of TEAM_SPONSOR_OUTREACH) expect(sponsors).toContain(o.sponsorId);
    for (const c of TEAM_CONTACTS) {
      if (c.sponsorId) expect(sponsors).toContain(c.sponsorId);
    }
    for (const s of TEAM_SPONSORS) {
      if (s.primaryContactId) expect(contacts).toContain(s.primaryContactId);
    }
  });

  /**
   * The one reference the dataset cannot resolve on its own. It must be the
   * *only* user id in the file, so the caller's single injected `users` entry
   * is enough to satisfy every `requireRef` on the user maps.
   */
  it('attributes every required "who did this" column to the import actor alone', () => {
    const actors = [
      ...TEAM_ACCOUNTS.map((a) => a.updatedById),
      ...TEAM_EXPENSES.map((e) => e.requesterId),
      ...TEAM_INCOME_DEPOSITS.map((d) => d.loggedById),
      ...TEAM_INFO.map((f) => f.updatedById)
    ];
    expect(actors.length).toBeGreaterThan(0);
    expect(new Set(actors)).toEqual(new Set([IMPORT_ACTOR_ID]));
  });

  it('marks exactly one season current, the latest', () => {
    const current = TEAM_SEASONS.filter((s) => s.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].label).toBe(
      [...TEAM_SEASONS].map((s) => s.label).sort().at(-1)
    );
    for (const s of TEAM_SEASONS) {
      expect(s.startDate).toBe(`${s.label.slice(0, 4)}-09-01`);
      expect(s.endDate).toBe(`${s.label.slice(5)}-08-31`);
    }
  });

  /** Variant spellings of one donor have to converge on one row. */
  it('lists each donor once under a normalized key', () => {
    const keys = TEAM_DONORS.map((d) => d.normalizedKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the imported dataset', () => {
  it('gives every deposit a real calendar day', () => {
    // A deposit with no date is a pledge, not money in the bank; the generator
    // drops those rather than inventing a day for them.
    for (const d of TEAM_INCOME_DEPOSITS) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('dates every record inside the years the team has been keeping books', () => {
    const days = [
      ...TEAM_INCOME_DEPOSITS.map((d) => d.date),
      ...TEAM_EXPENSES.map((e) => e.date).filter(Boolean)
    ] as string[];
    for (const day of days) {
      expect(day >= '2024-01-01' && day <= '2027-12-31').toBe(true);
    }
  });

  it('carries no placeholder rows from the sheets', () => {
    const names = [
      ...TEAM_SPONSORS.map((s) => s.name),
      ...TEAM_GRANTS.map((g) => g.funder)
    ];
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain('example company');
      expect(name.trim()).not.toBe('');
    }
  });

  it('keeps the team info and wishlist the sheets carried', () => {
    expect(TEAM_INFO.map((f) => f.label)).toContain('501(3)c EIN');
    expect(TEAM_INFO.map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(TEAM_WISHLIST).toHaveLength(8);
    for (const item of TEAM_WISHLIST) {
      expect(item.priority).toBeGreaterThanOrEqual(1);
      expect(item.priority).toBeLessThanOrEqual(10);
      expect(item.cost).toBeGreaterThan(0);
    }
  });

  /**
   * `annualHistory` used to be an array inline on the sponsor. Every gift the
   * budget sheet recorded must still be one outreach row.
   */
  it('turns each banked gift into a sponsor outreach row', () => {
    expect(TEAM_SPONSOR_OUTREACH.length).toBeGreaterThan(0);
    for (const o of TEAM_SPONSOR_OUTREACH) {
      expect(o.status).toBe('received');
      expect(o.amount).toBeGreaterThan(0);
      expect(o.year).toBeGreaterThanOrEqual(2024);
    }
  });
});

describe('funders ruled out in the sheet comments', () => {
  /**
   * These were established as dead ends -- the funder does not give to teams,
   * or it goes through FIRST, or it is aimed at six-figure research projects.
   * Left in the backlog they are indistinguishable from live leads and get
   * researched again next season, which is the cost the comments were written
   * to avoid.
   */
  it('leaves none of them anywhere but dropped', () => {
    for (const grant of TEAM_GRANTS) {
      if (doNotPursueReason(grant.funder)) {
        expect(grant.status).toBe('dropped');
      }
    }
  });

  it('carries the reason on the grant, not just the status', () => {
    const dropped = TEAM_GRANTS.filter((g) => g.status === 'dropped');
    expect(dropped.length).toBeGreaterThan(0);
    for (const grant of dropped) {
      expect(grant.notes ?? '').not.toBe('');
    }
  });

  /**
   * Two of them are listed under different names on the pipeline and directory
   * tabs, one of those a typo, so a rule matching a single spelling would drop
   * one row and leave its twin in the backlog.
   */
  it('catches the funders that appear under two spellings', () => {
    for (const funder of ['Amozon future engineer', 'Amazon Future Engineer']) {
      expect(TEAM_GRANTS.find((g) => g.funder === funder)?.status).toBe('dropped');
    }
    const nsf = TEAM_GRANTS.filter((g) => /national science/i.test(g.funder));
    expect(nsf.length).toBe(2);
    expect(nsf.every((g) => g.status === 'dropped')).toBe(true);
  });

  it('lists each funder once, with the duplicated pipeline row gone', () => {
    const ionBank = TEAM_GRANTS.filter((g) => /ion bank/i.test(g.funder));
    expect(ionBank).toHaveLength(1);
    expect(ionBank[0].status).toBe('drafting');
  });
});
