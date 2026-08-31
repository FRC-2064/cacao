/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { FunctionReference } from 'convex/server';

/**
 * Every write gate, exercised.
 *
 * The gates were correct and completely undefended. A reviewer rewrote
 * `requireWriter -> requireActor` across all six writer modules *and*
 * `requireAdmin -> requireWriter` in `accounts.ts` and `teamInfo.ts`, ran the
 * suite, and got 439/439 green. With those downgrades a read-only viewer could
 * create, edit and delete expenses, grants, sponsors, contacts, wishlist items
 * and bank-transaction filings, and any student could re-baseline both account
 * balances through `accounts.setBalance` -- the one mutation that rewrites the
 * opening figure every computed balance is built on. Exactly one gate in the
 * codebase had a test.
 *
 * So this file is a table, and completeness is the point rather than elegance:
 * every mutation the deployment exposes appears in it once, and downgrading any
 * single gate turns the suite red.
 *
 * Two things make the assertions meaningful rather than decorative:
 *
 *  - **The message is checked, not merely that something threw.** Nearly every
 *    mutation here is called with references that do not resolve, so a gate
 *    that let the call through still throws -- "Grant not found", a dangling
 *    `assertRef`. A bare `.rejects.toThrow()` would pass against no gate at
 *    all.
 *  - **The permitted role is asserted too.** A writer-gated mutation must
 *    refuse a viewer *and* admit a student; an admin-gated one must refuse
 *    both. Without the second half, `requireAdmin -> requireWriter` is
 *    invisible.
 *
 * Arguments only have to be shape-valid. Every guard runs before the handler
 * reads anything, so what happens after it is not this file's business -- the
 * behaviour of each mutation is tested where that mutation lives.
 */

const GOOGLE = 'https://accounts.google.com';

/** The exact strings `convex/auth.ts` throws. Nothing else counts as a refusal. */
const NOT_SIGNED_IN = 'Not signed in.';
const NOT_A_WRITER = 'Viewer accounts cannot make changes.';
const NOT_AN_ADMIN = 'Only admins can do that.';
const GUARD_MESSAGES = [NOT_SIGNED_IN, NOT_A_WRITER, NOT_AN_ADMIN];

/**
 * - `identity`  -- any authenticated browser, roster row or not (`ensureUser`).
 * - `actor`     -- any roster row, viewers included.
 * - `writer`    -- a student or an admin.
 * - `admin`     -- an admin.
 */
type Gate = 'identity' | 'actor' | 'writer' | 'admin';

type AnyMutation = FunctionReference<'mutation', 'public'>;
type AnyQuery = FunctionReference<'query', 'public'>;

/**
 * What the two `guardMessage` helpers below need of a caller: something that
 * can invoke one function reference with one arguments object. `convexTest()`
 * and `withIdentity()` return two different types -- `TestConvex<...>` and
 * `TestConvexForDataModel<...>` -- and both are structurally assignable to
 * this, which is the point: the helpers take either without a cast.
 *
 * Written as a two-parameter signature rather than `(fn: never, args: never)`.
 * The `never` version typechecked in the editor and in `npm run check` (whose
 * tsconfig includes neither `convex/` nor this file) but failed
 * `tsc --noEmit -p convex` with eight errors: convex-test's `mutation` takes
 * *rest* args, and `[args: never]` is not assignable to `never`, so no runner
 * was ever assignable and every call site had to be cast. That typecheck is
 * the one `convex deploy --typecheck try` runs, and a *failed* typecheck exits
 * 1 in every mode -- so this file could stop a production deploy. See the
 * `Convex typecheck` step in `.github/workflows/release.yml`, which now runs
 * it in CI so it cannot happen again.
 */
type MutationRunner = { mutation: (fn: AnyMutation, args: Record<string, unknown>) => Promise<unknown> };
type QueryRunner = { query: (fn: AnyQuery, args: Record<string, unknown>) => Promise<unknown> };

let t: ReturnType<typeof convexTest>;
let anonymous: ReturnType<typeof convexTest>;
let viewer: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
let student: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
let admin: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;

