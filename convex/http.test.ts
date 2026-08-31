import { convexTest } from 'convex-test';
import { expect, test, vi, beforeEach, afterEach } from 'vitest';
import schema from './schema';
import { internal } from './_generated/api';
import { hashSecret } from './sessions';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.APP_URL = 'https://app.example.com';
  process.env.CONVEX_SITE_URL = 'https://example.convex.site';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

test('refresh rejects an unknown session secret', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'not-a-real-session' })
  });
  expect(res.status).toBe(401);
});

test('refresh rejects a malformed body', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nope: 1 })
  });
  expect(res.status).toBe(400);
});

test('refresh rejects a non-object JSON body', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify('just a string')
  });
  expect(res.status).toBe(400);
});

test('refresh rejects invalid JSON instead of 500ing', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json'
  });
  expect(res.status).toBe(400);
});

test('a happy-path refresh returns a fresh id token in the body', async () => {
  const t = convexTest(schema);
  const secret = 'a-real-session-secret';
  await t.mutation(internal.sessions.create, {
    secretHash: await hashSecret(secret),
    refreshToken: 'refresh-good',
    tokenIdentifier: 'https://accounts.google.com|1',
    expiresAt: Date.now() + 60_000
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id_token: 'fresh-id-token' }), { status: 200 }))
  );

  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ token: 'fresh-id-token' });
});

test('an expired session is rejected and the row is deleted', async () => {
  const t = convexTest(schema);
  const secret = 'expired-secret';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-old',
    tokenIdentifier: 'https://accounts.google.com|2',
    expiresAt: Date.now() - 1000
  });

  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(401);

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found).toBeNull();
});

test('a refresh Google rejects with invalid_grant deletes the session', async () => {
  const t = convexTest(schema);
  const secret = 'dead-grant-secret';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-revoked',
    tokenIdentifier: 'https://accounts.google.com|3',
    expiresAt: Date.now() + 60_000
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
  );

  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(401);

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found).toBeNull();
});

test('a 429 from Google does not delete the session', async () => {
  const t = convexTest(schema);
  const secret = 'rate-limited-secret';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-fine',
    tokenIdentifier: 'https://accounts.google.com|4',
    expiresAt: Date.now() + 60_000
  });

  vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));

  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(503);

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found?.tokenIdentifier).toBe('https://accounts.google.com|4');
});

test('a 500 from Google does not delete the session', async () => {
  const t = convexTest(schema);
  const secret = 'server-error-secret';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-fine-2',
    tokenIdentifier: 'https://accounts.google.com|5',
    expiresAt: Date.now() + 60_000
  });

  vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));

  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(503);

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found).not.toBeNull();
});

test('OPTIONS on /auth/refresh answers the CORS preflight for the app origin', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', { method: 'OPTIONS' });
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
});

test('a state mismatch on the callback is rejected and creates no session', async () => {
  const t = convexTest(schema);
  const before = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
  expect(before).toHaveLength(0);

  const res = await t.fetch('/auth/google/callback?code=some-code&state=wrong-state', {
    method: 'GET',
    headers: { Cookie: '__Host-g_state=right-state' }
  });
  expect(res.status).toBe(400);

  const after = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
  expect(after).toHaveLength(0);
});

test('a missing state cookie on the callback is rejected and creates no session', async () => {
  const t = convexTest(schema);

  const res = await t.fetch('/auth/google/callback?code=some-code&state=whatever', {
    method: 'GET'
  });
  expect(res.status).toBe(400);

  const after = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
  expect(after).toHaveLength(0);
});

test('a malformed id_token from Google fails closed with a generic 502, no token content leaked', async () => {
  const t = convexTest(schema);

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id_token: 'not-a-jwt', refresh_token: 'r' }), { status: 200 }))
  );

  const res = await t.fetch('/auth/google/callback?code=some-code&state=right-state', {
    method: 'GET',
    headers: { Cookie: '__Host-g_state=right-state' }
  });
  expect(res.status).toBe(502);
  const text = await res.text();
  expect(text).not.toContain('not-a-jwt');

  const after = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
  expect(after).toHaveLength(0);
});

