import { describe, it, expect } from 'vitest';
import {
  MAJOR_DONOR_THRESHOLD,
  DEPOSIT_FORM_CATEGORIES,
  EXPENSE_FORM_CATEGORIES,
  INCOME_CATEGORY_META,
  EXPENSE_CATEGORY_META,
  migrateIncomeCategory,
  migrateExpenseCategory,
  migrateAccount,
  classifyHcbTransaction,
  suggestAccountForPaymentMethod,
  isIncomeCategory,
  isExpenseCategory,
  HCB_INCOME_CATEGORIES
} from './categories';

describe('migrateIncomeCategory', () => {
  it('maps every legacy income category to a new one', () => {
    expect(migrateIncomeCategory('sponsorship_check', 100)).toBe('sponsorships');
    expect(migrateIncomeCategory('fundraiser', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('bottle_can_drive', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('merch_sales', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('camp_registration', 100)).toBe('fundraising');
    expect(migrateIncomeCategory('other_income', 100)).toBe('fundraising');
  });

  it('splits legacy donations at the major-donor threshold', () => {
    expect(migrateIncomeCategory('donation', 250)).toBe('major_donors');
    expect(migrateIncomeCategory('donation', 249.99)).toBe('community_donations');
    expect(migrateIncomeCategory('donation', 1000)).toBe('major_donors');
  });

  it('passes through a value that is already migrated', () => {
    expect(migrateIncomeCategory('fundraising', 10)).toBe('fundraising');
  });
});

describe('migrateExpenseCategory', () => {
  it('maps every legacy expense category to a new one', () => {
    expect(migrateExpenseCategory('robot')).toBe('robot_parts');
    expect(migrateExpenseCategory('tools')).toBe('tools_shop');
    expect(migrateExpenseCategory('events')).toBe('competition_travel');
    expect(migrateExpenseCategory('general')).toBe('team_operations');
  });

  it('passes through a value that is already migrated', () => {
    expect(migrateExpenseCategory('robot_parts')).toBe('robot_parts');
  });
});

describe('form category lists', () => {
  it('never offers grants or sponsorships in the deposit form', () => {
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('grants');
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('sponsorships');
  });

  it('never offers uncategorized in either form', () => {
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('uncategorized');
    expect(EXPENSE_FORM_CATEGORIES).not.toContain('uncategorized');
  });

  it('offers all six real expense categories', () => {
    expect(EXPENSE_FORM_CATEGORIES).toHaveLength(6);
  });

  it('has metadata for every category it offers', () => {
    for (const c of DEPOSIT_FORM_CATEGORIES) expect(INCOME_CATEGORY_META[c]).toBeDefined();
    for (const c of EXPENSE_FORM_CATEGORIES) expect(EXPENSE_CATEGORY_META[c]).toBeDefined();
  });

  it('gives every category a distinct flow color slot', () => {
    const slots = [
      ...Object.values(INCOME_CATEGORY_META).map((m) => m.flow),
      ...Object.values(EXPENSE_CATEGORY_META).map((m) => m.flow)
    ].filter((s) => s !== 'var(--color-flow-muted)');
    expect(new Set(slots).size).toBe(slots.length);
  });
});

describe('classifyHcbTransaction', () => {
  it('reads direction from the sign of amount_cents', () => {
    expect(classifyHcbTransaction({ amount_cents: -100, memo: 'x', type: 'card_charge' }).direction).toBe('out');
    expect(classifyHcbTransaction({ amount_cents: 100, memo: 'x', type: 'donation' }).direction).toBe('in');
  });

  it('splits donations at the major-donor threshold', () => {
    expect(
      classifyHcbTransaction({ amount_cents: 25000, memo: 'Donation from Pat', type: 'donation' }).category
    ).toBe('major_donors');
    expect(
      classifyHcbTransaction({ amount_cents: 3226, memo: 'Donation from Maria', type: 'donation' }).category
    ).toBe('community_donations');
  });

  it('files HCB fees under team operations', () => {
    expect(
      classifyHcbTransaction({ amount_cents: -1149, memo: 'Fiscal sponsorship fee', type: 'hcb_fee' }).category
    ).toBe('team_operations');
  });

  it('applies memo keyword rules to card charges', () => {
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'REV ROBOTICS', type: 'card_charge' }).category)
      .toBe('robot_parts');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'andymark inc', type: 'card_charge' }).category)
      .toBe('robot_parts');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'FIRST REGISTRATION', type: 'card_charge' }).category)
      .toBe('registration_fees');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'HAMPTON INN', type: 'card_charge' }).category)
      .toBe('competition_travel');
    expect(classifyHcbTransaction({ amount_cents: -5000, memo: 'HOME DEPOT #123', type: 'card_charge' }).category)
      .toBe('tools_shop');
  });

  it('refuses to guess on Amazon', () => {
    expect(classifyHcbTransaction({ amount_cents: -3189, memo: 'Amazon', type: 'card_charge' }).category)
      .toBe('uncategorized');
  });

  it('falls back to uncategorized for an unrecognised memo', () => {
    expect(
      classifyHcbTransaction({ amount_cents: -8500, memo: 'SOUTHBURY COUNTRY FLOR', type: 'card_charge' }).category
    ).toBe('uncategorized');
  });
});

