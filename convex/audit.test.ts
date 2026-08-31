import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

test('an audit row holds userId, not a name, email, or summary', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|audit1' });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'admin', firstName: 'Levi', lastInitial: 'F' });
  });

  await as.mutation(api.teamInfo.create, { label: 'EIN', value: '12-3456789' });

  await t.run(async (ctx) => {
    const rows = await ctx.db.query('auditLogs').collect();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0]).not.toHaveProperty('actorName');
    expect(rows[0]).not.toHaveProperty('actorEmail');
    expect(rows[0]).not.toHaveProperty('summary');
  });
});

test('api.audit.list resolves actorName to "Levi F" for a signed-in reader', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|audit2' });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'admin', firstName: 'Levi', lastInitial: 'F' });
  });

  await as.mutation(api.teamInfo.create, { label: 'EIN', value: '12-3456789' });

  const rows = await as.query(api.audit.list, {});
  expect(rows).toHaveLength(1);
  expect(rows[0].actorName).toBe('Levi F');
});

test('api.audit.list rejects an unauthenticated caller', async () => {
  const t = convexTest(schema);
  await expect(t.query(api.audit.list, {})).rejects.toThrow('Not signed in.');
});
