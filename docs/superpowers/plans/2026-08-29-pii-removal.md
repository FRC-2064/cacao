# PII Removal & Schema Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce stored personal data to a first name and last initial, and replace Clerk with a hand-rolled Google OIDC flow requesting only the `openid` scope, so no student email ever reaches our infrastructure.

**Architecture:** Convex verifies Google ID tokens directly via `auth.config.ts`. A `convex/http.ts` endpoint performs the authorization-code exchange and stores an `openid`-scoped refresh token in a `sessions` table. Every name/email column across the schema becomes a `v.id("users")` reference resolved at read time; four new tables (`sessions`, `seasons`, `donors`, `sponsorOutreach`) normalize data currently duplicated as strings. Because all live data was imported from spreadsheets, the schema is rewritten in one commit and the data re-imported rather than migrated in place.

**Tech Stack:** Convex 1.45.0, SvelteKit 2 / Svelte 5, TypeScript, Vitest, `convex-test` + `@edge-runtime/vm`.

**Spec:** `docs/superpowers/specs/2026-08-29-pii-removal-design.md`

## Global Constraints

- **Convex version is 1.45.0** (`package.json` says `^1.19.4`; the installed tree is 1.45.0). Guidelines in `convex/_generated/ai/guidelines.md` target `^1.44.0` and apply.
- **Read `convex/_generated/ai/guidelines.md` before writing any Convex code.** Required by `CLAUDE.md`. Its rules override anything you believe about Convex from training.
- **The schema is replaced wholesale, not migrated.** All live data originates from the team's two Google Sheets via `scripts/import/generate.ts` → `src/lib/data/teamData.ts` → `convex/seed.ts:importAll`. Task 11 wipes the deployment, deploys the new schema against empty tables, and re-imports. There are therefore **no backfill mutations and no additive-then-drop sequences** anywhere in this plan.
- **Convex validates every document against the schema at deploy time**, so the new schema can only be deployed once the tables are empty. Order matters: wipe → deploy → import. Deploying first will fail.
- **No task except 4, 5, and 11 runs a `npx convex` command that contacts a deployment** (`dev`, `deploy`, `run`, `env`, `import`, `export`). `convex-test` is in-memory and needs no deployment; it is the only Convex execution path during implementation. Tasks 4, 5, and 11 are run by hand by the repository owner — Task 11 wipes production.
- **`hcbCategories` is the one table not derived from the spreadsheets** — human overrides for bank transactions the memo rules misfiled. It is deliberately NOT preserved: the owner confirms it is a handful of rows he will re-enter by hand after the cutover.
- **Use the table-name-first db API:** `ctx.db.get("users", id)`, `ctx.db.patch("users", id, {...})`, `ctx.db.delete("users", id)`.
- **Identity:** key users on `identity.tokenIdentifier`, never `identity.subject` alone. Never accept a user id as a function argument for authorization — always derive it server-side from `ctx.auth.getUserIdentity()`.
- **Index naming:** include every field, e.g. `["a","b"]` → `by_a_and_b`.
- **Queries do not support `.delete()`.** Read rows, then `ctx.db.delete(...)` each. Mutations have transaction limits: batch with `.take(n)` and continue via `ctx.scheduler.runAfter(0, internal.x.y, args)`.
- **Always include argument validators** on every Convex function.
- **Tests:** `convex-test` with `environment: "edge-runtime"`. Existing finance tests stay on `environment: "node"`.
- Run `npm run check` (svelte-check) before every commit. It catches the type breakage these ref changes cause.

---

## Task 1: Convex test harness

Nothing in `convex/` is currently tested — `vite.config.ts` restricts Vitest to `src/lib/finance/**` and `scripts/import/**`. Every later task needs a way to test Convex functions.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Modify: `vite.config.ts:12-18`
- Create: `convex/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `convexTest(schema)` harness importable in any `convex/*.test.ts`; `npm test` runs both projects.

- [ ] **Step 1: Install test dependencies**

```bash
npm install --save-dev convex-test @edge-runtime/vm
```

- [ ] **Step 2: Move Vitest config out of `vite.config.ts` into a projects config**

Delete the `test: {...}` block from `vite.config.ts` (lines 12-18), leaving only `plugins` and `server`. Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Pure TypeScript finance modules — no Convex runtime needed.
        test: {
          name: 'unit',
          include: ['src/lib/finance/**/*.test.ts', 'scripts/import/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        // Convex functions run against convex-test's in-memory backend.
        test: {
          name: 'convex',
          include: ['convex/**/*.test.ts'],
          environment: 'edge-runtime',
          server: { deps: { inline: ['convex-test'] } }
        }
      }
    ]
  }
});
```

- [ ] **Step 3: Write a failing smoke test**

Create `convex/auth.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

test('an unauthenticated caller is not an actor', async () => {
  const t = convexTest(schema);
  const user = await t.query(api.users.me, {});
  expect(user).toBeNull();
});
```

- [ ] **Step 4: Run it and confirm the harness works**

Run: `npx vitest run --project convex`
Expected: PASS. A failure mentioning `import.meta.glob` means the modules argument is needed — pass `convexTest(schema, import.meta.glob('./**/*.ts'))` and add `/// <reference types="vite/client" />` to the top of the test file only.

- [ ] **Step 5: Confirm the existing suite still runs**

Run: `npm test`
Expected: both projects execute; all existing finance tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vite.config.ts convex/auth.test.ts
git commit -m "test: add convex-test harness alongside the finance suite"
```

---

## Task 2: Google OIDC — config, sessions table, code exchange

**Files:**
- Modify: `convex/auth.config.ts`
- Modify: `convex/schema.ts`
- Create: `convex/http.ts`
- Create: `convex/sessions.ts`
- Create: `convex/sessions.test.ts`

**Interfaces:**
- Consumes: Task 1's harness.
- Produces: `internal.sessions.create({ refreshToken, tokenIdentifier, secretHash, expiresAt })` returning `Id<"sessions">`; `internal.sessions.bySecretHash({ secretHash })` returning `Doc<"sessions"> | null`; `hashSecret(secret: string): Promise<string>` exported from `convex/sessions.ts`; HTTP route `GET /auth/google/callback`.

- [ ] **Step 1: Point `auth.config.ts` at Google**

Replace the whole file:

```ts
import type { AuthConfig } from "convex/server";

declare const process: { env: Record<string, string | undefined> };

/**
 * Google issues the ID tokens; Convex verifies them against Google's JWKS,
 * which it discovers from `${domain}/.well-known/openid-configuration` --
 * Google's certs live at googleapis.com, not under the issuer host.
 *
 * `aud` on a Google ID token is the OAuth client ID, so that is `applicationID`.
 */
export default {
  providers: [
    {
      domain: "https://accounts.google.com",
      applicationID: process.env.GOOGLE_CLIENT_ID!,
    },
  ],
} satisfies AuthConfig;
```

- [ ] **Step 2: Add the `sessions` table to `convex/schema.ts`**

```ts
  /**
   * A signed-in browser. Holds the Google refresh token so an expired ID token
   * can be replaced without sending the user back through Google.
   *
   * The refresh token is scoped to `openid` alone: the only thing it can ever
   * obtain is the user's `sub`. It cannot read email, profile, or any API.
   *
   * `secretHash` is a SHA-256 of the secret the browser holds. Storing the
   * hash means a database leak does not hand over live sessions.
   */
  sessions: defineTable({
    secretHash: v.string(),
    refreshToken: v.string(),
    tokenIdentifier: v.string(),
    expiresAt: v.number(),
  }).index("by_secret_hash", ["secretHash"]),
