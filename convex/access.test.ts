import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
import { expenseEffectiveDate } from '../src/lib/finance/balances';

const GOOGLE = 'https://accounts.google.com';

/** Every field a stranger must never see, whatever route they take. */
const FORBIDDEN = [
  'requesterId', 'requesterName', 'requesterEmail',
  'purchaserId', 'purchaserName', 'approvedById',
  'loggedById', 'loggedByName', 'loggedByEmail',
  'setById', 'setByName', 'setByEmail',
  'assigneeId', 'assigneeName', 'finishedById', 'updatedById',
  'trackingNumber', 'carrier', 'receiptUrl',
  'primaryContactName', 'primaryContactEmail', 'primaryContactId'
];

/**
 * One fully populated row in every table the six public list queries read,
 * with every optional person reference and every delivery detail set.
 *
 * Populated deliberately, and asserted to be populated by the test below.
 * The first version of that test queried six *empty* tables: every
 * `for (const row of rows)` body was skipped, all ~114 assertions with it,
 * and the one test standing behind the spec's access guarantee passed by
 * proving nothing. An assertion that a field is absent proves nothing
 * against an empty table.
 */
async function seedEveryPublicTable(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const approverId = await ctx.db.insert('users', {
      tokenIdentifier: `${GOOGLE}|seed-approver`,
      firstName: 'Ada',
      lastInitial: 'L',
      role: 'admin',
      requested: false
    });
    const userId = await ctx.db.insert('users', {
      tokenIdentifier: `${GOOGLE}|seed-member`,
      firstName: 'Levi',
      lastInitial: 'F',
      role: 'student',
      requested: false,
      approvedById: approverId,
      approvedAt: Date.now()
    });

    const seasonId = await ctx.db.insert('seasons', {
      label: '2026-2027',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      isCurrent: true
    });
    const accountId = await ctx.db.insert('accounts', {
      key: 'hcb_bank',
      openingBalance: 0,
      asOfDate: '2026-09-01',
      updatedAt: Date.now(),
      updatedById: userId
    });
    const donorId = await ctx.db.insert('donors', {
      displayName: 'Pat Q',
      normalizedKey: 'pat q',
      isAnonymous: false
    });

    // `sponsors.list` emits `primaryContactId` for a member only, so the
    // sponsor has to actually have one for its absence to mean anything.
    const contactId = await ctx.db.insert('contacts', {
      name: 'Jordan Reyes',
      title: 'Owner',
      email: 'jordan@example.com',
      phone: '2035550100',
      isPrimary: true,
      preferredMethod: 'email',
      updatedAt: Date.now()
    });
    const sponsorId = await ctx.db.insert('sponsors', {
      name: 'Example Machining',
      category: 'local_business',
      tier: 'gold',
      status: 'paid_active',
      totalDonated: 2500,
      primaryContactId: contactId,
      updatedAt: Date.now()
    });
    await ctx.db.patch('contacts', contactId, { sponsorId });
    await ctx.db.insert('sponsorOutreach', {
      sponsorId,
      year: 2026,
      status: 'received',
      amount: 2500,
      contactedDate: '2026-10-01'
    });

    const grantId = await ctx.db.insert('grants', {
      title: 'Gene Haas Foundation',
      funder: 'Haas',
      amount: 5000,
      currency: 'USD',
      status: 'awarded',
      deadlineType: 'fixed',
      deadline: '2026-11-01',
      assigneeId: userId,
      finishedById: approverId,
      finishedAt: Date.now(),
      priority: 'high',
      seasonId,
      requirements: [],
      order: 0,
      updatedAt: Date.now()
    });

    const expenseId = await ctx.db.insert('expenses', {
      title: 'Swerve modules',
      vendor: 'REV',
      amount: 1240,
      currency: 'USD',
      category: 'robot_parts',
      requesterId: userId,
      purchaserId: approverId,
      approvedById: approverId,
      approvedAt: Date.now(),
      status: 'purchased',
      seasonId,
      accountId,
      donorId,
      paymentMethod: 'hcb_card',
      orderNumber: 'ORD-1',
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
      expectedDeliveryDate: '2026-10-20',
      deliveryStatus: 'shipped',
      receiptUrl: 'https://example.com/receipt.pdf',
      linkedGrantId: grantId,
      updatedAt: Date.now()
    });

    const depositId = await ctx.db.insert('incomeDeposits', {
      title: 'Sponsorship cheque',
      amount: 2500,
      category: 'sponsorships',
      accountId,
      date: '2026-10-10',
      loggedById: userId,
      seasonId,
      donorId,
      receiptUrl: 'https://example.com/deposit.pdf',
      updatedAt: Date.now()
    });

    await ctx.db.insert('hcbCategories', {
      hcbTransactionId: 'txn_1',
      direction: 'out',
      category: 'robot_parts',
      setById: userId,
      updatedAt: Date.now()
    });

    await ctx.db.insert('wishlist', {
      tool: 'Bandsaw',
      company: 'Grizzly',
      cost: 1200,
      source: 'grant',
      priority: 8,
      description: 'For the build season',
      updatedAt: Date.now()
    });

    return { userId, approverId, contactId, donorId, expenseId, depositId, grantId, sponsorId };
  });
}

