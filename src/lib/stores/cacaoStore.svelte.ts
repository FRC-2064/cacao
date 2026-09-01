import { browser } from '$app/environment';
import type {
  Grant,
  Sponsor,
  Contact,
  User,
  AuditLog,
  GrantStatus,
  GrantOutcome,
  RequirementItem,
  AnnualOutreachRecord,
  Expense,
  PaymentMethod,
  ExpenseAccount,
  CarrierType,
  DeliveryStatus,
  IncomeDeposit,
  DepositAccount,
  HCBOrganization,
  HCBTransaction,
  HCBDonation,
  HcbCategoryRow,
  Season,
  TeamInfoField,
  WishlistItem,
  DeadlineType,
  Priority
} from '$lib/types';
import {
  captureSessionFromRedirect,
  fetchConvexToken,
  isAuthEnabled,
  signOut as googleSignOut,
  watchSessionAcrossTabs
} from '$lib/auth/google.svelte';
import { getConvexClient, isConvexEnabled } from '$lib/convex/client';
import { api } from '../../../convex/_generated/api';
import type { Id, TableNames } from '../../../convex/_generated/dataModel';
import type { FunctionReference } from 'convex/server';
import { isGrantOutcome, type BoardGrantStatus } from '$lib/types';
import { computeBalances, HCB_STALE_AFTER_MS, type AccountConfig } from '$lib/finance/balances';
import { buildLedger, type HcbCategoryOverrides } from '$lib/finance/ledger';
import {
  collectGifts,
  groupDonors,
  suggestDuplicates,
  type HcbDonationRef
} from '$lib/finance/donors';
import { INCOME_CATEGORY_META, EXPENSE_CATEGORY_META, ACCOUNT_META } from '$lib/finance/categories';
import type { IncomeCategory, ExpenseCategory, Account } from '$lib/finance/categories';

/**
 * The shared types in `$lib/types` model ids as plain strings. Every id in
 * the store originated from a Convex document, so narrowing back to a branded
 * `Id` at the mutation boundary is sound.
 */
const asId = <T extends TableNames>(id: string) => id as Id<T>;

/**
 * The signed-out viewer.
 *
 * A sentinel, not a roster row: nobody is signed in, so there is no name, no
 * request and no id behind it. `role: 'viewer'` is what makes every
 * `ensureCanEdit` check refuse, and `displayName` is the only name-shaped
 * thing a client ever holds.
 */
export const GUEST_USER: User = {
  _id: 'guest_viewer',
  displayName: 'Guest Viewer',
  role: 'viewer',
  requested: false
};

/**
 * Fundraising target per season.
 *
 * Not on the wire: a `seasons` row carries a label and two dates and no goal,
 * so these live here until somebody asks for a column. Keyed rather than
 * laddered so a season the team adds later falls back to the default instead
 * of dropping out of the list.
 */
const SEASON_GOALS: Record<string, number> = {
  '2026-2027': 25000,
  '2025-2026': 22000,
  '2024-2025': 18000
};
const DEFAULT_SEASON_GOAL = 20000;
const ALL_TIME_GOAL = 65000;

/**
 * Convex owns every table, so the only thing worth keeping on the device is
 * the Hack Club Bank feed: it comes from a third-party API rather than the
 * deployment, and caching it is what stops a cold load rendering an empty
 * ledger while the fetch is in flight.
 */
const STORAGE_KEYS = {
  HCB_ORG: 'cacao_hcb_org_v2',
  HCB_TXNS: 'cacao_hcb_txns_v2',
  HCB_SYNC: 'cacao_hcb_sync_v2',
  HCB_DONATIONS: 'cacao_hcb_donations_v2'
};

/**
 * Every key this app has ever written under the old schema.
 *
 * The rows behind them carried student names and email addresses inline, and
 * they survive the database wipe entirely because they were never in the
 * database -- they are sitting in the `localStorage` of every browser that has
 * ever opened this app. Bumping `STORAGE_KEYS` to `_v2` only stops them being
 * *read*; `purgeLegacyStorage` is what makes "this app holds no student PII"
 * true on a device that ran the old version.
 *
 * `cacao_session_v1` is deliberately absent. It belongs to
 * `$lib/auth/google.svelte`, holds a session secret rather than a person, and
 * deleting it here would sign the browser out on every load.
 */
const LEGACY_STORAGE_KEYS = [
  'cacao_grants_v1',
  'cacao_sponsors_v1',
  'cacao_contacts_v1',
  'cacao_users_v1',
  'cacao_requests_v1',
  'cacao_audit_v1',
  'cacao_current_user_v1',
  'cacao_auth_state_v1',
  'cacao_expenses_v1',
  'cacao_income_v1',
  'cacao_team_info_v1',
  'cacao_wishlist_v1',
  'cacao_hcb_org_v1',
  'cacao_hcb_txns_v1',
  'cacao_hcb_sync_v1',
  'cacao_hcb_categories_v1',
  'cacao_hcb_donations_v1'
];

/**
 * Delete the pre-migration cache. Runs on every load, not once behind a flag:
 * a browser that has not opened the app since the migration must still be
 * cleaned the first time it does, and `removeItem` on an absent key is free.
 *
 * Wrapped because `localStorage` *throws* rather than returning null in a
 * browser set to block site data, and an exception here runs in the store's
 * constructor -- it would take the whole app down on load.
 */
export function purgeLegacyStorage() {
  if (!browser) return;
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  } catch (e) {
    console.error('Could not clear the pre-migration cache:', e);
  }
}

function loadStored<T>(key: string, fallback: T): T {
  if (!browser) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`Failed to load ${key} from storage:`, e);
    return fallback;
  }
}

function saveStored<T>(key: string, data: T) {
  if (!browser) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error(`Failed to save ${key} to storage:`, e);
  }
}

/**
 * What a grant form supplies.
 *
 * Deliberately not `Omit<Grant, ...>`: `Grant` is a *wire projection*, and the
 * server strips `assigneeId` from it and hands back the resolved
 * `assigneeName` instead. A form does the opposite -- it picks a person off
 * the roster and can only store the id -- so the id has to come back in here.
 * `order`, `season` and the award fields are all server-owned.
 */
export type GrantInput = {
  title: string;
  funder: string;
  amount: number;
  currency: string;
  status: GrantStatus;
  deadline?: string;
  deadlineType: DeadlineType;
  deadlineNote?: string;
  /** A roster row's `_id`. Absent means unassigned. */
  assigneeId?: string;
  priority: Priority;
  seasonId: string;
  portalUrl?: string;
  docUrl?: string;
  fileNote?: string;
  requirements: RequirementItem[];
  notes?: string;
};

/**
 * An edit to an existing grant: the row as it came off the wire, plus the
 * assignee's id for the same reason `GrantInput` carries one.
 *
 * An assignee has to be settable *and* clearable, which is three states, and
 * the **presence of the key** is what carries the third -- not the value:
 *
 * - key absent: a caller with no assignee picker. `updateGrant` sends nothing
 *   and Convex's `patch`, which only touches the keys it is given, leaves
 *   whoever is assigned in place.
 * - key present and empty: unassign. `updateGrant` turns it into the
 *   `assigneeId: null` that `grants.update` accepts as a clear.
 * - key present with an id: assign that person.
 *
 * The type deliberately stays `?: string` rather than widening to
 * `string | null`. `GrantDrawer` binds this field straight to a `<M3Select>`
 * whose value is `string | undefined`, and it already normalizes its
 * "Unassigned" option to `undefined` -- so a `null` here would be a value no
 * caller can produce and every caller would have to widen for. `null` is the
 * wire spelling of an empty assignee, and it is minted at the wire.
 *
 * A caller that spreads a wire `Grant` always has the key, because
 * `grants.list` always emits it to a signed-in member -- and only a signed-in
 * member both receives it and is allowed to write, so "the key is missing
 * because the server redacted it" is not a reachable state.
 */
export type GrantEdit = Grant & { assigneeId?: string };

class CacaoStore {
  // Reactive state using Svelte 5 runes
  grants = $state<Grant[]>([]);
  sponsors = $state<Sponsor[]>([]);
  contacts = $state<Contact[]>([]);
  users = $state<User[]>([]);
  /**
   * Roster rows asking for edit access, for the admin feed.
   *
   * Its own subscription rather than a filter over `users`, because
   * `users.listRequests` is `requireAdmin` while `users.listUsers` is only
   * `requireActor`: this is the query whose meaning is "the approval queue",
   * and it is opened only while the caller's own row actually says admin. Empty
   * for everyone else, which is exactly what they are entitled to.
   */
  editRequests = $state<User[]>([]);
  auditLogs = $state<AuditLog[]>([]);
  expenses = $state<Expense[]>([]);
  incomeDeposits = $state<IncomeDeposit[]>([]);
  teamInfo = $state<TeamInfoField[]>([]);
  wishlist = $state<WishlistItem[]>([]);
  currentUser = $state<User>(GUEST_USER);
  isAuthenticated = $state<boolean>(false);
  isGuest = $state<boolean>(false);
  /** False until sign-in has answered, so the UI does not flash the sign-in screen. */
  authReady = $state<boolean>(false);
  /**
   * Whether there is a real Google session behind `currentUser`.
   *
   * Distinct from `isAuthenticated`, which only asks "may this browser use the
   * app" -- and the answer to that is yes for everyone, because the team's
   * finances are public to read. Only `isSignedIn` implies a claimed identity.
   */
  isSignedIn = $state<boolean>(false);

  // Hack Club Bank (HCB) Live State
  hcbOrg = $state<HCBOrganization | null>(null);
  hcbTransactions = $state<HCBTransaction[]>([]);
  hcbDonations = $state<HCBDonation[]>([]);
  isHcbSyncing = $state<boolean>(false);
  hcbLastSyncedAt = $state<number | null>(null);
  hcbSlug = $state<string>('the-panther-project');

  /**
   * The team's own category for a bank transaction the memo rules could not
   * classify. Stored separately from the transactions themselves, which are
   * never persisted server-side -- they are re-fetched from HCB on every load.
   */
  hcbCategories = $state<HcbCategoryRow[]>([]);

