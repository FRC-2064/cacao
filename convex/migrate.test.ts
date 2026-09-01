/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { beforeEach, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

declare const process: { env: Record<string, string | undefined> };

const GOOGLE = 'https://accounts.google.com';
const SECRET = 'test-bootstrap-secret';

beforeEach(() => {
  process.env.ADMIN_BOOTSTRAP_SECRET = SECRET;
});

/** A signed-in browser, as `ensureUser` leaves it: a viewer with no name. */
async function signedIn(t: ReturnType<typeof convexTest>, sub: string) {
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|${sub}` });
  await as.mutation(api.auth.ensureUser, {});
  return as;
}

test('the first caller with the secret becomes admin', async () => {
  const t = convexTest(schema);
  const as = await signedIn(t, 'levi');

  await as.mutation(api.migrate.claimFirstAdmin, { secret: SECRET });

  expect((await as.query(api.users.me, {}))?.role).toBe('admin');
});

test('a second caller is refused, because one already exists', async () => {
  const t = convexTest(schema);
  const first = await signedIn(t, 'levi');
  await first.mutation(api.migrate.claimFirstAdmin, { secret: SECRET });

  const second = await signedIn(t, 'someone-else');
  await expect(
    second.mutation(api.migrate.claimFirstAdmin, { secret: SECRET })
  ).rejects.toThrow('An admin already exists.');
  expect((await second.query(api.users.me, {}))?.role).toBe('viewer');
});

test('a wrong secret is refused', async () => {
  const t = convexTest(schema);
  const as = await signedIn(t, 'levi');

  await expect(
    as.mutation(api.migrate.claimFirstAdmin, { secret: 'not-it' })
  ).rejects.toThrow('Invalid bootstrap secret.');
  expect((await as.query(api.users.me, {}))?.role).toBe('viewer');
});

/**
 * The failure the cutover actually hits. `npx convex run` authenticates with
 * an admin key and carries no *user* identity, so `requireActor` sees nobody
 * and the call fails here rather than at the secret -- which reads like a
 * sign-in problem and is not. The fix is `convex run --identity '{...}'`.
 */
test('an unauthenticated caller is refused even with the right secret', async () => {
  const t = convexTest(schema);

  await expect(t.mutation(api.migrate.claimFirstAdmin, { secret: SECRET })).rejects.toThrow(
    'Not signed in.'
  );
});

/**
 * Ordering, asserted rather than assumed: the identity check runs before the
 * secret check, so a stranger cannot tell a wrong guess from a right one.
 */
test('an unauthenticated caller cannot tell a wrong secret from a right one', async () => {
  const t = convexTest(schema);

  await expect(t.mutation(api.migrate.claimFirstAdmin, { secret: 'not-it' })).rejects.toThrow(
    'Not signed in.'
  );
});

test('an unset ADMIN_BOOTSTRAP_SECRET refuses everything', async () => {
  delete process.env.ADMIN_BOOTSTRAP_SECRET;
  const t = convexTest(schema);
  const as = await signedIn(t, 'levi');

  await expect(as.mutation(api.migrate.claimFirstAdmin, { secret: '' })).rejects.toThrow(
    'Invalid bootstrap secret.'
  );
});