```

- [ ] **Step 3: Write failing tests for session storage**

Create `convex/sessions.test.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run --project convex convex/sessions.test.ts`
Expected: FAIL — `convex/sessions.ts` does not exist.

- [ ] **Step 5: Implement `convex/sessions.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * SHA-256 of a session secret. Web Crypto is available in the Convex runtime,
 * so no dependency is needed. The database never holds the secret itself.
 */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const create = internalMutation({
  args: {
    secretHash: v.string(),
    refreshToken: v.string(),
    tokenIdentifier: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("sessions", args),
});

export const bySecretHash = internalQuery({
  args: { secretHash: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("sessions")
      .withIndex("by_secret_hash", (q) => q.eq("secretHash", args.secretHash))
      .unique(),
});

export const remove = internalMutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.delete("sessions", args.id);
  },
});
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run --project convex convex/sessions.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Implement the callback endpoint in `convex/http.ts`**

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hashSecret } from "./sessions";

const http = httpRouter();

/** Google's OIDC token endpoint, from its discovery document. */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** How long a session lives before the user must sign in again. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The `sub` and `iss` of an ID token, read without verifying the signature.
 *
 * Safe here and only here: the token has just come back over TLS from Google's
 * own token endpoint in response to a code we issued. Every other consumer of
 * this token -- Convex itself -- verifies it against Google's JWKS.
 */
function readIdToken(idToken: string): { iss: string; sub: string } {
  const [, payload] = idToken.split(".");
  const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  if (typeof json.iss !== "string" || typeof json.sub !== "string") {
    throw new Error("ID token is missing iss or sub");
  }
  return { iss: json.iss, sub: json.sub };
}

http.route({
  path: "/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return new Response("Missing code or state", { status: 400 });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return new Response("Token exchange failed", { status: 502 });

    const tokens = (await res.json()) as unknown as {
      id_token?: unknown;
      refresh_token?: unknown;
    };
    if (typeof tokens.id_token !== "string" || typeof tokens.refresh_token !== "string") {
      return new Response("Token response missing id_token or refresh_token", { status: 502 });
    }

    const { iss, sub } = readIdToken(tokens.id_token);

    // `state` doubles as the session secret: the browser generated it, kept it,
    // and sent only its opaque self through Google.
    await ctx.runMutation(internal.sessions.create, {
      secretHash: await hashSecret(state),
      refreshToken: tokens.refresh_token,
      tokenIdentifier: `${iss}|${sub}`,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return Response.redirect(`${process.env.APP_URL}/?signedin=1`, 302);
  }),
});

export default http;
```

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit -p convex/tsconfig.json && npx vitest run --project convex`
Expected: no type errors, all tests pass.

```bash
git add convex/auth.config.ts convex/schema.ts convex/http.ts convex/sessions.ts convex/sessions.test.ts
git commit -m "feat(auth): exchange Google authorization codes for openid-only sessions"
```

---

## Task 3: Token refresh endpoint

**Files:**
- Modify: `convex/http.ts`
- Create: `convex/http.test.ts`

**Interfaces:**
- Consumes: `internal.sessions.bySecretHash`, `hashSecret` from Task 2.
- Produces: HTTP route `POST /auth/refresh` accepting `{ secret: string }` and returning `{ token: string }`.

- [ ] **Step 1: Write the failing test**

Create `convex/http.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project convex convex/http.test.ts`
Expected: FAIL — the route does not exist, so the status is 404.

- [ ] **Step 3: Add the route to `convex/http.ts`**

Insert before `export default http;`:

```ts
http.route({
  path: "/auth/refresh",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as unknown as { secret?: unknown };
    if (typeof body.secret !== "string") {
      return new Response("Missing secret", { status: 400 });
    }

    const session = await ctx.runQuery(internal.sessions.bySecretHash, {
      secretHash: await hashSecret(body.secret),
    });
    if (!session) return new Response("Unknown session", { status: 401 });

    if (session.expiresAt < Date.now()) {
      await ctx.runMutation(internal.sessions.remove, { id: session._id });
      return new Response("Session expired", { status: 401 });
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: session.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    // Google revokes refresh tokens when access is withdrawn. Drop the dead
    // session so the client falls back to a full sign-in rather than looping.
    if (!res.ok) {
      await ctx.runMutation(internal.sessions.remove, { id: session._id });
      return new Response("Refresh failed", { status: 401 });
    }

    const tokens = (await res.json()) as unknown as { id_token?: unknown };
    if (typeof tokens.id_token !== "string") {
      return new Response("Refresh response missing id_token", { status: 502 });
    }

    return Response.json({ token: tokens.id_token });
  }),
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project convex convex/http.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add convex/http.ts convex/http.test.ts
git commit -m "feat(auth): mint fresh ID tokens from the stored refresh token"
```

---

## Task 4: End-to-end auth verification (manual gate)

This task writes no production code. It proves the assumption every later task rests on: that Convex accepts a Google ID token minted from an `openid`-only scope. **Do not proceed past this task until it passes.**

**Files:**
- Create: `scripts/verify-google-auth.md` (a checklist, committed so the next person can repeat it)

- [ ] **Step 1: Create the Google OAuth client**

In Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application. Add an authorized redirect URI of `https://<your-deployment>.convex.site/auth/google/callback`. Record the client ID and secret.

- [ ] **Step 2: Set the environment variables**

```bash
npx convex env set GOOGLE_CLIENT_ID "<client-id>"
npx convex env set GOOGLE_CLIENT_SECRET "<client-secret>"
npx convex env set APP_URL "http://localhost:5173"
npx convex dev
```

- [ ] **Step 3: Drive the flow by hand**

Open this URL in a browser, substituting the client ID and deployment host:

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=<client-id>
  &redirect_uri=https://<deployment>.convex.site/auth/google/callback
  &response_type=code
  &scope=openid
  &access_type=offline
  &prompt=consent
  &state=test-secret-12345
```

- [ ] **Step 4: Verify the ID token carries no PII**

In the Convex dashboard, confirm a `sessions` row was created. Then call the refresh endpoint and decode the returned token:

```bash
curl -s -X POST https://<deployment>.convex.site/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"secret":"test-secret-12345"}' | \
  python3 -c "import sys,json,base64; t=json.load(sys.stdin)['token']; p=t.split('.')[1]; print(json.dumps(json.loads(base64.urlsafe_b64decode(p+'==')),indent=2))"
```

Expected: a payload containing `iss`, `aud`, `sub`, `exp`, `iat` — and **no `email`, `name`, or `picture`**.

**If `email` is present**, `scope=openid` is not being honoured. Stop and report; the spec's §1 needs revisiting before any further work.

- [ ] **Step 5: Verify Convex accepts the token**

In the Convex dashboard function runner, run any query with the token set as the auth header. Confirm `ctx.auth.getUserIdentity()` returns non-null with a `tokenIdentifier` of `https://accounts.google.com|<sub>`.

**If Convex rejects it**, check that `applicationID` exactly equals the `aud` claim. Stop and report.

- [ ] **Step 6: Record the result and commit**

Write `scripts/verify-google-auth.md` capturing the steps above and the observed token payload with the `sub` value redacted.

```bash
git add scripts/verify-google-auth.md
git commit -m "docs: record the openid-only Google auth verification"
```

---

## Task 5: Rollback snapshot

