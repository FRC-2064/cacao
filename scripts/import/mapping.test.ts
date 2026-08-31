import { describe, it, expect } from 'vitest';
import {
  parseSheetDate,
  parseMoney,
  mapGrantStatus,
  mapDeadline,
  mapExpenseCategory,
  mapIncomeCategory,
  isHcbSourcedIncome,
  isHcbSourcedExpense,
  seasonFromSheet,
  cleanCell,
  cleanUrl,
  cleanEmail,
  doNotPursueReason,
  publicDepositTitle,
  donorNameFromTitle,
  DEPOSIT_TITLE_OVERRIDES
} from './mapping';

describe('cleanCell', () => {
  it('trims ordinary whitespace', () => {
    expect(cleanCell('  Ion Bank  ')).toBe('Ion Bank');
  });

  // The Grant Pipeline tab is full of cells holding nothing but a long run of
  // spaces, which read as present but render as blank.
  it('treats a run of spaces as empty', () => {
    expect(cleanCell('                    ')).toBe('');
  });

  it('collapses embedded newlines and repeated spaces', () => {
    expect(cleanCell('Brunch\nHouse   1850')).toBe('Brunch House 1850');
  });

  it('returns empty for undefined', () => {
    expect(cleanCell(undefined)).toBe('');
  });
});

describe('parseMoney', () => {
  it('reads a formatted dollar amount', () => {
    expect(parseMoney('$3,114.75')).toBe(3114.75);
  });

  it('reads a bare number', () => {
    expect(parseMoney('500')).toBe(500);
  });

  it('returns undefined for a blank cell', () => {
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('   ')).toBeUndefined();
  });

  it('returns undefined for text that is not an amount', () => {
    expect(parseMoney('N/A')).toBeUndefined();
  });
});

describe('parseSheetDate', () => {
  it('reads a four-digit-year US date as an ISO day', () => {
    expect(parseSheetDate('4/15/2026')).toBe('2026-04-15');
  });

  it('reads a two-digit-year US date', () => {
    expect(parseSheetDate('1/18/26')).toBe('2026-01-18');
  });

  it('pads single-digit months and days', () => {
    expect(parseSheetDate('8/6/2025')).toBe('2025-08-06');
  });

  it('returns undefined for a blank or non-date cell', () => {
    expect(parseSheetDate('')).toBeUndefined();
    expect(parseSheetDate('TBD after season ends')).toBeUndefined();
    expect(parseSheetDate('all year long')).toBeUndefined();
  });

  // The Spark Fun XRP row is dated 10/1/2015 in a 2025-2026 season block, three
  // rows below 8/6/2025 and above 10/2/2025. It is a typo for 2025, and left
  // uncorrected it drags the ledger back a decade.
  it('corrects a year that predates the team spreadsheet', () => {
    expect(parseSheetDate('10/1/2015')).toBe('2025-10-01');
  });
});

describe('seasonFromSheet', () => {
  it('passes a well-formed season through', () => {
    expect(seasonFromSheet('2025-2026')).toBe('2025-2026');
  });

  it('falls back to the season containing the date when the cell is blank', () => {
    expect(seasonFromSheet('', '2026-03-14')).toBe('2025-2026');
  });

  it('returns an empty string when it has neither', () => {
    expect(seasonFromSheet('', undefined)).toBe('');
  });
});

describe('mapGrantStatus', () => {
  it('maps the statuses the pipeline actually uses', () => {
    expect(mapGrantStatus('Drafting')).toBe('drafting');
    expect(mapGrantStatus('Submitted')).toBe('submitted');
    expect(mapGrantStatus('Accepted')).toBe('awarded');
    expect(mapGrantStatus('Awaiting Approval')).toBe('awaiting_approval');
    expect(mapGrantStatus('Declined')).toBe('declined');
  });

  it('is case and space insensitive', () => {
    expect(mapGrantStatus('  declined ')).toBe('declined');
  });

  // "Declined" and "Dropped" are different facts: one is the funder's answer,
  // the other is the team giving up on it.
  it('keeps declined and dropped apart', () => {
    expect(mapGrantStatus('Dropped')).toBe('dropped');
    expect(mapGrantStatus('Declined')).toBe('declined');
  });

  // Several pipeline rows have no status at all; the board's first column is
  // exactly where an un-triaged opportunity belongs.
  it('sends an unknown or blank status to the backlog', () => {
    expect(mapGrantStatus('')).toBe('backlog');
    expect(mapGrantStatus('Someday')).toBe('backlog');
  });
});