  // Verified account balances (opening balance re-baselines)
  accountConfigs = $state<AccountConfig[]>([]);

  /**
   * Account row ids keyed by slug.
   *
   * `Expense.account` and `IncomeDeposit.depositAccount` are slugs, because
   * `ledger.ts` compares them literally to decide whether a record can dedupe
   * against a live bank transaction, while the mutations take
   * `v.id("accounts")`. Somewhere has to hold both, and this is the only place
   * that sees them together.
   */
  private accountIds = $state<Record<string, string>>({});

  /** The competition seasons, newest first. Empty until the query lands. */
  seasons = $state<Season[]>([]);

  // UI filter state

  /**
   * Which season the UI is filtered to, as a `YYYY-YYYY` label.
   *
   * Empty until `api.seasons.list` lands and names the current one. There is
   * deliberately no hardcoded default: a literal year here is wrong for every
   * season after the one it was typed in, and it goes wrong silently.
   */
  selectedSeason = $state<string>('');
  selectedAssignee = $state<string>('all');
  selectedExpenseCategory = $state<string>('all');
  toastMessage = $state<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  /** True until the first snapshot of each table lands. */
  isLoading = $state<boolean>(isConvexEnabled);
  connectionError = $state<string | null>(null);

  private unsubscribers: Array<() => void> = [];

  /**
   * The admin-only requests subscription, opened and closed as the caller's
   * role changes rather than once at construction. Held apart from
   * `unsubscribers` because it is the one subscription with a lifetime shorter
   * than the session's.
   */
  private requestsUnsubscribe: (() => void) | null = null;

  constructor() {
    // First thing, before anything reads storage: the old keys are PII and
    // this is the only moment we are guaranteed to run on a device holding
    // them.
    purgeLegacyStorage();

    if (!browser) return;

    void this.initAuth();
    this.subscribeToConvex();

    // Paint from the cached bank feed, then refresh it in the background.
    this.hcbOrg = loadStored(STORAGE_KEYS.HCB_ORG, null);
    this.hcbTransactions = loadStored(STORAGE_KEYS.HCB_TXNS, []);
    this.hcbDonations = loadStored(STORAGE_KEYS.HCB_DONATIONS, []);
    this.hcbLastSyncedAt = loadStored(STORAGE_KEYS.HCB_SYNC, null);
    this.syncHackClubBank(false);
  }

  // ── Convex wiring ────────────────────────────────────────────────────