test('public list queries leak no person and no delivery detail', async () => {
  const t = convexTest(schema);
  const seeded = await seedEveryPublicTable(t);

  // The seed itself is asserted, not assumed. Without this, a schema change
  // that silently dropped `trackingNumber` from the insert would leave the
  // assertions below passing against a row that never carried the field.
  await t.run(async (ctx) => {
    const e = await ctx.db.get('expenses', seeded.expenseId);
    expect(e?.trackingNumber).toBe('1Z999AA10123456784');
    expect(e?.carrier).toBe('UPS');
    expect(e?.receiptUrl).toBeDefined();
    expect(e?.requesterId).toBe(seeded.userId);
    expect(e?.purchaserId).toBe(seeded.approverId);
    expect(e?.approvedById).toBe(seeded.approverId);
    expect(e?.donorId).toBe(seeded.donorId);
    const d = await ctx.db.get('incomeDeposits', seeded.depositId);
    expect(d?.loggedById).toBe(seeded.userId);
    const g = await ctx.db.get('grants', seeded.grantId);
    expect(g?.assigneeId).toBe(seeded.userId);
    expect(g?.finishedById).toBe(seeded.approverId);
    const s = await ctx.db.get('sponsors', seeded.sponsorId);
    expect(s?.primaryContactId).toBe(seeded.contactId);
  });

  // Anonymous: no `withIdentity`, so this is exactly a stranger's view.
  const lists: [string, unknown[]][] = [
    ['expenses.list', await t.query(api.expenses.list, {})],
    ['income.list', await t.query(api.income.list, {})],
    ['grants.list', await t.query(api.grants.list, {})],
    ['wishlist.list', await t.query(api.wishlist.list, {})],
    ['hcbCategories.list', await t.query(api.hcbCategories.list, {})],
    ['sponsors.list', await t.query(api.sponsors.list, {})]
  ];

  for (const [name, rows] of lists) {
    // Non-vacuity, asserted inside the test: with zero rows the loop below
    // runs zero assertions and this test passes while proving nothing. This
    // is the line that makes an empty table fail rather than pass.
    expect(
      rows.length,
      `${name} returned no rows, so every absence assertion below would be skipped`
    ).toBeGreaterThan(0);

    for (const row of rows as Record<string, unknown>[]) {
      for (const field of FORBIDDEN) {
        expect(row[field], `${name}: ${field} must not reach a stranger`).toBeUndefined();
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
  await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert('seasons', {
      label: '2026-2027',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      isCurrent: true
    });
    await ctx.db.insert('expenses', {
      title: 'Swerve modules',
      vendor: 'REV',
      amount: 1240,
      currency: 'USD',
      category: 'robot_parts',
      requesterId: userId,
      status: 'purchased',
      seasonId,
      paymentMethod: 'hcb_card',
      trackingNumber: '1Z999AA10123456784',
      carrier: 'UPS',
      deliveryStatus: 'shipped',
      receiptUrl: 'https://example.com/receipt.pdf',
      updatedAt: Date.now()
    });
  });

  // Asserted before indexing: `[0]` of an empty list is `undefined`, and
  // `undefined.trackingNumber` fails as an opaque TypeError rather than as
  // "the row this test is about was never there".
  const studentRows = (await as.query(api.expenses.list, {})) as Record<string, unknown>[];
  expect(studentRows).toHaveLength(1);
  const asStudent = studentRows[0];
  expect(asStudent.trackingNumber).toBeUndefined();
  expect(asStudent.receiptUrl).toBeUndefined();

  await t.run(async (ctx) => { await ctx.db.patch('users', userId, { role: 'admin' }); });
  const adminRows = (await as.query(api.expenses.list, {})) as Record<string, unknown>[];
  expect(adminRows).toHaveLength(1);
  const asAdmin = adminRows[0];
  expect(asAdmin.trackingNumber).toBeDefined();
  expect(asAdmin.receiptUrl).toBeDefined();
});

test('expenses.list maps accountId back to the hcb_bank slug for the dedup', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s2` });
  const userId = await as.mutation(api.auth.ensureUser, {});

  await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert('seasons', {
      label: '2026-2027',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      isCurrent: true
    });
    const accountId = await ctx.db.insert('accounts', {
      key: 'hcb_bank',
      openingBalance: 0,
      asOfDate: '2026-09-01',
      updatedAt: Date.now(),
      updatedById: userId
    });
    await ctx.db.insert('expenses', {
      title: 'Swerve modules',
      vendor: 'REV',
      amount: 1240,
      currency: 'USD',
      category: 'robot_parts',
      requesterId: userId,
      status: 'purchased',
      seasonId,
      accountId,
      paymentMethod: 'hcb_card',
      updatedAt: Date.now()
    });
  });

  const rows = (await t.query(api.expenses.list, {})) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  // The dedup in src/lib/finance/ledger.ts compares `e.account === 'hcb_bank'`
  // (a slug), never an id -- if this ever regresses to an id, the comparison
  // silently goes false and every HCB-paid expense double-counts.
  expect(rows[0].account).toBe('hcb_bank');
  expect(rows[0].accountId).toBeUndefined();
});

test('expenses.list carries reimbursedAt so balances.ts computes the real effective date, not the filing date', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s4` });
  const userId = await as.mutation(api.auth.ensureUser, {});

  // Filed in July, actually reimbursed in September -- a case that only
  // exists to tell "when it was filed" apart from "when the money moved".
  const purchasedAt = Date.parse('2026-07-15T00:00:00Z');
  const reimbursedAt = Date.parse('2026-09-20T00:00:00Z');

  await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert('seasons', {
      label: '2026-2027',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      isCurrent: true
    });
    await ctx.db.insert('expenses', {
      title: 'Battery charger',
      vendor: 'REV',
      amount: 200,
      currency: 'USD',
      category: 'robot_parts',
      requesterId: userId,
      status: 'reimbursed',
      seasonId,
      paymentMethod: 'personal_reimbursement',
      purchasedAt,
      reimbursedAt,
      updatedAt: Date.now()
    });
  });

  const rows = (await t.query(api.expenses.list, {})) as Array<{
    status: string;
    amount: number;
    finalPaidAmount?: number;
    purchasedAt?: number;
    reimbursedAt?: number;
    createdAt: number;
  }>;
  expect(rows).toHaveLength(1);

  // balances.ts's expenseEffectiveDate() must see the real reimbursedAt --
  // if the projection dropped it (or purchasedAt), this falls through to
  // createdAt (the filing date) with no error and no failing type check,
  // silently moving the expense to the wrong side of an account's
  // asOfDate cutoff and corrupting the computed balance.
  expect(expenseEffectiveDate(rows[0])).toBe('2026-09-20');
});

