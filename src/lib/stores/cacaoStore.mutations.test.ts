import { getFunctionName } from 'convex/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, Grant, IncomeDeposit, Sponsor, User } from '$lib/types';

/**
 * What reaches the server, argument by argument.
 *
 * Every assertion here is about a key that is either present, absent, or
 * present-and-null in the object handed to `client.mutation`. None of it is
 * visible to the type checker: every one of these arguments is
 * `v.optional(...)` on the Convex side, so a field-list builder that simply
 * forgets a key compiles, passes every other test, and silently drops the
 * user's edit on the floor. Three such bugs shipped before this file existed.
 *
 * The three-way distinction is the whole point, and it is the same on all
 * four fields:
 *
 * - **key absent**  -- leave the stored value alone. Convex's `patch` only
 *   touches keys it is given, which is what a form with no such input wants.
 * - **key present, emptied** -- clear it. `donorName: ""` resolves to no
 *   donor; `assigneeId: null` / `primaryContactId: null` detach.
 * - **key present, set** -- assign it.
 *
 * The store is driven in *remote* mode here, unlike `cacaoStore.svelte.test.ts`
 * next door, because `push` is a no-op without a client and the write path is
 * exactly what is under test. The client is a stub: it records calls and opens
 * no socket.
 */

const harness = vi.hoisted(() => {
  type Sub = { query: unknown; onRows: (rows: unknown) => void };
  const subscriptions: Sub[] = [];
  const calls: Array<{ fn: unknown; args: Record<string, unknown> }> = [];

  const client = {
    onUpdate(query: unknown, _args: unknown, onRows: (rows: unknown) => void) {
      const sub = { query, onRows };
      subscriptions.push(sub);
      return () => {
        const at = subscriptions.indexOf(sub);
        if (at !== -1) subscriptions.splice(at, 1);
      };
    },
    mutation(fn: unknown, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(undefined);
    },
    query() {
      return Promise.resolve(null);
    },
    setAuth() {}
  };

  return { subscriptions, calls, client };
});

// `isConvexEnabled` is read once, when the store class is defined, so it has
// to be true before the module is imported -- hence the dynamic import below.
vi.mock('$lib/convex/client', () => ({
  convexUrl: 'https://test-deployment.convex.cloud',
  isConvexEnabled: true,
  getConvexClient: () => harness.client
}));

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

let cacao: (typeof import('./cacaoStore.svelte'))['cacao'];
let api: (typeof import('../../../convex/_generated/api'))['api'];

const ADMIN: User = {
  _id: 'user_admin',
  displayName: 'An Admin',
  role: 'admin',
  requested: false
};

beforeAll(async () => {
  vi.stubGlobal('localStorage', localStorageStub);
  // The constructor kicks off a background HCB sync; a non-ok response is the
  // quiet way out of it.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503 })));

  ({ cacao } = await import('./cacaoStore.svelte'));
  ({ api } = await import('../../../convex/_generated/api'));

  // The only snapshot this file needs: `accountIdFor` turns the slug a form
  // speaks into the `accounts` row id the mutations take, and both the deposit
  // paths refuse to push without one.
  const accounts = harness.subscriptions.find((s) => nameOf(s.query) === 'accounts:list');
  if (!accounts) throw new Error('the store did not subscribe to api.accounts.list');
  accounts.onRows([
    { _id: 'account_school', account: 'school_account', openingBalance: 0, asOfDate: '2026-01-01' },
    { _id: 'account_hcb', account: 'hcb_bank', openingBalance: 0, asOfDate: '2026-01-01' }
  ]);
});

beforeEach(() => {
  harness.calls.length = 0;
  cacao.currentUser = ADMIN;
});

/**
 * `api` is a proxy that mints a fresh object on every property access, so two
 * reads of `api.expenses.add` are never `===`. Names are the stable identity.
 */
function nameOf(reference: unknown): string {
  return getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
}

/** The arguments of the most recent call to `fn`, or a failure if there was none. */
function argsOf(fn: unknown): Record<string, unknown> {
  const wanted = nameOf(fn);
  const call = [...harness.calls].reverse().find((c) => nameOf(c.fn) === wanted);
  if (!call) throw new Error(`${wanted} was never called`);
  return call.args;
}

