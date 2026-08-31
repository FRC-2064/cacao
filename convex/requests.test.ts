import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

/** A signed-in admin, with a roster row already promoted to `admin`. */
async function withAdmin(t: ReturnType<typeof convexTest>, tokenIdentifier: string) {
  const as = t.withIdentity({ tokenIdentifier });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'admin' });
  });
  return { as, userId };
}

test('a request records a truncated initial and surfaces to admins', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin1');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer1' });
  await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, {
    firstName: 'Levi',
    lastInitial: 'Fitzpatrick',
  });

  const requests = await admin.query(api.users.listRequests, {});
  expect(requests).toHaveLength(1);
  expect(requests[0].firstName).toBe('Levi');
  // The server truncates, regardless of what the form sent.
  expect(requests[0].lastInitial).toBe('F');
  expect(requests[0].requested).toBe(true);
  expect(requests[0].displayName).toBe('Levi F');
});

test('approving promotes to student', async () => {
  const t = convexTest(schema);
  const { as: admin, userId: adminId } = await withAdmin(t, 'https://accounts.google.com|admin2');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer2' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Ada', lastInitial: 'L' });

  await admin.mutation(api.users.approveRequest, { userId: viewerId });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.role).toBe('student');
    expect(row?.requested).toBe(false);
    expect(row?.approvedById).toBe(adminId);
    expect(row?.approvedAt).toBeTypeOf('number');
  });
});

test('declining clears the flag so the student can ask again', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin3');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer3' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Grace', lastInitial: 'H' });

  await admin.mutation(api.users.declineRequest, { userId: viewerId });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.requested).toBe(false);
    // Declining is not demotion -- there was nothing to demote from yet.
    expect(row?.role).toBe('viewer');
  });

  // Nothing about a decline stops the student from asking again.
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Grace', lastInitial: 'H' });
  const requests = await admin.query(api.users.listRequests, {});
  expect(requests.some((r) => r._id === viewerId)).toBe(true);
});

/**
 * What a person actually types is the half of this branch's privacy claim that
 * nothing defended.
 *
 * `convex/auth.ts` states the property the whole change rests on -- "a first
 * name and last initial only enter once someone asks for edit access" -- and
 * the request form's own copy promises "No surname, no email address, no
 * photo." `lastInitial` is truncated to one character server-side, so a
 * surname cannot get in that way. `firstName` had no cap and no shape check at
 * all: `a.student@example.org` stored verbatim and rendered to every signed-in
 * member through `listUsers`, the request card, and `requesterName` /
 * `purchaserName` / `assigneeName` on every expense and grant.
 *
 * Rejected rather than truncated: a silently shortened name is a name the
 * person cannot see was wrong, and the thrown message is what the form shows.
 */