test('income.list maps accountId back to the hcb_bank slug as depositAccount, not account', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s5` });
  const userId = await as.mutation(api.auth.ensureUser, {});

  await t.run(async (ctx) => {
    const seasonId = await ctx.db.insert('seasons', {
      label: '2026-2027',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      isCurrent: true
    });
    const accountId = await ctx.db.insert('accounts', {
      key: 'hcb_bank',
      openingBalance: 0,
      asOfDate: '2026-09-01',
      updatedAt: Date.now(),
      updatedById: userId
    });
    await ctx.db.insert('incomeDeposits', {
      title: 'Donation from Pat',
      amount: 300,
      category: 'major_donors',
      accountId,
      date: '2026-10-10',
      loggedById: userId,
      seasonId,
      updatedAt: Date.now()
    });
  });

  const rows = (await t.query(api.income.list, {})) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  // src/lib/finance/ledger.ts's `claimsHcb: d.depositAccount === 'hcb_bank'`
  // reads the key `depositAccount`, not `account` (that name is the
  // expense-side field) -- get this wrong and an HCB-paid deposit silently
  // stops deduping against the live bank transaction that paid it.
  expect(rows[0].depositAccount).toBe('hcb_bank');
  expect(rows[0].account).toBeUndefined();
  expect(rows[0].accountId).toBeUndefined();
});

/**
 * The three list queries left over when the rest were converted to explicit
 * allowlists. `accounts.list` and `teamInfo.list` were unauthenticated
 * `.collect()` calls
 * returning whole documents, and `audit.list` spread the raw row alongside the
 * name it had just resolved. An opaque id is not a name, but it still lets a
 * reader correlate one person's every edit, and one unconverted query makes
 * "every list query is an explicit allowlist" false system-wide.
 */
test('accounts.list and teamInfo.list emit balances and facts, never who set them', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s6` });
  const userId = await as.mutation(api.auth.ensureUser, {});

  // Populated deliberately: an assertion that a field is absent proves nothing
  // against an empty table.
  await t.run(async (ctx) => {
    await ctx.db.insert('accounts', {
      key: 'school_account',
      openingBalance: 7018,
      asOfDate: '2024-09-01',
      updatedAt: Date.now(),
      updatedById: userId
    });
    await ctx.db.insert('teamInfo', {
      label: '501(3)c EIN',
      value: '06-0854923',
      order: 0,
      updatedAt: Date.now(),
      updatedById: userId
    });
  });

  // Unauthenticated: both are public by design, so this is the stranger's view.
  const accounts = (await t.query(api.accounts.list, {})) as Record<string, unknown>[];
  expect(accounts).toHaveLength(1);
  expect(accounts[0].updatedById).toBeUndefined();
  // The balance itself stays public, and under the key balances.ts reads.
  expect(accounts[0].account).toBe('school_account');
  expect(accounts[0].openingBalance).toBe(7018);

  const teamInfo = (await t.query(api.teamInfo.list, {})) as Record<string, unknown>[];
  expect(teamInfo).toHaveLength(1);
  expect(teamInfo[0].updatedById).toBeUndefined();
  expect(teamInfo[0].value).toBe('06-0854923');
});