const EXPENSE: Expense = {
  _id: 'expense_1',
  title: 'Falcon 500',
  vendor: 'WCP',
  amount: 180,
  currency: 'USD',
  category: 'robot_parts',
  status: 'donated',
  seasonId: 'season_1',
  season: '2026-2027',
  account: 'hcb_bank',
  createdAt: 0,
  updatedAt: 0
};

const DEPOSIT: IncomeDeposit = {
  _id: 'deposit_1',
  title: 'Check from the Harrisons',
  amount: 500,
  category: 'community_donations',
  depositAccount: 'school_account',
  date: '2026-10-15',
  seasonId: 'season_1',
  season: '2026-2027',
  updatedAt: 0
};

const SPONSOR: Sponsor = {
  _id: 'sponsor_1',
  name: 'Bantam Wesson',
  category: 'local_business',
  tier: 'bronze',
  status: 'pledged',
  totalDonated: 0,
  annualHistory: [],
  updatedAt: 0
};

const GRANT: Grant = {
  _id: 'grant_1',
  title: 'Innovation in FIRST',
  funder: 'Region 15',
  amount: 5000,
  currency: 'USD',
  status: 'submitted',
  deadlineType: 'fixed',
  priority: 'high',
  seasonId: 'season_1',
  season: '2026-2027',
  requirements: [],
  order: 0,
  updatedAt: 0,
  assigneeId: 'user_mentor'
};

describe('donorName on an expense', () => {
  it('reaches expenses.add when the form collected one', () => {
    const { _id, createdAt, updatedAt, ...input } = EXPENSE;
    cacao.addExpense({ ...input, donorName: 'Ruth Harrison' });
    expect(argsOf(api.expenses.add).donorName).toBe('Ruth Harrison');
  });

  it('reaches expenses.update when the form collected one', () => {
    cacao.expenses = [EXPENSE];
    cacao.updateExpense({ ...EXPENSE, donorName: 'Ruth Harrison' });
    expect(argsOf(api.expenses.update).donorName).toBe('Ruth Harrison');
  });

  it('is sent blank -- not omitted -- when the donor field was emptied', () => {
    // `ExpenseModal` sends `donorName: undefined` the moment the status stops
    // being `donated`. That is a clear, not a "leave it alone": the mutation
    // reads a present-and-blank name as "no donor" and drops the id.
    cacao.expenses = [EXPENSE];
    cacao.updateExpense({ ...EXPENSE, status: 'purchased', donorName: undefined });
    expect(argsOf(api.expenses.update).donorName).toBe('');
  });

  it('is omitted by a form that has no donor field at all', () => {
    // `AddExpenseModal` never mentions a donor. Sending `""` from there would
    // clear a donor nobody touched.
    const { _id, createdAt, updatedAt, donorName, ...noDonorField } = EXPENSE;
    cacao.addExpense(noDonorField);
    expect('donorName' in argsOf(api.expenses.add)).toBe(false);
  });
});

describe('accountId on an expense', () => {
  /**
   * "No team account (voucher or unrepaid personal purchase)" is a real answer
   * and `MarkPurchasedModal`'s default one. An `accounts` row id cannot spell
   * it, so it travels as `null`; sending `undefined` -- which is what mapping
   * `'none'` through `accountIdFor` produced -- was indistinguishable from a
   * form that never asked, and the server left the old account in place.
   */
  it('is sent as null -- not omitted -- when "no team account" is chosen', () => {
    cacao.expenses = [EXPENSE];
    cacao.recordPurchase('expense_1', {
      finalPaidAmount: 175,
      paymentMethod: 'grant_voucher',
      account: 'none'
    });
    expect(argsOf(api.expenses.recordPurchase).accountId).toBeNull();
  });

  it('is sent as null from expenses.update too', () => {
    cacao.expenses = [EXPENSE];
    cacao.updateExpense({ ...EXPENSE, account: 'none' });
    expect(argsOf(api.expenses.update).accountId).toBeNull();
  });

  it('resolves a slug to the accounts row id', () => {
    cacao.expenses = [EXPENSE];
    cacao.updateExpense({ ...EXPENSE, account: 'school_account' });
    expect(argsOf(api.expenses.update).accountId).toBe('account_school');
  });

  it('is omitted when the expense has no account at all', () => {
    cacao.expenses = [EXPENSE];
    const { account, ...noAccount } = EXPENSE;
    cacao.updateExpense(noAccount);
    expect('accountId' in argsOf(api.expenses.update)).toBe(false);
  });

  it('is omitted by a form with no account picker, so recordPurchase leaves it alone', () => {
    // `recordPurchase` is called with `account` absent by nothing today, but
    // the contract is the one that matters: an absent key must not clear a
    // booking, or every caller that forgets the field silently unbooks money.
    cacao.expenses = [EXPENSE];
    cacao.recordPurchase('expense_1', {
      finalPaidAmount: 175,
      paymentMethod: 'hcb_card'
    });
    expect('accountId' in argsOf(api.expenses.recordPurchase)).toBe(false);
  });

  it('survives the optimistic row, so the modal does not flash the old account back', () => {
    cacao.expenses = [EXPENSE];
    cacao.recordPurchase('expense_1', {
      finalPaidAmount: 175,
      paymentMethod: 'grant_voucher',
      account: 'none'
    });
    expect(cacao.expenses[0].account).toBe('none');
  });
});