**Status: DONE.** `snapshots/pre-pii-removal.zip` exists and `snapshots/` is
gitignored — the dump contains every student email this change removes and must
never be committed.

The earlier version of this task also extracted `hcbCategories`, the one table
not derived from the spreadsheets. **That is no longer needed:** the owner
confirms it is a handful of rows he will redo by hand after the cutover. The
snapshot remains the rollback path for everything else.

- [x] **Step 1: Snapshot production**

```bash
npx convex export --deployment festive-lion-592 --include-file-storage --path snapshots/pre-pii-removal.zip
```

- [x] **Step 2: Keep snapshots out of git** — `snapshots/` is in `.gitignore`.

---

## Task 6: The new schema

One commit. No additive steps, because Task 11 deploys this against empty
tables.

**Files:**
- Modify: `convex/schema.ts` (rewritten)
- Modify: `convex/validators.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: the complete target schema. Every later task depends on these exact
  field names.

- [ ] **Step 1: Rewrite `convex/schema.ts`**

Apply every table change from the spec in one pass:

| Table | Change |
|---|---|
| `users` | `{ tokenIdentifier, firstName?, lastInitial?, role, requested, approvedById?, approvedAt? }`, index `by_token_identifier`. Everything else gone. |
| `sessions` | New — from Task 2. |
| `seasons` | New — `{ label, startDate, endDate, isCurrent }`, index `by_is_current`. |
| `donors` | New — `{ displayName, normalizedKey, isAnonymous }`, index `by_normalized_key`. |
| `sponsorOutreach` | New — `{ sponsorId, year, status, amount?, notes?, contactedDate? }`, indexes `by_sponsor` and `by_year`. |
| `accounts` | Add `key: accountKeyValidator`, `updatedById`. Drop `account`, `updatedBy`. Index `by_key`. |
| `grants` | `assigneeId: v.optional(v.id("users"))`, `finishedById`, `seasonId`. Drop `assigneeName`, `finishedBy`, `lastModifiedBy`, `createdAt`, `season`. `linkedDepositId → v.optional(v.id("incomeDeposits"))`. Index `by_assignee` on `assigneeId`, `by_season_id`. |
| `expenses` | `requesterId`, `purchaserId?`, `approvedById?`, `accountId?`, `donorId?`, `seasonId`, `linkedGrantId?: v.id("grants")`. Drop all name/email columns, `linkedGrantTitle`, `account`, `donorName`, `season`, `createdAt`. |
| `incomeDeposits` | `loggedById`, `accountId`, `donorId?`, `seasonId`. Drop `loggedByName`, `loggedByEmail`, `depositAccount`, `donorName`, `season`, `createdAt`. |
| `hcbCategories` | `setById`. Drop `setByName`, `setByEmail`. |
| `teamInfo` | `updatedById`. Drop `updatedBy`. |
| `wishlist` | Drop `requestedByName` and `createdAt` entirely — no person column at all. |
| `sponsors` | `primaryContactId?: v.id("contacts")`. Drop `primaryContactName`, `primaryContactEmail`, `annualHistory`, `createdAt`. |
| `contacts` | `sponsorId: v.optional(v.id("sponsors"))` (typed). Drop `sponsorName`, `createdAt`. |
| `auditLogs` | `{ userId, action, entityType, entityId, change? }`, index `by_user`. Everything else gone. |

Every `createdAt` column goes; `_creationTime` replaces it.

- [ ] **Step 2: Update `convex/validators.ts`**

- `roleValidator` → `admin | student | viewer` (drop `graduated`).
- Delete `userStatusValidator`, `actorArgs`, `accountValidator`,
  `expenseAccountValidator`, `depositAccountValidator`, `annualHistoryValidator`.
- Add `accountKeyValidator = v.union(v.literal("hcb_bank"), v.literal("school_account"))`.
- Add `entityTypeValidator` extracted from the inline union in `schema.ts`.
- Keep `outreachStatusValidator` — `sponsorOutreach` uses it.

- [ ] **Step 3: Mirror in `src/lib/types.ts`**

`validators.ts` states that it, `schema.ts`, and `src/lib/types.ts` must be kept
in step. Remove `email`, `gradYear`, `avatarId`, `imageUrl`, `password`,
`lastName`, `status`, and the `graduated` role from `User`; add `lastInitial`
and `requested`. Update every record type to match the table above.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p convex/tsconfig.json`
Expected: **errors in `convex/*.ts` and `src/`** — every consumer of the removed
fields. That is the worklist for Tasks 7–10. Do not fix them here.

- [ ] **Step 5: Commit the schema alone**

```bash
git add convex/schema.ts convex/validators.ts src/lib/types.ts
git commit -m "feat(schema): the post-PII-removal schema"
```

---

## Task 7: `auth.ts`, users, and the request-edit flow

**Files:**
- Modify: `convex/auth.ts`, `convex/users.ts`
- Create: `convex/users.test.ts`, `convex/requests.test.ts`

**Interfaces:**
- Consumes: Task 6's schema.
- Produces: `displayName(user): string`; `actorFields(user): { userId: Id<"users"> }`; `resolveNames(ctx): Promise<Map<Id<"users">, string>>`; `api.users.me`, `api.users.requestEditAccess`, `api.users.listRequests`, `api.users.approveRequest`, `api.users.declineRequest`.

- [ ] **Step 1: Write the failing tests**

Create `convex/users.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { displayName } from './auth';

describe('displayName', () => {
  test('joins a first name and last initial', () => {
    expect(displayName({ firstName: 'Levi', lastInitial: 'F' } as never)).toBe('Levi F');
  });
  test('falls back when a viewer has supplied no name', () => {
    expect(displayName({} as never)).toBe('Unnamed member');
  });
  test('omits a missing initial rather than trailing a space', () => {
    expect(displayName({ firstName: 'Levi' } as never)).toBe('Levi');
  });
});

test('a new sign-in stores an identifier and nothing else', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|s1' });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', userId);
    expect(row?.role).toBe('viewer');
    expect(row?.firstName).toBeUndefined();
    expect(row?.requested).toBe(false);
    expect(JSON.stringify(row)).not.toContain('@');
  });
});

test('signing in twice does not create a second row', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|s2' });
  const a = await as.mutation(api.auth.ensureUser, {});
  const b = await as.mutation(api.auth.ensureUser, {});
  expect(a).toBe(b);
});
```

Create `convex/requests.test.ts` covering: a request records a truncated
initial and surfaces to admins; approving promotes to `student`; declining
clears the flag so the student can ask again; a non-admin cannot approve. Use
the four scenarios and assertions given in the spec's §2 access flow — assert
specifically that `lastInitial` is `'F'` when `'Fitzpatrick'` was submitted.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project convex convex/users.test.ts convex/requests.test.ts`
Expected: FAIL — `displayName` is not exported and the request mutations do not exist.

- [ ] **Step 3: Rewrite `convex/auth.ts`**

Add `displayName` and `resolveNames`, replace `actorFields` with
`{ userId: user._id }`, simplify `requireActor` (there is no `status` to
reject — a viewer's limits are enforced by `requireWriter`), and rewrite
`ensureUser` as find-or-create on `tokenIdentifier` with no email path:

```ts
export function displayName(user: Doc<"users">): string {
  const parts = [user.firstName, user.lastInitial].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unnamed member";
}

export function actorFields(user: Doc<"users">) {
  return { userId: user._id };
}

/**
 * Every roster row's display name, keyed by id. Loaded once per query rather
 * than per row -- the roster is a few dozen people, so one read beats an N+1.
 */