  /**
   * Open a live subscription per table. Convex pushes a fresh array whenever
   * anything changes, so these assignments are the single source of truth
   * and they overwrite any optimistic edit a mutation made.
   */
  private subscribeToConvex() {
    const client = getConvexClient();
    if (!client) return;

    const pending = new Set([
      'grants',
      'sponsors',
      'contacts',
      'me',
      'users',
      'auditLogs',
      'expenses',
      'incomeDeposits',
      'teamInfo',
      'wishlist',
      'accounts',
      'seasons',
      'hcbCategories'
    ]);

    const settle = (key: string) => {
      pending.delete(key);
      // A snapshot arriving proves the connection works. Without this a
      // transient early failure leaves the banner up for the whole session.
      this.connectionError = null;
      if (pending.size === 0) this.isLoading = false;
    };

    const onError = (e: Error) => {
      console.error('Convex subscription failed:', e);
      this.connectionError = e.message;
      this.isLoading = false;
    };

    /**
     * For the three subscriptions that require a session.
     *
     * They are refused for everyone browsing the public view, and refused
     * again for a signed-in member during the moment between the subscription
     * opening and the Google ID token arriving. Neither is a connection
     * problem.
     *
     * Deliberately keyed on `isSignedIn` rather than on the error text:
     * production Convex deployments redact messages down to "Server Error",
     * so matching on the wording works in development and never fires in
     * production -- which is exactly how this reached the live site.
     */
    const onGatedError = (e: Error) => {
      if (!this.isSignedIn) {
        this.isLoading = false;
        return;
      }
      onError(e);
    };

    const track = (unsubscribe: () => void) => this.unsubscribers.push(unsubscribe);

    track(
      client.onUpdate(
        api.grants.list,
        {},
        (rows) => {
          this.grants = rows;
          settle('grants');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.sponsors.list,
        {},
        (rows) => {
          this.sponsors = rows;
          settle('sponsors');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.contacts.list,
        {},
        (rows) => {
          this.contacts = rows;
          settle('contacts');
        },
        onGatedError
      )
    );
    /**
     * The caller's own roster row, live.
     *
     * `onAuthChange` reads `users.me` once and assigns `currentUser` from it,
     * and nothing ever re-derived it. A mentor promoting a student while their
     * page is open changed nothing: `ensureCanEdit()` went on refusing, the
     * mentor said "I did it", and neither of them knew a reload was needed.
     * The reverse is quieter and worse -- a demoted admin keeps the admin panel
     * rendered while every write fails with a server-error toast.
     *
     * `onError` rather than `onGatedError`: `users.me` is deliberately the one
     * identity query that answers without a session, returning `null`, because
     * the client needs it to tell "just looking" from "signed in". A failure
     * here is a real failure.
     */
    track(
      client.onUpdate(
        api.users.me,
        {},
        (row) => {
          this.adoptOwnRow(row as User | null);
          settle('me');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.users.listUsers,
        {},
        (rows) => {
          this.users = rows;
          settle('users');
        },
        onGatedError
      )
    );
    track(
      client.onUpdate(
        api.audit.list,
        { limit: 200 },
        (rows) => {
          this.auditLogs = rows;
          settle('auditLogs');
        },
        onGatedError
      )
    );
    track(
      client.onUpdate(
        api.expenses.list,
        {},
        (rows) => {
          this.expenses = rows;
          settle('expenses');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.income.list,
        {},
        (rows) => {
          this.incomeDeposits = rows;
          settle('incomeDeposits');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.accounts.list,
        {},
        (rows) => {
          this.accountConfigs = rows;
          this.accountIds = Object.fromEntries(rows.map((a) => [a.account, a._id]));
          settle('accounts');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.seasons.list,
        {},
        (rows) => {
          this.seasons = rows;
          // Only when the user has not already chosen one: this snapshot
          // arrives again on every season edit, and resetting their filter
          // underneath them would be a bug they could not explain.
          if (!this.selectedSeason) {
            this.selectedSeason = rows.find((s) => s.isCurrent)?.label ?? rows[0]?.label ?? '';
          }
          settle('seasons');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.teamInfo.list,
        {},
        (rows) => {
          this.teamInfo = rows;
          settle('teamInfo');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.wishlist.list,
        {},
        (rows) => {
          this.wishlist = rows;
          settle('wishlist');
        },
        onError
      )
    );
    track(
      client.onUpdate(
        api.hcbCategories.list,
        {},
        (rows) => {
          this.hcbCategories = rows;
          settle('hcbCategories');
        },
        onError
      )
    );
  }

  /**
   * Fire a Convex mutation. Failures surface as a toast; the live
   * subscription then snaps the UI back to server truth, which undoes
   * whatever optimistic edit the caller applied.
   */
  private async push<M extends FunctionReference<'mutation'>>(
    mutation: M,
    args: M['_args']
  ): Promise<void> {
    const client = getConvexClient();
    if (!client) return;
    try {
      await client.mutation(mutation, args);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Convex mutation failed:', e);
      this.showToast(`Could not save to the server: ${message}`, 'error');
    }
  }

  /**
   * Open or close the admin-only requests feed to match the caller's role.
   *
   * `users.listRequests` is `requireAdmin`, so subscribing unconditionally
   * would put a permanent "Server Error" banner in front of every student.
   * Called wherever `currentUser` is assigned, so a mentor promoted mid-session
   * gets the feed and a demoted one loses it without a reload.
   */
  private syncRequestsSubscription() {
    const shouldWatch = this.currentUser.role === 'admin';
    if (shouldWatch === (this.requestsUnsubscribe !== null)) return;

    if (!shouldWatch) {
      this.requestsUnsubscribe?.();
      this.requestsUnsubscribe = null;
      // Not merely stale: a demoted admin must not keep rendering a queue of
      // other people's names out of the last snapshot.
      this.editRequests = [];
      return;
    }

    const client = getConvexClient();
    if (!client) return;
    this.requestsUnsubscribe = client.onUpdate(
      api.users.listRequests,
      {},
      (rows) => {
        this.editRequests = rows;
      },
      (e) => {
        // Deliberately quiet. The only way here is a role that changed under
        // us, which the next `users.me` snapshot resolves by closing this.
        console.error('The access-request feed failed:', e);
      }
    );
  }

  /** Drop every live subscription. Only needed by tests and hot reloads. */
  disconnect() {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.requestsUnsubscribe?.();
    this.requestsUnsubscribe = null;
  }

  showToast(text: string, type: 'success' | 'info' | 'error' = 'success') {
    this.toastMessage = { text, type };
    setTimeout(() => {
      if (this.toastMessage?.text === text) {
        this.toastMessage = null;
      }
    }, 4000);
  }

  // ── Seasons & accounts ───────────────────────────────────────────────

  /** Season labels, newest first, for the filter dropdowns. */
  get seasonLabels(): string[] {
    return this.seasons.map((s) => s.label);
  }

  /** The season the team is currently in, or null before the query lands. */
  get currentSeason(): Season | null {
    return this.seasons.find((s) => s.isCurrent) ?? null;
  }

  /**
   * The calendar year a season starts in, e.g. 2026 for `2026-2027`. Used
   * where a sponsor's outreach history is keyed by a single year.
   */
  private get currentSeasonYear(): number | null {
    const match = this.currentSeason?.label.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  /** The `YYYY-YYYY` label for a season row id, or `''` if it is unknown. */
  private seasonLabelFor(seasonId: string): string {
    return this.seasons.find((s) => s._id === seasonId)?.label ?? '';
  }

  /**
   * The `accounts` row id for a slug.
   *
   * `'none'` and an unknown slug both come back undefined. That is the right
   * answer for a deposit, which must have an account and refuses to push
   * without one -- see `addIncomeDeposit`. It is *not* the right answer for an
   * expense: see `expenseAccountField` below.
   */
  private accountIdFor(key: ExpenseAccount | DepositAccount | undefined): Id<'accounts'> | undefined {
    if (!key || key === 'none') return undefined;
    const id = this.accountIds[key];
    return id ? asId<'accounts'>(id) : undefined;
  }

  /**
   * The `accountId` argument for the expense mutations, three-state like
   * `donorName` -- the presence of the key decides, never its value.
   *
   * An expense may legitimately have no account: "No team account (voucher or
   * unrepaid personal purchase)" is a real answer, and it is `MarkPurchasedModal`'s
   * *default* selection. Once `account` stopped being a slug the server could
   * read `'none'` out of, `undefined` on the wire meant both that and "this
   * form never asked", and the server's `??` fallback took both as *leave it
   * alone*: the payment method saved, the account did not, and
   * `computeBalances` went on charging a voucher purchase to Hack Club Bank.
   *
   * - `'none'`: the user chose no account. `null` -- a deliberate clear.
   * - a known slug: that account's row id.
   * - `undefined`, or a slug no `accounts` snapshot has yet: the key is
   *   omitted, so the stored account is left exactly as it was. Omitting is
   *   the only honest answer for an unresolvable slug -- clearing would
   *   destroy a booking over a subscription that has not landed.
   */
  private expenseAccountField(
    key: ExpenseAccount | undefined
  ): { accountId?: Id<'accounts'> | null } {
    if (key === undefined) return {};
    if (key === 'none') return { accountId: null };
    const id = this.accountIds[key];
    return id ? { accountId: asId<'accounts'>(id) } : {};
  }

  // ── Hack Club Bank (HCB) Live Sync ────────────────────────────────────
  async syncHackClubBank(showToastNotification: boolean = true) {
    if (this.isHcbSyncing) return;
    this.isHcbSyncing = true;

    try {
      const slug = this.hcbSlug || 'the-panther-project';

      // 1. Fetch organization live balance and overview
      const orgRes = await fetch(`https://hcb.hackclub.com/api/v3/organizations/${slug}`);
      if (orgRes.ok) {
        const orgData: HCBOrganization = await orgRes.json();
        this.hcbOrg = orgData;
        saveStored(STORAGE_KEYS.HCB_ORG, orgData);
      }

      // 2. Page through the full transaction history. The org has a couple of
      // hundred records all-time, so a complete pull is cheap and the Sankey
      // needs more than the most recent page.
      const all: HCBTransaction[] = [];
      const PER_PAGE = 100;
      const MAX_PAGES = 10; // runaway guard, not an expected limit
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetch(
          `https://hcb.hackclub.com/api/v3/organizations/${slug}/transactions?per_page=${PER_PAGE}&page=${page}`
        );
        if (!res.ok) break;
        const batch: HCBTransaction[] = await res.json();
        all.push(...batch);
        if (batch.length < PER_PAGE) break;
      }
      if (all.length > 0) {
        this.hcbTransactions = all;
        saveStored(STORAGE_KEYS.HCB_TXNS, all);
      }

      // 3. Donations carry the donor's name and the date the donor gave, which
      // the transaction feed does not. The memo has the name too, but only as
      // free text -- this is the structured source, keyed by transaction id.
      const donations: HCBDonation[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetch(
          `https://hcb.hackclub.com/api/v3/organizations/${slug}/donations?per_page=${PER_PAGE}&page=${page}`
        );
        if (!res.ok) break;
        const batch: HCBDonation[] = await res.json();
        donations.push(...batch);
        if (batch.length < PER_PAGE) break;
      }
      if (donations.length > 0) {
        this.hcbDonations = donations;
        saveStored(STORAGE_KEYS.HCB_DONATIONS, donations);
      }

      this.hcbLastSyncedAt = Date.now();
      saveStored(STORAGE_KEYS.HCB_SYNC, this.hcbLastSyncedAt);

      if (showToastNotification) {
        const bal = ((this.hcbOrg?.balances?.balance_cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        this.showToast(`Synced with Hack Club Bank! Balance: ${bal}`);
      }
    } catch (e) {
      console.warn('Failed to sync Hack Club Bank:', e);
      if (showToastNotification) {
        this.showToast('Could not reach Hack Club Bank API (offline or network limit)', 'error');
      }
    } finally {
      this.isHcbSyncing = false;
    }
  }

  private ensureCanEdit(): boolean {
    if (this.currentUser.role === 'viewer') {
      // Says what to do about it, not just what went wrong. A signed-in viewer
      // has a way forward -- the request form in `UserProfileModal` -- and
      // being told only "editing is disabled" is how they used to end up
      // stuck with no idea one existed.
      this.showToast(
        this.isSignedIn
          ? 'Viewer mode: ask for edit access from your profile menu'
          : 'Viewer mode: editing is disabled',
        'error'
      );
      return false;
    }
    return true;
  }

  // ── Grants Methods ───────────────────────────────────────────────────
  addGrant(input: GrantInput) {
    if (!this.ensureCanEdit()) return;
    const now = Date.now();
    const id = `grant_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const { assigneeId, ...fields } = input;
    const grant: Grant = {
      ...fields,
      _id: id,
      // Kept on the optimistic row rather than dropped with the rest of the
      // destructure: the board and the drawer both read `assigneeId` back, and
      // without it a grant created with an assignee shows as unassigned until
      // the next snapshot.
      assigneeId,
      // Both server-owned: `order` is assigned from the target column's
      // current max, `season` is resolved from `seasonId`. Mirrored here only
      // so the optimistic row is a whole `Grant`.
      order: this.grants.filter((g) => g.status === input.status).length,
      season: this.seasonLabelFor(input.seasonId),
      updatedAt: now
    };
    this.grants = [grant, ...this.grants];
    this.push(api.grants.create, {
      ...fields,
      seasonId: asId<'seasons'>(input.seasonId),
      assigneeId: assigneeId ? asId<'users'>(assigneeId) : undefined
    });
    this.showToast(`Created grant "${grant.title}"!`);
  }

  updateGrant(updated: GrantEdit) {
    if (!this.ensureCanEdit()) return;
    const index = this.grants.findIndex((g) => g._id === updated._id);
    if (index === -1) return;

    const now = Date.now();
    const { assigneeId, ...row } = updated;
    // `assigneeId` back on the optimistic row, not dropped: the next
    // snapshot restores it either way, but until then the drawer reopens
    // reading its own state and would show "Unassigned" for a grant it had
    // just assigned. `?? undefined` because a cleared assignee is an absent
    // one on a `Grant`.
    const grant: Grant = { ...row, assigneeId: assigneeId ?? undefined, updatedAt: now };

    this.grants[index] = grant;
    this.grants = [...this.grants];

    this.push(api.grants.update, {
      id: asId<'grants'>(updated._id),
      title: updated.title,
      funder: updated.funder,
      amount: updated.amount,
      currency: updated.currency,
      status: updated.status,
      deadline: updated.deadline,
      deadlineType: updated.deadlineType,
      deadlineNote: updated.deadlineNote,
      // Omitted only when the caller never mentioned an assignee -- see
      // `GrantEdit`. A key that is present but empty is a deliberate
      // unassignment and goes out as `null`; `patch` clears the column on
      // `null` and ignores the field entirely when the key is absent.
      ...('assigneeId' in updated
        ? { assigneeId: assigneeId ? asId<'users'>(assigneeId) : null }
        : {}),
      priority: updated.priority,
      seasonId: asId<'seasons'>(updated.seasonId),
      portalUrl: updated.portalUrl,
      docUrl: updated.docUrl,
      fileNote: updated.fileNote,
      requirements: updated.requirements,
      notes: updated.notes,
      order: updated.order
    });
    this.showToast(`Saved changes to "${grant.title}"`);
  }

  /** Board-to-board moves only; an outcome is recorded through `finishGrant`. */
  updateGrantOrderAndStatus(grantId: string, targetStatus: BoardGrantStatus, newOrder: number) {
    if (!this.ensureCanEdit()) return;
    const grant = this.grants.find((g) => g._id === grantId);
    if (!grant) return;

    const oldStatus = grant.status;
    grant.status = targetStatus;
    grant.order = newOrder;
    grant.updatedAt = Date.now();

    this.grants = [...this.grants];
    if (oldStatus !== targetStatus) {
      this.showToast(`Moved "${grant.title}" to ${targetStatus}`);
    }
    this.push(api.grants.updateStatusAndOrder, {
      id: asId<'grants'>(grantId),
      status: targetStatus,
      order: newOrder
    });
  }

  // ── Finishing a grant ────────────────────────────────────────────────

  get boardGrants(): Grant[] {
    return this.grants.filter((g) => !isGrantOutcome(g.status));
  }

  get archivedGrants(): Grant[] {
    return this.grants
      .filter((g) => isGrantOutcome(g.status))
      .sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt));
  }

  /** What the archive says the team has actually been given. */
  get totalAwarded(): number {
    return this.grants
      .filter((g) => g.status === 'awarded')
      .reduce((sum, g) => sum + (g.awardedAmount ?? g.amount ?? 0), 0);
  }

  /**
   * Record a grant's outcome and take it off the board.
   *
   * An award also books the money: a deposit into the school account, created
   * server-side in the same transaction as the status change so the two cannot
   * end up disagreeing. Locally the same pair is applied optimistically.
   */
  async finishGrant(
    grantId: string,
    outcome: GrantOutcome,
    award?: { amount: number; date: string }
  ) {
    if (!this.ensureCanEdit()) return;
    const grant = this.grants.find((g) => g._id === grantId);
    if (!grant) return;

    if (grant.linkedDepositId) {
      this.showToast(`"${grant.title}" is already finished`, 'error');
      return;
    }
    if (outcome === 'awarded' && (!award || award.amount <= 0 || !award.date)) {
      this.showToast('An award needs an amount and the date it arrived', 'error');
      return;
    }

    // Not optimistic, unlike the rest of the write path: `grants.finish` also
    // inserts the `incomeDeposits` row for the award, in the same transaction
    // as the status change. Guessing that row's shape here and having the next
    // snapshot correct it would flicker money on the Money tab.
    const client = getConvexClient();
    if (!client) return;
    try {
      await client.mutation(api.grants.finish, {
        id: asId<'grants'>(grantId),
        outcome,
        awardedAmount: outcome === 'awarded' ? award!.amount : undefined,
        awardedDate: outcome === 'awarded' ? award!.date : undefined
      });
      this.showToast(
        outcome === 'awarded'
          ? `Awarded — $${award!.amount.toLocaleString('en-US')} recorded against the Region 15 account`
          : `Marked "${grant.title}" as ${outcome}`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Finishing the grant failed:', e);
      this.showToast(`Could not finish the grant: ${message}`, 'error');
    }
  }

  /**
   * Put a finished grant back on the board. Any deposit the award created is
   * left in place -- it is a financial record, possibly already reconciled,
   * and removing one as a side effect of a status change is a human's call.
   */
  async reopenGrant(grantId: string, status: BoardGrantStatus = 'submitted') {
    if (!this.ensureCanEdit()) return;
    const grant = this.grants.find((g) => g._id === grantId);
    if (!grant) return;

    const hadDeposit = grant.linkedDepositId !== undefined;

    await this.push(api.grants.reopen, {
      id: asId<'grants'>(grantId),
      status
    });

    this.showToast(
      hadDeposit
        ? `Reopened "${grant.title}" — its deposit is still on the Money tab`
        : `Reopened "${grant.title}"`,
      'info'
    );
  }

  deleteGrant(grantId: string) {
    if (!this.ensureCanEdit()) return;
    const grant = this.grants.find((g) => g._id === grantId);
    if (!grant) return;

    this.grants = this.grants.filter((g) => g._id !== grantId);
    this.push(api.grants.remove, { id: asId<'grants'>(grantId) });
    this.showToast(`Deleted "${grant.title}"`, 'info');
  }

  // ── Expenses & Purchase Requests Methods ─────────────────────────────
  addExpense(newExpense: Omit<Expense, '_id' | 'createdAt' | 'updatedAt'>) {
    if (!this.ensureCanEdit()) return;
    const now = Date.now();
    const id = `exp_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const expense: Expense = {
      ...newExpense,
      _id: id,
      createdAt: now,
      updatedAt: now
    };
    this.expenses = [expense, ...this.expenses];
    this.push(api.expenses.add, this.expenseMutationFields(newExpense));
    this.showToast(`Logged expense request for $${expense.amount}!`);
  }

  /**
   * The columns `expenses.add` / `expenses.update` actually store.
   *
   * Built by hand rather than rest-spread from the row: the wire shape and the
   * mutation arguments are different shapes on purpose. `account` is a slug
   * and the mutation wants the `accounts` row id; `season`, `requesterName`
   * and `purchaserName` are resolved server-side and are not settable at all.
   * Convex rejects an argument it does not declare, so a spread would fail the
   * whole write at runtime.
   *
   * `donorName` *is* settable, and is sent as a name rather than an id: a
   * client cannot mint a `donors` row, so both mutations take the string the
   * form collected and `resolveDonorByName` finds or creates the row inside
   * the same transaction. Three states, distinguished by whether the caller
   * set the key at all -- `Expense.donorName` is `?: string`, so the value
   * alone cannot tell "no donor input on this form" from "the donor input was
   * emptied":
   *
   * - key absent: the form has no donor field (`AddExpenseModal`). Nothing is
   *   sent, so `patch` leaves whatever donor the row has.
   * - key present and blank: the form has one and it is empty --
   *   `ExpenseModal` sends `undefined` the moment the status stops being
   *   `donated`. That is a deliberate clear, and `''` is how the mutation
   *   spells it.
   * - key present and filled: find or create that donor.
   *
   * Sending `''` unconditionally would wipe the donor on every save from a
   * form that never asked about one. Omitting the key unconditionally -- what
   * this builder did until the donor typeahead went in -- means a donor can
   * never be recorded at all.
   */
  private expenseMutationFields(e: Omit<Expense, '_id' | 'createdAt' | 'updatedAt'>) {
    const donor = 'donorName' in e ? { donorName: e.donorName ?? '' } : {};
    return {
      ...donor,
      ...this.expenseAccountField(e.account),
      title: e.title,
      vendor: e.vendor,
      amount: e.amount,
      finalPaidAmount: e.finalPaidAmount,
      currency: e.currency,
      category: e.category,
      date: e.date,
      status: e.status,
      seasonId: asId<'seasons'>(e.seasonId),
      paymentMethod: e.paymentMethod,
      orderNumber: e.orderNumber,
      trackingNumber: e.trackingNumber,
      carrier: e.carrier,
      expectedDeliveryDate: e.expectedDeliveryDate,
      deliveryStatus: e.deliveryStatus,
      receiptUrl: e.receiptUrl,
      itemLink: e.itemLink,
      notes: e.notes,
      taxYear: e.taxYear,
      ...this.expenseLinkedGrantField(e)
    };
  }

  /**
   * The `linkedGrantId` argument for the expense mutations -- three-state on
   * the presence of the key, exactly like `donorName` above and `accountId`
   * below.
   *
   * "General Team Funds" is `ExpenseModal`'s default option and a real answer,
   * and a `grants` row id cannot spell it. This used to send
   * `e.linkedGrantId ? asId(...) : undefined`; Convex strips `undefined`
   * before the arguments leave the browser, so unlinking a grant sent nothing
   * at all, `patch` never touched the column, and the link survived. The
   * dropdown showed the change, the optimistic row applied it, and the next
   * snapshot silently put the grant back -- while grant-attribution reporting
   * and the CSV export went on charging that grant for the spend.
   *
   * - key absent on the row: the form has no grant picker. Nothing is sent, so
   *   the stored grant is left alone.
   * - key present and empty: the picker is on "General Team Funds". `null` --
   *   a deliberate unlink.
   * - key present and filled: that grant's row id.
   */
  private expenseLinkedGrantField(
    e: Pick<Expense, 'linkedGrantId'>
  ): { linkedGrantId?: Id<'grants'> | null } {
    if (!('linkedGrantId' in e)) return {};
    return { linkedGrantId: e.linkedGrantId ? asId<'grants'>(e.linkedGrantId) : null };
  }

  updateExpense(updated: Expense) {
    if (!this.ensureCanEdit()) return;
    const index = this.expenses.findIndex((e) => e._id === updated._id);
    if (index === -1) return;

    const now = Date.now();
    const exp: Expense = {
      ...updated,
      updatedAt: now
    };
    this.expenses[index] = exp;
    this.expenses = [...this.expenses];

    this.push(api.expenses.update, {
      id: asId<'expenses'>(updated._id),
      ...this.expenseMutationFields(updated)
    });
    this.showToast(`Saved changes to "${exp.title}"`);
  }

  approveExpense(expenseId: string) {
    if (!this.ensureCanEdit()) return;
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'approved';
    exp.approvedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.push(api.expenses.approve, { id: asId<'expenses'>(expenseId) });
    this.showToast(`Approved expense for $${exp.amount}!`);
  }

  recordPurchase(
    expenseId: string,
    details: {
      finalPaidAmount: number;
      paymentMethod: PaymentMethod;
      account?: ExpenseAccount;
      date?: string;
      orderNumber?: string;
      trackingNumber?: string;
      carrier?: CarrierType;
      expectedDeliveryDate?: string;
      deliveryStatus?: DeliveryStatus;
      receiptUrl?: string;
    }
  ) {
    if (!this.ensureCanEdit()) return;
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'purchased';
    exp.finalPaidAmount = details.finalPaidAmount;
    exp.paymentMethod = details.paymentMethod;
    if (details.account !== undefined) exp.account = details.account;
    if (details.date) exp.date = details.date;
    // Who bought it is the actor, stamped server-side from the session --
    // never a name the form collected. Mirrored optimistically only.
    exp.purchaserName = this.currentUser.displayName;
    exp.orderNumber = details.orderNumber;
    exp.trackingNumber = details.trackingNumber;
    exp.carrier = details.carrier;
    exp.expectedDeliveryDate = details.expectedDeliveryDate;
    exp.deliveryStatus = details.deliveryStatus || 'ordered';
    if (details.receiptUrl) exp.receiptUrl = details.receiptUrl;
    exp.purchasedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.push(api.expenses.recordPurchase, {
      id: asId<'expenses'>(expenseId),
      ...this.expenseAccountField(details.account),
      finalPaidAmount: details.finalPaidAmount,
      paymentMethod: details.paymentMethod,
      date: details.date,
      orderNumber: details.orderNumber,
      trackingNumber: details.trackingNumber,
      carrier: details.carrier,
      expectedDeliveryDate: details.expectedDeliveryDate,
      deliveryStatus: details.deliveryStatus ?? 'ordered',
      receiptUrl: details.receiptUrl
    });
    this.showToast(`Recorded order for "${exp.title}" ($${details.finalPaidAmount})`);
  }

  markExpenseDelivered(expenseId: string) {
    if (!this.ensureCanEdit()) return;
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.deliveryStatus = 'delivered';
    exp.receivedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.push(api.expenses.markDelivered, { id: asId<'expenses'>(expenseId) });
    this.showToast(`Marked "${exp.title}" as received in shop!`);
  }

  purchaseExpense(expenseId: string) {
    if (!this.ensureCanEdit()) return;
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'purchased';
    exp.purchasedAt = now;
    exp.finalPaidAmount = exp.finalPaidAmount ?? exp.amount;
    exp.deliveryStatus = exp.deliveryStatus || 'ordered';
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.push(api.expenses.purchase, { id: asId<'expenses'>(expenseId) });
    this.showToast(`Marked as purchased!`);
  }

  reimburseExpense(expenseId: string) {
    if (!this.ensureCanEdit()) return;
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'reimbursed';
    exp.reimbursedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.push(api.expenses.reimburse, { id: asId<'expenses'>(expenseId) });
    this.showToast(`Marked expense as reimbursed!`);
  }

  deleteExpense(expenseId: string) {
    if (!this.ensureCanEdit()) return;
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    this.expenses = this.expenses.filter((e) => e._id !== expenseId);
    this.push(api.expenses.remove, { id: asId<'expenses'>(expenseId) });
    this.showToast(`Deleted expense "${exp.title}"`, 'info');
  }

  // ── Fundraisers & Income Deposit Methods ──────────────────────────────
  addIncomeDeposit(newDeposit: Omit<IncomeDeposit, '_id' | 'updatedAt'>) {
    if (!this.ensureCanEdit()) return;
    const accountId = this.accountIdFor(newDeposit.depositAccount);
    if (!accountId) {
      this.showToast(
        `No ${newDeposit.depositAccount} account is configured to book this against`,
        'error'
      );
      return;
    }

    const now = Date.now();
    const id = `inc_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const deposit: IncomeDeposit = {
      ...newDeposit,
      _id: id,
      updatedAt: now
    };
    this.incomeDeposits = [deposit, ...this.incomeDeposits];
    if (accountId) {
      this.push(api.income.add, this.depositMutationFields(newDeposit, accountId));
    }
    this.showToast(`Logged $${deposit.amount.toFixed(2)} deposit for ${deposit.title}!`);
  }

  /**
   * The columns `income.add` / `income.update` actually store. Built by hand
   * for the same reason as `expenseMutationFields`: `depositAccount` is a slug
   * and the mutation wants the row id, and `season` and `loggedByName` are
   * resolved server-side.
   *
   * `donorName` follows exactly the rule documented on `expenseMutationFields`
   * -- absent leaves the donor alone, blank clears it, a name finds or creates
   * the row. `LogDepositModal` is the only caller with a donor field and it
   * always sets the key, so a deposit's donor round-trips; anything else that
   * saves a deposit without asking about a donor keeps the one on the row.
   */
  private depositMutationFields(
    d: Omit<IncomeDeposit, '_id' | 'updatedAt'>,
    accountId: Id<'accounts'>
  ) {
    const donor = 'donorName' in d ? { donorName: d.donorName ?? '' } : {};
    return {
      ...donor,
      title: d.title,
      amount: d.amount,
      category: d.category,
      accountId,
      date: d.date,
      seasonId: asId<'seasons'>(d.seasonId),
      receiptUrl: d.receiptUrl,
      notes: d.notes,
      taxYear: d.taxYear
    };
  }

  updateIncomeDeposit(updated: IncomeDeposit) {
    if (!this.ensureCanEdit()) return;
    const index = this.incomeDeposits.findIndex((d) => d._id === updated._id);
    if (index === -1) return;

    const accountId = this.accountIdFor(updated.depositAccount);
    if (!accountId) {
      this.showToast(
        `No ${updated.depositAccount} account is configured to book this against`,
        'error'
      );
      return;
    }

    this.incomeDeposits[index] = { ...updated, updatedAt: Date.now() };
    this.incomeDeposits = [...this.incomeDeposits];
    if (accountId) {
      this.push(api.income.update, {
        id: asId<'incomeDeposits'>(updated._id),
        ...this.depositMutationFields(updated, accountId)
      });
    }
    this.showToast(`Saved changes to "${updated.title}"`);
  }

  deleteIncomeDeposit(id: string) {
    if (!this.ensureCanEdit()) return;
    const dep = this.incomeDeposits.find((d) => d._id === id);
    if (!dep) return;

    this.incomeDeposits = this.incomeDeposits.filter((d) => d._id !== id);
    this.push(api.income.remove, { id: asId<'incomeDeposits'>(id) });
    this.showToast(`Deleted deposit "${dep.title}"`, 'info');
  }

  // ── Sponsors Methods ─────────────────────────────────────────────────
  addSponsor(newSponsor: Omit<Sponsor, '_id' | 'updatedAt'>) {
    if (!this.ensureCanEdit()) return;
    const now = Date.now();
    const id = `sp_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const sponsor: Sponsor = {
      ...newSponsor,
      _id: id,
      updatedAt: now
    };
    this.sponsors = [sponsor, ...this.sponsors];
    this.push(api.sponsors.create, this.sponsorMutationFields(newSponsor));
    this.showToast(`Added sponsor "${sponsor.name}"!`);
  }

  /**
   * The columns `sponsors.create` / `sponsors.update` store. `annualHistory`
   * is joined on by the query from the `sponsorOutreach` table and is written
   * through `logOutreach`, not here.
   *
   * `primaryContactId` is three-state like `donorName`, and for the same
   * reason: `Sponsor.primaryContactId` is `?: string`, so only the key's
   * presence separates "this caller has no contact picker" from "the picker
   * was cleared". Absent leaves the attachment alone, `null` detaches (which
   * is what `sponsors.update` accepts -- an id or an explicit null), an id
   * attaches. `SponsorModal` always sets the key, so its picker can now both
   * attach and detach.
   */
  private sponsorMutationFields(s: Omit<Sponsor, '_id' | 'updatedAt'>) {
    const contact =
      'primaryContactId' in s
        ? { primaryContactId: s.primaryContactId ? asId<'contacts'>(s.primaryContactId) : null }
        : {};
    return {
      ...contact,
      name: s.name,
      category: s.category,
      tier: s.tier,
      status: s.status,
      totalDonated: s.totalDonated,
      currentYearPledge: s.currentYearPledge,
      lastContactDate: s.lastContactDate,
      nextFollowUpDate: s.nextFollowUpDate,
      website: s.website,
      logoUrl: s.logoUrl,
      address: s.address,
      notes: s.notes
    };
  }

  updateSponsor(updated: Sponsor) {
    if (!this.ensureCanEdit()) return;
    const index = this.sponsors.findIndex((s) => s._id === updated._id);
    if (index === -1) return;

    const now = Date.now();
    const sponsor: Sponsor = { ...updated, updatedAt: now };
    this.sponsors[index] = sponsor;
    this.sponsors = [...this.sponsors];
    this.push(api.sponsors.update, {
      id: asId<'sponsors'>(updated._id),
      ...this.sponsorMutationFields(updated)
    });
    this.showToast(`Saved "${sponsor.name}"`);
  }

  deleteSponsor(sponsorId: string) {
    if (!this.ensureCanEdit()) return;
    const sponsor = this.sponsors.find((s) => s._id === sponsorId);
    if (!sponsor) return;

    this.sponsors = this.sponsors.filter((s) => s._id !== sponsorId);
    this.push(api.sponsors.remove, { id: asId<'sponsors'>(sponsorId) });
    this.showToast(`Removed "${sponsor.name}"`, 'info');
  }

  logSponsorOutreach(sponsorId: string, record: AnnualOutreachRecord) {
    if (!this.ensureCanEdit()) return;
    const sponsor = this.sponsors.find((s) => s._id === sponsorId);
    if (!sponsor) return;

    const existingIndex = sponsor.annualHistory.findIndex((h) => h.year === record.year);
    if (existingIndex >= 0) {
      sponsor.annualHistory[existingIndex] = record;
    } else {
      sponsor.annualHistory.push(record);
    }

    sponsor.lastContactDate = record.contactedDate || new Date().toISOString().split('T')[0];
    sponsor.updatedAt = Date.now();

    this.sponsors = [...this.sponsors];
    this.push(api.sponsors.logOutreach, {
      sponsorId: asId<'sponsors'>(sponsorId),
      year: record.year,
      status: record.status,
      amount: record.amount,
      notes: record.notes
    });
    this.showToast(`Logged outreach for ${sponsor.name}!`);
  }

  // ── Contacts Methods ─────────────────────────────────────────────────
  addContact(newContact: Omit<Contact, '_id' | 'updatedAt'>) {
    if (!this.ensureCanEdit()) return;
    const now = Date.now();
    const id = `cnt_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const contact: Contact = {
      ...newContact,
      _id: id,
      updatedAt: now
    };
    this.contacts = [contact, ...this.contacts];
    this.push(api.contacts.create, {
      sponsorId: newContact.sponsorId ? asId<'sponsors'>(newContact.sponsorId) : undefined,
      name: newContact.name,
      title: newContact.title,
      email: newContact.email,
      phone: newContact.phone,
      isPrimary: newContact.isPrimary,
      preferredMethod: newContact.preferredMethod,
      notes: newContact.notes
    });
    this.showToast(`Added contact "${contact.name}"!`);
  }

  updateContact(updated: Contact) {
    if (!this.ensureCanEdit()) return;
    const index = this.contacts.findIndex((c) => c._id === updated._id);
    if (index === -1) return;

    const now = Date.now();
    const contact: Contact = { ...updated, updatedAt: now };
    this.contacts[index] = contact;
    this.contacts = [...this.contacts];
    this.push(api.contacts.update, {
      id: asId<'contacts'>(updated._id),
      sponsorId: updated.sponsorId ? asId<'sponsors'>(updated.sponsorId) : undefined,
      name: updated.name,
      title: updated.title,
      email: updated.email,
      phone: updated.phone,
      isPrimary: updated.isPrimary,
      preferredMethod: updated.preferredMethod,
      notes: updated.notes,
      lastContactedAt: updated.lastContactedAt
    });
    this.showToast(`Saved contact "${contact.name}"`);
  }

  deleteContact(contactId: string) {
    if (!this.ensureCanEdit()) return;
    const contact = this.contacts.find((c) => c._id === contactId);
    if (!contact) return;

    this.contacts = this.contacts.filter((c) => c._id !== contactId);
    this.push(api.contacts.remove, { id: asId<'contacts'>(contactId) });
    this.showToast(`Deleted "${contact.name}"`, 'info');
  }

  // ── Identity & Access ─────────────────────────────────────────────────

  /**
   * Adopt whatever session the browser already holds.
   *
   * There is no password step here to get wrong: Google proves who the
   * browser is and Convex verifies the ID token minted from that, so this
   * only asks who the browser is and mirrors the answer into `currentUser`.
   * The browser holds a secret for a session row the deployment owns, so two
   * devices are two independent sessions and a returning visitor is still
   * signed in until that row expires.
   */
  async initAuth() {
    if (!browser) return;

    if (!isAuthEnabled) {
      // No deployment to authenticate against. The finances are public to
      // read, so this is the guest view rather than an error.
      this.enterGuestMode();
      return;
    }

    const client = getConvexClient();
    if (!client) return;

    // Before the first `setAuth`: a browser coming back from Google is
    // carrying its session secret in the URL fragment, and Convex asks for a
    // token the moment auth is set.
    captureSessionFromRedirect();
    // Signing out in one tab has to end the session in every tab of this
    // browser, not just the one the button was in. See `watchSessionAcrossTabs`.
    watchSessionAcrossTabs();
    client.setAuth(fetchConvexToken, (ok) => {
      void this.onAuthChange(ok);
    });
  }

  /** Convex has accepted (or stopped accepting) the Google ID token. */
  private async onAuthChange(isAuthenticated: boolean) {
    const client = getConvexClient();
    if (!isAuthenticated || !client) {
      // Not an error state: a signed-out visitor still gets the public view.
      this.enterGuestMode();
      return;
    }

    try {
      // Creates the roster row the first time this person signs in, and links
      // it to their Google identity on every sign-in after that.
      await client.mutation(api.auth.ensureUser, {});
      // A point-in-time read, deliberately, and only to get `authReady` and
      // the first `currentUser` in place without waiting on a socket. Every
      // *subsequent* change to the caller's own row arrives through the
      // `api.users.me` subscription in `subscribeToConvex`, which is what makes
      // a promotion or a demotion land on an open page.
      this.adoptOwnRow((await client.query(api.users.me, {})) as User | null);
    } catch (e) {
      console.error('Could not establish the signed-in user:', e);
    } finally {
      this.authReady = true;
    }
  }

  /**
   * Take the caller's own roster row as the truth about who they are.
   *
   * The single place `currentUser` is set from the server, so the one-shot read
   * at sign-in and the live subscription cannot drift into disagreeing about
   * what a role change means.
   *
   * A `null` row means Convex is not accepting a token for this browser. That
   * is the normal state for the public view and must not be mistaken for a
   * sign-out, so it only tears down a session that was actually established.
   */
  private adoptOwnRow(row: User | null) {
    if (!row) {
      if (this.isSignedIn) this.enterGuestMode();
      return;
    }

    this.currentUser = row;
    this.isSignedIn = true;
    this.isAuthenticated = true;
    // Viewers are signed in but can only read -- the same as the public.
    this.isGuest = row.role === 'viewer';
    this.syncRequestsSubscription();
  }

  /** Browsing the public view: no session, read-only, still allowed in. */
  private enterGuestMode() {
    this.currentUser = GUEST_USER;
    this.isSignedIn = false;
    this.isAuthenticated = true;
    this.isGuest = true;
    this.authReady = true;
    this.syncRequestsSubscription();
  }

  // There is deliberately no `isRejected`. `status` is gone, and declining a
  // request only clears `requested` -- so a declined student is an ordinary
  // viewer who may ask again, not a person the app holds a refusal against.

  /**
   * Sign out here and on the deployment.
   *
   * `googleSignOut` posts to the deployment -- which deletes the session row
   * and the Google refresh token with it -- and then reloads. The reload is
   * load-bearing: `ConvexClient` caches the last ID token it fetched and
   * offers no way to clear it, so without a fresh page this browser keeps a
   * usable token for up to an hour after signing out. Local state goes first
   * so a blocked navigation still leaves this browser signed out, and there
   * is no toast because nothing survives the reload to read one.
   */
  async logout() {
    this.enterGuestMode();
    await googleSignOut();
  }

  // There are no avatar methods. Profile photos are gone by the owner's
  // decision -- a photograph of a student is exactly the kind of thing this
  // branch exists to stop storing -- and initials taken from `displayName`
  // stand in for them.

  /**
   * Edit your own name.
   *
   * Optimistic: the modal closes on save, and the live subscription replaces
   * this with server truth a moment later. There is no last name and no
   * graduation year to edit: the schema has no column either could go in.
   *
   * What the user typed is what gets sent. `lastInitial` is truncated to one
   * character **server-side**, in `requestEditAccess` / `updateOwnProfile`,
   * precisely because the client is not trusted to have done it -- so the
   * shortening below is only for the name shown back on this screen while the
   * server answers, never a substitute for the server's own.
   */
  saveOwnProfile(fields: { firstName?: string; lastInitial?: string }) {
    const firstName = fields.firstName?.trim() ?? this.currentUser.firstName;
    const typedInitial = fields.lastInitial?.trim() ?? this.currentUser.lastInitial;
    const shownInitial = typedInitial ? typedInitial.slice(0, 1).toUpperCase() : undefined;
    const shownName = [firstName, shownInitial].filter(Boolean).join(' ');

    this.currentUser = {
      ...this.currentUser,
      firstName,
      lastInitial: shownInitial,
      displayName: shownName || 'Unnamed member'
    };
    this.push(api.users.updateOwnProfile, fields);
    this.showToast('Profile saved');
  }

  /**
   * Ask a mentor for edit access, giving a first name and a last initial.
   *
   * This is the whole privacy argument of the branch in one call. Signing in
   * creates a roster row holding an opaque token identifier and nothing else;
   * a name enters the database here and only here, at the moment somebody asks
   * to be able to change the team's records -- which is the point at which
   * knowing who they are starts to matter. `users.updateOwnProfile` is gated on
   * `requireWriter` precisely so this cannot be skipped.
   *
   * Sent as typed. `users.requestEditAccess` truncates `lastInitial` to one
   * character **server-side**, because a client cannot be trusted to have done
   * it; shortening here as well would put the only copy of what somebody
   * actually typed in the one place nothing enforces.
   */
  requestEditAccess(fields: { firstName: string; lastInitial: string }) {
    if (!this.isSignedIn) {
      this.showToast('Sign in first, then ask a mentor for edit access', 'error');
      return;
    }

    // Optimistic, and only as far as the server will go: the initial shown
    // back is the one the server will store, so the name on screen does not
    // change again a moment later.
    const shownInitial = fields.lastInitial.trim().slice(0, 1).toUpperCase() || undefined;
    const shownName = [fields.firstName.trim(), shownInitial].filter(Boolean).join(' ');
    this.currentUser = {
      ...this.currentUser,
      firstName: fields.firstName.trim(),
      lastInitial: shownInitial,
      displayName: shownName || 'Unnamed member',
      requested: true
    };

    this.push(api.users.requestEditAccess, fields);
    this.showToast('Request sent. A mentor will review it.');
  }

  /**
   * Grant a request. Promotes a viewer to student; a non-viewer's role is left
   * alone and only the flag is cleared -- see `users.approveRequest`, which is
   * where that reasoning lives.
   */
  approveRequest(userId: string) {
    const user = this.editRequests.find((u) => u._id === userId);
    // Optimistic removal, so the card leaves the feed on click rather than a
    // round-trip later. The subscription is the source of truth either way.
    this.editRequests = this.editRequests.filter((u) => u._id !== userId);
    this.push(api.users.approveRequest, { userId: asId<'users'>(userId) });
    this.showToast(`${user?.displayName ?? 'They'} can now edit`);
  }

  /**
   * Turn a request down. Nothing records the refusal: an accidental decline
   * has to leave the student able to ask again, so only the flag is cleared.
   */
  declineRequest(userId: string) {
    const user = this.editRequests.find((u) => u._id === userId);
    this.editRequests = this.editRequests.filter((u) => u._id !== userId);
    this.push(api.users.declineRequest, { userId: asId<'users'>(userId) });
    this.showToast(`Declined the request from ${user?.displayName ?? 'that member'}`, 'info');
  }

  setUserRole(userId: string, role: 'admin' | 'student' | 'viewer') {
    const user = this.users.find((u) => u._id === userId);
    if (!user) return;
    this.push(api.users.setUserRole, { userId: asId<'users'>(userId), role });
    this.showToast(`${user.displayName} is now a ${role}`);
  }

  /**
   * Revoke access. Their Google account is untouched -- we only stop
   * answering: the roster row drops to `viewer`, so the next token they
   * present buys them no more than a stranger's public view.
   *
   * There is no `revokeUser` mutation to call any more, and there does not
   * need to be one: with `status` gone, "revoked" and "viewer" are the same
   * state, so revoking *is* a role change. The row itself stays -- deleting it
   * would only mean the next sign-in silently recreated it.
   */
  revokeUser(userId: string) {
    const user = this.users.find((u) => u._id === userId);
    if (!user) return;

    this.push(api.users.setUserRole, { userId: asId<'users'>(userId), role: 'viewer' });
    this.showToast(`Denied access for ${user.displayName}`, 'info');
  }

  // There is no `graduateClassBatch`. Graduation year is gone from the schema,
  // so there is nothing to select a class by; graduating one person is
  // `setUserRole(id, 'viewer')`, which is the same operation as revoking.

  // ── Accounts Methods ─────────────────────────────────────────────────
  /**
   * Re-baseline an account: overwrite its verified opening balance and the
   * date it was checked against the real statement. This is an edit reached
   * repeatedly during audits, not a one-time setup step, so it always writes
   * the values the admin just typed rather than merging partial input.
   */
  setAccountBalance(account: Account, openingBalance: number, asOfDate: string) {
    if (this.currentUser.role !== 'admin') {
      this.showToast('Only admins can set account balances', 'error');
      return;
    }

    const existing = this.accountConfigs.find((c) => c.account === account);
    const next = { account, openingBalance, asOfDate };
    this.accountConfigs = existing
      ? this.accountConfigs.map((c) => (c.account === account ? next : c))
      : [...this.accountConfigs, next];

    // The mutation takes the account's `key` slug, not the `account` name the
    // finance modules read it under.
    this.push(api.accounts.setBalance, { key: account, openingBalance, asOfDate });
    this.showToast(`${ACCOUNT_META[account].label} verified at $${openingBalance.toFixed(2)}`);
  }

  // ── Bank transaction categories ──────────────────────────────────────

  /**
   * The filings as `buildLedger` wants them: transaction id -> category. Built
   * fresh on read rather than cached, so a Convex snapshot or a local edit
   * flows straight through to every ledger that depends on it.
   */
  get hcbCategoryOverrides(): HcbCategoryOverrides {
    const map: HcbCategoryOverrides = {};
    for (const row of this.hcbCategories) map[row.hcbTransactionId] = row.category;
    return map;
  }

  /**
   * File a bank transaction under a category.
   *
   * `direction` comes from the sign of the transaction and is stored, but the
   * ledger never reads it back: `resolveHcbCategory` derives direction from the
   * transaction's own sign every time, so the stored value is dropped. It is
   * kept because it makes a filing row legible on its own -- an override read
   * out of the table says which side of the ledger it belongs to without
   * needing the transaction beside it -- not because anything depends on it.
   * The comment here used to claim the latter.
   */
  setHcbCategory(hcbTransactionId: string, direction: 'in' | 'out', category: IncomeCategory | ExpenseCategory) {
    if (this.currentUser.role === 'viewer') {
      this.showToast('Viewers cannot categorize transactions', 'error');
      return;
    }

    const row: HcbCategoryRow = {
      hcbTransactionId,
      direction,
      category,
      setByName: this.currentUser.displayName,
      updatedAt: Date.now()
    };

    const existing = this.hcbCategories.find((c) => c.hcbTransactionId === hcbTransactionId);
    this.hcbCategories = existing
      ? this.hcbCategories.map((c) => (c.hcbTransactionId === hcbTransactionId ? { ...c, ...row } : c))
      : [...this.hcbCategories, row];

    this.push(api.hcbCategories.set, { hcbTransactionId, direction, category });
  }

  /** Drop a filing, returning the transaction to automatic classification. */
  clearHcbCategory(hcbTransactionId: string) {
    if (this.currentUser.role === 'viewer') {
      this.showToast('Viewers cannot categorize transactions', 'error');
      return;
    }

    this.hcbCategories = this.hcbCategories.filter((c) => c.hcbTransactionId !== hcbTransactionId);

    this.push(api.hcbCategories.clear, { hcbTransactionId });
  }

  /**
   * How many bank transactions in a season are still sitting in
   * `uncategorized` -- what the dashboard nudge counts.
   */
  uncategorizedHcbCount(seasonKey: string = this.selectedSeason): number {
    const { entries } = buildLedger({
      expenses: this.expenses,
      deposits: this.incomeDeposits,
      hcbTransactions: this.hcbTransactions,
      season: seasonKey,
      hcbCategoryOverrides: this.hcbCategoryOverrides
    });
    return entries.filter((e) => e.source === 'hcb' && e.category === 'uncategorized').length;
  }

  /**
   * Donor totals for a calendar year. Built over the full ledger rather than
   * the raw tables so a gift logged by hand *and* synced from the bank counts
   * once -- `buildLedger` already collapses that overlap.
   */
  donorData(taxYear: number | 'all') {
    const { entries } = buildLedger({
      expenses: this.expenses,
      deposits: this.incomeDeposits,
      hcbTransactions: this.hcbTransactions,
      season: 'all',
      hcbCategoryOverrides: this.hcbCategoryOverrides
    });

    const hcbDonations: HcbDonationRef[] = this.hcbDonations
      .filter((d) => d.transaction?.id && d.donor?.name)
      .map((d) => ({
        transactionId: d.transaction!.id,
        donorName: d.donor!.name!,
        date: d.date.slice(0, 10)
      }));

    const donors = groupDonors(collectGifts({ entries, hcbDonations, taxYear }));
    return { donors, suggestions: suggestDuplicates(donors) };
  }

  /** Every calendar year that has at least one attributable gift, newest first. */
  donorTaxYears(): number[] {
    const { donors } = this.donorData('all');
    const years = new Set<number>();
    for (const d of donors) for (const g of d.gifts) years.add(g.taxYear);
    return [...years].sort((a, b) => b - a);
  }

  // ── Metrics & Calculations ───────────────────────────────────────────

  /**
   * Current balances. Deliberately not season-scoped — "how much do we have
   * right now" is one present-tense number, so this ignores selectedSeason.
   */
  get accountBalances() {
    // hcbOrg is restored from localStorage at boot and only refreshed on a
    // successful sync, so its mere presence does not mean it is current --
    // this is the one clock read that decides whether the cache is still
    // young enough to call "live" (balances.ts itself must stay pure).
    const hcbBalanceIsStale =
      !this.hcbLastSyncedAt || Date.now() - this.hcbLastSyncedAt > HCB_STALE_AFTER_MS;

    return computeBalances({
      configs: this.accountConfigs,
      deposits: this.incomeDeposits,
      expenses: this.expenses,
      hcbMeasuredBalance: this.hcbOrg ? (this.hcbOrg.balances?.balance_cents ?? 0) / 100 : undefined,
      hcbBalanceIsStale
    });
  }

  get metrics() {
    // "Potential" is money still in play, so a finished grant -- awarded,
    // declined or dropped -- is no longer part of it.
    const totalPotential = this.boardGrants.reduce((sum, g) => sum + (g.amount || 0), 0);
    const awardedGrants = this.grants.filter((g) => g.status === 'awarded');
    // What the funder actually gave, falling back to the ask for grants
    // awarded before the amount was recorded separately.
    const totalAwarded = awardedGrants.reduce((sum, g) => sum + (g.awardedAmount ?? g.amount ?? 0), 0);
    const draftingGrants = this.grants.filter((g) => g.status === 'drafting');
    const totalDrafting = draftingGrants.reduce((sum, g) => sum + (g.amount || 0), 0);
    const inReviewGrants = this.grants.filter((g) => g.status === 'awaiting_approval' || g.status === 'submitted');
    const totalInReview = inReviewGrants.reduce((sum, g) => sum + (g.amount || 0), 0);

    const totalSponsorFunding = this.sponsors.reduce((sum, s) => sum + (s.totalDonated || 0), 0);
    const currentYearPledges = this.sponsors.reduce((sum, s) => sum + (s.currentYearPledge || 0), 0);

    // Expenses metrics
    const totalExpenses = this.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const approvedExpenses = this.expenses
      .filter((e) => e.status === 'approved' || e.status === 'purchased' || e.status === 'reimbursed')
      .reduce((sum, e) => sum + (e.finalPaidAmount ?? e.amount ?? 0), 0);
    const pendingExpenses = this.expenses.filter((e) => e.status === 'pending_approval');
    const pendingExpensesAmount = pendingExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Fundraisers & Bank Deposits metrics
    const totalFundraiserIncome = this.incomeDeposits.reduce((sum, d) => sum + (d.amount || 0), 0);
    const hcbDepositsTotal = this.incomeDeposits
      .filter((d) => d.depositAccount === 'hcb_bank')
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const schoolAccountDepositsTotal = this.incomeDeposits
      .filter((d) => d.depositAccount === 'school_account')
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    // Live Hack Club Bank (HCB) figures
    const hcbBalanceDollars = (this.hcbOrg?.balances?.balance_cents || 0) / 100;
    const hcbTotalRaisedDollars = (this.hcbOrg?.balances?.total_raised || 0) / 100;

    const staleSponsors = this.sponsors.filter((s) => {
      if (!s.lastContactDate) return true;
      const last = new Date(s.lastContactDate).getTime();
      const nineMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 270;
      return last < nineMonthsAgo;
    });

    return {
      totalPotential,
      totalAwarded,
      totalDrafting,
      totalInReview,
      awardedCount: awardedGrants.length,
      totalGrantsCount: this.grants.length,
      totalSponsorFunding,
      currentYearPledges,
      totalExpenses,
      approvedExpenses,
      pendingExpensesAmount,
      pendingExpensesCount: pendingExpenses.length,
      totalFundraiserIncome,
      hcbDepositsTotal,
      schoolAccountDepositsTotal,
      hcbBalanceDollars,
      hcbTotalRaisedDollars,
      staleSponsorsCount: staleSponsors.length
    };
  }

  getFinancialsForSeason(seasonKey: string = this.selectedSeason) {
    const isAll = seasonKey === 'all';
    
    // Extract base year number from season key (e.g. '2026-2027' -> 2026, '2025-2026' -> 2025, '2024-2025' -> 2024)
    let yearNum: number | null = null;
    const yearMatch = seasonKey.match(/^(\d{4})/);
    if (!isAll && yearMatch) {
      yearNum = parseInt(yearMatch[1], 10);
    }

    // 1. Filtered Grants
    //
    // The tag alone, for the same reason as the deposits below -- and because
    // the year in a `deadline` is not a season at all: a rolling or
    // to-be-determined deadline has no year in it, so the fallback both
    // double-counted grants whose deadline year and season disagreed and
    // silently dropped every grant with no fixed deadline.
    const filteredGrants = isAll
      ? this.grants
      : this.grants.filter((g) => g.season === seasonKey);
    const awardedGrants = filteredGrants.filter((g) => g.status === 'awarded');
    const totalAwarded = awardedGrants.reduce((sum, g) => sum + (g.awardedAmount ?? g.amount ?? 0), 0);

    // 2. Filtered Sponsors
    let totalSponsorReceived = 0;
    let totalSponsorPledged = 0;
    const contributingSponsors: Array<{
      sponsor: Sponsor;
      amount: number;
      status: string;
      year: number;
    }> = [];

    for (const s of this.sponsors) {
      if (isAll) {
        if (s.totalDonated > 0) {
          totalSponsorReceived += s.totalDonated;
          contributingSponsors.push({
            sponsor: s,
            amount: s.totalDonated,
            status: s.status,
            year: yearNum ?? this.currentSeasonYear ?? new Date().getFullYear()
          });
        }
        if (s.currentYearPledge && s.status === 'pledged') {
          totalSponsorPledged += s.currentYearPledge;
        }
      } else if (yearNum !== null) {
        const hist = s.annualHistory?.find((h) => h.year === yearNum);
        if (hist) {
          const amt = hist.amount || 0;
          if (hist.status === 'received') {
            totalSponsorReceived += amt;
          } else if (hist.status === 'pledged') {
            totalSponsorPledged += amt;
          }
          if (amt > 0) {
            contributingSponsors.push({
              sponsor: s,
              amount: amt,
              status: hist.status,
              year: yearNum
            });
          }
        } else if (yearNum === this.currentSeasonYear) {
          // No outreach row for this year, but it *is* the current season, so
          // the sponsor's standing status is the best evidence there is. The
          // season marked `isCurrent` decides that -- never a literal year,
          // which is right for one season and silently wrong for every one
          // after it.
          if (s.status === 'paid_active') {
            totalSponsorReceived += s.currentYearPledge || s.totalDonated || 0;
          } else if (s.status === 'pledged') {
            totalSponsorPledged += s.currentYearPledge || 0;
          }
        }
      }
    }
    const totalSponsorFunding = totalSponsorReceived + totalSponsorPledged;

    // 3. Filtered Fundraisers & Income Deposits
    // The tag alone, with no fallback to the date -- exactly as the expense
    // filter below already does. A deposit's `season` is authoritative human
    // data: an awarded grant's money belongs to the season the grant was
    // *applied for*, and it routinely arrives a season later. ORing date
    // inference back in made such a deposit match both seasons at once and
    // counted the award twice across the two views.
    const filteredDeposits = isAll
      ? this.incomeDeposits
      : this.incomeDeposits.filter((d) => d.season === seasonKey);
    /**
     * Everything banked in this season *except* an awarded grant.
     *
     * `grants.finish` inserts an `incomeDeposits` row with `category: "grants"`
     * in the same transaction as the status change -- deliberately, so an
     * award and the money it produced can never disagree. That row is the same
     * money `totalAwarded` above already counted, so adding both into
     * `totalRaised` reported one $5,000 grant as $10,000 raised: 40% of the
     * season goal on the dashboard beside a Sankey saying $5,000, with the
     * optimistic figure being the one quoted to funders.
     *
     * The exclusion mirrors what the ledger side already does two blocks down,
     * where `incomeByCategory.grants` is *overwritten* with `totalAwarded`
     * rather than added to it -- which is why `totalIn` was right all along.
     */
    const totalFundraiserIncome = filteredDeposits
      .filter((d) => d.category !== 'grants')
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    // 4. Live HCB Figures
    const hcbBalanceDollars = (this.hcbOrg?.balances?.balance_cents || 0) / 100;
    const hcbTotalRaisedDollars = (this.hcbOrg?.balances?.total_raised || 0) / 100;

    // Total Raised (season-goal progress only; totalIn from the ledger below is
    // the number surfaced to the rest of the app). Each term counts money the
    // other two do not -- see `totalFundraiserIncome`, which excludes the
    // deposit `grants.finish` writes for exactly this reason.
    const totalRaised = totalAwarded + totalSponsorFunding + totalFundraiserIncome;

    // 5. Filtered Expenses ("Where it went")
    const filteredExpenses = isAll
      ? this.expenses
      : this.expenses.filter((e) => e.season === seasonKey);

    const approvedExpensesList = filteredExpenses.filter(
      (e) => e.status === 'approved' || e.status === 'purchased' || e.status === 'reimbursed'
    );

    // 6. Ledger-driven category breakdown. buildLedger merges logged records
    // with unmatched bank activity and classifies everything into the shared
    // taxonomy, so per-category arithmetic no longer lives in the store.
    const { entries } = buildLedger({
      expenses: this.expenses,
      deposits: this.incomeDeposits,
      hcbTransactions: this.hcbTransactions,
      season: seasonKey,
      hcbCategoryOverrides: this.hcbCategoryOverrides
    });

    const sumBy = <K extends string>(dir: 'in' | 'out', keys: K[]) =>
      Object.fromEntries(
        keys.map((k) => [k, entries
          .filter((e) => e.direction === dir && e.category === k)
          .reduce((s, e) => s + e.amount, 0)])
      ) as Record<K, number>;

    const incomeByCategory = sumBy('in', Object.keys(INCOME_CATEGORY_META) as IncomeCategory[]);
    const expensesByCategory = sumBy('out', Object.keys(EXPENSE_CATEGORY_META) as ExpenseCategory[]);

    // Grants and sponsorships are authoritative on their own tabs, so the
    // income side takes them from there rather than from the ledger.
    //
    // These are assignments, not `+=`: an awarded grant *is* also a deposit --
    // `grants.finish` writes one with `category: "grants"` -- and adding to
    // what the ledger already counted would report the same award twice.
    // Overwriting is what has kept `totalIn` honest; `totalFundraiserIncome`
    // above now excludes the same row for the same reason.
    //
    // Sponsorships uses totalSponsorReceived, not totalSponsorFunding: a pledge
    // is a promise, not money in the bank, and this node must only ever show
    // money actually received (per the design spec's reconciliation table).
    incomeByCategory.grants = totalAwarded;
    incomeByCategory.sponsorships = totalSponsorReceived;

    const totalIn = Object.values(incomeByCategory).reduce((s, n) => s + n, 0);
    const totalOut = Object.values(expensesByCategory).reduce((s, n) => s + n, 0);

    const seasonGoal = isAll ? ALL_TIME_GOAL : SEASON_GOALS[seasonKey] ?? DEFAULT_SEASON_GOAL;

    const goalProgressPct = Math.min(100, Math.round((totalRaised / seasonGoal) * 100));

    return {
      seasonKey,
      yearNum,
      isAll,
      seasonGoal,
      goalProgressPct,
      totalAwarded,
      awardedCount: awardedGrants.length,
      awardedGrants,
      totalSponsorFunding,
      totalSponsorReceived,
      totalSponsorPledged,
      contributingSponsors,
      totalFundraiserIncome,
      depositsCount: filteredDeposits.length,
      filteredDeposits,
      hcbBalanceDollars,
      hcbTotalRaisedDollars,
      approvedExpensesList,
      filteredExpenses,
      expensesCount: approvedExpensesList.length,
      entries,
      incomeByCategory,
      expensesByCategory,
      totalIn,
      totalOut,
      net: totalIn - totalOut
    };
  }

  // ── Team info ────────────────────────────────────────────────────────

  /** Hand-ordered, so the list is sorted by `order` and never by content. */
  get orderedTeamInfo(): TeamInfoField[] {
    return [...this.teamInfo].sort((a, b) => a.order - b.order);
  }

  /** Team info is what goes out on applications, so only admins may change it. */
  private ensureAdmin(): boolean {
    if (this.currentUser.role !== 'admin') {
      this.showToast('Only admins can edit team info', 'error');
      return false;
    }
    return true;
  }

  addTeamInfoField(label: string, value: string) {
    if (!this.ensureAdmin()) return;
    const now = Date.now();
    const id = `tif_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const order = this.teamInfo.reduce((max, f) => Math.max(max, f.order), -1) + 1;
    const field: TeamInfoField = {
      _id: id,
      label,
      value,
      order,
      updatedAt: now
    };
    this.teamInfo = [...this.teamInfo, field];
    this.push(api.teamInfo.create, { label, value });
    this.showToast(`Added "${label}"`);
  }

  updateTeamInfoField(id: string, label: string, value: string) {
    if (!this.ensureAdmin()) return;
    const index = this.teamInfo.findIndex((f) => f._id === id);
    if (index === -1) return;

    this.teamInfo[index] = {
      ...this.teamInfo[index],
      label,
      value,
      updatedAt: Date.now()
    };
    this.teamInfo = [...this.teamInfo];
    this.push(api.teamInfo.update, { id: asId<'teamInfo'>(id), label, value });
    this.showToast(`Saved "${label}"`);
  }

  deleteTeamInfoField(id: string) {
    if (!this.ensureAdmin()) return;
    const field = this.teamInfo.find((f) => f._id === id);
    if (!field) return;

    this.teamInfo = this.teamInfo.filter((f) => f._id !== id);
    this.push(api.teamInfo.remove, { id: asId<'teamInfo'>(id) });
    this.showToast(`Removed "${field.label}"`, 'info');
  }

  /**
   * Move one field up or down. The whole ordering is rewritten rather than
   * swapping two `order` values, so a list that has drifted out of sequence --
   * an imported set, a half-applied edit -- comes back consistent.
   */
  moveTeamInfoField(id: string, direction: -1 | 1) {
    if (!this.ensureAdmin()) return;
    const ordered = this.orderedTeamInfo;
    const from = ordered.findIndex((f) => f._id === id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= ordered.length) return;

    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    this.teamInfo = ordered.map((f, i) => ({ ...f, order: i }));
    this.push(api.teamInfo.reorder, {
      ids: ordered.map((f) => asId<'teamInfo'>(f._id))
    });
  }

  // ── Wishlist ─────────────────────────────────────────────────────────

  /** Most-wanted first, then dearest first, so the list reads as a priority order. */
  get orderedWishlist(): WishlistItem[] {
    return [...this.wishlist].sort((a, b) => b.priority - a.priority || b.cost - a.cost);
  }

  get wishlistTotal(): number {
    return this.wishlist.reduce((sum, item) => sum + item.cost, 0);
  }

  // No `requestedByName`: who asked for a tool is not a fact worth keeping
  // about a student, and the column is gone from the schema.
  addWishlistItem(item: Omit<WishlistItem, '_id' | 'updatedAt'>) {
    if (!this.ensureCanEdit()) return;
    const now = Date.now();
    const id = `wish_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const record: WishlistItem = {
      ...item,
      _id: id,
      updatedAt: now
    };
    this.wishlist = [record, ...this.wishlist];
    this.push(api.wishlist.create, { ...item });
    this.showToast(`Added "${item.tool}" to the wishlist`);
  }

  updateWishlistItem(updated: WishlistItem) {
    if (!this.ensureCanEdit()) return;
    const index = this.wishlist.findIndex((w) => w._id === updated._id);
    if (index === -1) return;

    this.wishlist[index] = { ...updated, updatedAt: Date.now() };
    this.wishlist = [...this.wishlist];
    const { _id, updatedAt, ...fields } = updated;
    this.push(api.wishlist.update, { id: asId<'wishlist'>(_id), ...fields });
    this.showToast(`Saved "${updated.tool}"`);
  }

  deleteWishlistItem(id: string) {
    if (!this.ensureCanEdit()) return;
    const item = this.wishlist.find((w) => w._id === id);
    if (!item) return;

    this.wishlist = this.wishlist.filter((w) => w._id !== id);
    this.push(api.wishlist.remove, { id: asId<'wishlist'>(id) });
    this.showToast(`Removed "${item.tool}"`, 'info');
  }
}

export const cacao = new CacaoStore();