describe('mapDeadline', () => {
  it('reads a real date as a fixed deadline', () => {
    expect(mapDeadline('10/31/2026')).toEqual({
      deadlineType: 'fixed',
      deadline: '2026-10-31'
    });
  });

  it('reads open-ended prose as a rolling deadline, keeping the words', () => {
    expect(mapDeadline('all year long')).toEqual({
      deadlineType: 'rolling',
      deadlineNote: 'all year long'
    });
    expect(mapDeadline('Rolling')).toEqual({
      deadlineType: 'rolling',
      deadlineNote: 'Rolling'
    });
  });

  it('reads other prose as tbd, keeping the words', () => {
    expect(mapDeadline('TBD after season ends')).toEqual({
      deadlineType: 'tbd',
      deadlineNote: 'TBD after season ends'
    });
  });

  it('reads a blank cell as tbd with no note', () => {
    expect(mapDeadline('')).toEqual({ deadlineType: 'tbd' });
  });
});

describe('mapExpenseCategory', () => {
  it('maps every category the transactions tab uses', () => {
    expect(mapExpenseCategory('Machine Parts')).toBe('robot_parts');
    expect(mapExpenseCategory('Tools')).toBe('tools_shop');
    expect(mapExpenseCategory('Competition Entry Fees')).toBe('registration_fees');
    expect(mapExpenseCategory('Travel & Lodging')).toBe('competition_travel');
    expect(mapExpenseCategory('Food')).toBe('competition_travel');
    expect(mapExpenseCategory('Educational Tools')).toBe('outreach_events');
    expect(mapExpenseCategory('Hack Club Service Fees')).toBe('team_operations');
    expect(mapExpenseCategory('Other')).toBe('team_operations');
  });

  it('sends anything unrecognised to uncategorized rather than guessing', () => {
    expect(mapExpenseCategory('Mystery')).toBe('uncategorized');
    expect(mapExpenseCategory('')).toBe('uncategorized');
  });
});

describe('mapIncomeCategory', () => {
  it('maps grants and fundraisers by their sheet category', () => {
    expect(mapIncomeCategory('Grant', 'MannKind', 5000)).toBe('grants');
    expect(mapIncomeCategory('Pail Shakes', 'Stop & Shop Pail Shake', 841.49)).toBe('fundraising');
    expect(mapIncomeCategory('Bottle Drive', 'Bottle Drive', 866.7)).toBe('fundraising');
    expect(mapIncomeCategory('Silent Auction', 'Auction', 740)).toBe('fundraising');
    expect(mapIncomeCategory('Dine with Us', 'Pies and Pub', 250)).toBe('fundraising');
    expect(mapIncomeCategory('Studen Dues', 'Dues Deposit', 1200)).toBe('fundraising');
    expect(mapIncomeCategory('Apparel Fundraiser', 'Apparel Order Deposit', 270)).toBe('fundraising');
    expect(mapIncomeCategory('Flower Sale', 'Flower Sale', 400)).toBe('fundraising');
  });

  it('maps a company sponsorship to sponsorships', () => {
    expect(mapIncomeCategory('Sponsorship', 'Ansys Inc.', 1000)).toBe('sponsorships');
    expect(mapIncomeCategory('Sponsorship', 'Haas Sponsorship', 3000)).toBe('sponsorships');
  });

  // The sheet files personal cheques under "Sponsorship" too, but a gift from
  // a family is a major donor, not a corporate partner -- and the Donors view
  // is built on that distinction.
  it('maps a named personal gift to major_donors', () => {
    expect(mapIncomeCategory('Sponsorship', "Donation - Seamus's Grandfather", 5000)).toBe(
      'major_donors'
    );
    expect(mapIncomeCategory('Sponsorship', 'Buckley Personal Check', 500)).toBe('major_donors');
    // Categorisation reads the raw sheet text, which is why
    // `publicDepositTitle` is applied after it and never before: run the
    // scrub first and both of these silently refile as `sponsorships`.
    expect(mapIncomeCategory('Sponsorship', publicDepositTitle('Buckley Personal Check'), 500)).toBe(
      'sponsorships'
    );
  });

  it('sends an unrecognised category to uncategorized', () => {
    expect(mapIncomeCategory('Something New', 'x', 10)).toBe('uncategorized');
  });
});