describe('linkedGrantId on an expense', () => {
  /**
   * "General Team Funds" is `ExpenseModal`'s default option and a real answer.
   * A `grants` row id cannot spell it, so it travels as `null`; sending
   * `undefined` -- which is what `linkedGrantId || undefined` produced -- is
   * stripped by Convex before it reaches the server, so the key never arrived
   * at `patch` and the old grant link survived. The dropdown showed the
   * change, the optimistic row applied it, and the next snapshot reverted it,
   * while grant reporting kept charging that grant for the spend.
   */
  it('is sent as null -- not omitted -- when "General Team Funds" is chosen', () => {
    cacao.expenses = [EXPENSE];
    cacao.updateExpense({ ...EXPENSE, linkedGrantId: undefined });
    expect(argsOf(api.expenses.update).linkedGrantId).toBeNull();
  });

  it('resolves a chosen grant to its row id', () => {
    cacao.expenses = [EXPENSE];
    cacao.updateExpense({ ...EXPENSE, linkedGrantId: 'grant_1' });
    expect(argsOf(api.expenses.update).linkedGrantId).toBe('grant_1');
  });

  it('is omitted by a form that has no grant picker at all', () => {
    // Nothing in `src/` is such a form today, but the contract is the one that
    // matters: an absent key must not unlink a grant nobody touched.
    cacao.expenses = [EXPENSE];
    expect('linkedGrantId' in EXPENSE).toBe(false);
    cacao.updateExpense(EXPENSE);
    expect('linkedGrantId' in argsOf(api.expenses.update)).toBe(false);
  });
});

describe('donorName on a deposit', () => {
  it('reaches income.add when the form collected one', () => {
    const { _id, updatedAt, ...input } = DEPOSIT;
    cacao.addIncomeDeposit({ ...input, donorName: 'Ruth Harrison' });
    expect(argsOf(api.income.add).donorName).toBe('Ruth Harrison');
  });

  it('reaches income.update when the form collected one', () => {
    cacao.incomeDeposits = [DEPOSIT];
    cacao.updateIncomeDeposit({ ...DEPOSIT, donorName: 'Ruth Harrison' });
    expect(argsOf(api.income.update).donorName).toBe('Ruth Harrison');
  });

  it('is sent blank when the donor field was emptied', () => {
    cacao.incomeDeposits = [DEPOSIT];
    cacao.updateIncomeDeposit({ ...DEPOSIT, donorName: undefined });
    expect(argsOf(api.income.update).donorName).toBe('');
  });

  it('is omitted by a caller that has no donor field at all', () => {
    cacao.incomeDeposits = [DEPOSIT];
    const { donorName, ...noDonorField } = DEPOSIT;
    cacao.updateIncomeDeposit(noDonorField);
    expect('donorName' in argsOf(api.income.update)).toBe(false);
  });
});