let viewerId: Id<'users'>;
let seasonId: Id<'seasons'>;
let accountId: Id<'accounts'>;
let sponsorId: Id<'sponsors'>;
let contactId: Id<'contacts'>;
let grantId: Id<'grants'>;
let expenseId: Id<'expenses'>;
let depositId: Id<'incomeDeposits'>;
let teamInfoId: Id<'teamInfo'>;
let wishlistId: Id<'wishlist'>;

beforeEach(async () => {
  t = convexTest(schema);
  anonymous = t;

  viewer = t.withIdentity({ tokenIdentifier: `${GOOGLE}|viewer` });
  student = t.withIdentity({ tokenIdentifier: `${GOOGLE}|student` });
  admin = t.withIdentity({ tokenIdentifier: `${GOOGLE}|admin` });

  viewerId = await viewer.mutation(api.auth.ensureUser, {});
  const studentId = await student.mutation(api.auth.ensureUser, {});
  const adminId = await admin.mutation(api.auth.ensureUser, {});

  await t.run(async (ctx) => {
    await ctx.db.patch('users', studentId, { role: 'student' });
    await ctx.db.patch('users', adminId, { role: 'admin' });

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
      updatedById: adminId
    });
    sponsorId = await ctx.db.insert('sponsors', {
      name: 'Bantam Wesson',
      category: 'local_business',
      tier: 'bronze',
      status: 'pledged',
      totalDonated: 0,
      updatedAt: Date.now()
    });
    contactId = await ctx.db.insert('contacts', {
      name: 'A Sponsor Contact',
      title: 'Owner',
      email: 'contact@example.com',
      isPrimary: true,
      preferredMethod: 'email',
      updatedAt: Date.now()
    });
    grantId = await ctx.db.insert('grants', {
      title: 'Innovation in FIRST',
      funder: 'Region 15',
      amount: 5000,
      currency: 'USD',
      status: 'submitted',
      deadlineType: 'fixed',
      priority: 'high',
      seasonId,
      requirements: [],
      order: 0,
      updatedAt: Date.now()
    });
    expenseId = await ctx.db.insert('expenses', {
      title: 'Falcon 500',
      vendor: 'WCP',
      amount: 180,
      currency: 'USD',
      category: 'robot_parts',
      status: 'approved',
      seasonId,
      requesterId: studentId,
      updatedAt: Date.now()
    });
    depositId = await ctx.db.insert('incomeDeposits', {
      title: 'Cheque',
      amount: 500,
      category: 'community_donations',
      accountId,
      date: '2026-10-01',
      seasonId,
      loggedById: studentId,
      updatedAt: Date.now()
    });
    teamInfoId = await ctx.db.insert('teamInfo', {
      label: 'Team number',
      value: '2064',
      order: 0,
      updatedAt: Date.now(),
      updatedById: adminId
    });
    wishlistId = await ctx.db.insert('wishlist', {
      tool: 'Bandsaw',
      cost: 900,
      source: 'purchase',
      priority: 1,
      updatedAt: Date.now()
    });
  });
});

/** The guard message a call produced, or null if it produced none. */
async function guardMessage(
  runner: MutationRunner,
  fn: AnyMutation,
  args: Record<string, unknown>
): Promise<string | null> {
  try {
    await runner.mutation(fn, args);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return GUARD_MESSAGES.find((g) => message.includes(g)) ?? null;
  }
}

async function guardMessageOfQuery(
  runner: QueryRunner,
  fn: AnyQuery,
  args: Record<string, unknown>
): Promise<string | null> {
  try {
    await runner.query(fn, args);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return GUARD_MESSAGES.find((g) => message.includes(g)) ?? null;
  }
}

/**
 * Every mutation in `convex/`, its gate, and arguments that pass the argument
 * validator. Keep this exhaustive: a new mutation with no row here is a new
 * mutation with no gate test.
 */