describe('suggestAccountForPaymentMethod', () => {
  it('maps the three payment methods that touch a real account', () => {
    expect(suggestAccountForPaymentMethod('hcb_card')).toBe('hcb_bank');
    expect(suggestAccountForPaymentMethod('school_po')).toBe('school_account');
    // Cash is banked into the school account; there is no cash-on-hand pot.
    expect(suggestAccountForPaymentMethod('cash')).toBe('school_account');
  });

  it('returns none for money that never leaves a team account', () => {
    expect(suggestAccountForPaymentMethod('grant_voucher')).toBe('none');
    expect(suggestAccountForPaymentMethod('personal_reimbursement')).toBe('none');
    expect(suggestAccountForPaymentMethod('other')).toBe('none');
    expect(suggestAccountForPaymentMethod(undefined)).toBe('none');
  });
});

describe('MAJOR_DONOR_THRESHOLD', () => {
  it('is 250 dollars', () => {
    expect(MAJOR_DONOR_THRESHOLD).toBe(250);
  });
});

describe('in_kind_gifts income category', () => {
  it('is a recognised income category', () => {
    expect(isIncomeCategory('in_kind_gifts')).toBe(true);
  });

  it('is not an expense category', () => {
    expect(isExpenseCategory('in_kind_gifts')).toBe(false);
  });

  it('has its own flow colour, distinct from every other income category', () => {
    const flows = Object.values(INCOME_CATEGORY_META).map((m) => m.flow);
    expect(new Set(flows).size).toBe(flows.length);
    expect(INCOME_CATEGORY_META.in_kind_gifts.flow).toBe('var(--color-flow-12)');
  });

  it('is never offered on the deposit form, so a gift cannot be entered twice', () => {
    expect(DEPOSIT_FORM_CATEGORIES).not.toContain('in_kind_gifts');
  });

  it('is never assignable to a bank transaction', () => {
    expect(HCB_INCOME_CATEGORIES).not.toContain('in_kind_gifts');
  });
});

describe('migrateAccount', () => {
  it('moves the retired cash box into the school account', () => {
    expect(migrateAccount('cash_box')).toBe('school_account');
  });

  it('passes a live account through', () => {
    expect(migrateAccount('hcb_bank')).toBe('hcb_bank');
    expect(migrateAccount('school_account')).toBe('school_account');
  });

  it('falls back to the school account for anything unrecognised', () => {
    expect(migrateAccount('mattress')).toBe('school_account');
  });
});