describe('what a first name is allowed to be', () => {
  const asViewer = async (t: ReturnType<typeof convexTest>, who: string) => {
    const as = t.withIdentity({ tokenIdentifier: `https://accounts.google.com|${who}` });
    const userId = await as.mutation(api.auth.ensureUser, {});
    return { as, userId };
  };

  /**
   * The stored `firstName`, or `'unset'` when the column is genuinely absent.
   * Not returned raw: a Convex function that returns `undefined` answers
   * `null`, so "no name at all" and "an empty name" would arrive
   * indistinguishable -- and this block is about exactly that difference.
   */
  const storedName = async (t: ReturnType<typeof convexTest>, userId: Id<'users'>) =>
    await t.run(async (ctx) => {
      const row = await ctx.db.get('users', userId);
      if (!row) return 'missing';
      return 'firstName' in row ? String(row.firstName) : 'unset';
    });

  test('an email address is refused, and nothing is stored', async () => {
    const t = convexTest(schema);
    const { as, userId } = await asViewer(t, 'autofill');

    // The browser autofilling a school email into a field near a sign-in is
    // the realistic way this happens, not somebody being difficult.
    await expect(
      as.mutation(api.users.requestEditAccess, {
        firstName: 'a.student@example.org',
        lastInitial: 'S',
      })
    ).rejects.toThrow(/email/i);

    expect(await storedName(t, userId)).toBe('unset');
    await t.run(async (ctx) => {
      expect(JSON.stringify(await ctx.db.get('users', userId))).not.toContain('@');
      expect((await ctx.db.get('users', userId))?.requested).toBe(false);
    });
  });

  test('a full name is refused -- the surname has nowhere to go', async () => {
    const t = convexTest(schema);
    const { as, userId } = await asViewer(t, 'freshman');

    await expect(
      as.mutation(api.users.requestEditAccess, {
        firstName: 'Levi Fitzpatrick',
        lastInitial: 'F',
      })
    ).rejects.toThrow(/surname|first name only/i);

    expect(await storedName(t, userId)).toBe('unset');
  });

  test('an unbounded paste is refused', async () => {
    const t = convexTest(schema);
    const { as, userId } = await asViewer(t, 'paste');

    await expect(
      as.mutation(api.users.requestEditAccess, {
        firstName: 'a'.repeat(500),
        lastInitial: 'B',
      })
    ).rejects.toThrow(/characters/i);

    expect(await storedName(t, userId)).toBe('unset');
  });

  test('a real first name still gets through, hyphens and apostrophes included', async () => {
    const t = convexTest(schema);
    for (const [who, name] of [
      ['plain', 'Levi'],
      ['hyphen', 'Anne-Marie'],
      ['apostrophe', "O'Brien"],
      ['accents', 'José'],
    ] as const) {
      const { as, userId } = await asViewer(t, who);
      await as.mutation(api.users.requestEditAccess, { firstName: name, lastInitial: 'X' });
      expect(await storedName(t, userId)).toBe(name);
    }
  });

  test('updateOwnProfile enforces the same rule', async () => {
    const t = convexTest(schema);
    const { as, userId } = await asViewer(t, 'writer');
    await t.run(async (ctx) => {
      await ctx.db.patch('users', userId, { role: 'student', firstName: 'Ada' });
    });

    await expect(
      as.mutation(api.users.updateOwnProfile, { firstName: 'ada.l@example.org' })
    ).rejects.toThrow(/email/i);
    await expect(
      as.mutation(api.users.updateOwnProfile, { firstName: 'Ada Lovelace' })
    ).rejects.toThrow(/surname|first name only/i);

    expect(await storedName(t, userId)).toBe('Ada');
  });

  test('a writer can still take their own name back off the roster', async () => {
    const t = convexTest(schema);
    const { as, userId } = await asViewer(t, 'erase');
    await t.run(async (ctx) => {
      await ctx.db.patch('users', userId, { role: 'student', firstName: 'Ada' });
    });

    // Emptying the field is a deliberate act, not a malformed name -- on a
    // branch about storing less, removing your own name has to stay possible.
    await as.mutation(api.users.updateOwnProfile, { firstName: '' });
    expect(await storedName(t, userId)).toBe('');
  });
});

test('declining takes the name back off the row', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin-decline');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|declined' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Grace', lastInitial: 'H' });

  await admin.mutation(api.users.declineRequest, { userId: viewerId });

  // A refused student is back to what a bare sign-in holds: an opaque
  // identifier and nothing else. Clearing only `requested` left their name on
  // the roster indefinitely, visible to every signed-in member, for an account
  // that was turned down.
  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.firstName).toBeUndefined();
    expect(row?.lastInitial).toBeUndefined();
    expect(row?.requested).toBe(false);
  });

  const roster = await admin.query(api.users.listUsers, {});
  expect(roster.find((u) => u._id === viewerId)?.displayName).toBe('Unnamed member');
});

test('a non-admin cannot approve', async () => {
  const t = convexTest(schema);
  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer4' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Noor', lastInitial: 'K' });

  await expect(
    viewer.mutation(api.users.approveRequest, { userId: viewerId })
  ).rejects.toThrow();

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.role).toBe('viewer');
    expect(row?.requested).toBe(true);
  });
});

test('an admin can promote a viewer to admin', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin5');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer5' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});

  await admin.mutation(api.users.setUserRole, { userId: viewerId, role: 'admin' });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.role).toBe('admin');
  });
});

test('an admin can set a student back to viewer', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin6');

  const student = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|student6' });
  const studentId = await student.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', studentId, { role: 'student' });
  });

  await admin.mutation(api.users.setUserRole, { userId: studentId, role: 'viewer' });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', studentId);
    expect(row?.role).toBe('viewer');
  });
});

test('a non-admin calling setUserRole throws', async () => {
  const t = convexTest(schema);
  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer6' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});

  await expect(
    viewer.mutation(api.users.setUserRole, { userId: viewerId, role: 'admin' })
  ).rejects.toThrow('Only admins can do that.');
});

test('setting a role clears a pending requested flag', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin7');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer7' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Sam', lastInitial: 'Q' });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.requested).toBe(true);
  });

  await admin.mutation(api.users.setUserRole, { userId: viewerId, role: 'student' });

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.role).toBe('student');
    expect(row?.requested).toBe(false);
  });
});