function mutationTable(): Array<{ name: string; gate: Gate; fn: AnyMutation; args: Record<string, unknown> }> {
  const grantFields = {
    title: 'Innovation in FIRST',
    funder: 'Region 15',
    amount: 5000,
    currency: 'USD',
    status: 'submitted' as const,
    deadlineType: 'fixed' as const,
    priority: 'high' as const,
    seasonId,
    requirements: [],
  };
  const expenseFields = {
    title: 'Falcon 500',
    vendor: 'WCP',
    amount: 180,
    currency: 'USD',
    category: 'robot_parts' as const,
    status: 'approved' as const,
    seasonId,
  };
  const depositFields = {
    title: 'Cheque',
    amount: 500,
    category: 'community_donations' as const,
    accountId,
    date: '2026-10-01',
    seasonId,
  };
  const sponsorFields = {
    name: 'Bantam Wesson',
    category: 'local_business' as const,
    tier: 'bronze' as const,
    status: 'pledged' as const,
    totalDonated: 0,
  };
  const contactFields = {
    name: 'A Sponsor Contact',
    title: 'Owner',
    email: 'contact@example.com',
    isPrimary: true,
    preferredMethod: 'email' as const,
  };
  const wishlistFields = {
    tool: 'Bandsaw',
    cost: 900,
    source: 'purchase' as const,
    priority: 1,
  };

  return [
    // The one mutation any authenticated browser may call: it is how a roster
    // row comes into existence in the first place.
    { name: 'auth.ensureUser', gate: 'identity', fn: api.auth.ensureUser, args: {} },

    // Asking for edit access is the one write a viewer is supposed to make.
    { name: 'users.requestEditAccess', gate: 'actor', fn: api.users.requestEditAccess, args: { firstName: 'Levi', lastInitial: 'F' } },
    // Not `actor`: a viewer has no name to edit, and letting them set one
    // would be a way around the request flow that is supposed to be the only
    // door a name comes through.
    { name: 'users.updateOwnProfile', gate: 'writer', fn: api.users.updateOwnProfile, args: { firstName: 'Levi' } },

    { name: 'users.setUserRole', gate: 'admin', fn: api.users.setUserRole, args: { userId: viewerId, role: 'student' } },
    { name: 'users.approveRequest', gate: 'admin', fn: api.users.approveRequest, args: { userId: viewerId } },
    { name: 'users.declineRequest', gate: 'admin', fn: api.users.declineRequest, args: { userId: viewerId } },

    // The opening figure every computed balance is built on.
    { name: 'accounts.setBalance', gate: 'admin', fn: api.accounts.setBalance, args: { key: 'school_account', openingBalance: 100, asOfDate: '2026-09-01' } },

    { name: 'teamInfo.create', gate: 'admin', fn: api.teamInfo.create, args: { label: 'Team number', value: '2064' } },
    { name: 'teamInfo.update', gate: 'admin', fn: api.teamInfo.update, args: { id: teamInfoId, label: 'Team number', value: '2064' } },
    { name: 'teamInfo.remove', gate: 'admin', fn: api.teamInfo.remove, args: { id: teamInfoId } },
    { name: 'teamInfo.reorder', gate: 'admin', fn: api.teamInfo.reorder, args: { ids: [teamInfoId] } },

    // Destroys and rewrites every table.
    { name: 'seed.importAll', gate: 'admin', fn: api.seed.importAll, args: { seasons: [], donors: [], users: [], accounts: [], sponsors: [], contacts: [], sponsorOutreach: [], grants: [], expenses: [], incomeDeposits: [], teamInfo: [], wishlist: [], actorLocalId: 'nobody' } },

    { name: 'expenses.add', gate: 'writer', fn: api.expenses.add, args: expenseFields },
    { name: 'expenses.update', gate: 'writer', fn: api.expenses.update, args: { id: expenseId, ...expenseFields } },
    { name: 'expenses.recordPurchase', gate: 'writer', fn: api.expenses.recordPurchase, args: { id: expenseId, finalPaidAmount: 175, paymentMethod: 'hcb_card', deliveryStatus: 'ordered' } },
    { name: 'expenses.markDelivered', gate: 'writer', fn: api.expenses.markDelivered, args: { id: expenseId } },
    { name: 'expenses.approve', gate: 'writer', fn: api.expenses.approve, args: { id: expenseId } },
    { name: 'expenses.purchase', gate: 'writer', fn: api.expenses.purchase, args: { id: expenseId } },
    { name: 'expenses.reimburse', gate: 'writer', fn: api.expenses.reimburse, args: { id: expenseId } },
    { name: 'expenses.remove', gate: 'writer', fn: api.expenses.remove, args: { id: expenseId } },

    { name: 'income.add', gate: 'writer', fn: api.income.add, args: depositFields },
    { name: 'income.update', gate: 'writer', fn: api.income.update, args: { id: depositId, ...depositFields } },
    { name: 'income.remove', gate: 'writer', fn: api.income.remove, args: { id: depositId } },

    { name: 'grants.create', gate: 'writer', fn: api.grants.create, args: grantFields },
    { name: 'grants.update', gate: 'writer', fn: api.grants.update, args: { id: grantId, ...grantFields, order: 0 } },
    { name: 'grants.updateStatusAndOrder', gate: 'writer', fn: api.grants.updateStatusAndOrder, args: { id: grantId, status: 'drafting', order: 1 } },
    { name: 'grants.toggleRequirement', gate: 'writer', fn: api.grants.toggleRequirement, args: { grantId, requirementId: 'req_1' } },
    { name: 'grants.finish', gate: 'writer', fn: api.grants.finish, args: { id: grantId, outcome: 'declined' } },
    { name: 'grants.reopen', gate: 'writer', fn: api.grants.reopen, args: { id: grantId, status: 'drafting' } },
    { name: 'grants.remove', gate: 'writer', fn: api.grants.remove, args: { id: grantId } },

    { name: 'sponsors.create', gate: 'writer', fn: api.sponsors.create, args: sponsorFields },
    { name: 'sponsors.update', gate: 'writer', fn: api.sponsors.update, args: { id: sponsorId, ...sponsorFields } },
    { name: 'sponsors.logOutreach', gate: 'writer', fn: api.sponsors.logOutreach, args: { sponsorId, year: 2026, status: 'contacted' } },
    { name: 'sponsors.remove', gate: 'writer', fn: api.sponsors.remove, args: { id: sponsorId } },

    { name: 'contacts.create', gate: 'writer', fn: api.contacts.create, args: contactFields },
    { name: 'contacts.update', gate: 'writer', fn: api.contacts.update, args: { id: contactId, ...contactFields } },
    { name: 'contacts.remove', gate: 'writer', fn: api.contacts.remove, args: { id: contactId } },

    { name: 'wishlist.create', gate: 'writer', fn: api.wishlist.create, args: wishlistFields },
    { name: 'wishlist.update', gate: 'writer', fn: api.wishlist.update, args: { id: wishlistId, ...wishlistFields } },
    { name: 'wishlist.remove', gate: 'writer', fn: api.wishlist.remove, args: { id: wishlistId } },

    { name: 'hcbCategories.set', gate: 'writer', fn: api.hcbCategories.set, args: { hcbTransactionId: 'txn_1', direction: 'out', category: 'robot_parts' } },
    { name: 'hcbCategories.clear', gate: 'writer', fn: api.hcbCategories.clear, args: { hcbTransactionId: 'txn_1' } },
  ];
}