describe('primaryContactId on a sponsor', () => {
  it('reaches sponsors.create', () => {
    const { _id, updatedAt, ...input } = SPONSOR;
    cacao.addSponsor({ ...input, primaryContactId: 'contact_1' });
    expect(argsOf(api.sponsors.create).primaryContactId).toBe('contact_1');
  });

  it('reaches sponsors.update', () => {
    cacao.sponsors = [SPONSOR];
    cacao.updateSponsor({ ...SPONSOR, primaryContactId: 'contact_1' });
    expect(argsOf(api.sponsors.update).primaryContactId).toBe('contact_1');
  });

  it('is sent as null -- not omitted -- when the picker was cleared', () => {
    cacao.sponsors = [{ ...SPONSOR, primaryContactId: 'contact_1' }];
    cacao.updateSponsor({ ...SPONSOR, primaryContactId: undefined });
    expect(argsOf(api.sponsors.update).primaryContactId).toBeNull();
  });

  it('is omitted by a caller with no contact picker', () => {
    cacao.sponsors = [SPONSOR];
    const { primaryContactId, ...noPicker } = SPONSOR;
    cacao.updateSponsor(noPicker);
    expect('primaryContactId' in argsOf(api.sponsors.update)).toBe(false);
  });
});

describe('assigneeId on a grant', () => {
  it('reaches grants.update when someone is picked', () => {
    cacao.grants = [GRANT];
    cacao.updateGrant({ ...GRANT, assigneeId: 'user_mentor' });
    expect(argsOf(api.grants.update).assigneeId).toBe('user_mentor');
  });

  it('is sent as null when "Unassigned" is chosen', () => {
    // `GrantDrawer` runs every optional string through `blankToUndefined`, so
    // the store sees the key present with `undefined` -- never `null` and
    // never `""`. Reading that as "leave the assignee alone" is what made the
    // "Unassigned" option do nothing at all.
    cacao.grants = [GRANT];
    cacao.updateGrant({ ...GRANT, assigneeId: undefined });
    expect(argsOf(api.grants.update).assigneeId).toBeNull();
  });

  it('is omitted by a form with no assignee picker', () => {
    cacao.grants = [GRANT];
    const { assigneeId, ...noPicker } = GRANT;
    cacao.updateGrant(noPicker);
    expect('assigneeId' in argsOf(api.grants.update)).toBe(false);
  });

  it('survives the optimistic edit, so reopening the drawer still shows them', () => {
    cacao.grants = [GRANT];
    cacao.updateGrant({ ...GRANT, title: 'Renamed', assigneeId: 'user_mentor' });
    expect(cacao.grants[0].assigneeId).toBe('user_mentor');
  });

  it('is dropped from the optimistic row when it is cleared', () => {
    cacao.grants = [GRANT];
    cacao.updateGrant({ ...GRANT, assigneeId: undefined });
    expect(cacao.grants[0].assigneeId).toBeUndefined();
  });

  it('survives creation too, so a new card is not born unassigned', () => {
    // `grants.create` inserts rather than patches, so there is nothing to
    // preserve or clear on the wire -- an absent id and a null one both mean
    // "nobody". The optimistic row is the part that was losing it.
    cacao.grants = [];
    const { _id, order, season, updatedAt, assigneeId, ...input } = GRANT;
    cacao.addGrant({ ...input, assigneeId: 'user_mentor' });
    expect(argsOf(api.grants.create).assigneeId).toBe('user_mentor');
    expect(cacao.grants[0].assigneeId).toBe('user_mentor');
  });
});

/**
 * The request-edit-access flow, which had no client half at all: none of
 * `requestEditAccess`, `listRequests`, `approveRequest` or `declineRequest`
 * had a call site in `src/`, while eleven Convex tests defended a flow no user
 * could reach.
 */
