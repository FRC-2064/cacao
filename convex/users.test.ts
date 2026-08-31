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

describe('publicUserFields is a real allowlist', () => {
  /**
   * A row with every private column populated -- tokenIdentifier from
   * sign-in, approvedById/approvedAt from being approved -- so an absence
   * assertion below is actually exercising something, not passing vacuously
   * against an empty field.
   */
  async function approvedStudent(t: ReturnType<typeof convexTest>) {
    const admin = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|allow-admin' });
    await admin.mutation(api.auth.ensureUser, {});
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('users').collect();
      await ctx.db.patch('users', rows[0]._id, { role: 'admin' });
    });

    const student = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|allow-student' });
    const studentId = await student.mutation(api.auth.ensureUser, {});
    await student.mutation(api.users.requestEditAccess, { firstName: 'Rae', lastInitial: 'T' });
    await admin.mutation(api.users.approveRequest, { userId: studentId });

    return { admin, student, studentId };
  }

  test('me exposes only the allowlisted fields', async () => {
    const t = convexTest(schema);
    const { student } = await approvedStudent(t);

    const row = await student.query(api.users.me, {});
    expect(row).toMatchObject({
      firstName: 'Rae',
      lastInitial: 'T',
      displayName: 'Rae T',
      role: 'student',
      requested: false,
    });
    // A rest-spread would leak all three of these; the allowlist must not.
    expect(row).not.toHaveProperty('tokenIdentifier');
    expect(row).not.toHaveProperty('approvedById');
    expect(row).not.toHaveProperty('approvedAt');
  });

  test('listUsers exposes only the allowlisted fields', async () => {
    const t = convexTest(schema);
    const { student, studentId } = await approvedStudent(t);

    const rows = await student.query(api.users.listUsers, {});
    const row = rows.find((r) => r._id === studentId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      firstName: 'Rae',
      lastInitial: 'T',
      displayName: 'Rae T',
      role: 'student',
      requested: false,
    });
    expect(row).not.toHaveProperty('tokenIdentifier');
    expect(row).not.toHaveProperty('approvedById');
    expect(row).not.toHaveProperty('approvedAt');
  });

  test('me returns null for an unauthenticated caller', async () => {
    const t = convexTest(schema);
    const row = await t.query(api.users.me, {});
    expect(row).toBeNull();
  });
});

describe('approveRequest never demotes a non-viewer', () => {
  async function signIn(t: ReturnType<typeof convexTest>, sub: string) {
    const as = t.withIdentity({ tokenIdentifier: `https://accounts.google.com|${sub}` });
    const userId = await as.mutation(api.auth.ensureUser, {});
    return { as, userId };
  }

  test('approving a viewer promotes to student and audits from: "viewer"', async () => {
    const t = convexTest(schema);
    const { as: admin } = await signIn(t, 'promote-admin');
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('users').collect();
      await ctx.db.patch('users', rows[0]._id, { role: 'admin' });
    });

    const { as: viewer, userId: viewerId } = await signIn(t, 'promote-viewer');
    await viewer.mutation(api.users.requestEditAccess, { firstName: 'Rae', lastInitial: 'T' });
    await admin.mutation(api.users.approveRequest, { userId: viewerId });

    const row = await t.run((ctx) => ctx.db.get('users', viewerId));
    expect(row?.role).toBe('student');
    expect(row?.requested).toBe(false);

    const logs = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    const entry = logs.find((l) => l.entityId === viewerId);
    expect(entry?.change).toEqual({ field: 'role', from: 'viewer', to: 'student' });
  });

  test('approving a user who is already an admin does not demote them', async () => {
    const t = convexTest(schema);
    const { as: admin, userId: adminId } = await signIn(t, 'self-admin');
    await t.run(async (ctx) => {
      await ctx.db.patch('users', adminId, { role: 'admin' });
    });

    // requestEditAccess has no role gate -- an admin can set `requested: true`
    // on their own row, same as anyone else.
    await admin.mutation(api.users.requestEditAccess, { firstName: 'Levi', lastInitial: 'F' });
    await admin.mutation(api.users.approveRequest, { userId: adminId });

    const row = await t.run((ctx) => ctx.db.get('users', adminId));
    expect(row?.role).toBe('admin');
    expect(row?.requested).toBe(false);
  });

  test('the audit row for a non-viewer records the real prior role, not a hardcoded "viewer"', async () => {
    const t = convexTest(schema);
    const { as: admin, userId: adminId } = await signIn(t, 'audit-admin');
    await t.run(async (ctx) => {
      await ctx.db.patch('users', adminId, { role: 'admin' });
    });

    await admin.mutation(api.users.requestEditAccess, { firstName: 'Levi', lastInitial: 'F' });
    await admin.mutation(api.users.approveRequest, { userId: adminId });

    const logs = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    const entry = logs.find((l) => l.entityId === adminId);
    expect(entry?.change).toEqual({ field: 'role', from: 'admin', to: 'admin' });
  });
});