/**
 * Every module in `convex/` except the test files, loaded eagerly so their
 * exports can be read.
 *
 * The negative pattern is load-bearing twice over: eager globbing a
 * `*.test.ts` would import it, and importing a test file from inside a test
 * file registers its tests a second time.
 *
 * `**` rather than `*`, because Convex deploys nested modules: its bundler
 * walks `convex/` recursively and skips only `_deps`, the top-level
 * `_generated`, dotfiles and multi-dot basenames. A top-level-only glob
 * therefore fails *open* -- a reviewer put an entirely ungated public mutation
 * in `convex/nested/thing.ts` against the first version of this and the suite
 * stayed green at 493, which is the same hole the `42 === 42` count had, one
 * directory down.
 */
const functionModules = import.meta.glob<Record<string, unknown>>(
  ['./**/*.ts', '!./**/*.test.ts', '!./_generated/**'],
  { eager: true }
);

/**
 * Every mutation the deployment actually exposes, read off the modules
 * themselves -- `module.name` for each export a registered *public* mutation.
 *
 * Derived, not written down. This assertion used to be
 * `expect(mutationTable()).toHaveLength(42)` against a `const MUTATION_COUNT =
 * 42`, which is `42 === 42`: it read nothing about the function surface, so a
 * new mutation with no row here changed no assertion anywhere. A reviewer
 * appended an entirely ungated mutation to `convex/wishlist.ts` and the suite
 * stayed green at 476 -- a write any anonymous browser could call, added with
 * every gate test passing. The 42 rows that exist do bite (downgrade any one
 * gate and the table reddens naming it); it was the 43rd row that was
 * unprotected, which is the one case this file exists for.
 *
 * `api` cannot be the source: it is `anyApi`, a proxy, so it enumerates
 * nothing. A registered function carries `isMutation` and, separately,
 * `isPublic` or `isInternal` -- `sessions.ts`'s four `internalMutation`s are
 * not part of the exposed surface and are excluded by the `isPublic` check,
 * not by being listed somewhere as exceptions.
 */
