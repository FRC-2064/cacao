# Removing student PII from Cacao

**Status:** approved design, not yet planned
**Date:** 2026-08-29

## Goal

Reduce the personal information Cacao stores to the minimum the app can
function on, and stop student email addresses from reaching our infrastructure
at all.

After this change the complete inventory of personal data in the database is:

| Where | What | Exposure |
|---|---|---|
| `users.firstName` + `lastInitial` | "Levi F" | gated |
| `donors.displayName` | donor names | public — already public on HCB |
| `contacts` | adult sponsor contacts | gated |

No student emails. No surnames. No photographs. No graduation years.

## Why

A Region 15 teacher raised that the app should not collect student personal
information. Two things are true:

1. **We are not currently a "contractor" under the CT Student Data Privacy Act**
   (CGS §§ 10-234aa–ff). That statute binds an operator or consultant *with a
   contract with a board of education*; a student-run team tool with no BoE
   contract and no district-supplied data is outside its terms. FERPA likewise
   binds the school as custodian of education records, not us. COPPA is
   under-13 only.
2. **The statutory definition of "student information" nevertheless describes
   exactly what we store** — "name, home address, telephone number, date of
   birth, email address, grades, test results, photographs, voice recordings."
   If the district ever adopts the app they are *required* to execute a Student
   Data Privacy Agreement with us, and under § 10-234bb a contract missing the
   required provisions is void.

So this is minimisation ahead of a requirement, not compliance with one. The
practical payoff: "what do you store about students?" becomes a one-sentence
answer.

### The bug this also fixes

`expenses.list`, `income.list`, `grants.list`, `wishlist.list`, and
`hcbCategories.list` are unauthenticated queries returning whole documents.
Student names and **three student email columns** (`expenses.requesterEmail`,
`incomeDeposits.loggedByEmail`, `hcbCategories.setByEmail`) are readable today
by anyone with the URL. The `PUBLIC_DATA` note in `convex/auth.ts` correctly
reasons the *money* should be public and that `users`/`auditLogs`/`contacts`
should be gated — the person stamps leaked into the public tables and were
never re-checked.

## Non-goals

- Grant field ergonomics (`currency`, `priority`, `deadlineType`,
  `deadlineNote`, `finishedAt`). No PII; deliberately deferred.
- A `categories` table. The taxonomy is stable and stays hardcoded in
  `src/lib/finance/categories.ts`.
- Reconciling HCB's measured balance against our computed one. See Risks.

---

## 1. Authentication

Remove `@clerk/clerk-js`. Clerk cannot be configured to never receive an email:
its account linking is keyed on the email an OAuth provider returns, and only
email, phone, and Web3 wallet work as sign-in identifiers.

Neither auth library is usable either:

