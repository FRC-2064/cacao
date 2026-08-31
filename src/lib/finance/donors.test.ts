import { describe, it, expect } from 'vitest';
import {
  buildLedger,
  type LedgerExpense,
  type LedgerDeposit,
  type LedgerHcbTransaction
} from './ledger';
import {
  normalizeDonorName,
  isAnonymousDonor,
  parseDonationMemo,
  collectGifts,
  groupDonors,
  nameSimilarity,
  suggestDuplicates,
  donorsToCsv,
  giftsToCsv,
  ANONYMOUS_KEY,
  ANONYMOUS_DONOR_NAME,
  isEmailShapedDonorName,
  redactEmails,
  DEFAULT_SIMILARITY_THRESHOLD,
  CSV_CAVEAT,
  type DonorTotals
} from './donors';

const expense = (over: Partial<LedgerExpense> = {}): LedgerExpense => ({
  _id: 'exp1',
  title: 'Polycarbonate sheet',
  vendor: 'McMaster',
  amount: 240,
  finalPaidAmount: undefined,
  category: 'robot_parts',
  status: 'donated',
  season: '2026-2027',
  paymentMethod: 'personal_reimbursement',
  account: 'none',
  purchasedAt: Date.parse('2026-10-10T00:00:00Z'),
  createdAt: Date.parse('2026-10-01T00:00:00Z'),
  ...over
});

const deposit = (over: Partial<LedgerDeposit> = {}): LedgerDeposit => ({
  _id: 'dep1',
  title: 'Check',
  amount: 1000,
  category: 'major_donors',
  depositAccount: 'school_account',
  date: '2026-10-10',
  season: '2026-2027',
  ...over
});

const txn = (over: Partial<LedgerHcbTransaction> = {}): LedgerHcbTransaction => ({
  id: 'txn1',
  amount_cents: 3226,
  memo: 'Donation from Samantha Christolini',
  date: '2026-06-25',
  type: 'donation',
  pending: false,
  ...over
});

/** Gifts for a set of records, always over the full ledger. */
const gifts = (input: {
  expenses?: LedgerExpense[];
  deposits?: LedgerDeposit[];
  hcbTransactions?: LedgerHcbTransaction[];
  hcbDonations?: Parameters<typeof collectGifts>[0]['hcbDonations'];
  taxYear?: number | 'all';
}) => {
  const { entries } = buildLedger({
    expenses: input.expenses ?? [],
    deposits: input.deposits ?? [],
    hcbTransactions: input.hcbTransactions ?? [],
    season: 'all'
  });
  return collectGifts({
    entries,
    hcbDonations: input.hcbDonations ?? [],
    taxYear: input.taxYear ?? 'all'
  });
};

describe('normalizeDonorName', () => {
  it('trims trailing whitespace seen in real HCB data', () => {
    expect(normalizeDonorName('Samantha Christolini ')).toBe(
      normalizeDonorName('Samantha Christolini')
    );
  });

  it('is case insensitive', () => {
    expect(normalizeDonorName('HEATHER JENSEN')).toBe(normalizeDonorName('Heather Jensen'));
  });

  it('collapses internal whitespace', () => {
    expect(normalizeDonorName('Ruth   Harrison')).toBe(normalizeDonorName('Ruth Harrison'));
  });

  it('treats & and and as the same', () => {
    expect(normalizeDonorName('Ruth & Paul Harrison')).toBe(
      normalizeDonorName('Ruth and Paul Harrison')
    );
  });

  it('strips punctuation', () => {
    expect(normalizeDonorName('Dr. Glenn Mott,')).toBe(normalizeDonorName('Glenn Mott'));
  });

  it('strips honorifics', () => {
    expect(normalizeDonorName('Mrs Teresa Carr')).toBe(normalizeDonorName('Teresa Carr'));
  });

  it('returns an empty string for a blank name', () => {
    expect(normalizeDonorName('   ')).toBe('');
  });
});