describe('isHcbSourcedIncome', () => {
  // Every "Hack Club" row is a donation that came through HCB, so the live
  // API already reports it. Re-importing would double-count.
  it('excludes rows the sheet filed under Hack Club', () => {
    expect(isHcbSourcedIncome('Hack Club')).toBe(true);
  });

  it('keeps rows that arrived outside HCB', () => {
    expect(isHcbSourcedIncome('Grant')).toBe(false);
    expect(isHcbSourcedIncome('Sponsorship')).toBe(false);
    expect(isHcbSourcedIncome('Flower Sale')).toBe(false);
  });
});

describe('isHcbSourcedExpense', () => {
  // A fresh pool per test: the function consumes the debits it matches, so a
  // shared array would let one case decide the next one's outcome.
  const pool = () => [
    { id: 't1', amount_cents: -13635, date: '2025-04-12' },
    { id: 't2', amount_cents: -311475, date: '2025-04-12' }
  ];

  it('excludes fiscal sponsorship fees, which only ever exist inside HCB', () => {
    expect(isHcbSourcedExpense('Hack Club Service Fees', 21, pool())).toBe(true);
  });

  it('excludes a purchase the bank feed already reports at that amount', () => {
    expect(isHcbSourcedExpense('Machine Parts', 136.35, pool())).toBe(true);
  });

  it('keeps a purchase with no matching debit, e.g. a school PO', () => {
    expect(isHcbSourcedExpense('Tools', 824.87, pool())).toBe(false);
  });

  // Two rows at $136.35 but only one debit: the second is either a duplicate
  // row or a genuine second order paid elsewhere. Consuming each debit once
  // keeps the second row, so a human can see it rather than have it silently
  // swallowed.
  it('consumes each debit at most once', () => {
    const debits = pool();
    expect(isHcbSourcedExpense('Machine Parts', 136.35, debits)).toBe(true);
    expect(isHcbSourcedExpense('Machine Parts', 136.35, debits)).toBe(false);
  });

  it('compares in integer cents so float drift cannot decide a match', () => {
    const debits = [{ id: 't3', amount_cents: -1638401, date: '2026-01-01' }];
    expect(isHcbSourcedExpense('Machine Parts', 16384.01, debits)).toBe(true);
  });
});

describe('cleanUrl', () => {
  it('keeps a real link', () => {
    expect(cleanUrl('https://ionbank.com/about-us/foundation/')).toBe(
      'https://ionbank.com/about-us/foundation/'
    );
  });

  // The Contacts tab uses these columns loosely: page titles and the literal
  // word "none" appear where a URL belongs.
  it('drops placeholder text that is not a link', () => {
    expect(cleanUrl('none')).toBeUndefined();
    expect(cleanUrl('(Will Open Soon)')).toBeUndefined();
    expect(cleanUrl('Home | 1of1 Barbering')).toBeUndefined();
    expect(cleanUrl('')).toBeUndefined();
  });

  it('adds a scheme to a bare domain', () => {
    expect(cleanUrl('facebook.com/kitchen64/')).toBe('https://facebook.com/kitchen64/');
  });
});

describe('cleanEmail', () => {
  it('keeps a real address and lowercases it', () => {
    expect(cleanEmail('Alex.Rivera@example.com')).toBe('alex.rivera@example.com');
  });

  it('drops a URL pasted into the email column', () => {
    expect(cleanEmail('https://wsmpco.com/contact/')).toBe('');
  });

  it('drops placeholder text', () => {
    expect(cleanEmail('none')).toBe('');
    expect(cleanEmail('')).toBe('');
  });
});