test('setUserRole writes an audit row naming the acting admin, not the target', async () => {
  const t = convexTest(schema);
  const { as: admin, userId: adminId } = await withAdmin(t, 'https://accounts.google.com|admin8');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer8' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});

  await admin.mutation(api.users.setUserRole, { userId: viewerId, role: 'student' });

  await t.run(async (ctx) => {
    const rows = await ctx.db.query('auditLogs').collect();
    const entry = rows.find((r) => r.entityId === viewerId);
    expect(entry).toBeDefined();
    expect(entry?.userId).toBe(adminId);
    expect(entry?.action).toBe('update');
    expect(entry?.entityType).toBe('user');
    expect(entry?.change).toEqual({ field: 'role', from: 'viewer', to: 'student' });
  });
});

test('approveRequest writes an audit row naming the acting admin, not the target', async () => {
  const t = convexTest(schema);
  const { as: admin, userId: adminId } = await withAdmin(t, 'https://accounts.google.com|admin9');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer9' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Wei', lastInitial: 'C' });

  await admin.mutation(api.users.approveRequest, { userId: viewerId });

  await t.run(async (ctx) => {
    const rows = await ctx.db.query('auditLogs').collect();
    const entry = rows.find((r) => r.entityId === viewerId);
    expect(entry).toBeDefined();
    expect(entry?.userId).toBe(adminId);
    expect(entry?.action).toBe('approve_user');
    expect(entry?.entityType).toBe('user');
    expect(entry?.change).toEqual({ field: 'role', from: 'viewer', to: 'student' });
  });
});

test('declineRequest writes an audit row naming the acting admin, not the target', async () => {
  const t = convexTest(schema);
  const { as: admin, userId: adminId } = await withAdmin(t, 'https://accounts.google.com|admin10');

  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer10' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Priya', lastInitial: 'S' });

  await admin.mutation(api.users.declineRequest, { userId: viewerId });

  await t.run(async (ctx) => {
    const rows = await ctx.db.query('auditLogs').collect();
    const entry = rows.find((r) => r.entityId === viewerId);
    expect(entry).toBeDefined();
    expect(entry?.userId).toBe(adminId);
    expect(entry?.action).toBe('reject_user');
    expect(entry?.entityType).toBe('user');
    // Nothing about the target actually changed except the request flag.
    expect(entry?.change).toBeUndefined();
  });
});

/**
 * The request flow is the only door a name comes through.
 *
 * `updateOwnProfile` used to be gated on `requireActor`, which let a signed-in
 * viewer put their name on the roster without ever asking for edit access --
 * contradicting the design `auth.ts` states ("A new account holds an opaque
 * identifier and nothing else") and making the flow an admin actually sees
 * skippable.
 */
test('a viewer cannot name themselves except by asking for access', async () => {
  const t = convexTest(schema);
  const viewer = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|viewer5' });
  const viewerId = await viewer.mutation(api.auth.ensureUser, {});

  await expect(
    viewer.mutation(api.users.updateOwnProfile, { firstName: 'Levi', lastInitial: 'F' })
  ).rejects.toThrow('Viewer accounts cannot make changes.');

  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.firstName).toBeUndefined();
    expect(row?.lastInitial).toBeUndefined();
  });

  // The one door that is open to them, and it raises the request at the same
  // time as it records the name.
  await viewer.mutation(api.users.requestEditAccess, { firstName: 'Levi', lastInitial: 'F' });
  await t.run(async (ctx) => {
    const row = await ctx.db.get('users', viewerId);
    expect(row?.firstName).toBe('Levi');
    expect(row?.requested).toBe(true);
  });
});

/** Once approved they are a student, and editing their own name is theirs again. */
test('an approved member can fix their own name afterwards', async () => {
  const t = convexTest(schema);
  const { as: admin } = await withAdmin(t, 'https://accounts.google.com|admin5');

  const member = t.withIdentity({ tokenIdentifier: 'https://accounts.google.com|member5' });
  const memberId = await member.mutation(api.auth.ensureUser, {});
  await member.mutation(api.users.requestEditAccess, { firstName: 'Levy', lastInitial: 'F' });
  await admin.mutation(api.users.approveRequest, { userId: memberId });

  await member.mutation(api.users.updateOwnProfile, { firstName: 'Levi' });

  await t.run(async (ctx) => {
    expect((await ctx.db.get('users', memberId))?.firstName).toBe('Levi');
  });
});
