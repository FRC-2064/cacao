import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { internal } from './_generated/api';
import { hashSecret } from './sessions';

test('hashSecret is stable and does not return the input', async () => {
  const a = await hashSecret('abc');
  const b = await hashSecret('abc');
  expect(a).toBe(b);
  expect(a).not.toBe('abc');
});

test('a session is found by the hash of its secret', async () => {
  const t = convexTest(schema);
  const secretHash = await hashSecret('session-secret');
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-abc',
    tokenIdentifier: 'https://accounts.google.com|12345',
    expiresAt: Date.now() + 60_000
  });

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found?.tokenIdentifier).toBe('https://accounts.google.com|12345');

  const missing = await t.query(internal.sessions.bySecretHash, {
    secretHash: await hashSecret('wrong')
  });
  expect(missing).toBeNull();
});

test('the stored session row never contains the plaintext secret', async () => {
  const t = convexTest(schema);
  const secret = 'super-secret-session-value';
  await t.mutation(internal.sessions.create, {
    secretHash: await hashSecret(secret),
    refreshToken: 'refresh-plain-check',
    tokenIdentifier: 'https://accounts.google.com|555',
    expiresAt: Date.now() + 60_000
  });

  const rows = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(JSON.stringify(row)).not.toContain(secret);
  }
});

test('removeBySecretHash deletes the matching session and no other', async () => {
  const t = convexTest(schema);
  const hashA = await hashSecret('secret-a');
  const hashB = await hashSecret('secret-b');
  await t.mutation(internal.sessions.create, {
    secretHash: hashA,
    refreshToken: 'refresh-a',
    tokenIdentifier: 'https://accounts.google.com|a',
    expiresAt: Date.now() + 60_000
  });
  await t.mutation(internal.sessions.create, {
    secretHash: hashB,
    refreshToken: 'refresh-b',
    tokenIdentifier: 'https://accounts.google.com|b',
    expiresAt: Date.now() + 60_000
  });

  await t.mutation(internal.sessions.removeBySecretHash, { secretHash: hashA });

  expect(await t.query(internal.sessions.bySecretHash, { secretHash: hashA })).toBeNull();
  expect(await t.query(internal.sessions.bySecretHash, { secretHash: hashB })).not.toBeNull();
});

test('removeBySecretHash on an unknown hash is a harmless no-op', async () => {
  const t = convexTest(schema);
  await expect(
    t.mutation(internal.sessions.removeBySecretHash, { secretHash: await hashSecret('nothing-here') })
  ).resolves.not.toThrow();
});

test('reapExpired deletes only sessions past their expiry', async () => {
  const t = convexTest(schema);
  const expiredHash = await hashSecret('expired-one');
  const liveHash = await hashSecret('still-live');
  await t.mutation(internal.sessions.create, {
    secretHash: expiredHash,
    refreshToken: 'refresh-expired',
    tokenIdentifier: 'https://accounts.google.com|expired',
    expiresAt: Date.now() - 1000
  });
  await t.mutation(internal.sessions.create, {
    secretHash: liveHash,
    refreshToken: 'refresh-live',
    tokenIdentifier: 'https://accounts.google.com|live',
    expiresAt: Date.now() + 60_000
  });

  await t.mutation(internal.sessions.reapExpired, {});

  expect(await t.query(internal.sessions.bySecretHash, { secretHash: expiredHash })).toBeNull();
  expect(await t.query(internal.sessions.bySecretHash, { secretHash: liveHash })).not.toBeNull();
});