function exposedMutationNames(): string[] {
  const names: string[] = [];
  for (const [path, module] of Object.entries(functionModules)) {
    // Convex names a nested module with dots, not slashes:
    // `convex/nested/thing.ts` is `api.nested.thing`.
    const file = path
      .replace(/^\.\//, '')
      .replace(/\.ts$/, '')
      .replace(/\//g, '.');
    for (const [name, value] of Object.entries(module)) {
      const fn = value as { isMutation?: boolean; isPublic?: boolean } | null;
      if (fn?.isMutation === true && fn?.isPublic === true) names.push(`${file}.${name}`);
    }
  }
  return names.sort();
}

test('the table covers every mutation the deployment exposes', () => {
  // Compared as sorted lists rather than counts, so the failure names the
  // mutation that has no row instead of only saying the total moved.
  expect(mutationTable().map((r) => r.name).sort()).toEqual(exposedMutationNames());
  expect(new Set(mutationTable().map((r) => r.name)).size).toBe(mutationTable().length);
});

test('no mutation answers a browser with no session', async () => {
  for (const row of mutationTable()) {
    expect(await guardMessage(anonymous, row.fn, row.args), row.name).toBe(NOT_SIGNED_IN);
  }
});

test('a viewer is refused every write', async () => {
  for (const row of mutationTable()) {
    const expected =
      row.gate === 'admin' ? NOT_AN_ADMIN : row.gate === 'writer' ? NOT_A_WRITER : null;
    expect(await guardMessage(viewer, row.fn, row.args), row.name).toBe(expected);
  }
});

test('a student is refused exactly the admin-only writes, and admitted to the rest', async () => {
  for (const row of mutationTable()) {
    const expected = row.gate === 'admin' ? NOT_AN_ADMIN : null;
    expect(await guardMessage(student, row.fn, row.args), row.name).toBe(expected);
  }
});

test('an admin passes every gate', async () => {
  for (const row of mutationTable()) {
    expect(await guardMessage(admin, row.fn, row.args), row.name).toBeNull();
  }
});

/**
 * The gated *reads*. `access.test.ts` covers what the public lists emit; these
 * three answer nobody at all without the right role, and `users.listRequests`
 * in particular is the admin feed the request flow is built on.
 */
test('the gated queries refuse the roles they are meant to', async () => {
  const gated: Array<{ name: string; gate: Gate; fn: AnyQuery; args: Record<string, unknown> }> = [
    { name: 'users.listUsers', gate: 'actor', fn: api.users.listUsers, args: {} },
    { name: 'contacts.list', gate: 'actor', fn: api.contacts.list, args: {} },
    { name: 'donors.list', gate: 'actor', fn: api.donors.list, args: {} },
    { name: 'audit.list', gate: 'actor', fn: api.audit.list, args: {} },
    { name: 'users.listRequests', gate: 'admin', fn: api.users.listRequests, args: {} },
    { name: 'seed.status', gate: 'admin', fn: api.seed.status, args: {} },
  ];

  for (const row of gated) {
    expect(await guardMessageOfQuery(anonymous, row.fn, row.args), row.name).toBe(NOT_SIGNED_IN);
    expect(await guardMessageOfQuery(viewer, row.fn, row.args), row.name).toBe(
      row.gate === 'admin' ? NOT_AN_ADMIN : null
    );
    expect(await guardMessageOfQuery(student, row.fn, row.args), row.name).toBe(
      row.gate === 'admin' ? NOT_AN_ADMIN : null
    );
    expect(await guardMessageOfQuery(admin, row.fn, row.args), row.name).toBeNull();
  }
});