describe('doNotPursueReason', () => {
  it('rules out every funder the sheet comments ruled out', () => {
    for (const funder of [
      'Raspberry Pi Foundation Grants',
      'Department of War STEAM grant',
      'GitHub Education Grants',
      'Google Community Grants',
      'Eversource'
    ]) {
      expect(doNotPursueReason(funder)).toBeTruthy();
    }
  });

  /**
   * The same funder is named differently on the pipeline and directory tabs,
   * and one is a plain typo. Matching only the pipeline spelling would leave
   * the directory row in the backlog for somebody to research again.
   */
  it('catches both spellings of the funders that appear twice', () => {
    expect(doNotPursueReason('U.S national science foundation')).toBeTruthy();
    expect(doNotPursueReason('National Science Foundation STEM Grants')).toBeTruthy();
    expect(doNotPursueReason('Amozon future engineer')).toBeTruthy();
    expect(doNotPursueReason('Amazon Future Engineer')).toBeTruthy();
  });

  it('carries the reason, not just a flag', () => {
    expect(doNotPursueReason('Eversource')).toMatch(/NEFIRST directly/);
  });

  it('leaves funders the team is still pursuing alone', () => {
    for (const funder of [
      'Ion Bank Foundation',
      'Thomaston Savings Bank',
      'AIAA',
      'RTX / Raytheon Technologies Community Grants',
      'PTC Education Grant',
      'Gene Haas Foundation'
    ]) {
      expect(doNotPursueReason(funder)).toBeUndefined();
    }
  });

  it('is undefined for a blank funder', () => {
    expect(doNotPursueReason('')).toBeUndefined();
  });
});

describe('publicDepositTitle', () => {
  it('rewrites the three deposit titles that named the wrong person', () => {
    // `Dumoullin` is the sponsor's business contact, an adult whose details
    // otherwise live only in `contacts`, behind `requireActor`.
    expect(publicDepositTitle('Kenneth Lynch & Sons - Dumoullin')).toBe('Kenneth Lynch & Sons');
    // These two named a STUDENT -- a surname on one, a first name and a family
    // relationship on the other. The owner's ruling is that the donor behind
    // them may be named, the student may not, so both become the family's own
    // attribution in the sheet's house style.
    expect(publicDepositTitle('Buckley Personal Check')).toBe('Donation - Buckley Family');
    expect(publicDepositTitle("Donation - Seamus's Grandfather")).toBe('Donation - Buckley Family');
  });

  it('leaves every other title alone', () => {
    expect(publicDepositTitle('Haas Sponsorship')).toBe('Haas Sponsorship');
    expect(publicDepositTitle('Bottle Drive')).toBe('Bottle Drive');
  });

  it('merges the two gifts from one family onto one donor', () => {
    // Deliberately NOT distinct, unlike the first draft of this map. The owner
    // confirms both gifts come from the Buckley family, so one `donors` row is
    // the accurate shape: one family, two deposits, told apart by date and
    // amount like every other repeat giver.
    expect(publicDepositTitle('Buckley Personal Check')).toBe(
      publicDepositTitle("Donation - Seamus's Grandfather")
    );
    expect(donorNameFromTitle(publicDepositTitle('Buckley Personal Check'))).toBe('Buckley Family');
  });

  it('names no student and no relationship', () => {
    // The line the owner drew: a donor family may be named, because donor
    // attribution is already public on the team's HCB page. A student's own
    // name, or a relationship that identifies one ("Seamus's Grandfather"),
    // may not.
    for (const replacement of Object.values(DEPOSIT_TITLE_OVERRIDES)) {
      expect(replacement).not.toMatch(/Dumoullin|Seamus/i);
      expect(replacement).not.toMatch(/grandfather|uncle|aunt|cousin|mother|father|parent/i);
    }
  });
});

describe('donorNameFromTitle', () => {
  it("strips the sheet's Donation - prefix so a donor reads like the others", () => {
    expect(donorNameFromTitle('Donation - Buckley Family')).toBe('Buckley Family');
    expect(donorNameFromTitle('Donation - Baldelli Company')).toBe('Baldelli Company');
  });

  it('leaves a title that carries no prefix alone', () => {
    expect(donorNameFromTitle('Bal Family')).toBe('Bal Family');
  });

  it('never returns empty, so a donor always has a name', () => {
    expect(donorNameFromTitle('Donation - ')).toBe('Donation - ');
  });
});

