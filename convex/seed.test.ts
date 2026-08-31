import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
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
  TEAM_WISHLIST
} from '../src/lib/data/teamData';

/**
 * `importAll` deletes every row in the deployment, `users` included, and then
 * writes the payload it was handed. The one row whose loss cannot be undone is
 * the admin's own. `ensureUser` gives every new account `role: "viewer"` and
 * `setUserRole` requires an admin to call it, so the app has no path to mint
 * an admin at all -- an import that replaces the caller's roster row with
 * somebody else's token, or with a placeholder, bricks the deployment
 * silently, with no error and no way back in short of the Convex dashboard.
 *
 * These run against the real generated dataset rather than a fixture, because
 * the payload that matters is the one that will actually be imported.
 */

const GOOGLE = 'https://accounts.google.com';
const ADMIN_TOKEN = `${GOOGLE}|the-real-admin`;

/** The dataset exactly as `src/lib/data/teamData.ts` emits it, minus `users`. */
const dataset = {
  actorLocalId: IMPORT_ACTOR_ID,
  seasons: TEAM_SEASONS,
  donors: TEAM_DONORS,
  accounts: TEAM_ACCOUNTS,
  sponsors: TEAM_SPONSORS,
  contacts: TEAM_CONTACTS,
  sponsorOutreach: TEAM_SPONSOR_OUTREACH,
  grants: TEAM_GRANTS,
  expenses: TEAM_EXPENSES,
  incomeDeposits: TEAM_INCOME_DEPOSITS,
  teamInfo: TEAM_INFO,
  wishlist: TEAM_WISHLIST,
  replace: true
};

