/**
 * Calendar-day helpers shared by every view that shows or filters a date.
 *
 * A date in this app is a plain `YYYY-MM-DD` calendar day, never an instant:
 * a purchase made on the 1st was made on the 1st in the shop, whatever the
 * viewer's timezone. That is why comparisons here are string comparisons and
 * why `localDay` exists -- `new Date('2026-01-01')` parses as midnight *UTC*,
 * which renders as Dec 31 anywhere west of Greenwich.
 *
 * This is a leaf module: it imports nothing, so anything may import it.
 */

export interface DateRange {
  start: string;
  end: string;
}

/** Read `YYYY-MM-DD` as a local calendar day; `new Date(iso)` shifts it a timezone. */
export function localDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function toISO(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isoOf(d: Date): string {
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** A dash rather than a blank, so an undated row still occupies its column. */
export function formatDay(iso: string | undefined): string {
  if (!iso) return '—';
  return localDay(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/** FRC seasons run September through August, so a season is not a calendar year. */
export function seasonDateRange(season: string): DateRange | null {
  if (season === 'all') return null;
  const match = season.match(/^(\d{4})-(\d{4})$/);
  if (!match) return null;
  return { start: `${match[1]}-09-01`, end: `${match[2]}-08-31` };
}

/** The `YYYY-YYYY` season label a calendar day falls in. */
export function seasonForDate(iso: string): string {
  const [year, month] = iso.split('-').map(Number);
  const start = month >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export type DateRangePreset = 'all' | 'this_month' | 'last_30' | 'this_season' | 'custom';

export const DATE_PRESETS: { id: DateRangePreset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'this_season', label: 'This season' },
  { id: 'custom', label: 'Custom…' }
];

/** Sentinels for a half-open custom range, so one bound can be left blank. */
const MIN_DAY = '0000-01-01';
const MAX_DAY = '9999-12-31';

/**
 * The range a preset selects, or null to filter nothing. `today` is passed in
 * rather than read from the clock so the relative presets are testable.
 */
export function dateRangeFor(
  preset: DateRangePreset,
  custom: { start?: string; end?: string },
  today: string
): DateRange | null {
  switch (preset) {
    case 'all':
      return null;

    case 'this_month': {
      const [year, month] = today.split('-').map(Number);
      // Day 0 of the next month is the last day of this one, which gets
      // February and leap years right without a table.
      const lastDay = new Date(year, month, 0).getDate();
      return { start: toISO(year, month, 1), end: toISO(year, month, lastDay) };
    }

    case 'last_30': {
      const start = localDay(today);
      // Inclusive of today, so 30 days means today plus the 29 before it.
      start.setDate(start.getDate() - 29);
      return { start: isoOf(start), end: today };
    }

    case 'this_season':
      return seasonDateRange(seasonForDate(today));

    case 'custom': {
      if (!custom.start && !custom.end) return null;
      return { start: custom.start || MIN_DAY, end: custom.end || MAX_DAY };
    }
  }
}

/** Inclusive of both bounds. A null range accepts everything. */
export function withinDateRange(date: string, range: DateRange | null): boolean {
  if (!range) return true;
  return date >= range.start && date <= range.end;
}
