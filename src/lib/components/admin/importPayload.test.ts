import { describe, it, expect } from 'vitest';
import * as teamData from '$lib/data/teamData';
import type { SeedUser } from '$lib/data/teamData';
import {
  actorSeedEntry,
  buildImportPayload,
  importPayloadProblems,
  payloadRowCounts,
  type SeedDataset
} from './importPayload';

const ADMIN = { firstName: 'Levi', lastInitial: 'F' };

describe('the seed import payload', () => {
  it('sends every collection importAll declares, and asks to replace', () => {
    const payload = buildImportPayload(teamData, ADMIN);

    // The argument names are the mutation's, not the dataset's. A missing one
    // is a whole table silently not imported; a spare one is rejected at
    // runtime, because Convex refuses an argument it does not declare.
    expect(Object.keys(payload).sort()).toEqual(
      [
        'accounts',
        'actorLocalId',
        'contacts',
        'donors',
        'expenses',
        'grants',
        'incomeDeposits',
        'replace',
        'seasons',
        'sponsorOutreach',
        'sponsors',
        'teamInfo',
        'users',
        'wishlist'
      ].sort()
    );

    // Without this a non-empty deployment is left alone, which is not what a
    // control called "replace all data" can be allowed to do quietly.
    expect(payload.replace).toBe(true);
    expect(payload.actorLocalId).toBe(teamData.IMPORT_ACTOR_ID);
  });

  it('carries the real dataset, not an empty shell', () => {
    const payload = buildImportPayload(teamData, ADMIN);
    expect(payload.seasons).toBe(teamData.TEAM_SEASONS);
    expect(payload.grants.length).toBeGreaterThan(0);
    expect(payload.expenses.length).toBeGreaterThan(0);
    expect(payload.incomeDeposits.length).toBeGreaterThan(0);
    expect(payload.contacts.length).toBeGreaterThan(0);
  });

  it('adds exactly one users entry, and it is the importing admin', () => {
    const payload = buildImportPayload(teamData, ADMIN);
    const mine = payload.users.filter((u) => u._id === payload.actorLocalId);

    expect(mine).toHaveLength(1);
    expect(payload.users).toHaveLength(teamData.TEAM_USERS.length + 1);
    expect(mine[0].firstName).toBe('Levi');
    expect(mine[0].lastInitial).toBe('F');
  });

  it('sends no token identifier, because importAll overwrites it anyway', () => {
    // Sending a real one is not merely redundant. A wrong one would hand the
    // deployment to nobody, unrecoverably and without an error -- and the
    // browser cannot read its own token to send a right one.
    const entry = actorSeedEntry('import_actor', ADMIN);
    expect(entry.tokenIdentifier).toBe('');
  });

  it('counts the actor entry in the users figure it shows before writing', () => {
    const payload = buildImportPayload(teamData, ADMIN);
    const counts = payloadRowCounts(payload);
    const byTable = Object.fromEntries(counts.map((c) => [c.table, c.rows]));

    expect(byTable.users).toBe(teamData.TEAM_USERS.length + 1);
    expect(byTable.grants).toBe(teamData.TEAM_GRANTS.length);
    // `actorLocalId` and `replace` are not collections and must not appear.
    expect(counts.map((c) => c.table)).not.toContain('replace');
    expect(counts).toHaveLength(12);
  });

  it('finds nothing wrong with the payload it builds', () => {
    expect(importPayloadProblems(buildImportPayload(teamData, ADMIN))).toEqual([]);
  });
});

describe('the lockout shapes importPayloadProblems can see', () => {
  const other: SeedUser = {
    _id: 'someone_else',
    tokenIdentifier: 'https://accounts.google.com|111',
    role: 'student',
    requested: false
  };

  function datasetWith(users: SeedUser[]): SeedDataset {
    return { ...teamData, TEAM_USERS: users };
  }

  it('rejects a dataset that already carries the actor local id', () => {
    // Both entries would be written with the caller's identity, and every
    // later request would then throw on `getActor`'s `.unique()`.
    const payload = buildImportPayload(
      datasetWith([{ ...other, _id: teamData.IMPORT_ACTOR_ID }]),
      ADMIN
    );
    expect(importPayloadProblems(payload).join(' ')).toContain(teamData.IMPORT_ACTOR_ID);
  });

  it('rejects two entries sharing one _id', () => {
    const payload = buildImportPayload(datasetWith([other, { ...other }]), ADMIN);
    expect(importPayloadProblems(payload)).toContain('Two users entries share one _id.');
  });

  it('rejects two entries sharing one tokenIdentifier', () => {
    const payload = buildImportPayload(
      datasetWith([other, { ...other, _id: 'a_third_person' }]),
      ADMIN
    );
    expect(importPayloadProblems(payload)).toContain(
      'Two users entries share one tokenIdentifier.'
    );
  });

  it('does not count the actor entry towards the token collision check', () => {
    // Its placeholder token is discarded server-side, so a second entry with a
    // blank token is not a collision with it -- but two of *those* would be.
    const payload = buildImportPayload(datasetWith([{ ...other, tokenIdentifier: '' }]), ADMIN);
    expect(importPayloadProblems(payload)).toEqual([]);
  });

  it('reports a payload naming an actor row that is not there', () => {
    const problems = importPayloadProblems({ users: [other], actorLocalId: 'import_actor' });
    expect(problems.join(' ')).toContain('no users entry');
  });
});