describe('asking for and granting edit access', () => {
  const VIEWER: User = {
    _id: 'user_viewer',
    displayName: 'Unnamed member',
    role: 'viewer',
    requested: false
  };

  it('sends the name as typed, because the server is what truncates', () => {
    cacao.currentUser = VIEWER;
    cacao.isSignedIn = true;
    cacao.requestEditAccess({ firstName: 'Levi', lastInitial: 'Fitzpatrick' });

    // Shortening here too would put the only copy of what somebody actually
    // typed in the one place nothing enforces the rule.
    expect(argsOf(api.users.requestEditAccess)).toEqual({
      firstName: 'Levi',
      lastInitial: 'Fitzpatrick'
    });
  });

  it('shows the name the server will store, not the one that was typed', () => {
    cacao.currentUser = VIEWER;
    cacao.isSignedIn = true;
    cacao.requestEditAccess({ firstName: 'Levi', lastInitial: 'Fitzpatrick' });

    expect(cacao.currentUser.displayName).toBe('Levi F');
    expect(cacao.currentUser.requested).toBe(true);
  });

  it('asks for nothing when nobody is signed in', () => {
    cacao.currentUser = VIEWER;
    cacao.isSignedIn = false;
    cacao.requestEditAccess({ firstName: 'Levi', lastInitial: 'F' });

    expect(() => argsOf(api.users.requestEditAccess)).toThrow();
  });

  it('approves and declines by id, and drops the card from the feed', () => {
    cacao.editRequests = [
      { _id: 'user_a', displayName: 'Ada L', role: 'viewer', requested: true },
      { _id: 'user_b', displayName: 'Bea M', role: 'viewer', requested: true }
    ];

    cacao.approveRequest('user_a');
    expect(argsOf(api.users.approveRequest)).toEqual({ userId: 'user_a' });
    expect(cacao.editRequests.map((u) => u._id)).toEqual(['user_b']);

    cacao.declineRequest('user_b');
    expect(argsOf(api.users.declineRequest)).toEqual({ userId: 'user_b' });
    expect(cacao.editRequests).toEqual([]);
  });
});

/**
 * A role change on an open page.
 *
 * `onAuthChange` read `api.users.me` once and assigned `currentUser` from it,
 * and nothing re-derived it. A mentor promoting a student while their page was
 * open changed nothing they could see -- `ensureCanEdit()` kept refusing while
 * the mentor insisted they had done it. The demotion direction is worse: an
 * admin kept the admin panel rendered while every write failed with a
 * server-error toast.
 */
describe('the caller\'s own row, live', () => {
  /** The `users.me` subscription's push function. */
  function pushMe(row: unknown) {
    const sub = harness.subscriptions.find((s) => nameOf(s.query) === 'users:me');
    if (!sub) throw new Error('the store did not subscribe to api.users.me');
    sub.onRows(row);
  }

  const hasRequestsFeed = () =>
    harness.subscriptions.some((s) => nameOf(s.query) === 'users:listRequests');

  it('adopts a promotion without a reload', () => {
    pushMe({ _id: 'user_me', displayName: 'Ada L', role: 'viewer', requested: true });
    expect(cacao.currentUser.role).toBe('viewer');
    expect(cacao.isGuest).toBe(true);

    // The mentor approves, and the snapshot arrives on its own.
    pushMe({ _id: 'user_me', displayName: 'Ada L', role: 'student', requested: false });
    expect(cacao.currentUser.role).toBe('student');
    expect(cacao.isGuest).toBe(false);
  });

  it('opens the admin-only requests feed on promotion and closes it on demotion', () => {
    pushMe({ _id: 'user_me', displayName: 'Ada L', role: 'student', requested: false });
    // `users.listRequests` is `requireAdmin`; subscribing for a student would
    // park a permanent error banner in front of them.
    expect(hasRequestsFeed()).toBe(false);

    pushMe({ _id: 'user_me', displayName: 'Ada L', role: 'admin', requested: false });
    expect(hasRequestsFeed()).toBe(true);

    cacao.editRequests = [
      { _id: 'user_x', displayName: 'Bea M', role: 'viewer', requested: true }
    ];
    pushMe({ _id: 'user_me', displayName: 'Ada L', role: 'student', requested: false });
    expect(hasRequestsFeed()).toBe(false);
    // A demoted admin must not keep rendering a queue of other people's names
    // out of the last snapshot it received.
    expect(cacao.editRequests).toEqual([]);
  });

  it('does not mistake the public view for a sign-out', () => {
    // `users.me` answers `null` for anyone without a session -- that is the
    // whole reason it is ungated -- so a null row on a browser that never
    // signed in is the normal case, not a session ending.
    cacao.isSignedIn = false;
    cacao.currentUser = { _id: 'guest', displayName: 'Guest Viewer', role: 'viewer', requested: false };
    pushMe(null);
    expect(cacao.isSignedIn).toBe(false);
  });

  it('tears the session down when the row goes away under a signed-in browser', () => {
    pushMe({ _id: 'user_me', displayName: 'Ada L', role: 'admin', requested: false });
    expect(cacao.isSignedIn).toBe(true);

    pushMe(null);
    expect(cacao.isSignedIn).toBe(false);
    expect(cacao.currentUser.role).toBe('viewer');
    expect(hasRequestsFeed()).toBe(false);
  });
});