describe('importAll and the admin running it', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;

  beforeEach(async () => {
    t = convexTest(schema);
    as = t.withIdentity({ tokenIdentifier: ADMIN_TOKEN });
    const userId = await as.mutation(api.auth.ensureUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch('users', userId, { role: 'admin' });
    });
  });

  test('refuses a payload that does not name the importing admin', async () => {
    await expect(as.mutation(api.seed.importAll, { ...dataset, users: [] })).rejects.toThrow(
      /no users entry/
    );

    // Nothing was deleted: the caller is still on the roster and still admin.
    const roster = await t.run(async (ctx) => await ctx.db.query('users').collect());
    expect(roster).toHaveLength(1);
    expect(roster[0].tokenIdentifier).toBe(ADMIN_TOKEN);
    await expect(as.query(api.seed.status, {})).resolves.toBeDefined();
  });

  /**
   * The payload is data. A wrong or stale `tokenIdentifier` in it used to be
   * enough to hand the deployment to nobody; now the field is never read for
   * the actor's row, so it cannot do harm whatever it says.
   */
  test('ignores the token identifier the payload carries for the actor', async () => {
    await as.mutation(api.seed.importAll, {
      ...dataset,
      users: [
        {
          _id: IMPORT_ACTOR_ID,
          tokenIdentifier: 'placeholder|import',
          role: 'admin' as const,
          requested: false
        }
      ]
    });

    await expect(as.query(api.seed.status, {})).resolves.toBeDefined();
    const roster = await t.run(async (ctx) => await ctx.db.query('users').collect());
    expect(roster.map((u) => u.tokenIdentifier)).toEqual([ADMIN_TOKEN]);
  });

  test('ignores the role the payload carries for the actor', async () => {
    await as.mutation(api.seed.importAll, {
      ...dataset,
      users: [
        {
          _id: IMPORT_ACTOR_ID,
          tokenIdentifier: 'placeholder|import',
          role: 'viewer' as const,
          requested: false
        }
      ]
    });

    // `status` is admin-only, so resolving at all proves the role survived.
    const counts = await as.query(api.seed.status, {});
    expect(counts.counts.grants).toBe(TEAM_GRANTS.length);
  });

  /**
   * The `.some()` guard above only asks whether *an* entry names the actor.
   * Two entries sharing that `_id` both pass it, and the insert loop then
   * writes both rows with the caller's `tokenIdentifier` and `role: "admin"`.
   * `getActor` ends in `.unique()`, so from that moment every request throws
   * -- `ensureUser` included, so signing in again does not help. Nor is there
   * another door: `ensureUser` makes every new account a `viewer` and
   * `setUserRole` needs an admin, so nothing in the app can mint one. There
   * is no way back in.
   */
  test('refuses two users entries sharing one _id', async () => {
    await expect(
      as.mutation(api.seed.importAll, {
        ...dataset,
        users: [
          {
            _id: IMPORT_ACTOR_ID,
            tokenIdentifier: 'placeholder|import',
            role: 'admin' as const,
            requested: false
          },
          {
            _id: IMPORT_ACTOR_ID,
            tokenIdentifier: 'placeholder|import-again',
            role: 'student' as const,
            requested: false
          }
        ]
      })
    ).rejects.toThrow(/duplicate _id/);

    // A rejected import leaves the deployment exactly as it was. Not because
    // the guard runs before the delete loop -- `importAll` is a transaction,
    // so a throw anywhere in it rolls the deletes back too, and moving all
    // three guards after the loop leaves this file passing unchanged. This
    // asserts the rollback, which is the property that actually protects the
    // roster; it would fail if the import ever stopped being one transaction.
    const roster = await t.run(async (ctx) => await ctx.db.query('users').collect());
    expect(roster).toHaveLength(1);
    expect(roster[0].tokenIdentifier).toBe(ADMIN_TOKEN);
    await expect(as.query(api.seed.status, {})).resolves.toBeDefined();
  });

  /**
   * The same lockout by the other door: distinct `_id`s, but a second entry
   * carrying the caller's real identity. The actor's row is written with that
   * identity by definition, so the payload's copy collides with it.
   */
  test("refuses a second entry carrying the importing admin's own identity", async () => {
    await expect(
      as.mutation(api.seed.importAll, {
        ...dataset,
        users: [
          {
            _id: IMPORT_ACTOR_ID,
            tokenIdentifier: 'placeholder|import',
            role: 'admin' as const,
            requested: false
          },
          {
            _id: 'someone-else',
            tokenIdentifier: ADMIN_TOKEN,
            role: 'student' as const,
            requested: false
          }
        ]
      })
    ).rejects.toThrow(/own identity/);

    const roster = await t.run(async (ctx) => await ctx.db.query('users').collect());
    expect(roster).toHaveLength(1);
    expect(roster[0].tokenIdentifier).toBe(ADMIN_TOKEN);
    await expect(as.query(api.seed.status, {})).resolves.toBeDefined();
  });

  /**
   * The lockout by a third door, and the one the first three guards all miss:
   * two entries with distinct `_id`s and one shared `tokenIdentifier`,
   * neither of them the caller. `new Set(ids)` passes because the ids differ;
   * the identity check passes because neither token is the caller's. Both
   * rows are written, and the person they describe hits `getActor`'s
   * `.unique()` on every request from their first sign-in -- with no way out,
   * because `convex/users.ts` has no user-delete mutation.
   */
  test('refuses two users entries sharing one tokenIdentifier', async () => {
    await expect(
      as.mutation(api.seed.importAll, {
        ...dataset,
        users: [
          {
            _id: IMPORT_ACTOR_ID,
            tokenIdentifier: 'placeholder|import',
            role: 'admin' as const,
            requested: false
          },
          {
            _id: 'mentor',
            tokenIdentifier: `${GOOGLE}|same-person`,
            role: 'student' as const,
            requested: false
          },
          {
            _id: 'student',
            tokenIdentifier: `${GOOGLE}|same-person`,
            role: 'student' as const,
            requested: false
          }
        ]
      })
    ).rejects.toThrow(/share one tokenIdentifier/);

    const roster = await t.run(async (ctx) => await ctx.db.query('users').collect());
    expect(roster).toHaveLength(1);
    expect(roster[0].tokenIdentifier).toBe(ADMIN_TOKEN);
  });

  /**
   * The actor's entry is exempt from that check, because its payload token is
   * discarded and rewritten with the caller's real identity -- a placeholder
   * it shares with nobody cannot collide, and two *different* placeholders
   * are what the generated dataset would ordinarily carry.
   */
  test('accepts a roster whose distinct members carry distinct identities', async () => {
    await as.mutation(api.seed.importAll, {
      ...dataset,
      users: [
        {
          _id: IMPORT_ACTOR_ID,
          tokenIdentifier: 'placeholder|import',
          role: 'admin' as const,
          requested: false
        },
        {
          _id: 'mentor',
          tokenIdentifier: `${GOOGLE}|mentor`,
          role: 'student' as const,
          requested: false
        }
      ]
    });

    const roster = await t.run(async (ctx) => await ctx.db.query('users').collect());
    expect(roster.map((u) => u.tokenIdentifier).sort()).toEqual(
      [ADMIN_TOKEN, `${GOOGLE}|mentor`].sort()
    );
  });

  /**
   * The donor guard, on the one path that actually runs at cutover.
   *
   * `convex/donors.ts`'s `resolveDonorByName` routes an email-shaped name into
   * the anonymous bucket, and no member can get an address into
   * `donors.displayName` through any mutation. `importAll` was not one of
   * those paths: it inserted the payload's donor rows verbatim, and the
   * generator that builds them reads the team's real HCB export -- the same
   * source that produced the `"Donation from <address>"` case the read-side
   * rule exists for.
   *
   * `donors.list` and `income.list`'s raw `donorName` both emit that column,
   * so a one-shot import could seed an address straight into the deployment.
   * The app hides it; the app is not the only thing that can read a
   * deployment. Fixed here rather than in the generator, where it would be
   * skippable and where `scripts/` is off-limits to this branch.
   */
  test('an email-shaped donor name in the payload is imported anonymised', async () => {
    await as.mutation(api.seed.importAll, {
      ...dataset,
      donors: [
        ...TEAM_DONORS,
        {
          _id: 'donor_typed_their_email',
          displayName: 'Donation from A.Rivera0106@example.com',
          normalizedKey: 'donation from a rivera0106 example com',
          isAnonymous: false
        }
      ],
      users: [
        {
          _id: IMPORT_ACTOR_ID,
          tokenIdentifier: 'placeholder|import',
          role: 'admin' as const,
          requested: false
        }
      ]
    });

    const donors = await t.run(async (ctx) => await ctx.db.query('donors').collect());
    expect(JSON.stringify(donors)).not.toContain('@');
    expect(donors.some((d) => d.displayName === 'Anonymous Donor')).toBe(true);

    // And it is emitted anonymised by the query the donor typeahead reads.
    const listed = await as.query(api.donors.list, {});
    expect(JSON.stringify(listed)).not.toContain('@');
  });

  /**
   * Two addresses redact to one name, and two rows sharing a `normalizedKey`
   * would break the uniqueness `resolveDonorByName`'s `by_normalized_key`
   * lookup assumes -- so a redacted donor joins the anonymous bucket that
   * already exists rather than making a second one.
   */
  test('several redacted donors land on one anonymous row', async () => {
    await as.mutation(api.seed.importAll, {
      ...dataset,
      donors: [
        {
          _id: 'anon',
          displayName: 'Anonymous Donor',
          normalizedKey: 'anonymous donor',
          isAnonymous: true
        },
        {
          _id: 'email_one',
          displayName: 'a.rivera@example.com',
          normalizedKey: 'a rivera example com',
          isAnonymous: false
        },
        {
          _id: 'email_two',
          displayName: 'b.tan@example.org',
          normalizedKey: 'b tan example org',
          isAnonymous: false
        }
      ],
      expenses: [],
      incomeDeposits: [],
      users: [
        {
          _id: IMPORT_ACTOR_ID,
          tokenIdentifier: 'placeholder|import',
          role: 'admin' as const,
          requested: false
        }
      ]
    });

    const donors = await t.run(async (ctx) => await ctx.db.query('donors').collect());
    expect(donors).toHaveLength(1);
    expect(donors[0].displayName).toBe('Anonymous Donor');
    expect(donors[0].isAnonymous).toBe(true);
  });

  /**
   * The actor's old roster row is deleted by the import, and Convex does not
   * reject a dangling `v.id("users")`. Logging the import against that id
   * wrote the one entry that must never be anonymous as "Unknown member".
   */
  test('attributes the import audit row to a real member', async () => {
    await as.mutation(api.seed.importAll, {
      ...dataset,
      users: [
        {
          _id: IMPORT_ACTOR_ID,
          tokenIdentifier: 'placeholder|import',
          firstName: 'Ada',
          lastInitial: 'L',
          role: 'admin' as const,
          requested: false
        }
      ]
    });

    const log = await as.query(api.audit.list, {});
    const imports = log.filter((r) => r.action === 'import_seed');
    expect(imports).toHaveLength(1);
    expect(imports[0].actorName).toBe('Ada L');
  });
});