test('consent denial on the callback redirects to the app instead of dead-ending', async () => {
  const t = convexTest(schema);

  const res = await t.fetch('/auth/google/callback?error=access_denied', {
    method: 'GET',
    headers: { Cookie: '__Host-g_state=whatever' }
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('Location')).toBe('https://app.example.com/?error=1');
});

function makeIdToken(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url({ alg: 'none' })}.${base64url(payload)}.signature`;
}

test('refresh rejects a null JSON body', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(null)
  });
  expect(res.status).toBe(400);
});

test('refresh rejects an array JSON body', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([1])
  });
  expect(res.status).toBe(400);
});

test('a 401 with invalid_client (bad client credentials) does not delete the row', async () => {
  const t = convexTest(schema);
  const secret = 'wrong-client-secret-case';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-still-good',
    tokenIdentifier: 'https://accounts.google.com|6',
    expiresAt: Date.now() + 60_000
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }))
  );

  const res = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(503);

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found).not.toBeNull();
});

test('a valid callback mints a fresh secret (not the state) and returns it in the fragment', async () => {
  const t = convexTest(schema);
  const state = 'matching-state-value';

  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          id_token: makeIdToken({ iss: 'https://accounts.google.com', sub: 'user-123' }),
          refresh_token: 'refresh-happy-path'
        }),
        { status: 200 }
      )
    )
  );

  const res = await t.fetch(`/auth/google/callback?code=good-code&state=${state}`, {
    method: 'GET',
    headers: { Cookie: `__Host-g_state=${state}` }
  });

  expect(res.status).toBe(302);
  const location = res.headers.get('Location')!;
  // Fragment, not query string.
  expect(location).toMatch(/^https:\/\/app\.example\.com\/#session=[0-9a-f]{64}$/);
  expect(location).not.toContain('?session=');

  const fragmentSecret = new URLSearchParams(location.split('#')[1]).get('session')!;
  expect(fragmentSecret).toBeTruthy();
  // Freshly minted, not the CSRF state value.
  expect(fragmentSecret).not.toBe(state);

  const rows = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].secretHash).toBe(await hashSecret(fragmentSecret));
  expect(rows[0].tokenIdentifier).toBe('https://accounts.google.com|user-123');
});

test('a trailing-slash APP_URL still normalizes to a bare origin in CORS and redirects', async () => {
  process.env.APP_URL = 'https://app.example.com/';
  const t = convexTest(schema);

  const corsRes = await t.fetch('/auth/refresh', { method: 'OPTIONS' });
  expect(corsRes.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

  const res = await t.fetch('/auth/google/callback?error=access_denied', {
    method: 'GET',
    headers: { Cookie: '__Host-g_state=whatever' }
  });
  expect(res.status).toBe(302);
  expect(res.headers.get('Location')).toBe('https://app.example.com/?error=1');
});

test('signout revokes a live session: 204, and the secret can no longer be refreshed', async () => {
  const t = convexTest(schema);
  const secret = 'signout-live-session';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-to-be-revoked',
    tokenIdentifier: 'https://accounts.google.com|7',
    expiresAt: Date.now() + 60_000
  });

  const res = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

  // The row is actually gone, not merely reported gone.
  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found).toBeNull();

  // And the credential is dead end-to-end: a refresh with the same secret is
  // rejected before Google is ever contacted. `fetch` is deliberately stubbed
  // to throw so that a surviving row would fail loudly rather than silently.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('a revoked session must never reach Google');
    })
  );
  const refreshRes = await t.fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  expect(refreshRes.status).toBe(401);
});

test('signout on an unknown secret is 204, indistinguishable from a real revoke', async () => {
  const t = convexTest(schema);

  const live = 'signout-idempotency-live';
  await t.mutation(internal.sessions.create, {
    secretHash: await hashSecret(live),
    refreshToken: 'refresh-idempotent',
    tokenIdentifier: 'https://accounts.google.com|8',
    expiresAt: Date.now() + 60_000
  });

  const real = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: live })
  });
  // A retry of the same request, now that the row is gone.
  const retry = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: live })
  });
  // A secret that never existed at all.
  const neverExisted = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'a-secret-that-was-never-issued' })
  });

  // No status distinguishes "that session was live" from "it was not" -- that
  // difference would be an oracle telling an attacker whether a stolen secret
  // is still worth using.
  expect(real.status).toBe(204);
  expect(retry.status).toBe(204);
  expect(neverExisted.status).toBe(204);
});

test('signout rejects a malformed body without touching any session', async () => {
  const t = convexTest(schema);
  const secret = 'signout-bad-body-guard';
  const secretHash = await hashSecret(secret);
  await t.mutation(internal.sessions.create, {
    secretHash,
    refreshToken: 'refresh-untouched',
    tokenIdentifier: 'https://accounts.google.com|9',
    expiresAt: Date.now() + 60_000
  });

  const invalidJson = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json'
  });
  expect(invalidJson.status).toBe(400);

  const missingSecret = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nope: 1 })
  });
  expect(missingSecret.status).toBe(400);

  const nonStringSecret = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 42 })
  });
  expect(nonStringSecret.status).toBe(400);

  const nullBody = await t.fetch('/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(null)
  });
  expect(nullBody.status).toBe(400);

  const found = await t.query(internal.sessions.bySecretHash, { secretHash });
  expect(found).not.toBeNull();
});

test('OPTIONS on /auth/signout answers the CORS preflight for the app origin', async () => {
  const t = convexTest(schema);
  const res = await t.fetch('/auth/signout', { method: 'OPTIONS' });
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
});
