import { convexTest } from 'convex-test';
import { beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

/**
 * Round-tripping a person reference.
 *
 * `publicGrantFields` emitted `assigneeName` and not `assigneeId`, while
 * `grants.create`/`update` accepted `assigneeId`. So a client could set an
 * assignee and never read back who was assigned: it held only a display
 * string, an edit form could not pre-select the current value, and an
 * assignee could be set but never cleared. `sponsors.primaryContactId` had
 * the same shape.
 *
 * The fix is not to publish the ids. It is to emit them on the gate that
 * already resolves the names -- a signed-in member gets both, a stranger gets
 * neither -- so the public shape is exactly what it was.
 */

const GOOGLE = 'https://accounts.google.com';

describe('a member can read back the reference they set', () => {
  let t: ReturnType<typeof convexTest>;
  let as: ReturnType<ReturnType<typeof convexTest>['withIdentity']>;
  let writerId: Id<'users'>;
  let assigneeId: Id<'users'>;
  let seasonId: Id<'seasons'>;

  beforeEach(async () => {
    t = convexTest(schema);
    as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|writer` });
    writerId = await as.mutation(api.auth.ensureUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch('users', writerId, {
        role: 'student',
        firstName: 'Ada',
        lastInitial: 'L'
      });
      assigneeId = await ctx.db.insert('users', {
        tokenIdentifier: `${GOOGLE}|mentor`,
        firstName: 'Grace',
        lastInitial: 'H',
        role: 'student',
        requested: false
      });
      seasonId = await ctx.db.insert('seasons', {
        label: '2026-2027',
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        isCurrent: true
      });
    });
  });

  const grant = () => ({
    title: 'Community grant',
    funder: 'Rotary',
    amount: 5000,
    currency: 'USD',
    status: 'drafting' as const,
    deadlineType: 'rolling' as const,
    priority: 'medium' as const,
    seasonId,
    requirements: []
  });

  test('a member gets the assignee id alongside the name', async () => {
    await as.mutation(api.grants.create, { ...grant(), assigneeId });

    const [row] = await as.query(api.grants.list, {});
    expect(row.assigneeId).toBe(assigneeId);
    expect(row.assigneeName).toBe('Grace H');
  });

  test('a stranger gets neither, so the public shape is unchanged', async () => {
    await as.mutation(api.grants.create, { ...grant(), assigneeId });

    const [row] = await t.query(api.grants.list, {});
    expect(row.assigneeId).toBeUndefined();
    expect(row.assigneeName).toBeUndefined();
    // The money is still public.
    expect(row.amount).toBe(5000);
  });

  test('getById answers the same way as list', async () => {
    const id = await as.mutation(api.grants.create, { ...grant(), assigneeId });

    expect((await as.query(api.grants.getById, { id }))?.assigneeId).toBe(assigneeId);
    expect((await t.query(api.grants.getById, { id }))?.assigneeId).toBeUndefined();
  });

  /**
   * The three states, and why the middle one is not the first. Convex cannot
   * transmit `undefined`, so without a `null` member an assignee could be set
   * and never taken off; but making an *omitted* field mean "clear" would
   * unassign a grant on every save from a form with no assignee input, which
   * is exactly what the store does today.
   */
  test('an omitted assignee is left alone and a null one is cleared', async () => {
    const id = await as.mutation(api.grants.create, { ...grant(), assigneeId });
    const order = (await t.run(async (ctx) => await ctx.db.get('grants', id)))!.order;

    await as.mutation(api.grants.update, { id, ...grant(), order, title: 'Renamed' });
    let row = await as.query(api.grants.getById, { id });
    expect(row?.title).toBe('Renamed');
    expect(row?.assigneeId).toBe(assigneeId);

    await as.mutation(api.grants.update, { id, ...grant(), order, assigneeId: null });
    row = await as.query(api.grants.getById, { id });
    expect(row?.assigneeId).toBeUndefined();
    expect(row?.assigneeName).toBeUndefined();
  });

  /**
   * `finishedById` is deliberately not emitted. `finish` stamps it from the
   * actor and no mutation accepts it, so a client could only correlate with
   * it, never send it back.
   */
  test('finishedByName resolves for a member but its id is never emitted', async () => {
    const id = await as.mutation(api.grants.create, grant());
    await as.mutation(api.grants.finish, { id, outcome: 'dropped' });

    const row = (await as.query(api.grants.getById, { id })) as Record<string, unknown>;
    expect(row.finishedByName).toBe('Ada L');
    expect(row.finishedById).toBeUndefined();
  });

  test('a sponsor round-trips its primary contact for a member only', async () => {
    const contactId = await t.run(
      async (ctx) =>
        await ctx.db.insert('contacts', {
          name: 'Pat Vendor',
          title: 'Owner',
          email: 'pat@example.com',
          isPrimary: true,
          preferredMethod: 'email' as const,
          updatedAt: Date.now()
        })
    );

    const sponsorId = await as.mutation(api.sponsors.create, {
      name: 'Acme',
      category: 'local_business',
      tier: 'bronze',
      status: 'lead',
      totalDonated: 0,
      primaryContactId: contactId
    });

    expect((await as.query(api.sponsors.list, {}))[0].primaryContactId).toBe(contactId);
    expect((await t.query(api.sponsors.list, {}))[0].primaryContactId).toBeUndefined();

    const base = {
      id: sponsorId,
      name: 'Acme',
      category: 'local_business' as const,
      tier: 'bronze' as const,
      status: 'lead' as const,
      totalDonated: 0
    };

    // Omitted: left alone.
    await as.mutation(api.sponsors.update, { ...base, totalDonated: 100 });
    expect((await as.query(api.sponsors.list, {}))[0].primaryContactId).toBe(contactId);

    // Null: detached.
    await as.mutation(api.sponsors.update, { ...base, primaryContactId: null });
    expect((await as.query(api.sponsors.list, {}))[0].primaryContactId).toBeUndefined();
  });
});