test('audit.list emits the resolved actorName and drops the userId behind it', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s7` });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'admin', firstName: 'Levi', lastInitial: 'F' });
  });

  // A real mutation, so the row is stamped the way production stamps it.
  await as.mutation(api.teamInfo.create, { label: 'EIN', value: '12-3456789' });

  const rows = (await as.query(api.audit.list, {})) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  expect(rows[0].actorName).toBe('Levi F');
  expect(rows[0].userId).toBeUndefined();
  // The feed is still a feed: what happened, to what, and when.
  expect(rows[0].action).toBe('create');
  expect(rows[0].entityType).toBe('team_info');
  expect(rows[0].timestamp).toEqual(expect.any(Number));
});

/**
 * `contacts` is the documented exception in section 6 of the design: the
 * whole table is adult sponsor contacts, and the whole table is gated. It was
 * also the one read path in `convex/` still returning raw documents, which
 * made the "every list query is an explicit allowlist" claim the other query
 * files carry false system-wide -- and made this table, the one holding the
 * most identifying data in the app, the single place a column added to the
 * schema later would leak by default.
 */
test('contacts.list is gated, and an allowlist rather than the raw document', async () => {
  const t = convexTest(schema);
  const as = t.withIdentity({ tokenIdentifier: `${GOOGLE}|s8` });
  const userId = await as.mutation(api.auth.ensureUser, {});
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { role: 'student' });
  });

  // Every optional column set, so a missing key below means the projection
  // dropped it rather than the row never having carried it.
  const sponsorId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('sponsors', {
      name: 'Example Machining',
      category: 'local_business',
      tier: 'gold',
      status: 'paid_active',
      totalDonated: 2500,
      updatedAt: Date.now()
    });
    await ctx.db.insert('contacts', {
      sponsorId: id,
      name: 'Jordan Reyes',
      title: 'Owner',
      email: 'jordan@example.com',
      phone: '2035550100',
      isPrimary: true,
      preferredMethod: 'email',
      notes: 'Prefers a call in the morning',
      lastContactedAt: Date.now(),
      updatedAt: Date.now()
    });
    return id;
  });

  await expect(t.query(api.contacts.list, {})).rejects.toThrow();

  const rows = (await as.query(api.contacts.list, {})) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  expect(rows[0].sponsorId).toBe(sponsorId);
  // Exactly the documented columns. A raw `.collect()` also carries
  // `_creationTime`, so this fails the moment the allowlist is dropped.
  expect(Object.keys(rows[0]).sort()).toEqual(
    [
      '_id', 'sponsorId', 'name', 'title', 'email', 'phone', 'isPrimary',
      'preferredMethod', 'notes', 'lastContactedAt', 'updatedAt'
    ].sort()
  );
});
