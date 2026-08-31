import type { Season } from '$lib/types';

/**
 * Season pickers, shared by every form that has to name one.
 *
 * The season list is a table now (`api.seasons.list`, mirrored on
 * `cacao.seasons`), not a literal array in a component. A hardcoded
 * `'2026-2027'` is wrong for every season after the one it was typed in and
 * goes wrong silently -- the record simply files itself under a season that
 * does not exist -- so nothing here invents a label.
 *
 * Two spellings are in play and they are not interchangeable. A *mutation*
 * takes `seasonId`, a `seasons` row id. The ledger and the season filters
 * compare the `YYYY-YYYY` *label*. `Grant`, `Expense` and `IncomeDeposit`
 * each carry both.
 */

/** Options for a season `<select>`, newest first, valued by row id. */
export function seasonIdOptions(seasons: Season[]): { value: string; label: string }[] {
  return seasons.map((s) => ({ value: s._id, label: s.label }));
}

/**
 * Which season a form should open on: whichever the UI is filtered to, else
 * the one flagged current, else the newest. `''` while the query is in
 * flight, which is the caller's cue that there is nothing valid to submit
 * yet -- an empty id would reach the server as a malformed `v.id("seasons")`.
 */
export function defaultSeasonId(seasons: Season[], selectedLabel: string): string {
  return (
    seasons.find((s) => s.label === selectedLabel)?._id ??
    seasons.find((s) => s.isCurrent)?._id ??
    seasons[0]?._id ??
    ''
  );
}

/**
 * The `YYYY-YYYY` label for a season row id, or `''` for one that names no
 * season. Empty is what the server itself emits for a dangling `seasonId`,
 * and it deliberately routes a record back through date inference rather than
 * filing it under a made-up year.
 */
export function seasonLabelFor(seasons: Season[], seasonId: string): string {
  return seasons.find((s) => s._id === seasonId)?.label ?? '';
}