describe('isAnonymousDonor', () => {
  it('recognises the HCB anonymous label', () => {
    expect(isAnonymousDonor('Anonymous Donor')).toBe(true);
  });

  it('recognises a bare anonymous', () => {
    expect(isAnonymousDonor('anonymous')).toBe(true);
  });

  it('does not match a real name containing the word', () => {
    expect(isAnonymousDonor('Anonymously Yours LLC')).toBe(false);
  });
});

describe('parseDonationMemo', () => {
  it('pulls the donor out of a real HCB memo', () => {
    expect(parseDonationMemo('Donation from Samantha Christolini')).toBe('Samantha Christolini');
  });

  it('is case insensitive on the prefix', () => {
    expect(parseDonationMemo('DONATION FROM Glenn Mott')).toBe('Glenn Mott');
  });

  it('returns null for an unrelated memo', () => {
    expect(parseDonationMemo('REV ROBOTICS')).toBeNull();
  });
});

describe('an email address is never rendered as a donor name', () => {
  it('recognises a bare address and one embedded in a name', () => {
    expect(isEmailShapedDonorName('A.Rivera0106@example.com')).toBe(true);
    expect(isEmailShapedDonorName('John Smith (john@example.com)')).toBe(true);
  });

  it('leaves a real donor name alone', () => {
    expect(isEmailShapedDonorName('Ruth & Paul Harrison')).toBe(false);
    expect(isEmailShapedDonorName('Anonymous Donor')).toBe(false);
  });

  it('routes an email-shaped HCB memo into the anonymous bucket, money intact', () => {
    // Verbatim from the live feed, which is also cached in localStorage under
    // cacao_hcb_txns_v2 -- so this rendered an address as a donor name in the
    // report and wrote it into the CSV export.
    const result = gifts({
      hcbTransactions: [
        txn({ id: 'txnEmail', memo: 'Donation from A.Rivera0106@example.com', amount_cents: 5000 })
      ]
    });
    expect(result).toHaveLength(1);
    expect(result[0].donorName).toBe(ANONYMOUS_DONOR_NAME);

    const [donor] = groupDonors(result);
    expect(donor.key).toBe(ANONYMOUS_KEY);
    expect(donor.displayName).toBe('Anonymous');
    // The gift is bucketed, not discarded: dropping it would take real money
    // out of the donor totals.
    expect(donor.total).toBe(50);
    expect(JSON.stringify(donor)).not.toContain('A.Rivera0106');
  });

  it('takes the address out of the gift description, which is the memo itself', () => {
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnEmail', memo: 'Donation from A.Rivera0106@example.com' })]
    });
    expect(result[0].description).toBe('Donation from [email removed]');
    expect(redactEmails('a@b.com and c@d.org')).toBe('[email removed] and [email removed]');
  });

  it('sanitizes the donations endpoint too, not only the memo', () => {
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnB', memo: 'Donation from Someone' })],
      hcbDonations: [
        { transactionId: 'txnB', donorName: 'a.rivera0106@example.com', date: '2026-06-20' }
      ]
    });
    expect(result[0].donorName).toBe(ANONYMOUS_DONOR_NAME);
  });

  it('sanitizes a hand-typed deposit donor as well', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'someone@example.org', amount: 100 })]
    });
    expect(result).toHaveLength(1);
    expect(result[0].donorName).toBe(ANONYMOUS_DONOR_NAME);
  });
});