export async function resolveNames(ctx: AnyCtx): Promise<Map<Id<"users">, string>> {
  const users = await ctx.db.query("users").take(500);
  return new Map(users.map((u) => [u._id, displayName(u)]));
}

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) return existing._id;

    // A new account holds an opaque identifier and nothing else. A name is
    // collected only if they later ask for edit access, which is the point at
    // which accountability starts to matter.
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      role: "viewer",
      requested: false,
    });
  },
});
```

- [ ] **Step 4: Rewrite `convex/users.ts`**

Add an explicit projection — an allowlist, so a column added later cannot leak
by default:

```ts
const publicUserFields = (u: Doc<"users">) => ({
  _id: u._id,
  firstName: u.firstName,
  lastInitial: u.lastInitial,
  displayName: displayName(u),
  role: u.role,
  requested: u.requested,
});
```

Use it in `listUsers` and `me`. Delete `generateAvatarUploadUrl`,
`setOwnAvatar`, `clearOwnAvatar`, `graduateClassBatch`, and
`migrateGraduatedRoleToViewer`. Reduce `updateOwnProfile` to `firstName` and
`lastInitial`. Add the four request functions:

```ts
export const requestEditAccess = mutation({
  args: { firstName: v.string(), lastInitial: v.string() },
  handler: async (ctx, args) => {
    const user = await requireActor(ctx);
    await ctx.db.patch("users", user._id, {
      firstName: args.firstName.trim(),
      // Truncated on the server, not merely in the form: this is the only
      // place a surname could enter the database.
      lastInitial: args.lastInitial.trim().slice(0, 1).toUpperCase(),
      requested: true,
    });
  },
});

export const listRequests = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (await ctx.db.query("users").take(200))
      .filter((u) => u.requested)
      .map(publicUserFields);
  },
});

export const approveRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireAdmin(ctx);
    await ctx.db.patch("users", args.userId, {
      role: "student", requested: false,
      approvedById: actor._id, approvedAt: Date.now(),
    });
  },
});

export const declineRequest = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    // Only the flag is cleared. There is deliberately no record of a decline:
    // rejections are for obvious junk, and an accidental one must leave the
    // student able to ask again.
    await ctx.db.patch("users", args.userId, { requested: false });
  },
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project convex convex/users.test.ts convex/requests.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/auth.ts convex/users.ts convex/users.test.ts convex/requests.test.ts
git commit -m "feat(users): opaque sign-in, request-edit flow, name resolution"
```

---

## Task 8: Rewrite the mutations onto references

Work through the type errors Task 6 produced in `convex/`.

**Files:**
- Modify: `convex/grants.ts`, `expenses.ts`, `income.ts`, `hcbCategories.ts`, `teamInfo.ts`, `accounts.ts`, `wishlist.ts`, `sponsors.ts`, `contacts.ts`, `audit.ts`, `lib.ts`, `seed.ts`
- Create: `convex/people.test.ts`, `convex/audit.test.ts`

**Interfaces:**
- Consumes: `actorFields`, `requireWriter`, `requireAdmin` from Task 7.
- Produces: every mutation deriving its actor server-side; audit rows of `{ userId, action, entityType, entityId, change? }`.

- [ ] **Step 1: Write the failing tests**

Create `convex/people.test.ts` asserting that a wishlist item stores no
person column, and that an expense stores `requesterId` rather than
`requesterName` or `requesterEmail`.

Create `convex/audit.test.ts` asserting an audit row holds `userId` and has no
`actorName`, `actorEmail`, or `summary` property; that `api.audit.list`
resolves `actorName` to `'Levi F'` for a signed-in reader; and that
`api.audit.list` rejects an unauthenticated caller with `'Not signed in.'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project convex convex/people.test.ts convex/audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Strip client-supplied identity from every mutation**

Delete `actorName`, `actorEmail`, `actorRole`, `requesterName`,
`requesterEmail`, `purchaserName`, `loggedByName`, `loggedByEmail`,
`setByName`, `setByEmail`, `assigneeName`, `finishedBy`, `lastModifiedBy`,
`updatedBy`, and `requestedByName` from every mutation's `args`. Replace each
with the actor derived server-side:

```ts
const actor = await requireWriter(ctx);
// ...then set requesterId: actor._id, or omit the column entirely for wishlist.
```

**Never accept a user id as an argument** — the guidelines forbid it and it
would be an authorization hole.

- [ ] **Step 4: Rewrite every audit write**

Replace each insert with:

```ts
await ctx.db.insert("auditLogs", {
  ...actorFields(actor),
  action: "create",
  entityType: "wishlist",
  entityId: itemId,
});
```

Drop `timestamp`, `entityName`, `summary`, and `details`. Where a status change
was described in `summary`, pass `change: { field: "status", from, to }`.
Update `logAudit` in `convex/lib.ts` to the new shape.

- [ ] **Step 5: Resolve names on the audit read path**

```ts
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireActor(ctx);
    const rows = await ctx.db.query("auditLogs").order("desc").take(200);
    const names = await resolveNames(ctx);
    return rows.map((r) => ({
      ...r,
      timestamp: r._creationTime,
      actorName: names.get(r.userId) ?? "Unknown member",
    }));
  },
});
```

A deleted entity renders as "deleted grant" — expected, and recorded in the spec.

- [ ] **Step 6: Update `convex/seed.ts` to the new shape**

`seed.ts` imports validators Task 6 deleted (`actorArgs`, `accountValidator`,
`annualHistoryValidator`, `userStatusValidator`) and writes the columns this
task removed, so it cannot be left for later without holding `convex/` in a
non-compiling state. Rewrite its `seedGrant` / `seedExpense` / `seedDeposit` /
`seedSponsor` / `seedUser` validators to the Task 6 schema, and extend
`importAll` to write `seasons`, `donors`, `contacts`, and `sponsorOutreach`
first — other rows reference them. Keep the existing string-id-to-Convex-id
rewriting approach.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run --project convex && npx tsc --noEmit -p convex/tsconfig.json`
Expected: PASS, and no remaining type errors under `convex/`.

- [ ] **Step 8: Commit**

```bash
git add convex/
git commit -m "refactor: derive the actor server-side, store references not names"
```

---

## Task 9: Read-path projections and access control

Closes the live exposure: three student email columns and every name stamp are
readable today through unauthenticated list queries.

**Files:**
- Modify: `convex/expenses.ts`, `income.ts`, `grants.ts`, `wishlist.ts`, `hcbCategories.ts`, `sponsors.ts`
- Modify: `convex/auth.ts` (the `PUBLIC_DATA` note)
- Create: `convex/access.test.ts`

**Interfaces:**
- Consumes: `getActor`, `resolveNames` from Task 7.
- Produces: list queries emitting a wire shape unchanged for the finance modules — `account` as a slug, `donorName` as a string, `createdAt` from `_creationTime` — with person and delivery fields gated.

- [ ] **Step 1: Write the failing test**

Create `convex/access.test.ts`:

```ts
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const GOOGLE = 'https://accounts.google.com';

/** Every field a stranger must never see, whatever route they take. */
const FORBIDDEN = [
  'requesterId', 'requesterName', 'requesterEmail',
  'purchaserId', 'purchaserName', 'approvedById',
  'loggedById', 'loggedByName', 'loggedByEmail',
  'setById', 'setByName', 'setByEmail',
  'assigneeId', 'assigneeName', 'finishedById', 'updatedById',
  'trackingNumber', 'carrier', 'receiptUrl',
  'primaryContactName', 'primaryContactEmail'
];

