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

/**
 * The call shape `cacaoStore.subscribeToConvex` actually sends.
 *
 * `args: {}` rejected it -- "Unexpected field `limit` in object" -- and the
 * feed read empty on a database full of rows. Nothing caught it: the args type
 * for an empty validator is `{}`, which accepts any object, and the store
 * swallows this subscription's errors while signed out. So the guard has to be
 * a test, and it has to send `limit` the way the client does rather than the
 * `{}` every other test here sends.
 */
test('api.audit.list accepts the { limit } the client subscribes with', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|audit3' });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'admin', firstName: 'Levi', lastInitial: 'F' });
  });

  await as.mutation(api.teamInfo.create, { label: 'EIN', value: '12-3456789' });

  expect(await as.query(api.audit.list, { limit: 200 })).toHaveLength(1);
});

test('api.audit.list honours a limit smaller than the row count', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|audit4' });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'admin', firstName: 'Levi', lastInitial: 'F' });
  });

  await as.mutation(api.teamInfo.create, { label: 'EIN', value: '12-3456789' });
  await as.mutation(api.teamInfo.create, { label: 'Mailing address', value: 'PO Box 1' });
  await as.mutation(api.teamInfo.create, { label: 'Website', value: 'frc2064.org' });

  expect(await as.query(api.audit.list, { limit: 2 })).toHaveLength(2);
  expect(await as.query(api.audit.list, {})).toHaveLength(3);
});
