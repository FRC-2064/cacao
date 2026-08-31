/**
 * Generates `src/lib/data/teamData.ts` from the team's two Google Sheets.
 *
 *     npm run generate:dataset
 *
 * (i.e. `node scripts/import/generate.ts` -- this file and the modules it
 * pulls in import each other with explicit `.ts` extensions, which Node's own
 * type stripping resolves and vite-node does not.)
 *
 * The CSV exports and a snapshot of the HCB transaction feed live in `data/`,
 * which is **gitignored**: this repository is public, and those files carry a
 * mentor's cell number and personal email, fourteen students' full names, and
 * donor addresses -- the very data this generator exists to strip. Keep them
 * locally. Given the same inputs the output is byte-identical, and the
 * decisions it makes are the ones in `mapping.ts`, under test.
 *
 * Source workbooks:
 *   grants  1qjqCBoeMgk0K1eTi4KD7w28UMXfssaTpvy50LjmxKys
 *   budget  1M1w1Py6W8fD9tWkUEJkz8-5XR5qMrDboonS9V_x1qMo
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.ts';
import { normalizeDonorName } from '../../convex/donorNames.ts';
import {
  cleanCell,
  cleanEmail,
  cleanUrl,
  isHcbSourcedExpense,
  isHcbSourcedIncome,
  mapDeadline,
  mapExpenseCategory,
  mapGrantStatus,
  mapIncomeCategory,
  doNotPursueReason,
  parseMoney,
  parseSheetDate,
  donorNameFromTitle,
  publicDepositTitle,
  publicGrantNote,
  seasonFromSheet,
  type HcbDebit
} from './mapping.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const OUT = join(HERE, '..', '..', 'src', 'lib', 'data', 'teamData.ts');

const read = (name: string) => parseCsv(readFileSync(join(DATA, name), 'utf8'));

/**
 * Every generated record carries this as its timestamp. A fixed instant keeps
 * the output stable across runs, so re-generating shows only real changes in
 * the diff. It is the day the sheets were exported.
 */
const IMPORTED_AT = Date.parse('2026-08-27T00:00:00Z');
const ts = (iso?: string) => (iso ? Date.parse(`${iso}T12:00:00Z`) : IMPORTED_AT);

/**
 * Every "who did this" reference the schema requires -- `accounts.updatedById`,
 * `expenses.requesterId`, `incomeDeposits.loggedById`, `teamInfo.updatedById`
 * -- is a real, non-optional `v.id("users")` at the database layer; there is
 * no blank to leave it. `TEAM_USERS` below is deliberately `[]` (seeding a
 * placeholder admin would leave an unclaimable, nameless row in the roster
 * forever -- the roster fills as people sign in), so this id resolves to
 * nobody inside this file alone.
 *
 * It is a placeholder *local* id, used consistently everywhere a "who did
 * this" field is required. Whatever performs the real import is expected to
 * append one entry with this `_id` to the `users` array it sends to
 * `api.seed.importAll` -- e.g. the admin who just claimed the first account
 * and is running the one-shot import -- so `requireRef` resolves it to that
 * real, signed-in person rather than this file ever inventing an attribution
 * nobody supplied. See `convex/seed.ts`'s own `requireRef`/`optionalRef` doc
 * comment for the mutation side of this contract.
 */
const IMPORT_ACTOR_ID = 'import_actor';

/** The one account this import creates a baseline for. */
const SCHOOL_ACCOUNT_ID = 'account_1';

/** The season the sheets were exported in, for rows that name none. */
const CURRENT_SEASON = '2026-2027';

const notes: string[] = [];
const note = (s: string) => notes.push(s);

// ── Seasons ─────────────────────────────────────────────────────────────────

interface SeasonRow {
  _id: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

/**
 * Find-or-create registry so every reference to the same season label (an
 * FRC year, e.g. "2026-2027") converges on one row instead of a free-text
 * column repeated on every record.
 */
class SeasonRegistry {
  private byLabel = new Map<string, SeasonRow>();

  idFor(rawLabel: string): string {
    const label = rawLabel || CURRENT_SEASON;
    let row = this.byLabel.get(label);
    if (!row) {
      const year = Number(label.slice(0, 4));
      row = {
        _id: `season_${label}`,
        label,
        startDate: `${year}-09-01`,
        endDate: `${year + 1}-08-31`,
        isCurrent: false
      };
      this.byLabel.set(label, row);
    }
    return row._id;
  }

  /** Every season seen, sorted by label, with the latest marked current. */
  rows(): SeasonRow[] {
    const list = [...this.byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (list.length > 0) list[list.length - 1] = { ...list[list.length - 1], isCurrent: true };
    return list;
  }
}

// ── Donors ──────────────────────────────────────────────────────────────────

interface DonorRow {
  _id: string;
  displayName: string;
  normalizedKey: string;
  isAnonymous: boolean;
}

/**
 * Find-or-create registry keyed by `normalizeDonorName` -- the same key
 * `convex/donors.ts` uses at write time and `src/lib/finance/donors.ts` uses
 * to group gifts in the app, all three from one implementation -- so that
 * spelling variants of one donor converge on a single row instead of a
 * free-text name repeated on every gift.
 */
class DonorRegistry {
  private byKey = new Map<string, DonorRow>();