describe('collectGifts', () => {
  it('reads the donor name from the donations endpoint when available', () => {
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnA', memo: 'Donation from Anonymous Donor' })],
      hcbDonations: [{ transactionId: 'txnA', donorName: 'Heather Jensen', date: '2026-06-20' }]
    });

    expect(result).toHaveLength(1);
    expect(result[0].donorName).toBe('Heather Jensen');
    expect(result[0].source).toBe('hcb');
    expect(result[0].amount).toBeCloseTo(32.26);
  });

  it('falls back to the memo when the donations endpoint has no row', () => {
    const result = gifts({ hcbTransactions: [txn({ id: 'txnA' })] });
    expect(result[0].donorName).toBe('Samantha Christolini');
  });

  it('ignores a non-donation bank transaction', () => {
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnA', type: 'card_charge', memo: 'REV', amount_cents: -4000 })]
    });
    expect(result).toHaveLength(0);
  });

  it('collects a check from a deposit with a donor name', () => {
    const result = gifts({ deposits: [deposit({ donorName: 'Frank Leon', amount: 1000 })] });

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('check');
    expect(result[0].amount).toBe(1000);
    expect(result[0].donorName).toBe('Frank Leon');
  });

  it('ignores a deposit with no donor name', () => {
    expect(gifts({ deposits: [deposit({ donorName: undefined })] })).toHaveLength(0);
  });

  it('collects an in-kind gift from a donated expense', () => {
    const result = gifts({ expenses: [expense({ donorName: 'Dana Vale', amount: 240 })] });

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('in_kind');
    expect(result[0].amount).toBe(240);
  });

  it('prefers the final paid amount for an in-kind gift', () => {
    const result = gifts({
      expenses: [expense({ donorName: 'Dana Vale', amount: 240, finalPaidAmount: 198.4 })]
    });
    expect(result[0].amount).toBe(198.4);
  });

  it('never double-counts the synthetic in_kind_gifts income entry', () => {
    const result = gifts({ expenses: [expense({ donorName: 'Dana Vale', amount: 240 })] });
    expect(result).toHaveLength(1);
  });

  it('ignores an expense that is not donated', () => {
    const result = gifts({
      expenses: [expense({ status: 'purchased', donorName: 'Dana Vale' })]
    });
    expect(result).toHaveLength(0);
  });

  it('counts a check logged by hand and synced from HCB only once', () => {
    // Same amount, same account, same week: buildLedger matches them and the
    // bank transaction stops being a separate entry.
    const result = gifts({
      deposits: [
        deposit({
          donorName: 'Frank Leon',
          amount: 32.26,
          depositAccount: 'hcb_bank',
          date: '2026-06-25'
        })
      ],
      hcbTransactions: [txn({ id: 'txnA', amount_cents: 3226, date: '2026-06-25' })]
    });

    expect(result).toHaveLength(1);
    expect(result[0].amount).toBeCloseTo(32.26);
    expect(result[0].source).toBe('check');
  });
});

describe('tax year attribution', () => {
  it('files an HCB donation by the donation date, not the settlement date', () => {
    // Given on 31 Dec, settled 2 Jan. The donor believes they gave in 2026.
    const result = gifts({
      hcbTransactions: [txn({ id: 'txnA', date: '2027-01-02' })],
      hcbDonations: [{ transactionId: 'txnA', donorName: 'Krista Legg', date: '2026-12-31' }],
      taxYear: 2026
    });

    expect(result).toHaveLength(1);
    expect(result[0].taxYear).toBe(2026);
  });

  it('honours an explicit taxYear on a deposit over its date', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'Frank Leon', date: '2027-01-03', taxYear: 2026 })],
      taxYear: 2026
    });
    expect(result).toHaveLength(1);
  });

  it('falls back to the date year when no taxYear is stored', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'Frank Leon', date: '2026-10-10' })],
      taxYear: 2026
    });
    expect(result[0].taxYear).toBe(2026);
  });

  it('excludes gifts from other years', () => {
    const result = gifts({
      deposits: [deposit({ donorName: 'Frank Leon', date: '2025-10-10' })],
      taxYear: 2026
    });
    expect(result).toHaveLength(0);
  });

  it('includes every year when asked for all', () => {
    const result = gifts({
      deposits: [
        deposit({ _id: 'd1', donorName: 'Frank Leon', date: '2025-10-10' }),
        deposit({ _id: 'd2', donorName: 'Frank Leon', date: '2026-10-10' })
      ],
      taxYear: 'all'
    });
    expect(result).toHaveLength(2);
  });
});

