/**
 * Turning the team's two Google Sheets into Cacao records.
 *
 * These are the judgment calls the import makes, pulled out of the generator
 * so they can be argued with in a test rather than buried in a script that ran
 * once. `generate.ts` reads the exported CSVs, applies these, and writes
 * `src/lib/data/teamData.ts`. Nothing here ships to the browser.
 */

import type { GrantStatus, DeadlineType } from '../../src/lib/types';
import type { ExpenseCategory, IncomeCategory } from '../../src/lib/finance/categories';

/**
 * Cells across both workbooks are padded with long runs of spaces -- a cell
 * holding forty spaces looks filled in the CSV and blank on screen -- and a
 * few contact names wrap onto a second line.
 */
export function cleanCell(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

export function parseMoney(raw: string | undefined): number | undefined {
  const cell = cleanCell(raw).replace(/[$,]/g, '');
  if (!cell) return undefined;
  const n = Number(cell);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The team began keeping these books in the 2024-2025 season. A parsed year
 * earlier than this is a typo for the same month in the surrounding block --
 * the one live instance is a Spark Fun order dated 10/1/2015, sitting between
 * rows dated 8/6/2025 and 10/2/2025 -- so the century-scale slip is corrected
 * rather than carried into the ledger.
 */
const EARLIEST_REAL_YEAR = 2024;

export function parseSheetDate(raw: string | undefined): string | undefined {
  const cell = cleanCell(raw);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(cell);
  if (!m) return undefined;

  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (year < EARLIEST_REAL_YEAR) year = year + Math.ceil((EARLIEST_REAL_YEAR - year) / 10) * 10;

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** An FRC season runs September to August, so a spring date belongs to the year before it. */
export function seasonFromSheet(raw: string | undefined, isoDate?: string): string {
  const cell = cleanCell(raw);
  if (/^\d{4}-\d{4}$/.test(cell)) return cell;
  if (!isoDate) return '';
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 9 ? year : year - 1;
  return `${start}-${start + 1}`;
}

const GRANT_STATUSES: Record<string, GrantStatus> = {
  drafting: 'drafting',
  submitted: 'submitted',
  accepted: 'awarded',
  awarded: 'awarded',
  'awaiting approval': 'awaiting_approval',
  // The sheet's "Declined" means the funder said no, which is now its own
  // outcome rather than the old catch-all `rejected`.
  declined: 'declined',
  rejected: 'declined',
  dropped: 'dropped',
  backlog: 'backlog'
};

/** An un-triaged opportunity belongs in the board's first column, not nowhere. */
export function mapGrantStatus(raw: string | undefined): GrantStatus {
  return GRANT_STATUSES[cleanCell(raw).toLowerCase()] ?? 'backlog';
}

/**
 * Funders ruled out in the sheet's comment threads, with the reason given.
 *
 * These are not rejections by the funder -- they are findings that the team
 * should not be applying at all, and without them recorded somebody
 * re-researches the same dead end next season. The reason travels with the
 * grant so the answer is on the card rather than in a comment nobody opens.
 *
 * Matched by pattern rather than exact name because the same funder is spelled
 * differently in the pipeline and the directory tabs ("U.S national science
 * foundation" against "National Science Foundation STEM Grants"), and one is
 * simply a typo ("Amozon").
 */
export const DO_NOT_PURSUE: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /raspberry ?pi/i,
    reason:
      'The Raspberry Pi Foundation is a non-profit and is not in a position to donate to teams. Their support is the lesson resources on their site.'
  },
  {
    pattern: /department of war|dowstem/i,
    reason: 'Goes through the FIRST portal rather than being a grant we apply for ourselves.'
  },
  {
    pattern: /github/i,
    reason:
      'They do not do grants, just access to their pro tools, none of which we need or want.'
  },
  {
    pattern: /national science foundation|\bnsf\b/i,
    reason:
      'Intended for research projects awarding hundreds of thousands of dollars. Unrelated to what we do.'
  },
  {
    pattern: /google/i,
    reason:
      'Not something we apply for. Intended for larger projects, and it needs a Google employee to mentor or personally sponsor the team.'
  },
  {
    pattern: /eversource/i,
    reason:
      'Eversource sponsor NEFIRST directly rather than individual teams. The link on the sheet was a paid grant-aggregator service, not their giving page.'
  },
  {
    pattern: /am[ao]zon future engineer/i,
    reason:
      'Should go through the FIRST dashboard rather than a direct application — still to be confirmed.'
  }
];

/** The reason this funder was ruled out, if it was. */
export function doNotPursueReason(funder: string): string | undefined {
  const name = cleanCell(funder);
  if (!name) return undefined;
  return DO_NOT_PURSUE.find((rule) => rule.pattern.test(name))?.reason;
}

export interface MappedDeadline {
  deadlineType: DeadlineType;
  deadline?: string;
  deadlineNote?: string;
}

/** Prose meaning "no closing date", as opposed to prose meaning "we don't know yet". */
const ROLLING = /rolling|year.?round|all year|ongoing|any ?time|open|multiple|varies/i;

export function mapDeadline(raw: string | undefined): MappedDeadline {
  const cell = cleanCell(raw);
  if (!cell) return { deadlineType: 'tbd' };

  const iso = parseSheetDate(cell);
  if (iso) return { deadlineType: 'fixed', deadline: iso };

  // The words are kept either way: "Mar 13 / Jul 17 / Oct 9" carries more than
  // any single field could, and losing it would make the row less useful than
  // the spreadsheet it replaced.
  return { deadlineType: ROLLING.test(cell) ? 'rolling' : 'tbd', deadlineNote: cell };
}

const EXPENSE_CATEGORIES: Record<string, ExpenseCategory> = {
  'machine parts': 'robot_parts',
  tools: 'tools_shop',
  'competition entry fees': 'registration_fees',
  'travel & lodging': 'competition_travel',
  // The competition_travel note covers lodging, buses, food and fuel.
  food: 'competition_travel',
  // XRP kits, dev boards and filament bought to teach students, which is the
  // outreach programme rather than the competition robot.
  'educational tools': 'outreach_events',
  // team_operations explicitly covers bank fees.
  'hack club service fees': 'team_operations',
  other: 'team_operations'
};

export function mapExpenseCategory(raw: string | undefined): ExpenseCategory {
  return EXPENSE_CATEGORIES[cleanCell(raw).toLowerCase()] ?? 'uncategorized';
}

const INCOME_CATEGORIES: Record<string, IncomeCategory> = {
  grant: 'grants',
  sponsorship: 'sponsorships',
  'pail shakes': 'fundraising',
  'bottle drive': 'fundraising',
  'silent auction': 'fundraising',
  'dine with us': 'fundraising',
  'flower sale': 'fundraising',
  'apparel fundraiser': 'fundraising',
  // Sic: the sheet's own spelling of "Student Dues".
  'studen dues': 'fundraising',
  'student dues': 'fundraising'
};

/**
 * Gifts the sheet files under "Sponsorship" that are really personal cheques.
 * Listed explicitly rather than guessed from the wording: telling a person
 * from a company by pattern would misfile "Kenneth Lynch & Sons" as often as
 * it caught anything, and misfiling shows up in the Donors view.
 */
const PERSONAL_GIFTS = new Set([
  "donation - seamus's grandfather",
  'buckley personal check'
]);

/**
 * Deposit titles rewritten before they leave this import.
 *
 * The budget sheet's description column is free text a human typed about
 * whoever wrote the cheque, and three of its rows name a person. Those titles
 * become `incomeDeposits.title`, which `income.list` emits **unauthenticated**,
 * and `donors.displayName`, which is a public table as well:
 *
 *  - "Kenneth Lynch & Sons - Dumoullin" -- `Dumoullin` is the surname of the
 *    sponsor's business contact, an adult whose details otherwise live only
 *    in `contacts`, behind `requireActor`. It is quoted a second time in the
 *    sponsor's own `notes`, also public.
 *  - "Buckley Personal Check" and "Donation - Seamus's Grandfather" -- a
 *    student's surname and a student's first name. `Seamus Buckley` is an
 *    assignee in the grant pipeline sheet; these are the same person's family.
 *
 * Section 5 of the design rules that donor names stay public, and the reason
 * it gives is that they are already public on Hack Club Bank. These three are
 * not HCB gifts -- they are school-account deposits typed into a spreadsheet
 * -- so that ruling does not reach them, and a student's family name reaching
 * a stranger through a deposit title is the exact class of disclosure this
 * branch exists to remove.
 *
 * Rewritten rather than dropped: the money is real and has to stay in the
 * ledger, and the label has to keep pointing at where it came from so a
 * deposit can still be reconciled. The house style across the other ~100
 * deposits is the source's name, so these follow it.
 *
 * The two Buckley gifts map to the same string on purpose -- the owner
 * confirms both are from that family -- so they resolve to one `donors` row
 * rather than two. That is the accurate shape: one family, one donor, two
 * deposits, told apart by date and amount like every other repeat giver.
 *
 * Keyed on the raw text and applied *after* categorisation, never before:
 * `PERSONAL_GIFTS` above recognises two of these same strings to file them as
 * `major_donors` rather than `sponsorships`. Scrub first and both would
 * silently refile themselves as sponsorships.
 */
export const DEPOSIT_TITLE_OVERRIDES: Record<string, string> = {
  'Kenneth Lynch & Sons - Dumoullin': 'Kenneth Lynch & Sons',
  'Buckley Personal Check': 'Donation - Buckley Family',
  "Donation - Seamus's Grandfather": 'Donation - Buckley Family'
};

/**
 * Sheet notes that name a person, keyed on the raw cell text.
 *
 * `grants.list` is unauthenticated, so a note is published prose. The one
 * entry here reads "call Uncle about geting the grant" -- it identifies
 * nobody by name, but it is a team member's family relationship on a public
 * endpoint, and the owner's answer was that it is useless as a note anyway
 * because there is no way to tell whose uncle. Mapped to nothing rather than
 * rewritten: unlike a deposit title, a grant note carries no money and
 * dropping it loses no record.
 */
export const GRANT_NOTE_DROPS = new Set(['call Uncle about geting the grant']);

/** The sheet note as it may be published. Anything not dropped passes through. */
export function publicGrantNote(note: string): string {
  return GRANT_NOTE_DROPS.has(note) ? '' : note;
}

/**
 * The donor behind a deposit title, for the `donors` registry.
 *
 * A deposit title follows the sheet's house style and often leads with
 * `Donation - `; the donor row underneath should read like the others
 * ("Bal Family", "Baldelli Company"), not repeat the prefix. Stripping it here
 * rather than in the registry keeps the one place that knows about the sheet's
 * phrasing in the mapping layer.
 */
export function donorNameFromTitle(title: string): string {
  return title.replace(/^Donation\s*-\s*/i, '').trim() || title;
}

/** The deposit title as it may be published. Unlisted titles pass through. */
export function publicDepositTitle(description: string): string {
  return DEPOSIT_TITLE_OVERRIDES[description] ?? description;
}

export function mapIncomeCategory(
  rawCategory: string | undefined,
  description: string | undefined,
  _amount: number
): IncomeCategory {
  const mapped = INCOME_CATEGORIES[cleanCell(rawCategory).toLowerCase()];
  if (!mapped) return 'uncategorized';
  if (mapped === 'sponsorships' && PERSONAL_GIFTS.has(cleanCell(description).toLowerCase())) {
    return 'major_donors';
  }
  return mapped;
}

/**
 * Every row the sheet files under "Hack Club" is a donation that arrived
 * through HCB, which the app already fetches live from the HCB API on every
 * load. Importing them as deposits too would double-count them in the ledger
 * whenever the date typed here differs from the date HCB settled on.
 */
export function isHcbSourcedIncome(rawCategory: string | undefined): boolean {
  return cleanCell(rawCategory).toLowerCase() === 'hack club';
}

export interface HcbDebit {
  id: string;
  amount_cents: number;
  date: string;
}

/**
 * Whether the live bank feed already reports this purchase.
 *
 * Fiscal sponsorship fees only exist inside HCB, so they go by category. Every
 * other row is matched against the real debits by amount, and each debit is
 * consumed at most once: the sheet holds two $136.35 Swerve Drive rows on
 * consecutive days against a single debit, and keeping the second one means a
 * human gets to decide whether it is a duplicate or a second order, rather
 * than the import quietly dropping a real purchase.
 *
 * `debits` is mutated -- callers pass a pool and it shrinks as rows claim it.
 */
export function isHcbSourcedExpense(
  rawCategory: string | undefined,
  amount: number,
  debits: HcbDebit[]
): boolean {
  if (cleanCell(rawCategory).toLowerCase() === 'hack club service fees') return true;

  const cents = Math.round(amount * 100);
  const i = debits.findIndex((d) => Math.abs(d.amount_cents) === cents);
  if (i === -1) return false;
  debits.splice(i, 1);
  return true;
}

/** Text that looks like a link, as opposed to a page title or the word "none". */
const NOT_A_VALUE = /^(none|n\/a|na|tbd|\(?will open soon\)?|unknown|-)$/i;

export function cleanUrl(raw: string | undefined): string | undefined {
  const cell = cleanCell(raw);
  if (!cell || NOT_A_VALUE.test(cell)) return undefined;
  if (/^https?:\/\//i.test(cell)) return cell;
  // A bare domain is still a link; anything with a space in it is a page title
  // somebody pasted into the wrong column.
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(cell)) return `https://${cell}`;
  return undefined;
}

export function cleanEmail(raw: string | undefined): string {
  const cell = cleanCell(raw);
  if (!cell || NOT_A_VALUE.test(cell)) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) return '';
  return cell.toLowerCase();
}