- **`@convex-dev/auth` is React-only** — no plain JS/TS implementation
  (convex-auth#89). This is SvelteKit.
- **Better Auth**, the officially-suggested Svelte path, **hard-requires an
  email** on its user record (better-auth#9124, open). Same failure as Clerk.

So the OIDC flow is hand-rolled against Google directly.

### `convex/auth.config.ts`

```ts
export default {
  providers: [
    { domain: "https://accounts.google.com", applicationID: GOOGLE_CLIENT_ID },
  ],
};
```

Convex fetches `{domain}/.well-known/openid-configuration` to **discover** the
JWKS endpoint, so Google's certs living at `googleapis.com/oauth2/v3/certs`
rather than `accounts.google.com/.well-known/jwks.json` is not a problem.
Google sets `aud` to the OAuth client ID, which `applicationID` matches.

### `convex/http.ts`

Four endpoints. This section originally described two; the CSRF and
session-secret separation added `/auth/start`, and the client's `signOut()`
needs a server half.

**`GET /auth/start`** — mints the CSRF `state`, binds it to this browser in an
HttpOnly `__Host-` cookie, and redirects to Google. The browser never builds
the authorize URL and never holds a secret at this point: `state` and the
session secret are separate, server-minted values, because one value serving
as both is a full account-takeover path.

**`GET /auth/google/callback`** — receives `?code` and `?state`, verifies
`state` against the pending value (CSRF), then POSTs to
`https://oauth2.googleapis.com/token` with `client_id`, `client_secret`,
`code`, `redirect_uri`, `grant_type=authorization_code`. Google returns
`id_token` and `refresh_token`. Derive `tokenIdentifier` as `${iss}|${sub}`
from the ID token, create a session, and redirect to the app.

**`POST /auth/refresh`** — takes the session secret, exchanges the stored
refresh token at the same endpoint with `grant_type=refresh_token`, and returns
a fresh `id_token`. This backs `fetchConvexToken` in
`src/lib/stores/cacaoStore.svelte.ts:1267`, which already calls
`client.setAuth(...)`.

**`POST /auth/signout`** — takes the session secret, hashes it, and deletes
the matching row. Deliberately unauthenticated: holding the secret is the
authorization, and it has to work when the token can no longer be refreshed.
Always 204, whether or not a row existed -- a different status would tell an
attacker whether a stolen secret is still live. Without this route, signing
out clears the browser and leaves a live Google refresh token on the server
for the rest of the session's 30 days.

### `sessions`

```ts
sessions: defineTable({
  secretHash:      v.string(),   // SHA-256 of the session secret; never the secret
  refreshToken:    v.string(),
  tokenIdentifier: v.string(),
  expiresAt:       v.number(),
}).index("by_secret_hash", ["secretHash"])
```

Storing a Google refresh token is a deliberate, bounded liability: scoped to
`openid` alone, the only thing it can ever obtain is the user's `sub`. It
cannot read email, profile, Drive, or anything else.

### Client

The sign-in link is built with `scope=openid`, plus `access_type=offline` and
`prompt=consent` (both required for Google to issue a refresh token) and a
random `state`. `openid` alone returns an ID token carrying `sub` and nothing
else — no `email`, `name`, or `picture`. Google's own guidance is to use `sub`
as the identifier, since it is "unique among all Google Accounts and never
reused" while an account's email can change.

`getActor` / `requireActor` / `requireWriter` / `requireAdmin` in
`convex/auth.ts` keep their signatures. Only the lookup underneath changes.

### Environment

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Convex environment
variables, plus `APP_URL`. `redirect_uri` is built from `CONVEX_SITE_URL`,
which the platform already provides.

The frontend needs **no** Google configuration. An earlier draft of this
section called for a `PUBLIC_GOOGLE_CLIENT_ID`, which assumed the browser
would build the authorize URL itself. It does not: `GET /auth/start` builds
it server-side, precisely so the client holds no part of the OAuth exchange.
Do not reintroduce the variable -- nothing would read it.

## 2. `users`

```ts
users: defineTable({
  tokenIdentifier: v.string(),           // `${iss}|${sub}` from Google. Opaque.
  firstName:    v.optional(v.string()),  // "Levi"
  lastInitial:  v.optional(v.string()),  // "F" — validated to length 1
  role:         roleValidator,           // admin | student | viewer
  requested:    v.boolean(),
  approvedById: v.optional(v.id("users")),
  approvedAt:   v.optional(v.number()),
}).index("by_token_identifier", ["tokenIdentifier"])
```

Removed: `name`, `email`, `lastName`, `imageUrl`, `avatarId`, `password`,
`gradYear`, `status`, `requestReason`, `createdAt`, `lastActiveAt`.

`tokenIdentifier` is kept rather than a bare `subject`: the Convex guidelines
state it is the canonical stable identifier and that `identity.subject` must
not be used alone as a global identity key. The existing schema comment gives
the concrete reason — a row claimed against a development issuer could
otherwise be matched by a production token.

`lastInitial` is its own one-character column deliberately: **there is no
column a surname fits in.** The privacy property is enforced by the schema
rather than by convention.

`graduated` leaves both the role and status enums — graduating sets
`role: "viewer"`. `status` goes entirely: active is the absence of anything
else, pending is `requested === true`. A declined request sets `requested` back
to `false`, which lets the student ask again — deliberate, since the only
expected rejections are obvious junk, and an accidental denial must be
recoverable.

### Access flow

Signing in creates a row holding an opaque token identifier and `role: "viewer"` — no
name, no gate, no PII. A viewer who wants edit rights supplies a first name and
last initial, which sets `requested: true` and surfaces them in the admin feed.
Approving sets `role: "student"` and stamps `approvedById` / `approvedAt`.

## 3. Person references

Thirteen name/email columns become `v.id("users")`:

| Was | Becomes |
|---|---|
| `grants.assigneeName` + `assigneeId: v.string()` | `assigneeId: v.id("users")` |
| `grants.finishedBy` | `finishedById` |
| `grants.lastModifiedBy` | *deleted* — `auditLogs` records it |
| `expenses.requesterName` + `requesterEmail` | `requesterId` |
| `expenses.purchaserName` | `purchaserId` |
| `expenses.approvedBy` | `approvedById` |
| `incomeDeposits.loggedByName` + `loggedByEmail` | `loggedById` |
| `hcbCategories.setByName` + `setByEmail` | `setById` |
| `teamInfo.updatedBy` | `updatedById` |
| `accounts.updatedBy` | `updatedById` |
| `wishlist.requestedByName` | *deleted* |
| `auditLogs.actorName` + `actorEmail` + `actorRole` | `userId` |
| `users.approvedBy: v.string()` | `approvedById: v.id("users")` |

`grants.by_assignee` is currently indexed on `assigneeName` and is rebuilt on
`assigneeId`.

Resolution idiom: load the roster once into a `Map`, then map over rows. One
extra query, not N.

## 4. `accounts` — and a slug that must not be skipped

`expenses.account` and `incomeDeposits.depositAccount` become
`accountId: v.id("accounts")` (absent on an expense = the old `"none"`).

**`accounts` gains a `key` column** (`"hcb_bank" | "school_account"`).
This is load-bearing, not cosmetic. `src/lib/finance/ledger.ts:247` reads:

```ts
claimsHcb: e.account === 'hcb_bank' || e.paymentMethod === 'hcb_card'
```

That comparison drives the dedup collapsing a hand-logged expense against the
live HCB transaction that paid it. Compared against a generated Convex ID it
silently goes false, dedup stops firing, every HCB-paid expense counts twice,
and the Sankey shows inflated totals that look entirely plausible — no error,
no failing test. Convex IDs also differ between dev and prod, so an ID could
never be hardcoded anyway.

**Rule: references for storage, slug for logic.** A regression test on
`claimsHcb` is required.

## 5. `donors`

```ts
donors: defineTable({
  displayName:   v.string(),
  normalizedKey: v.string(),
  isAnonymous:   v.boolean(),
}).index("by_key", ["normalizedKey"])
```

`expenses.donorName` and `incomeDeposits.donorName` become
`donorId: v.optional(v.id("donors"))`.

`src/lib/finance/donors.ts` currently joins gifts by fuzzy-matching name
strings — lowercasing, stripping honorifics, `&`→`and` — because "nothing links
them but the donor's name." `normalizeDonorName` is kept but moves from a
**join-time heuristic re-run on every page load** to an **ingestion-time
find-or-create**: when HCB hands us a name, resolve or create the donor row
once. Two spellings of one person become one row that can be merged by hand.

Donor names stay public; they are already public on HCB.

## 6. `sponsors` and `contacts`

- `sponsors.primaryContactName` / `primaryContactEmail` → `primaryContactId:
  v.optional(v.id("contacts"))`. These are currently **public** while the
  `contacts` table holding the same adult's details is gated.
- `contacts.sponsorName` deleted; `contacts.sponsorId` becomes
  `v.optional(v.id("sponsors"))`.
- The public sponsor view gets a "View contact" control that only resolves for
  a signed-in writer.

## 7. `sponsorOutreach`

`sponsors.annualHistory[]` splits out:

```ts
sponsorOutreach: defineTable({
  sponsorId:     v.id("sponsors"),
  year:          v.number(),
  status:        outreachStatusValidator,
  amount:        v.optional(v.number()),
  notes:         v.optional(v.string()),
  contactedDate: v.optional(v.string()),
}).index("by_sponsor", ["sponsorId"]).index("by_year", ["year"])
```

Convex indexes only top-level fields, so as an embedded array "who did we
contact in 2024?" cannot be asked across sponsors.

**`grants.requirements[]` stays embedded** — owned by one grant, never queried
independently, always read with its parent, and updated in the same transaction
for free. The rule: split when the child is queried independently or shared;
embed when it is owned and always read with its parent.

## 8. `seasons`

```ts
seasons: defineTable({
  label:     v.string(),   // "2026-2027"
  startDate: v.string(),
  endDate:   v.string(),
  isCurrent: v.boolean(),
}).index("by_current", ["isCurrent"])
```

`season: v.string()` on `grants`, `expenses`, `incomeDeposits` becomes
`seasonId: v.id("seasons")`. The `season` argument on `grants.list:15`,
`income.list:9`, and `expenses.list:16` becomes `v.optional(v.id("seasons"))`,
with the existing `"all"` case expressed as an absent argument. The hardcoded
dropdown in `FinancialsView.svelte:12-18` becomes a query.

## 9. `auditLogs`

```ts
auditLogs: defineTable({
  userId:     v.id("users"),
  action:     auditActionValidator,
  entityType: entityTypeValidator,
  entityId:   v.string(),
  change:     v.optional(v.object({
    field: v.string(),
    from:  v.string(),
    to:    v.string(),
  })),
}).index("by_user", ["userId"])
```

Time is `_creationTime`. Removed: `actorName`, `actorEmail`, `actorRole`,
`entityName`, `summary`, `details`.

`entityId` stays `v.string()`: it points at six different tables depending on
`entityType`, and Convex has no polymorphic ID type.

**Accepted loss:** `entityName` is resolved at read time, so a *deleted* entity
can no longer be named and old rows read as "deleted grant".

## 10. `_creationTime`

Every `createdAt: v.number()` column is deleted in favour of Convex's built-in
`_creationTime`. The value is load-bearing — `src/lib/finance/balances.ts` and
`ledger.ts` sort the ledger by it, with tests — so this is a swap, not a
removal.

## 11. Access control

- Restore the `PUBLIC_DATA` intent: public list queries strip person references
  for unauthenticated callers. Signed-in callers resolve them to "Levi F".
- `expenses.trackingNumber`, `carrier`, and `receiptUrl` become **admin-only**.
  A tracking number looked up on a carrier's site frequently reveals the
  destination address, and receipt images usually carry a buyer name.
- `contacts` stays gated. `sponsors` contact details are no longer duplicated
  onto a public row.

## 12. Validators

`convex/validators.ts` changes to match:

- `roleValidator` drops `"graduated"` → `admin | student | viewer`.
- `userStatusValidator` is **deleted** (§2 removes `status`).
- `entityTypeValidator` is **extracted** from the inline union currently in
  `schema.ts`, since §9 references it by name.
- `accountValidator`, `expenseAccountValidator`, `depositAccountValidator` are
  deleted as *stored* types — the values move to `accounts.key`. The
  `Account` / `ExpenseAccount` types in `src/lib/finance/categories.ts` stay,
  because §4 keeps slugs for logic.
- `actorArgs` is deleted. It takes `actorName` / `actorEmail` / `actorRole`
  from the client; §3 replaces all three with a server-derived `userId`.

`src/lib/types.ts` mirrors each of these — `validators.ts` notes the three
files must be kept in step.

## 13. Migration

Single mutation, run once:

1. Truncate `auditLogs`.
2. Null every person stamp; drop the dead columns.
3. Delete avatar blobs from Convex storage.
4. Seed `accounts.key`, `seasons`, and `donors` from existing values.
5. Re-point `season`, `account`, and `donorName` columns to the new refs.

The money survives untouched: grants, expenses, deposits, amounts, vendors,
categories, receipts. Only actor stamps are cleared. Every existing stamp names
the single person who has made every change to date, so nothing is lost that
anyone else could have needed.

**Admin bootstrap.** The current admin row is keyed to a Clerk subject that
will not exist after cutover. A one-time, env-var-guarded mutation grants
`admin` to the first Google subject to sign in. Without it the deployment locks
everyone out.

## Risks

| Risk | Mitigation |
|---|---|
| `claimsHcb` literal comparison breaks silently, double-counting HCB expenses | `accounts.key` slug + regression test (§4) |
| Convex rejects Google's ID token (JWKS discovery, `aud` mismatch) | Verify end-to-end in Task 1 before building on it (§1) |
| Admin lockout at cutover | Bootstrap mutation (§12) |
| HCB balance treated as computable | Preserve per-account behaviour (below) |

**HCB balances must stay measured, not computed.** `hcb_bank` transactions are
fetched live and never written to `deposits` or `expenses`, so summing local
rows for that account sums an empty set. `school_account` is computed from
rows; `hcb_bank` is read from the API; an unreachable API means the balance is
*unknown*, not wrong. An earlier version compared the two and produced a
standing "off by $214.81" warning that only meant "we do not keep books for
this account." This looks like a bug and must not be "fixed" back into one.

**The Sankey is unaffected.** `FinancialsView.svelte:36-37` derives it from
`incomeByCategory` / `expensesByCategory` keyed on category slugs, with labels
and colours from `INCOME_CATEGORY_META` / `EXPENSE_CATEGORY_META`. It reads no
person field. Since the taxonomy stays hardcoded, those lookups are untouched.

## Testing

- Regression test on `claimsHcb` with `accountId` refs in play (§4).
- Ledger and balance tests continue to pass against `_creationTime`.
- Auth: a token with no `email` claim produces a working session.
- Access: unauthenticated reads of every public list query return no person
  reference, no tracking number, and no receipt URL.
- Migration is idempotent, or guarded against a second run.

## Follow-up, outside this spec

Sign the CT uniform student-data-privacy terms-of-service addendum (§ 10-234ff)
with Region 15 and get logged in their contract log, if the district adopts the
app. Contact: Russ Sage, Director of IT.