describe('groupDonors', () => {
  it('merges name variants into one donor', () => {
    const donors = groupDonors(
      gifts({
        deposits: [
          deposit({ _id: 'd1', donorName: 'Ruth & Paul Harrison', amount: 100 }),
          deposit({ _id: 'd2', donorName: 'Ruth and Paul Harrison', amount: 250 })
        ]
      })
    );

    expect(donors).toHaveLength(1);
    expect(donors[0].total).toBe(350);
    expect(donors[0].gifts).toHaveLength(2);
  });

  it('separates cash and in-kind totals', () => {
    const donors = groupDonors(
      gifts({
        deposits: [deposit({ donorName: 'Dana Vale', amount: 500 })],
        expenses: [expense({ donorName: 'Dana Vale', amount: 240 })]
      })
    );

    expect(donors).toHaveLength(1);
    expect(donors[0].cashTotal).toBe(500);
    expect(donors[0].inKindTotal).toBe(240);
    expect(donors[0].total).toBe(740);
  });

  it('sorts by total, largest first', () => {
    const donors = groupDonors(
      gifts({
        deposits: [
          deposit({ _id: 'd1', donorName: 'Small Giver', amount: 20 }),
          deposit({ _id: 'd2', donorName: 'Big Giver', amount: 5000 })
        ]
      })
    );

    expect(donors.map((d) => d.displayName)).toEqual(['Big Giver', 'Small Giver']);
  });

  it('rolls every anonymous gift into a single shown row', () => {
    const donors = groupDonors(
      gifts({
        hcbTransactions: [
          txn({ id: 'a1', memo: 'Donation from Anonymous Donor', amount_cents: 1000 }),
          txn({ id: 'a2', memo: 'Donation from anonymous', amount_cents: 2500 })
        ]
      })
    );

    const anon = donors.find((d) => d.key === ANONYMOUS_KEY);
    expect(anon).toBeDefined();
    expect(anon?.isAnonymous).toBe(true);
    expect(anon?.displayName).toBe('Anonymous');
    expect(anon?.total).toBe(35);
  });

  it('picks the most frequent spelling as the display name', () => {
    const donors = groupDonors(
      gifts({
        deposits: [
          deposit({ _id: 'd1', donorName: 'heather jensen', amount: 10 }),
          deposit({ _id: 'd2', donorName: 'Heather Jensen', amount: 10 }),
          deposit({ _id: 'd3', donorName: 'Heather Jensen', amount: 10 })
        ]
      })
    );

    expect(donors[0].displayName).toBe('Heather Jensen');
  });
});

const donor = (over: Partial<DonorTotals> = {}): DonorTotals => ({
  key: 'heather jensen',
  displayName: 'Heather Jensen',
  gifts: [],
  cashTotal: 100,
  inKindTotal: 0,
  total: 100,
  isAnonymous: false,
  ...over
});

describe('nameSimilarity', () => {
  it('is 1 for identical names', () => {
    expect(nameSimilarity('heather jensen', 'heather jensen')).toBe(1);
  });

  it('is high for a single typo', () => {
    expect(nameSimilarity('heather jensen', 'heather jenson')).toBeGreaterThan(0.9);
  });

  it('is low for two different people', () => {
    expect(nameSimilarity('heather jensen', 'frank leon')).toBeLessThan(0.5);
  });

  it('is 1 for two empty strings', () => {
    expect(nameSimilarity('', '')).toBe(1);
  });
});