test('public list queries leak no person and no delivery detail', async () => {
  const t = convexTest(schema);
  for (const rows of [
    await t.query(api.expenses.list, {}),
    await t.query(api.income.list, {}),
    await t.query(api.grants.list, {}),
    await t.query(api.wishlist.list, {}),
    await t.query(api.hcbCategories.list, {}),
    await t.query(api.sponsors.list, {})
  ]) {
    for (const row of rows as Record<string, unknown>[]) {
      for (const field of FORBIDDEN) {
        expect(row[field], `${field} must not reach a stranger`).toBeUndefined();
      }
    }
  }
});

test('tracking and receipts are admin-only, not merely signed-in', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s1` });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'student' });
  });
  // Insert an expense with delivery details via t.run, matching the new schema.

  const asStudent = (await as.query(api.expenses.list, {}))[0] as Record<string, unknown>;
  expect(asStudent.trackingNumber).toBeUndefined();
  expect(asStudent.receiptUrl).toBeUndefined();

  await t.run(async (ctx) => { await ctx.db.patch('users', userId, { role: 'admin' }); });
  const asAdmin = (await as.query(api.expenses.list, {}))[0] as Record<string, unknown>;
  expect(asAdmin.trackingNumber).toBeDefined();
  expect(asAdmin.receiptUrl).toBeDefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project convex convex/access.test.ts`
Expected: FAIL — the list queries return whole documents.

- [ ] **Step 3: Project every list query explicitly**

Load the lookup maps once, then build each row from an allowlist. For
`convex/expenses.ts`:

```ts
const actor = await getActor(ctx);
const names = actor ? await resolveNames(ctx) : null;
const isAdmin = actor?.role === "admin";

const accounts = await ctx.db.query("accounts").take(50);
const slugById = new Map(accounts.map((a) => [a._id, a.key]));
const donors = await ctx.db.query("donors").take(500);
const donorNameById = new Map(donors.map((d) => [d._id, d.displayName]));

return expenses.map((e) => ({
  _id: e._id,
  title: e.title, vendor: e.vendor, amount: e.amount,
  finalPaidAmount: e.finalPaidAmount, currency: e.currency,
  category: e.category, status: e.status, seasonId: e.seasonId,
  paymentMethod: e.paymentMethod, date: e.date,
  orderNumber: e.orderNumber, expectedDeliveryDate: e.expectedDeliveryDate,
  deliveryStatus: e.deliveryStatus, itemLink: e.itemLink, notes: e.notes,
  taxYear: e.taxYear, linkedGrantId: e.linkedGrantId,
  updatedAt: e.updatedAt,
  // The finance modules consume these exact shapes; keep them stable.
  account: e.accountId ? slugById.get(e.accountId) : undefined,
  donorName: e.donorId ? donorNameById.get(e.donorId) : undefined,
  createdAt: e._creationTime,
  // Person references resolve only for a signed-in member.
  requesterName: names?.get(e.requesterId),
  purchaserName: e.purchaserId ? names?.get(e.purchaserId) : undefined,
  // A tracking number handed to a carrier's site often reveals the delivery
  // address, and a receipt image usually carries a name. Admin only.
  trackingNumber: isAdmin ? e.trackingNumber : undefined,
  carrier: isAdmin ? e.carrier : undefined,
  receiptUrl: isAdmin ? e.receiptUrl : undefined,
}));
```

**`account` must keep emitting the slug.** `src/lib/finance/ledger.ts:247`
reads `e.account === 'hcb_bank'` to drive the dedup that collapses a
hand-logged expense against the live HCB transaction paying it. Emit an id
there and the comparison silently goes false, every HCB-paid expense
double-counts, and the Sankey shows inflated totals that look plausible — no
error, no failing test.

Apply the same pattern to `income.list`, `grants.list`, `wishlist.list`,
`hcbCategories.list`, and `sponsors.list` (which additionally assembles
`annualHistory` from `sponsorOutreach` and omits the contact columns).

- [ ] **Step 4: Add the guard test for the dedup**

Add to `src/lib/finance/ledger.test.ts` a case asserting that an expense with
`account: 'hcb_bank'` and `paymentMethod: 'hcb_card'` produces exactly **one**
outgoing ledger entry when a matching HCB transaction is present. Read
`buildLedger`'s signature in `src/lib/finance/ledger.ts` first and match the
argument shape exactly.

- [ ] **Step 5: Update the `PUBLIC_DATA` note in `convex/auth.ts`**

Rewrite it to record what is now true: the money is public, person references
resolve only for members, delivery details are admin-only, and `contacts`
holds the only personal data left behind a gate.

- [ ] **Step 6: Run to verify pass and commit**

Run: `npm run check && npx vitest run`

```bash
git add convex/ src/lib/finance/ledger.test.ts
git commit -m "fix(security): stop public queries leaking names, emails and tracking"
```

---

## Task 10: Regenerate the seed dataset

**Files:**
- Modify: `scripts/import/generate.ts`
- Modify: `src/lib/data/teamData.ts` (generated — do not hand-edit)
- Modify: `scripts/import/dataset.test.ts`

**Interfaces:**
- Consumes: Task 6's schema.
- Produces: `teamData.ts` matching the new shape; `api.seed.importAll` accepting it.

- [ ] **Step 1: Update the generator**

In `scripts/import/generate.ts`:

- Emit `seasons` rows from the distinct season labels the sheets produce, with
  `startDate` = `${year}-09-01` and `endDate` = `${year + 1}-08-31`, and
  `isCurrent` on the latest. Replace every `season: string` with `seasonId`.
- Emit `donors` rows using `normalizeDonorName` as the find-or-create key, and
  replace `donorName` with `donorId`.
- Emit `accounts` rows carrying `key`.
- Emit `sponsorOutreach` rows from what previously became `annualHistory`.
- Emit `contacts` rows for what previously became
  `sponsors.primaryContactName` / `primaryContactEmail`, and link them by
  `primaryContactId`.
- `TEAM_USERS` becomes `[]`. Seeding a placeholder admin would leave an
  unclaimable, nameless admin row in the roster once `claimFirstAdmin`
  promotes the real signed-in row instead. The roster fills as people sign
  in. **`cleanEmail` in `mapping.ts:276` must no longer be called for any
  person; delete its use.**
- `TEAM_AUDIT_LOGS` stays empty.
- Drop every `createdAt` from the emitted records.

- [ ] **Step 2: Update the dataset test**

`scripts/import/dataset.test.ts` asserts the generated shape. Update its
expectations, and **add an assertion that no generated record contains an `@`**:

```ts
test('the generated dataset contains no email address', () => {
  const json = JSON.stringify({ GRANTS, EXPENSES, DEPOSITS, WISHLIST, TEAM_USERS });
  expect(json).not.toMatch(/@/);
});
```

Import whichever collections `generate.ts` actually exports.

- [ ] **Step 3: Run to verify**

Run: `npx vitest run --project unit scripts/import`
Expected: PASS, including the no-email assertion.

- [ ] **Step 4: Regenerate `teamData.ts`**

Run the generator as the repo already invokes it (check `generate.ts`'s entry
point; it writes `src/lib/data/teamData.ts`). Confirm:

```bash
grep -c "@" src/lib/data/teamData.ts
```

Expected: `0`.

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npx vitest run`

```bash
git add scripts/import/ src/lib/data/teamData.ts
git commit -m "feat(seed): regenerate the dataset against the new schema"
```

---

## Task 11: Cutover

**Read this whole task before running any of it.** It wipes a live database.
An earlier draft of this section could not execute: it deployed before setting
the credentials the deploy validates, aimed eight commands at the dev
deployment, and called two admin-only functions from a CLI that carries no user
identity. Each of those failed *after* the wipe. The order below is the
corrected one.

Order matters: **wipe, set env, deploy, sign in, claim admin, import.** Convex
validates every stored document against the schema at deploy time, so deploying
the new schema against the old data fails.

**Files:**
- Create: `convex/migrate.ts`, `convex/migrate.test.ts`

**Interfaces:**
- Consumes: nothing. (`hcbCategories` is re-entered by hand after cutover — a
  handful of rows, per the owner.)
- Produces: `api.migrate.claimFirstAdmin({ secret })`.

### Before you start

**The deployments, since this document used to say `<your-deployment>`:**

| | name | `.convex.cloud` | `.convex.site` |
|---|---|---|---|
| **production** | `festive-lion-592` | `https://festive-lion-592.convex.cloud` | `https://festive-lion-592.convex.site` |
| dev | `charming-poodle-399` | `https://charming-poodle-399.convex.cloud` | `https://charming-poodle-399.convex.site` |

Dashboard: <https://dashboard.convex.dev/d/festive-lion-592>. The Google
redirect URI you need is
`https://festive-lion-592.convex.site/auth/google/callback`.


Production is **down for the whole window** — from Step 4 until the frontend
ships in Step 13. Pick a time nobody is using it.

Three things to do first, because each one otherwise fails after the wipe:

- [ ] **Add the production redirect URI to the Google OAuth client.** Task 4
  registered the *dev* deployment's. `convex/http.ts` builds `redirect_uri`
  from `CONVEX_SITE_URL`, which on production is a different host, so sign-in
  in Step 7 dies at Google with `redirect_uri_mismatch`. In the Google Cloud
  console add `https://festive-lion-592.convex.site/auth/google/callback`
  to the OAuth client's authorized redirect URIs. While you are there, confirm
  the consent screen is **Published**, not in Testing — a Testing-mode client
  expires refresh tokens after 7 days.
- [ ] **Record the current Clerk issuer, for the rollback.** Step 5 removes it
  and the rollback needs it back:
  ```bash
  npx convex env get --prod CLERK_JWT_ISSUER_DOMAIN
  ```
  Write the value down somewhere outside this repo.
- [ ] **Run the gates locally before you start.**
  ```bash
  npx vitest run && npm run check && npm run check:convex && npm run build
  ```
  All four must pass. `check:convex` is the one that matters most here: it is
  the same `tsc --project convex` that `convex deploy` runs itself, and a
  failure there crashes the deploy in Step 6 — after the wipe. CI runs it too,
  but the release workflow only fires on a tag, and by the constraint below no
  tag exists yet, so this local run is the only thing standing in front of the
  cutover.

- [ ] **Do not tag a release until Step 12.** `src/lib/data/teamData.ts` is
  gitignored — it is a one-time seed payload holding 31 sponsor contacts, and
  this repository is public — but five tracked files still import it. On a
  fresh `actions/checkout` the release workflow's `npm test`, `npm run check`
  and `npm run check:convex` all fail to resolve it, so `deploy` (which
  `needs: verify`) never runs. Nothing catches this locally, because your
  working copy has the file and the workflow only fires on a tag.

  This is not a defect to fix now — Step 12 deletes the importers along with
  the rest of the import scaffold, and after that a fresh clone builds. It is a
  sequencing constraint: **the cutover runs from your local dev server, and the
  tagged release comes after Step 12.** Steps 13 and 14 are already in that
  order; this is the reason.

- [ ] **Stop CI from deploying the backend out from under you.** `vercel.json`
  runs `npm run build:vercel`, which is `convex deploy --cmd 'npm run build'`.
  Any push to the production branch before Step 6 makes Vercel deploy the new
  schema against the old data and fail. Do not merge this branch until Step 13.

Every `npx convex` command below carries `--prod`. Without it they hit the dev
deployment, because `.env.local` sets `CONVEX_DEPLOYMENT=dev:…` and `env`, `run`
and `import` all default to it. Only `deploy` defaults to production. Getting
this wrong is silent: the commands succeed, against the wrong database.

- [ ] **Step 1: Write the bootstrap mutation**

Create `convex/migrate.ts`:

```ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireActor } from "./auth";

declare const process: { env: Record<string, string | undefined> };

/**
 * Grant admin to the caller, once.
 *
 * After the cutover no roster row is claimed by anyone, so without this the
 * deployment has no administrator and nobody can promote anyone: `ensureUser`
 * writes only `role: "viewer"`, and `setUserRole` requires an admin already.
 */
export const claimFirstAdmin = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    const expected = process.env.ADMIN_BOOTSTRAP_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("Invalid bootstrap secret.");
    }
    const users = await ctx.db.query("users").take(500);
    if (users.some((u) => u.role === "admin")) {
      throw new Error("An admin already exists.");
    }
    const actor = await requireActor(ctx);
    await ctx.db.patch("users", actor._id, { role: "admin" });
  },
});
```

Note `requireActor`: this mutation needs a **signed-in user identity**, which
is why Step 7 runs it with `--identity` and not bare.

- [ ] **Step 2: Test the bootstrap**

Create `convex/migrate.test.ts` asserting: a caller with the correct secret and
a roster row becomes admin; a second caller is refused with `'An admin already
exists.'`; a wrong secret is refused with `'Invalid bootstrap secret.'`; and an
**unauthenticated** caller with the correct secret is refused with `'Not signed
in.'` — that last one is the failure you will hit in Step 7 if you forget
`--identity`, so it is worth having seen it. Set
`ADMIN_BOOTSTRAP_SECRET=test-secret` in the test environment.

Run: `npx vitest run --project convex convex/migrate.test.ts` → PASS

- [ ] **Step 3: Confirm the rollback snapshot, and know the rollback**

```bash
ls -la snapshots/pre-pii-removal.zip
```

**Do not continue without it.**

If anything from Step 4 onward goes wrong, the recovery is **not** "import the
snapshot". Every `users` row in it carries `email`, `gradYear`, `avatarId` and
`status`, and once Step 6 has deployed the new schema those rows are rejected.
The real sequence is:

1. Wipe again (Step 4).
2. `git checkout trunk`.
3. `npx convex env set --prod CLERK_JWT_ISSUER_DOMAIN "<the value you recorded>"`
4. `npx convex deploy` — puts the old schema back.
5. `npx convex import --prod --replace-all --yes snapshots/pre-pii-removal.zip`
6. Redeploy the old frontend on Vercel.

- [ ] **Step 4: Wipe the deployment**

Use the **Convex dashboard**: clear every table by hand. The CLI route looks
tempting and does not work — Convex requires a zip with one directory per
table containing `<table>/documents.jsonl`, and an empty file is neither, so
`convex import --replace-all` rejects it.

Verify every table is empty before continuing. A single surviving row makes
Step 6 fail with a schema validation error — *after* the rest of the data is
gone.

- [ ] **Step 5: Set the environment — BEFORE the deploy**

```bash
SECRET=$(openssl rand -hex 16); echo "$SECRET"     # write this down
npx convex env set --prod GOOGLE_CLIENT_ID "<client-id>"
npx convex env set --prod GOOGLE_CLIENT_SECRET "<client-secret>"
npx convex env set --prod APP_URL "http://localhost:5173"
npx convex env set --prod ADMIN_BOOTSTRAP_SECRET "$SECRET"
npx convex env remove --prod CLERK_JWT_ISSUER_DOMAIN
```

This runs before the deploy on purpose. `convex/auth.config.ts` reads
`GOOGLE_CLIENT_ID`, and the backend rejects a push whose auth config names an
unset variable: *"Environment variable GOOGLE_CLIENT_ID is used in auth config
file but its value was not set."*

As of writing, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_URL` are
**already set on production** — check with `npx convex env list --prod` before
you run the block. Setting them again is harmless, and the ordering stays as
insurance: if any one of them is ever missing, the deploy fails *after* the
wipe, which is the worst place to find out.

`APP_URL` is the **local dev origin** for now, not the production one. Steps 7
and 8 run from a local `npm run dev` server pointed at production, because the
seed-import panel no longer ships in a production build (Step 8 says why), and
`APP_URL` is the single origin `/auth/google/callback` redirects back to and
the only one `/auth/refresh` allows through CORS. Step 9 points it back.

**What the detour breaks, so nothing surprises you.** `/auth/start` and the
OAuth `redirect_uri` come from `CONVEX_SITE_URL`, not `APP_URL`, so they are
unaffected; the `__Host-g_state` cookie is set and read on the HTTPS
`convex.site` origin and stays valid — do not "fix" either. But for the length
of this window anyone signing in on the production site is redirected to their
own `localhost:5173` and gets nothing, and every production browser's
`/auth/refresh` is blocked by CORS, so a user still holding a session silently
falls back to the public view. The database is empty anyway. Just do this when
nobody is using it.

Point the local dev server at production:

```bash
echo 'PUBLIC_CONVEX_URL=https://festive-lion-592.convex.cloud' >> .env.local
```

The appended line wins over the existing one (Vite takes the last occurrence).
Step 9 deletes it again.

- [ ] **Step 6: Deploy the new schema**

```bash
npx convex deploy
```

`deploy` is the one command that already defaults to production. Expected:
succeeds. A schema validation failure here means Step 4 left rows behind.

- [ ] **Step 7: Sign in and claim admin — BEFORE the import, not after**

`api.seed.importAll` opens with `requireAdmin` and Step 4 wiped the roster, so
the import cannot run until someone is an admin. Claiming admin needs a
signed-in identity. Hence this order — and do not swap them back, because
`claimFirstAdmin` refuses once any admin exists, so a retry in the other order
is unrecoverable.

Start the dev server, bound to this machine only — it is about to hold
production data and the whole seed dataset:

```bash
npx vite dev --host 127.0.0.1
```

Open `http://localhost:5173` and sign in through Google. You land as a viewer
with no name.

Now find your identity. Open the Convex dashboard for the **production**
deployment, look at the single row in `users`, and copy its `tokenIdentifier`
— it looks like `https://accounts.google.com|107812…`. The dashboard for production is
<https://dashboard.convex.dev/d/festive-lion-592>. Then:

```bash
npx convex run --prod \
  --identity '{"tokenIdentifier":"https://accounts.google.com|<your sub>"}' \
  migrate:claimFirstAdmin '{"secret":"'"$SECRET"'"}'
```

**`--identity` is not optional.** `convex run` authenticates with an admin key
and carries no *user* identity, so without it `requireActor` sees nobody and
the call fails with `Not signed in.` — which looks like a sign-in problem and
is not. If it still fails, set `role` to `admin` on your own row directly in
the dashboard; that is the only other way to mint the first admin.

- [ ] **Step 8: Import the dataset**

**From the local dev server, not the production site.** The seed-import panel
is development-only now. `$lib/data/teamData` carries `TEAM_CONTACTS` — the
adult sponsor contacts `contacts.list` gates behind `requireActor` — and
importing it from a component made SvelteKit emit it as a code-split chunk
hanging off the admin route node, which any anonymous visitor could fetch. The
panel was never *mounted* for a non-admin, but a chunk is not access control.
`import.meta.env.DEV` is a literal `false` in a production build, so neither
the panel nor the dataset is in one.

In the dev server's admin UI, open **Data**, check the counts it shows, type
`REPLACE ALL DATA`, and press the button.

The panel passes `actorLocalId: IMPORT_ACTOR_ID`. `importAll` replaces the
`users` table and writes **your own** `tokenIdentifier` onto that row rather
than whatever the payload carries, so you cannot lock yourself out with a
stale token and never handle a raw one. Omit the entry, duplicate it, or send
a second entry carrying your identity, and the whole transaction rolls back
with your existing row intact.

It writes 172 rows: grants 60, contacts 31, incomeDeposits 28, expenses 16,
sponsors 8, wishlist 8, sponsorOutreach 7, teamInfo 6, seasons 3, donors 3,
accounts 1, users 1 — plus one `auditLogs` row recording the import, which the
panel does not count. The panel reports what came back; that is the
confirmation. (Do not reach for `npx convex run seed:status` — `status` is
admin-only and would need `--identity` too.)

**Then reload `http://localhost:5173`.** Your role is fetched once at sign-in,
so until you refresh the browser still thinks you are a viewer and the admin
page will bounce you. If you re-run the claim from Step 7 it will say *"An
admin already exists."* — that means it worked.

Set your first name and last initial through the profile form, and re-enter the
HCB bank categorisations by hand (a couple of rows — the owner confirmed
re-entering them beats preserving them across the wipe).

- [ ] **Step 9: Point production back at itself**

```bash
npx convex env set --prod APP_URL "https://<production host>"
npx convex env get --prod APP_URL
```

Give the **exact origin, with scheme and no trailing path**. Anything
`new URL()` cannot parse — a bare `cacao.example.com` — makes `appOrigin()`
return null, and then the callback 500s and every refresh fails CORS with an
empty `Access-Control-Allow-Origin`, with no error anywhere you would look.

Stop the dev server and undo the `.env.local` edit — otherwise every later
`npm run dev` on this machine runs against production:

```bash
# delete the PUBLIC_CONVEX_URL line you appended in Step 5
```

- [ ] **Step 10: Delete the avatar blobs**

Spec §13 requires it and nothing else does it. Trunk's `users` carried
`avatarId: v.optional(v.id("_storage"))`; the new tree has no storage code at
all, so after the wipe nothing references those files and nothing in the app
can delete them — student photographs would simply sit in Convex storage.

In the Convex dashboard for production, open **Files** and delete everything
left there.

- [ ] **Step 11: Retire the bootstrap**

```bash
npx convex env remove --prod ADMIN_BOOTSTRAP_SECRET
```

Delete `claimFirstAdmin` from `convex/migrate.ts`, then **deploy again** —
removing it from the source tree changes nothing on the deployment:

```bash
npx convex deploy
```

- [ ] **Step 12: Delete the import scaffold**

The import has run. The contacts, sponsors, grants and deposits now live in
Convex, which is the point — so the seed payload and the machinery around it
are a second copy of that data with no remaining purpose, and this repository
is public.

`src/lib/data/teamData.ts` is already gitignored, so it never entered the
repo. Now remove the rest of it:

```bash
git rm -r scripts/import
git rm src/lib/components/admin/ImportSeedPanel.svelte \
       src/lib/components/admin/importPayload.ts \
       src/lib/components/admin/importPayload.test.ts \
       src/lib/components/admin/seedDatasetExposure.test.ts \
       convex/donorNames.test.ts
rm -rf src/lib/data
```

Then take the **Data** tab out of `src/lib/components/admin/AdminPanel.svelte`,
and drop the `generate:dataset` script from `package.json`.

Keep `convex/donorNames.ts` — `convex/donors.ts` and `src/lib/finance/donors.ts`
both use `normalizeDonorName` at runtime, so it is not scaffolding.

```bash
npx vitest run && npm run check && npm run build
```

All three clean, and now a fresh clone builds too — which it cannot do while
the scaffold references a gitignored dataset.

This is the same retirement `claimFirstAdmin` gets in Step 11: a one-shot tool
that becomes a liability the moment it stops being useful.

- [ ] **Step 13: Ship the frontend**

Production has been running the old Clerk build against a Google-only backend
since Step 6, so it is broken until this lands. Merge the branch and let Vercel
build; `build:vercel` runs `convex deploy --cmd 'npm run build'`, which is now
a no-op for the backend since Step 11 already deployed it.

Then verify on the production site, signed out and signed in:
- the public pages render with no names and no emails
- sign-in through Google works end to end
- your admin role is there after a reload
- the Data tab shows the development-only notice, not an import button

- [ ] **Step 14: Commit**

```bash
git add convex/migrate.ts convex/migrate.test.ts
git commit -m "feat(migrate): cutover bootstrap"
```

---

## Task 12: Client cutover and Clerk removal

**Files:**
- Delete: `src/lib/auth/clerk.svelte.ts`
- Create: `src/lib/auth/google.svelte.ts`
- Modify: `src/lib/stores/cacaoStore.svelte.ts:1247-1275`
- Modify: `src/routes/+page.svelte:77`
- Modify: `src/lib/components/admin/AdminPanel.svelte`
- Modify: `src/lib/components/analytics/FinancialsView.svelte:12-18`
- Modify: `package.json`

**Interfaces:**
- Consumes: `POST /auth/refresh` from Task 3; `api.users.*` from Task 7.
- Produces: `signIn()`, `signOut()`, `authState`, `fetchConvexToken()`.

- [ ] **Step 1: Write `src/lib/auth/google.svelte.ts`**

**This differs from the original plan text.** Tasks 2-3's security review found
that a client-generated `state` doubling as the session secret is an account
takeover path, so the server now owns both. The client never generates a
secret and never builds the Google URL:

```ts
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

const SESSION_KEY = 'cacao.session';
const convexSite = (env.PUBLIC_CONVEX_URL ?? '').replace('.convex.cloud', '.convex.site');

export const isAuthEnabled = convexSite.length > 0;
export const authState = $state({ loading: true, isSignedIn: false });

/**
 * Hand off to the server, which mints the CSRF `state`, binds it to this
 * browser with an HttpOnly cookie, and redirects on to Google. The client
 * deliberately holds no secret at this point -- one is issued only after
 * Google has verified who this is.
 */
export function signIn(): void {
  window.location.href = `${convexSite}/auth/start`;
}

/**
 * Collect the session secret the callback left in the URL fragment, then
 * scrub it from the address bar and history. A fragment never reaches a
 * server log, which is why the secret travels there rather than in a query.
 */
export function captureSessionFromRedirect(): void {
  if (!browser || !window.location.hash) return;
  const secret = new URLSearchParams(window.location.hash.slice(1)).get('session');
  if (!secret) return;
  localStorage.setItem(SESSION_KEY, secret);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  authState.isSignedIn = true;
}

export async function signOut(): Promise<void> {
  const secret = localStorage.getItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  authState.isSignedIn = false;
  // Drop the server row and its Google refresh token too -- clearing
  // localStorage alone would leave a live credential behind for 30 days.
  if (secret) {
    await fetch(`${convexSite}/auth/signout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret })
    }).catch(() => {});
  }
  window.location.href = '/';
}

