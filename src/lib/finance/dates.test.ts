import { describe, it, expect } from 'vitest';
import { localDay, formatDay, dateRangeFor, DATE_PRESETS, type DateRangePreset } from './dates';

describe('localDay', () => {
  it('reads an ISO day as a local calendar day, not a UTC instant', () => {
    const d = localDay('2026-03-14');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(14);
  });

  it('does not shift the day backwards in a negative-offset timezone', () => {
    // `new Date('2026-01-01')` parses as midnight UTC, which is Dec 31 in the
    // Americas -- the exact bug this helper exists to avoid.
    expect(localDay('2026-01-01').getDate()).toBe(1);
  });
});

describe('formatDay', () => {
  it('renders an ISO day as a short human date', () => {
    expect(formatDay('2026-03-14')).toBe('Mar 14, 2026');
  });

  it('renders an empty string for a missing date', () => {
    expect(formatDay(undefined)).toBe('—');
  });
});

describe('dateRangeFor', () => {
  const today = '2026-03-14';

  it('returns null for all time, so nothing is filtered out', () => {
    expect(dateRangeFor('all', {}, today)).toBeNull();
  });

  it('spans the calendar month containing today', () => {
    expect(dateRangeFor('this_month', {}, today)).toEqual({
      start: '2026-03-01',
      end: '2026-03-31'
    });
  });

  it('ends this month on the right day for a short month', () => {
    expect(dateRangeFor('this_month', {}, '2026-02-10')?.end).toBe('2026-02-28');
  });

  it('covers today and the 29 days before it for last 30 days', () => {
    expect(dateRangeFor('last_30', {}, today)).toEqual({
      start: '2026-02-13',
      end: '2026-03-14'
    });
  });

  it('spans September through August for the season containing today', () => {
    expect(dateRangeFor('this_season', {}, today)).toEqual({
      start: '2025-09-01',
      end: '2026-08-31'
    });
  });

  it('starts the season in the same calendar year once September arrives', () => {
    expect(dateRangeFor('this_season', {}, '2026-09-02')).toEqual({
      start: '2026-09-01',
      end: '2027-08-31'
    });
  });

  it('uses the custom bounds when the custom preset is chosen', () => {
    expect(dateRangeFor('custom', { start: '2026-01-05', end: '2026-01-09' }, today)).toEqual({
      start: '2026-01-05',
      end: '2026-01-09'
    });
  });

  it('leaves an unfilled side of a custom range open-ended', () => {
    expect(dateRangeFor('custom', { start: '2026-01-05' }, today)).toEqual({
      start: '2026-01-05',
      end: '9999-12-31'
    });
    expect(dateRangeFor('custom', { end: '2026-01-09' }, today)).toEqual({
      start: '0000-01-01',
      end: '2026-01-09'
    });
  });

  it('filters nothing when a custom range has neither bound', () => {
    expect(dateRangeFor('custom', {}, today)).toBeNull();
  });

  it('offers a label for every preset', () => {
    for (const preset of DATE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
    const ids = DATE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['all', 'this_month', 'last_30', 'this_season', 'custom']);
  });
});

describe('withinDateRange', () => {
  it('is inclusive of both bounds', async () => {
    const { withinDateRange } = await import('./dates');
    const range = { start: '2026-03-01', end: '2026-03-31' };
    expect(withinDateRange('2026-03-01', range)).toBe(true);
    expect(withinDateRange('2026-03-31', range)).toBe(true);
    expect(withinDateRange('2026-02-28', range)).toBe(false);
    expect(withinDateRange('2026-04-01', range)).toBe(false);
  });

  it('accepts everything when there is no range', async () => {
    const { withinDateRange } = await import('./dates');
    expect(withinDateRange('1999-01-01', null)).toBe(true);
  });
});
