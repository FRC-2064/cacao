import type { SeedUser } from '$lib/data/teamData';

/**
 * Assembling the `api.seed.importAll` payload, kept out of the component so
 * it can be tested without a deployment.
 *
 * The contract this satisfies is the one written at the top of
 * `src/lib/data/teamData.ts`, and it is not a tidiness preference: three of
 * the four shapes it forbids end with `getActor`'s `.unique()` throwing on
 * every later request, for everyone, with no way back in through the app --
 * `auth.ensureUser` only ever writes `role: "viewer"` and `users.setUserRole`
 * needs an admin, so nothing can mint one. Recovery is the Convex dashboard.
 *
 * `importAll` refuses all four itself. Checking them here as well is not
 * belt-and-braces for its own sake: the three that are checkable client-side
 * are checkable *before* an admin types a destructive confirmation, so the
 * answer is a sentence on the screen rather than a rolled-back transaction and
 * a redacted "Server Error" from production Convex.
 */

/** The value exports of `$lib/data/teamData`, as loaded at runtime. */
export type SeedDataset = typeof import('$lib/data/teamData');

/** The name parts written onto the importing admin's own rebuilt roster row. */
export interface ImportingAdmin {
  firstName?: string;
  lastInitial?: string;
}

/**
 * The importing admin's roster row.
 *
 * `tokenIdentifier` and `role` are placeholders and are meant to be. For the
 * entry named by `actorLocalId`, `importAll` discards both and writes the row
 * from the caller's own authenticated identity with `role: "admin"` -- which
 * is precisely why no caller has to know or transmit a raw token identifier,
 * and why a stale or wrong one cannot hand the deployment to nobody. The
 * browser has no way to read its own token either, so there is nothing to look
 * up even if it were wanted.
 */
export function actorSeedEntry(actorLocalId: string, admin: ImportingAdmin): SeedUser {
  return {
    _id: actorLocalId,
    tokenIdentifier: '',
    role: 'admin',
    requested: false,
    firstName: admin.firstName,
    lastInitial: admin.lastInitial
  };
}

/**
 * Every argument `api.seed.importAll` declares, with `replace: true` -- the
 * mutation leaves a non-empty deployment alone without it, and this control
 * exists to overwrite one.
 */
export function buildImportPayload(dataset: SeedDataset, admin: ImportingAdmin) {
  return {
    seasons: dataset.TEAM_SEASONS,
    donors: dataset.TEAM_DONORS,
    users: [...dataset.TEAM_USERS, actorSeedEntry(dataset.IMPORT_ACTOR_ID, admin)],
    accounts: dataset.TEAM_ACCOUNTS,
    sponsors: dataset.TEAM_SPONSORS,
    contacts: dataset.TEAM_CONTACTS,
    sponsorOutreach: dataset.TEAM_SPONSOR_OUTREACH,
    grants: dataset.TEAM_GRANTS,
    expenses: dataset.TEAM_EXPENSES,
    incomeDeposits: dataset.TEAM_INCOME_DEPOSITS,
    teamInfo: dataset.TEAM_INFO,
    wishlist: dataset.TEAM_WISHLIST,
    actorLocalId: dataset.IMPORT_ACTOR_ID,
    replace: true as const
  };
}

/**
 * Row counts per table, in the order `importAll` declares them, for the
 * "will write" column. Derived from the payload rather than from the dataset
 * so the `users` figure includes the actor entry that is actually sent.
 */
export function payloadRowCounts(
  payload: ReturnType<typeof buildImportPayload>
): { table: string; rows: number }[] {
  return Object.entries(payload as Record<string, unknown>).flatMap(([table, rows]) =>
    Array.isArray(rows) ? [{ table, rows: rows.length }] : []
  );
}

/**
 * The lockout shapes that can be detected without knowing the caller's real
 * `tokenIdentifier`. Empty means nothing here can be seen to be wrong; it is
 * not a promise the mutation will accept the payload, since check 3 -- a
 * second entry carrying the caller's own identity -- is only answerable
 * server-side.
 */
export function importPayloadProblems(payload: { users: SeedUser[]; actorLocalId: string }): string[] {
  const problems: string[] = [];
  const { users, actorLocalId } = payload;

  const actorEntries = users.filter((u) => u._id === actorLocalId);
  if (actorEntries.length === 0) {
    problems.push(
      `The payload has no users entry with _id "${actorLocalId}" to carry the importing admin.`
    );
  } else if (actorEntries.length > 1) {
    problems.push(
      `The payload has ${actorEntries.length} users entries with _id "${actorLocalId}". Every one of them would be written with your identity, which locks this deployment.`
    );
  }

  const ids = users.map((u) => u._id);
  if (new Set(ids).size !== ids.length) {
    problems.push('Two users entries share one _id.');
  }

  // The actor's entry is excluded: its placeholder token is discarded and
  // replaced with the caller's real one, so it cannot collide with anything.
  const tokens = users.filter((u) => u._id !== actorLocalId).map((u) => u.tokenIdentifier);
  if (new Set(tokens).size !== tokens.length) {
    problems.push('Two users entries share one tokenIdentifier.');
  }

  return problems;
}