/** Convex calls this whenever it needs a fresh ID token. */
export async function fetchConvexToken(): Promise<string | null> {
  if (!browser) return null;
  const secret = localStorage.getItem(SESSION_KEY);
  if (!secret) return null;

  const res = await fetch(`${convexSite}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret })
  });
  if (res.status === 401) {
    // Dead session: drop it. A 503 is Google being briefly unavailable --
    // keep the secret and let the next attempt succeed.
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  return token;
}
```

Confirm the exact route names and the fragment parameter against
`convex/http.ts` as committed — that file is the source of truth for this
contract, not this plan text.

- [ ] **Step 2: Repoint the store**

In `src/lib/stores/cacaoStore.svelte.ts`, swap the Clerk import for
`$lib/auth/google.svelte`. Leave `client.setAuth(fetchConvexToken, ...)` at
line 1267 — its contract is unchanged. Call `captureSessionFromRedirect()`
once on app load, before the first `setAuth`, so a browser returning from
Google picks up its secret. Remove every read of
`clerkState.email` and `clerkState.name`; the display name now comes from
`api.users.me`.

- [ ] **Step 3: Update the sign-in copy**

`src/routes/+page.svelte:77` reads "Sign in with your school Google account, or
with an email and password." Replace with "Sign in with your Google account."
There is no password path and no email is collected.

- [ ] **Step 4: Rebuild the admin feed and the season picker**

In `AdminPanel.svelte`, source pending members from `api.users.listRequests`
and wire the buttons to `approveRequest` / `declineRequest`. Remove every
column rendering an email, graduation year, or photograph — avatars become
initials from `displayName`.

In `FinancialsView.svelte`, delete the hardcoded `availableSeasons` array and
the `'2026-2027'` default; source both from `api.seasons.list`, defaulting to
`isCurrent`. Keep an "All time" option that passes no `seasonId`.

- [ ] **Step 5: Delete Clerk**

```bash
rm src/lib/auth/clerk.svelte.ts
npm uninstall @clerk/clerk-js
grep -rni "clerk" src convex package.json
```

Expected: no matches. Remove `PUBLIC_CLERK_PUBLISHABLE_KEY` from `.env` files.

- [ ] **Step 6: Verify and commit**

Run: `npm run check && npx vitest run && npm run build`

```bash
git add -A
git commit -m "feat(auth): replace Clerk with the openid-only Google flow"
```

---

## Task 13: Final verification

- [ ] **Step 1: No email column survives**

```bash
grep -niE "email" convex/schema.ts
```

Expected: only `contacts.email` and the `"email"` literal in
`preferredMethod` — adult sponsor contacts, deliberately retained and gated.

- [ ] **Step 2: No personal data reaches a stranger**

In a private browser window, signed out, open the site and check the network
tab for every query response. No `@`, no surname, no tracking number, no
receipt URL.

- [ ] **Step 3: The balances still reconcile**

The school account balance must match its value in
`snapshots/pre-pii-removal.zip`. The HCB balance must read as *measured* — or
*unavailable* if the API is down — never *computed*.

- [ ] **Step 4: The Sankey is unchanged**

Compare against a pre-migration screenshot for the same season. Totals and
category splits must be identical. **A doubled outgoing total means the HCB
dedup has broken** — `account` is no longer reaching `ledger.ts` as a slug.
Stop and fix.

- [ ] **Step 5: Re-enter the bank categorizations**

`hcbCategories` comes back empty — it was never in the spreadsheets. Re-file the
handful of misclassified bank transactions by hand in the ledger UI.

- [ ] **Step 6: Full suite**

Run: `npm run check && npx vitest run && npm run build`

- [ ] **Step 7: Tag**

```bash
git tag -a v0.5.0 -m "Remove student PII; openid-only auth; relational schema"
```
