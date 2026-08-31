import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

/** A signed-in writer, with a roster row promoted past `viewer`. */
async function withWriter(
  t: ReturnType<typeof convexTest>,
  tokenIdentifier: string,
  role: 'student' | 'admin' = 'student'
) {
  const as = t.withIdentity({ tokenIdentifier });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role });
  });
  return { as, userId };
}

test('a wishlist item stores no person column', async () => {
  const t = convexTest(schema);
  const { as } = await withWriter(t, 'https://accounts.google.com|wishlist1');

  const id = await as.mutation(api.wishlist.create, {
    tool: 'Swerve module',
    cost: 500,
    source: 'purchase',
    priority: 8,
  });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('wishlist', id);
    expect(row).not.toBeNull();
    const serialized = JSON.stringify(row);
    expect(serialized).not.toMatch(/name/i);
    expect(serialized).not.toMatch(/email/i);
    expect(serialized).not.toMatch(/By"/i);
  });
});

test('an expense stores requesterId, not a name or email', async () => {
  const t = convexTest(schema);
  const { as, userId } = await withWriter(t, 'https://accounts.google.com|expense1');

  const seasonId = await t.run((ctx) =>
    ctx.db.insert('seasons', {
      label: '2025-2026',
      startDate: '2025-09-01',
      endDate: '2026-08-31',
      isCurrent: true,
    })
  );

  const id = await as.mutation(api.expenses.add, {
    title: 'Wheels',
    vendor: 'AndyMark',
    amount: 100,
    currency: 'USD',
    category: 'robot_parts',
    status: 'pending_approval',
    seasonId,
  });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('expenses', id);
    expect(row?.requesterId).toBe(userId);
    expect(row).not.toHaveProperty('requesterName');
    expect(row).not.toHaveProperty('requesterEmail');
  });
});