  idFor(rawName: string): string {
    const displayName = cleanCell(rawName);
    const key = normalizeDonorName(displayName) || displayName.toLowerCase();
    let row = this.byKey.get(key);
    if (!row) {
      row = {
        _id: `donor_${this.byKey.size + 1}`,
        displayName,
        normalizedKey: key,
        isAnonymous: false
      };
      this.byKey.set(key, row);
    }
    return row._id;
  }

  rows(): DonorRow[] {
    return [...this.byKey.values()];
  }
}

// ── Team info ───────────────────────────────────────────────────────────────

interface TeamInfoRow {
  _id: string;
  label: string;
  value: string;
  order: number;
  updatedAt: number;
  updatedById: string;
}

function buildTeamInfo(): TeamInfoRow[] {
  const rows = read('g_teaminfo.csv');
  const out: TeamInfoRow[] = [];

  for (const [i, [raw]] of rows.entries()) {
    const line = cleanCell(raw);
    if (!line || /^helpful information/i.test(line)) continue;

    // Most lines are "Label: Value". "Founded in 2007" is the one that is not,
    // and splitting it on a colon that is not there would lose it.
    let label: string;
    let value: string;
    const colon = line.indexOf(':');
    if (colon > 0) {
      label = cleanCell(line.slice(0, colon));
      value = cleanCell(line.slice(colon + 1));
    } else {
      const founded = /^founded in (\d{4})$/i.exec(line);
      if (!founded) {
        // The sheet row, never the line. This branch fires on whatever the
        // sheet happens to hold in an unlabelled row, which is unbounded --
        // and these notes get printed to a terminal and pasted into commit
        // messages and chat. The row number is enough to go and look.
        note(`Team info sheet row ${i + 1} kept verbatim, no label found`);
        label = 'Note';
        value = line;
      } else {
        label = 'Founded';
        value = founded[1];
      }
    }
    if (!value) continue;

    // A mentor's personal cell phone and email, not the boilerplate every
    // grant application asks for (EIN, address, member count) -- and exactly
    // the kind of personal data this import must not carry. Dropped rather
    // than imported and scrubbed after the fact.
    if (/^mentor contact$/i.test(label)) {
      // The line itself is a mentor's name, cell phone and email. Naming the
      // label is enough to find it in the sheet; echoing the value would put
      // all three into a terminal, and from there into a commit or a chat --
      // the same leak this import exists to close.
      note(`Team info line dropped, carries a mentor's personal contact info: "${label}"`);
      continue;
    }

    out.push({
      _id: `info_${out.length + 1}`,
      label,
      value,
      order: out.length,
      updatedAt: IMPORTED_AT,
      updatedById: IMPORT_ACTOR_ID
    });
  }
  return out;
}

// ── Wishlist ────────────────────────────────────────────────────────────────

interface WishlistRow {
  _id: string;
  tool: string;
  company?: string;
  cost: number;
  source: 'grant' | 'purchase';
  priority: number;
  description?: string;
  updatedAt: number;
}

function buildWishlist(): WishlistRow[] {
  const [, ...rows] = read('g_wishlist.csv');
  const out: WishlistRow[] = [];

  for (const r of rows) {
    const tool = cleanCell(r[0]);
    const cost = parseMoney(r[2]);
    if (!tool || cost === undefined) continue;

    const company = cleanCell(r[1]);
    const priority = Number(cleanCell(r[4]));

    out.push({
      _id: `wish_${out.length + 1}`,
      tool,
      // "N/A" is what the sheet says for the road cases; it is an answer, not
      // a blank, so it is kept rather than normalised away.
      company: company || undefined,
      cost,
      source: /grant/i.test(cleanCell(r[3])) ? 'grant' : 'purchase',
      priority: Number.isFinite(priority) ? Math.min(10, Math.max(1, priority)) : 5,
      description: cleanCell(r[5]) || undefined,
      updatedAt: IMPORTED_AT
    });
  }
  return out;
}

// ── Grants ──────────────────────────────────────────────────────────────────

interface GrantRow {
  _id: string;
  title: string;
  funder: string;
  amount: number;
  currency: string;
  status: string;
  deadline?: string;
  deadlineType: string;
  deadlineNote?: string;
  priority: string;
  seasonId: string;
  portalUrl?: string;
  docUrl?: string;
  fileNote?: string;
  requirements: { id: string; title: string; done: boolean }[];
  notes?: string;
  order: number;
  updatedAt: number;
}

const normaliseFunder = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(foundation|grants?|sponsorship|community|education|inc\.?|llc)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

function buildGrants(seasons: SeasonRegistry): GrantRow[] {
  const out: GrantRow[] = [];
  const seen = new Set<string>();

  // Grant Pipeline: what the team is actually working on.
  const [, ...pipeline] = read('g_pipeline.csv');
  for (const r of pipeline) {
    const funder = cleanCell(r[2]);
    const name = cleanCell(r[1]);
    if (!funder && !name) continue;

    // The pipeline tab lists Ion Bank Foundation twice, which a comment on the
    // second row flags. Deduping only the directory against the pipeline left
    // both of them on the board.
    const key = normaliseFunder(funder || name);
    if (seen.has(key)) {
      note(`Pipeline row skipped as a duplicate of an earlier row: "${funder || name}"`);
      continue;
    }

    const deadline = mapDeadline(r[7]);
    const requirement = cleanCell(r[6]);
    const document = cleanCell(r[8]);
    const docUrl = cleanUrl(document);

    seen.add(key);

    // A funder ruled out in the sheet's comments is dropped rather than
    // declined: the funder never said no, we established we should not be
    // applying. The reason leads the notes so it is the first thing read.
    const ruledOut = doNotPursueReason(funder || name);
    const sheetNotes = publicGrantNote(cleanCell(r[10]));

    out.push({
      _id: `grant_${out.length + 1}`,
      title: name || funder,
      funder: funder || name,
      amount: parseMoney(r[9]) ?? 0,
      currency: 'USD',
      status: ruledOut ? 'dropped' : mapGrantStatus(r[4]),
      ...deadline,
      // Everything on the pipeline is live work; the directory below is the
      // long tail, and giving the two the same priority would flatten the
      // distinction the board exists to show.
      priority: 'medium',
      seasonId: seasons.idFor(seasonFromSheet(r[0], deadline.deadline)),
      portalUrl: cleanUrl(r[3]),
      docUrl,
      // The Document column holds a Drive link on some rows and a filename or
      // an email subject line on others. Only the links are useful as links.
      fileNote: docUrl ? undefined : document || undefined,
      requirements: requirement ? [{ id: 'req_1', title: requirement, done: false }] : [],
      notes: [ruledOut, sheetNotes].filter(Boolean).join(' · ') || undefined,
      order: out.length,
      updatedAt: IMPORTED_AT
    });
  }
  const pipelineCount = out.length;

  // Grant Directory: researched opportunities nobody has started. These are
  // real leads, so they belong in the backlog column rather than being
  // dropped -- but at low priority, so they never outrank live work.
  const [, ...directory] = read('g_directory.csv');
  for (const r of directory) {
    const funder = cleanCell(r[2]);
    if (!funder) continue;

    const key = normaliseFunder(funder);
    if (seen.has(key)) continue;
    seen.add(key);

    const strategy = cleanCell(r[7]);
    const type = cleanCell(r[6]);
    const bestMonth = cleanCell(r[5]);
    const ruledOut = doNotPursueReason(funder);
    const detail = [
      ruledOut,
      type && `Type: ${type}`,
      bestMonth && `Best month: ${bestMonth}`,
      strategy
    ]
      .filter(Boolean)
      .join(' · ');

    out.push({
      _id: `grant_${out.length + 1}`,
      title: funder,
      funder,
      amount: 0,
      currency: 'USD',
      // A ruled-out lead must not sit in the backlog waiting to be researched
      // again -- that is the whole reason the finding was written down.
      status: ruledOut ? 'dropped' : 'backlog',
      ...mapDeadline(r[4]),
      priority: 'low',
      seasonId: seasons.idFor(CURRENT_SEASON),
      portalUrl: cleanUrl(r[3]),
      requirements: [],
      notes: detail || undefined,
      order: out.length,
      updatedAt: IMPORTED_AT
    });
  }

  note(
    `Grants: ${pipelineCount} from Grant Pipeline, ${out.length - pipelineCount} from Grant Directory ` +
      `(${directory.length - (out.length - pipelineCount)} directory rows deduped against the pipeline)`
  );
  return out;
}

// ── Sponsors, contacts & outreach ───────────────────────────────────────────

/**
 * Sponsors the team actually banked, named from the budget sheet's own
 * description of each deposit. Listed explicitly rather than derived: turning
 * "Kenneth Lynch & Sons - Dumoullin" into an organisation name by rule would
 * need a rule that also handles "Haas Sponsorship" and "PTO STEM Donation",
 * and a wrong guess here becomes a wrong name on a thank-you letter.
 */
const SPONSOR_NAMES: Record<string, string> = {
  'Sperry Logistics': 'Sperry Logistics',
  'Haas Sponsorship': 'Haas',
  'Kenneth Lynch & Sons - Dumoullin': 'Kenneth Lynch & Sons',
  'Ansys Inc.': 'Ansys',
  PwC: 'PwC',
  'Donation - Baldelli Company': 'Baldelli Company',
  'PTO STEM Donation': 'PTO STEM'
};

function tierFor(total: number): string {
  if (total >= 5000) return 'platinum';
  if (total >= 2500) return 'gold';
  if (total >= 1000) return 'silver';
  if (total >= 500) return 'bronze';
  return 'none';
}

interface ContactRow {
  _id: string;
  sponsorId?: string;
  name: string;
  title: string;
  email: string;
  phone?: string;
  isPrimary: boolean;
  preferredMethod: string;
  notes?: string;
  updatedAt: number;
}

interface SponsorOutreachRow {
  _id: string;
  sponsorId: string;
  year: number;
  status: string;
  amount?: number;
  notes?: string;
  contactedDate?: string;
}

interface SponsorRow {
  _id: string;
  name: string;
  category: string;
  tier: string;
  status: string;
  totalDonated: number;
  lastContactDate?: string;
  address?: string;
  notes?: string;
  primaryContactId?: string;
  updatedAt: number;
}

/**
 * A sponsor's point of contact is now its own row in `contacts`, linked back
 * by `primaryContactId`, rather than an inline `primaryContactName` /
 * `primaryContactEmail` pair on the sponsor. `contacts` are adult business
 * contacts, deliberately retained with their emails -- unlike every other
 * "who" field in this file, this one is allowed to carry one.
 *
 * `contacts` is threaded through by reference (mutated in place) so that
 * `buildContacts` below can keep numbering `_id`s after whatever this
 * function already added.
 */
function buildSponsorsAndOutreach(
  income: IncomeSource[],
  contacts: ContactRow[]
): { sponsors: SponsorRow[]; outreach: SponsorOutreachRow[] } {
  const sponsors: SponsorRow[] = [];
  const outreach: SponsorOutreachRow[] = [];

  const addContact = (
    sponsorId: string,
    sponsorName: string,
    personName: string,
    email: string
  ): string | undefined => {
    if (!personName && !email) return undefined;
    const _id = `contact_${contacts.length + 1}`;
    contacts.push({
      _id,
      sponsorId,
      // Where there is no named person, the business itself is the contact.
      name: personName || sponsorName,
      title: personName ? 'Business contact' : 'Business',
      email,
      isPrimary: true,
      preferredMethod: email ? 'email' : 'phone',
      updatedAt: IMPORTED_AT
    });
    return _id;
  };

  // Companies that gave money, from the budget sheet.
  const byName = new Map<string, { amount: number; date?: string; raw: string }[]>();
  for (const row of income) {
    if (row.category !== 'sponsorships') continue;
    const name = SPONSOR_NAMES[row.description];
    if (!name) {
      // Same reason as the undated-deposit note above: this is the deposit
      // title column, not a sponsor name we have already recognised.
      note(
        `Transactions sheet row ${row.sheetRow}: sponsorship deposit with no sponsor name mapping, left as a deposit only`
      );
      continue;
    }
    const list = byName.get(name) ?? [];
    // The rewritten title, not the sheet's: this string is quoted verbatim
    // into `sponsors.notes`, which `sponsors.list` emits unauthenticated.
    list.push({ amount: row.amount, date: row.date, raw: row.publicTitle });
    byName.set(name, list);
  }

  for (const [name, gifts] of byName) {
    const total = gifts.reduce((sum, g) => sum + g.amount, 0);
    const dates = gifts.map((g) => g.date).filter(Boolean).sort() as string[];
    const sponsorId = `sponsor_${sponsors.length + 1}`;

    const primaryContactId =
      name === 'Kenneth Lynch & Sons' ? addContact(sponsorId, name, 'Dumoullin', '') : undefined;

    sponsors.push({
      _id: sponsorId,
      name,
      category: 'corporate',
      tier: tierFor(total),
      status: 'paid_active',
      totalDonated: total,
      lastContactDate: dates.at(-1),
      notes: `Imported from the budget sheet as "${gifts[0].raw}".`,
      primaryContactId,
      updatedAt: IMPORTED_AT
    });

    for (const g of gifts) {
      outreach.push({
        _id: `outreach_${outreach.length + 1}`,
        sponsorId,
        year: g.date ? Number(g.date.slice(0, 4)) : new Date(IMPORTED_AT).getFullYear(),
        status: 'received',
        amount: g.amount,
        contactedDate: g.date
      });
    }
  }

  // Sponsor Pipeline: outreach in progress, no money yet.
  const PIPELINE_STATUS: Record<string, string> = {
    contacted: 'contacted',
    accepted: 'pledged',
    declined: 'declined',
    'in discussion': 'in_discussion'
  };
  const [, ...pipeline] = read('g_sponsors.csv');
  for (const r of pipeline) {
    const name = cleanCell(r[0]);
    if (!name) continue;
    // The sheet's own placeholder row, not a real prospect.
    if (/^example company$/i.test(name)) {
      note('Skipped the "Example Company" placeholder row on the Sponsor Pipeline tab');
      continue;
    }

    const sponsorId = `sponsor_${sponsors.length + 1}`;
    const contactName = cleanCell(r[5]);
    const email = cleanEmail(r[6]);
    const primaryContactId = addContact(sponsorId, name, contactName, email);

    sponsors.push({
      _id: sponsorId,
      name,
      category: 'local_business',
      tier: 'none',
      status: PIPELINE_STATUS[cleanCell(r[9]).toLowerCase()] ?? 'lead',
      totalDonated: 0,
      lastContactDate: parseSheetDate(r[10]),
      address: [cleanCell(r[2]), cleanCell(r[1])].filter(Boolean).join(', ') || undefined,
      notes: cleanCell(r[11]) || undefined,
      primaryContactId,
      updatedAt: IMPORTED_AT
    });
  }

  return { sponsors, outreach };
}

/**
 * Business contacts researched for sponsorship/in-kind asks, independent of
 * whether the business ever became a funded sponsor. Linked to a sponsor row
 * by name when one matches; left unlinked otherwise, since most of this sheet
 * is prospects nobody has banked money from yet.
 */
function buildContacts(contacts: ContactRow[], sponsorIdByName: Map<string, string>): void {
  const [, ...rows] = read('g_contacts.csv');

  for (const [i, r] of rows.entries()) {
    const business = cleanCell(r[0]);
    if (!business) {
      // Deliberately not the address itself: these notes get printed to a
      // terminal and pasted into commit messages and chat. The sheet row is
      // enough to go and look, and the whole point of this import is that a
      // real address never leaves the spreadsheet.
      const orphan = cleanEmail(r[3]);
      note(
        orphan
          ? `Skipped Contacts sheet row ${i + 2}: an email address but no business name`
          : `Skipped Contacts sheet row ${i + 2}: blank`
      );
      continue;
    }

    // The "Contact Name" column is used loosely: about half the rows hold a
    // URL or a page title there instead of a person. Where there is no person,
    // the business is the contact.
    const rawName = cleanCell(r[2]);
    const isPerson = rawName && !cleanUrl(rawName) && !/https?:|\|/i.test(rawName);
    const email = cleanEmail(r[3]);
    const phone = cleanCell(r[4]).replace(/^none$/i, '');
    const location = cleanCell(r[1]);

    contacts.push({
      _id: `contact_${contacts.length + 1}`,
      sponsorId: sponsorIdByName.get(business.toLowerCase()),
      name: isPerson ? rawName : business,
      title: isPerson ? 'Business contact' : 'Business',
      email,
      phone: phone || undefined,
      isPrimary: true,
      preferredMethod: email ? 'email' : 'phone',
      // The sheet's "done by" column names the student who researched the
      // business. It said nothing about the contact and everything about a
      // minor, so it is dropped rather than carried into a note.
      notes: [
        location && !cleanUrl(location) ? location : undefined,
        cleanUrl(location) ? `Site: ${cleanUrl(location)}` : undefined
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
      updatedAt: IMPORTED_AT
    });
  }
}

// ── Transactions ────────────────────────────────────────────────────────────

interface IncomeSource {
  /**
   * The 1-based row of `b_txns.csv` this came from, carried so a diagnostic
   * can say *which* deposit it is talking about without printing the
   * description. That column is the deposit title, and it is the field that
   * produced "Donation - Seamus's Grandfather" and "Buckley Personal Check" --
   * free text a human typed about a person. Notes printed here end up in a
   * terminal, and from there in a commit message or a chat.
   */
  sheetRow: number;
  season: string;
  date?: string;
  amount: number;
  /**
   * The sheet's own text, kept for *matching* only -- `PERSONAL_GIFTS` and
   * `SPONSOR_NAMES` are both keyed on it. Never emitted: three of these rows
   * name a person. Use `publicTitle` for anything that lands in the dataset.
   */
  description: string;
  /** `description` with the three person-naming titles rewritten. */
  publicTitle: string;
  sheetCategory: string;
  category: string;
}

/**
 * Vendor names, recognised from the sheet's free-text description. The
 * expenses table wants a vendor and the sheet has no such column; guessing
 * from the first word would make "Hotel Reimbursement for 6 Rooms" a vendor
 * called "Hotel".
 */
const VENDOR_RULES: [RegExp, string][] = [
  [/mcmaster/i, 'McMaster-Carr'],
  [/andymark/i, 'AndyMark'],
  [/\bwcp\b|west coast prod/i, 'West Coast Products'],
  [/thriftybot/i, 'The Thrifty Bot'],
  [/swerve drive specialties/i, 'Swerve Drive Specialties'],
  [/amazon/i, 'Amazon'],
  [/ingenuityne/i, 'IngenuityNE'],
  [/wiwi/i, 'WIWI'],
  [/state championship/i, 'FIRST Connecticut'],
  [/spark ?fun/i, 'SparkFun'],
  [/home depot/i, 'The Home Depot'],
  [/online metal/i, 'Online Metals']
];

const vendorFor = (description: string) =>
  VENDOR_RULES.find(([re]) => re.test(description))?.[1] ?? '';

interface ExpenseRow {
  _id: string;
  title: string;
  vendor: string;
  amount: number;
  currency: string;
  category: string;
  requesterId: string;
  status: string;
  seasonId: string;
  paymentMethod: string;
  accountId?: string;
  date?: string;
  donorId?: string;
  taxYear?: number;
  notes?: string;
  purchasedAt?: number;
  reimbursedAt?: number;
  updatedAt: number;
}

function buildTransactions(seasons: SeasonRegistry, donors: DonorRegistry) {
  const rows = read('b_txns.csv').slice(1);

  const debits: HcbDebit[] = (
    JSON.parse(readFileSync(join(DATA, 'hcb-transactions.json'), 'utf8')) as HcbDebit[]
  ).filter((t) => t.amount_cents < 0);

  const expenses: ExpenseRow[] = [];
  const income: IncomeSource[] = [];
  let skippedExpenses = 0;
  let skippedIncome = 0;

  // `rows` has already had its header sliced off, so the spreadsheet's own
  // row number is `i + 2`.
  for (const [i, raw] of rows.entries()) {
    const sheetRow = i + 2;
    const r = [...raw, ...Array(13).fill('')];

    // The transactions tab is two tables side by side: expenses in columns
    // B-F, income in columns H-L.
    const expAmount = parseMoney(r[3]);
    if (expAmount !== undefined) {
      const sheetCategory = cleanCell(r[5]);
      const description = cleanCell(r[4]);
      if (isHcbSourcedExpense(sheetCategory, expAmount, debits)) {
        skippedExpenses++;
      } else {
        const date = parseSheetDate(r[2]);
        const reimbursed = /reimbursement/i.test(description);
        const schoolPo = /through school/i.test(description);
        expenses.push({
          _id: `expense_${expenses.length + 1}`,
          title: description,
          vendor: vendorFor(description),
          amount: expAmount,
          currency: 'USD',
          category: mapExpenseCategory(sheetCategory),
          requesterId: IMPORT_ACTOR_ID,
          status: reimbursed ? 'reimbursed' : 'purchased',
          seasonId: seasons.idFor(seasonFromSheet(r[1], date)),
          paymentMethod: reimbursed
            ? 'personal_reimbursement'
            : schoolPo
              ? 'school_po'
              : 'other',
          // These are the rows the HCB feed does not report, so they were paid
          // from the school activity account. Assumed rather than stated: the
          // sheet has no account column.
          accountId: SCHOOL_ACCOUNT_ID,
          date,
          notes: `Imported from the budget sheet (${sheetCategory}).`,
          // computeBalances reads these timestamps, not `date`, so without
          // them every imported purchase would land on the import date.
          purchasedAt: ts(date),
          reimbursedAt: reimbursed ? ts(date) : undefined,
          updatedAt: IMPORTED_AT
        });
      }
    }

    const incAmount = parseMoney(r[9]);
    if (incAmount !== undefined) {
      const sheetCategory = cleanCell(r[11]);
      const description = cleanCell(r[10]);
      if (isHcbSourcedIncome(sheetCategory)) {
        skippedIncome++;
      } else {
        const date = parseSheetDate(r[8]);
        if (!date) {
          // A deposit with no date is a pledge, not money in the bank, and the
          // ledger has nowhere to put it. "CT Mini Grant 2 of 2" is the one.
          // Deliberately not the description: that column is the deposit
          // title, the same free-text field that produced "Donation -
          // Seamus's Grandfather". The row number is enough to go and look,
          // and the amount is public money either way.
          note(
            `Transactions sheet row ${sheetRow} skipped, no date on the sheet: income of $${incAmount.toLocaleString('en-US')}`
          );
          continue;
        }
        income.push({
          sheetRow,
          season: seasonFromSheet(r[7], date),
          date,
          amount: incAmount,
          description,
          // Categorised from the raw text first, then rewritten: two of the
          // three overridden titles are exactly what `PERSONAL_GIFTS` matches
          // on to file them as `major_donors` rather than `sponsorships`.
          publicTitle: publicDepositTitle(description),
          sheetCategory,
          category: mapIncomeCategory(sheetCategory, description, incAmount)
        });
      }
    }
  }

  note(
    `Expenses: ${expenses.length} imported, ${skippedExpenses} skipped as already in the live HCB feed`
  );
  note(`Income: ${income.length} imported, ${skippedIncome} skipped as Hack Club donations`);

  // In-kind gifts: a purchase somebody made and waived repayment on, which is
  // an expense with status 'donated' rather than a deposit -- no money moved
  // through a team account.
  const [, ...inKind] = read('b_inkind.csv');
  for (const r of inKind) {
    const amount = parseMoney(r[4]);
    const item = cleanCell(r[2]);
    if (amount === undefined || !item) continue;
    const date = parseSheetDate(r[1]);
    const donor = cleanCell(r[3]);

    expenses.push({
      _id: `expense_${expenses.length + 1}`,
      title: item,
      vendor: '',
      amount,
      currency: 'USD',
      category: 'team_operations',
      requesterId: IMPORT_ACTOR_ID,
      status: 'donated',
      seasonId: seasons.idFor(seasonFromSheet('', date)),
      paymentMethod: 'other',
      // A donated purchase never touched a team account.
      accountId: undefined,
      date,
      donorId: donor ? donors.idFor(donor) : undefined,
      taxYear: date ? Number(date.slice(0, 4)) : undefined,
      notes: cleanCell(r[5]) || 'Imported from the In Kind Gifts tab.',
      purchasedAt: ts(date),
      updatedAt: IMPORTED_AT
    });
  }
  note(`In-kind gifts: ${inKind.length} imported as donated expenses`);

  return { expenses, income };
}

interface DepositRow {
  _id: string;
  title: string;
  amount: number;
  category: string;
  accountId: string;
  date: string;
  loggedById: string;
  seasonId: string;
  notes?: string;
  donorId?: string;
  taxYear?: number;
  updatedAt: number;
}

function buildDeposits(
  income: IncomeSource[],
  seasons: SeasonRegistry,
  donors: DonorRegistry
): DepositRow[] {
  return income.map((row, i) => ({
    _id: `deposit_${i + 1}`,
    title: row.publicTitle,
    amount: row.amount,
    category: row.category,
    // Assumed, not stated: these are the deposits the HCB feed does not
    // report, so they went to the school activity account.
    accountId: SCHOOL_ACCOUNT_ID,
    date: row.date!,
    loggedById: IMPORT_ACTOR_ID,
    seasonId: seasons.idFor(row.season),
    notes: `Imported from the budget sheet (${row.sheetCategory}).`,
    // `donors.displayName` is a public table, so it gets the rewritten title
    // for the same reason `title` does.
    donorId:
      row.category === 'major_donors'
        ? donors.idFor(donorNameFromTitle(row.publicTitle))
        : undefined,
    taxYear: Number(row.date!.slice(0, 4)),
    updatedAt: IMPORTED_AT
  }));
}

// ── Emit ────────────────────────────────────────────────────────────────────

const json = (v: unknown) => JSON.stringify(v, null, 2);

function section(name: string, type: string, rows: unknown[]): string {
  return `export const ${name}: ${type}[] = ${json(rows)};\n`;
}

function main() {
  const seasons = new SeasonRegistry();
  const donors = new DonorRegistry();

  const teamInfo = buildTeamInfo();
  const wishlist = buildWishlist();
  const grants = buildGrants(seasons);
  const { expenses, income } = buildTransactions(seasons, donors);

  const contacts: ContactRow[] = [];
  const { sponsors, outreach } = buildSponsorsAndOutreach(income, contacts);
  const sponsorIdByName = new Map(sponsors.map((s) => [s.name.toLowerCase(), s._id]));
  buildContacts(contacts, sponsorIdByName);

  const deposits = buildDeposits(income, seasons, donors);

  const seasonRows = seasons.rows();
  const donorRows = donors.rows();

  const startBalance = 7018;
  const accounts = [
    {
      _id: SCHOOL_ACCOUNT_ID,
      key: 'school_account' as const,
      openingBalance: startBalance,
      asOfDate: '2024-09-01',
      updatedAt: IMPORTED_AT,
      updatedById: IMPORT_ACTOR_ID
    }
  ];

  const header = `// GENERATED FILE -- do not edit by hand.
//
// Produced by \`npm run generate:dataset\` from the team's two Google Sheets,
// whose CSV exports are committed under \`scripts/import/data/\`.
// To change what lands here, change the sheets or the mapping rules in
// \`scripts/import/mapping.ts\` and re-run the generator.
//
// Deliberately absent: every Hack Club donation and fiscal-sponsorship fee,
// and every purchase the live HCB feed already reports -- the app fetches
// those from the HCB API on load, and importing them too would double-count
// them -- and every student or mentor's name, email, and phone number, which
// the sheets carried freely but this app's data model has nowhere to put.
// The one exception is \`TEAM_CONTACTS\`: a sponsor's point of contact is an
// adult acting for their business, not a student, and that table exists
// specifically to hold their name, email, and phone.

/**
 * This file is an *import payload*, so what it has to satisfy is
 * \`api.seed.importAll\`'s argument validators -- not the shapes the queries
 * hand a browser. The two genuinely differ: a list query resolves person
 * references to display names and accounts to slugs, and drops the id columns
 * a seed row must carry. Deriving these from the validators means the dataset
 * is typechecked against the mutation that actually consumes it, and cannot
 * drift from it silently.
 *
 * The import is erased at build time (\`import type\`), so nothing in
 * \`convex/\` reaches the browser bundle.
 */
import type { Infer } from 'convex/values';
import type {
  seedSeason,
  seedDonor,
  seedUser,
  seedAccount,
  seedGrant,
  seedSponsor,
  seedContact,
  seedSponsorOutreach,
  seedExpense,
  seedIncome,
  seedTeamInfo,
  seedWishlistItem
} from '../../../convex/seed';

export type SeedSeason = Infer<typeof seedSeason>;
export type SeedDonor = Infer<typeof seedDonor>;
export type SeedUser = Infer<typeof seedUser>;
export type SeedAccount = Infer<typeof seedAccount>;
export type SeedGrant = Infer<typeof seedGrant>;
export type SeedSponsor = Infer<typeof seedSponsor>;
export type SeedContact = Infer<typeof seedContact>;
export type SeedSponsorOutreach = Infer<typeof seedSponsorOutreach>;
export type SeedExpense = Infer<typeof seedExpense>;
export type SeedIncomeDeposit = Infer<typeof seedIncome>;
export type SeedTeamInfoField = Infer<typeof seedTeamInfo>;
export type SeedWishlistItem = Infer<typeof seedWishlistItem>;

/**
 * Nobody signs in through this file. Every real person's row is created by
 * \`auth.ensureUser\` the moment they actually sign in with Google, and
 * upgraded through the access-request flow -- seeding one here ahead of that,
 * even as a placeholder, would leave an unclaimable, nameless row in the
 * roster forever.
 *
 * The audit log is empty for the same reason and is not emitted at all:
 * \`importAll\` takes no \`auditLogs\` argument, because every row in that table
 * is stamped with a real person and this file knows no people. The import
 * writes exactly one audit row, for itself.
 */
export const TEAM_USERS: SeedUser[] = [];

/**
 * The local id every "who did this" column below carries:
 * \`TEAM_ACCOUNTS[].updatedById\`, \`TEAM_EXPENSES[].requesterId\`,
 * \`TEAM_INCOME_DEPOSITS[].loggedById\`, \`TEAM_INFO[].updatedById\`. Each is a
 * required \`v.id("users")\` in the schema -- there is no blank to leave it --
 * and \`TEAM_USERS\` is empty, so nothing in this file resolves it.
 *
 * **Contract for whoever calls \`api.seed.importAll\`:** pass this value as
 * \`actorLocalId\`, and pass **exactly one** entry in \`users\` whose \`_id\` is
 * it -- and no other entry carrying your own identity. That entry is the
 * importing admin's own roster row, which \`importAll\` rebuilds from the
 * caller's authenticated identity: its \`tokenIdentifier\` and \`role\` are
 * ignored, so no caller ever has to know or transmit a raw token identifier
 * and a stale one cannot do harm. Everything else on the entry (a first name,
 * a last initial) is written as given.
 *
 * "Exactly one, and nobody else with your identity" is the whole constraint,
 * not a tidiness preference. Two rows sharing your \`tokenIdentifier\` -- from
 * a duplicated \`_id\`, or from a second entry that happens to carry your real
 * one -- make \`getActor\`'s \`.unique()\` throw on *every* later request. And
 * nothing hands the deployment back: \`auth.ensureUser\` writes
 * \`role: "viewer"\` for every new account and \`users.setUserRole\` requires an
 * admin, so the app has no way to mint one. Recovery is the Convex dashboard.
 *
 * The same goes for any *two* entries sharing a token, yours or not: the
 * person they describe is locked out identically, and \`convex/users.ts\` has
 * no delete mutation to clear either row. Give every entry its own identity.
 *
 * Break any part of this and the mutation refuses the import. It refuses
 * before deleting anything, but that is only so it fails cheaply -- the
 * import is one transaction, so a throw at any point in it rolls back
 * everything it had written.
 */
export const IMPORT_ACTOR_ID = '${IMPORT_ACTOR_ID}';

`;

  const body = [
    section('TEAM_SEASONS', 'SeedSeason', seasonRows),
    section('TEAM_DONORS', 'SeedDonor', donorRows),
    section('TEAM_ACCOUNTS', 'SeedAccount', accounts),
    section('TEAM_GRANTS', 'SeedGrant', grants),
    section('TEAM_SPONSORS', 'SeedSponsor', sponsors),
    section('TEAM_CONTACTS', 'SeedContact', contacts),
    section('TEAM_SPONSOR_OUTREACH', 'SeedSponsorOutreach', outreach),
    section('TEAM_EXPENSES', 'SeedExpense', expenses),
    section('TEAM_INCOME_DEPOSITS', 'SeedIncomeDeposit', deposits),
    section('TEAM_INFO', 'SeedTeamInfoField', teamInfo),
    section('TEAM_WISHLIST', 'SeedWishlistItem', wishlist)
  ].join('\n');

  writeFileSync(OUT, header + body);

  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  console.log(`Wrote ${OUT}\n`);
  console.log(`  seasons           ${seasonRows.length}`);
  console.log(`  donors            ${donorRows.length}`);
  console.log(`  grants            ${grants.length}`);
  console.log(`  sponsors          ${sponsors.length}`);
  console.log(`  contacts          ${contacts.length}`);
  console.log(`  sponsor outreach  ${outreach.length}`);
  console.log(
    `  expenses          ${expenses.length}  ${money(expenses.reduce((s, e) => s + e.amount, 0))}`
  );
  console.log(
    `  deposits          ${deposits.length}  ${money(deposits.reduce((s, d) => s + d.amount, 0))}`
  );
  console.log(`  team info         ${teamInfo.length}`);
  console.log(`  wishlist          ${wishlist.length}`);
  console.log('\nNotes:');
  for (const n of notes) console.log(`  - ${n}`);
}

main();