describe('suggestDuplicates', () => {
  it('suggests a near-identical pair', () => {
    const suggestions = suggestDuplicates([
      donor({ key: 'heather jensen', displayName: 'Heather Jensen' }),
      donor({ key: 'heather jenson', displayName: 'Heather Jenson' })
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].displayNames).toEqual(['Heather Jensen', 'Heather Jenson']);
  });

  it('stays silent for two clearly different donors', () => {
    expect(
      suggestDuplicates([
        donor({ key: 'heather jensen', displayName: 'Heather Jensen' }),
        donor({ key: 'frank leon', displayName: 'Frank Leon' })
      ])
    ).toHaveLength(0);
  });

  it('never suggests merging the anonymous bucket into a named donor', () => {
    // The named key has to sit *above* the threshold for this to test the
    // exemption at all -- 'anonymouse' is one edit from the bucket key, so
    // without the exemption it would be offered as a merge.
    expect(nameSimilarity(ANONYMOUS_KEY, 'anonymouse')).toBeGreaterThan(
      DEFAULT_SIMILARITY_THRESHOLD
    );
    expect(
      suggestDuplicates([
        donor({ key: ANONYMOUS_KEY, displayName: 'Anonymous', isAnonymous: true }),
        donor({ key: 'anonymouse', displayName: 'Anonymouse' })
      ])
    ).toHaveLength(0);
  });

  it('honours a custom threshold', () => {
    const pair = [
      donor({ key: 'heather jensen', displayName: 'Heather Jensen' }),
      donor({ key: 'heather jenson', displayName: 'Heather Jenson' })
    ];

    expect(suggestDuplicates(pair, 0.999)).toHaveLength(0);
    expect(suggestDuplicates(pair, 0.5)).toHaveLength(1);
  });

  it('reports each pair once, not twice', () => {
    const suggestions = suggestDuplicates([
      donor({ key: 'ruth harrison', displayName: 'Ruth Harrison' }),
      donor({ key: 'ruth harrisen', displayName: 'Ruth Harrisen' }),
      donor({ key: 'ruth harrisonn', displayName: 'Ruth Harrisonn' })
    ]);

    // Asserting the count as well as its distinctness: `seen.size ===
    // suggestions.length` alone holds trivially when nothing is suggested.
    expect(suggestions).toHaveLength(3);
    const seen = new Set(suggestions.map((s) => [...s.keys].sort().join('|')));
    expect(seen.size).toBe(suggestions.length);
  });

  it('defaults to the documented threshold', () => {
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.85);
  });
});

describe('donorsToCsv', () => {
  it('opens with the caveat so the figure is never mistaken for a receipt', () => {
    const csv = donorsToCsv([donor()], '2026');
    expect(csv.split('\n')[0]).toContain(CSV_CAVEAT);
  });

  it('names the period', () => {
    expect(donorsToCsv([donor()], '2026')).toContain('2026');
  });

  it('writes a header row and one row per donor', () => {
    const csv = donorsToCsv(
      [
        donor({ displayName: 'Big Giver', cashTotal: 5000, inKindTotal: 0, total: 5000 }),
        donor({ key: 'small', displayName: 'Small Giver', cashTotal: 20, inKindTotal: 5, total: 25 })
      ],
      '2026'
    );

    const lines = csv.trim().split('\n');
    expect(lines[1]).toBe('Donor,Gifts,Cash,In-kind,Total');
    expect(lines[2]).toBe('Big Giver,0,5000.00,0.00,5000.00');
    expect(lines[3]).toBe('Small Giver,0,20.00,5.00,25.00');
  });

  it('quotes a name containing a comma', () => {
    const csv = donorsToCsv([donor({ displayName: 'Harrison, Ruth' })], '2026');
    expect(csv).toContain('"Harrison, Ruth"');
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = donorsToCsv([donor({ displayName: 'Bob \"Buzz\" Smith' })], '2026');
    expect(csv).toContain('"Bob \"\"Buzz\"\" Smith"');
  });
});

describe('giftsToCsv', () => {
  it('itemizes one donor with a total row', () => {
    const csv = giftsToCsv(
      donor({
        displayName: 'Dana Vale',
        cashTotal: 500,
        inKindTotal: 240,
        total: 740,
        gifts: [
          {
            id: 'g1',
            donorName: 'Dana Vale',
            source: 'check',
            amount: 500,
            date: '2026-10-10',
            taxYear: 2026,
            description: 'Check'
          },
          {
            id: 'g2',
            donorName: 'Dana Vale',
            source: 'in_kind',
            amount: 240,
            date: '2026-10-11',
            taxYear: 2026,
            description: 'Polycarbonate sheet'
          }
        ]
      }),
      '2026'
    );

    expect(csv).toContain('Date,Source,Description,Amount');
    expect(csv).toContain('2026-10-10,Check,Check,500.00');
    expect(csv).toContain('2026-10-11,In-kind,Polycarbonate sheet,240.00');
    expect(csv).toContain('Total,,,740.00');
  });
});
