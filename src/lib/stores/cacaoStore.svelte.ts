import { browser } from '$app/environment';
import type {
  Grant,
  Sponsor,
  Contact,
  User,
  AccessRequest,
  AuditLog,
  GrantStatus,
  UserRole,
  RequirementItem,
  AnnualOutreachRecord,
  Expense,
  ExpenseStatus,
  PaymentMethod,
  CarrierType,
  DeliveryStatus,
  IncomeDeposit,
  IncomeCategory,
  DepositAccount,
  HCBOrganization,
  HCBTransaction
} from '$lib/types';
import {
  SEED_GRANTS,
  SEED_SPONSORS,
  SEED_CONTACTS,
  SEED_USERS,
  SEED_ACCESS_REQUESTS,
  SEED_AUDIT_LOGS,
  SEED_EXPENSES,
  SEED_INCOME_DEPOSITS
} from '$lib/data/seedData';
import { getConvexClient, isConvexEnabled } from '$lib/convex/client';
import { api } from '../../../convex/_generated/api';
import type { Id, TableNames } from '../../../convex/_generated/dataModel';
import type { FunctionReference } from 'convex/server';

/**
 * The shared types in `$lib/types` model ids as plain strings. In remote mode
 * every id in the store originated from a Convex document, so narrowing back to
 * a branded `Id` at the mutation boundary is sound.
 */
const asId = <T extends TableNames>(id: string) => id as Id<T>;

const STORAGE_KEYS = {
  GRANTS: 'cacao_grants_v1',
  SPONSORS: 'cacao_sponsors_v1',
  CONTACTS: 'cacao_contacts_v1',
  USERS: 'cacao_users_v1',
  REQUESTS: 'cacao_requests_v1',
  AUDIT: 'cacao_audit_v1',
  CURRENT_USER: 'cacao_current_user_v1',
  EXPENSES: 'cacao_expenses_v1',
  INCOME: 'cacao_income_v1',
  HCB_ORG: 'cacao_hcb_org_v1',
  HCB_TXNS: 'cacao_hcb_txns_v1',
  HCB_SYNC: 'cacao_hcb_sync_v1'
};

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

class CacaoStore {
  // Reactive state using Svelte 5 runes
  grants = $state<Grant[]>([]);
  sponsors = $state<Sponsor[]>([]);
  contacts = $state<Contact[]>([]);
  users = $state<User[]>([]);
  accessRequests = $state<AccessRequest[]>([]);
  auditLogs = $state<AuditLog[]>([]);
  expenses = $state<Expense[]>([]);
  incomeDeposits = $state<IncomeDeposit[]>([]);
  currentUser = $state<User>(SEED_USERS[0]); // Default to the seeded head mentor (admin)

  // Hack Club Bank (HCB) Live State
  hcbOrg = $state<HCBOrganization | null>(null);
  hcbTransactions = $state<HCBTransaction[]>([]);
  isHcbSyncing = $state<boolean>(false);
  hcbLastSyncedAt = $state<number | null>(null);
  hcbSlug = $state<string>('the-panther-project');

  // UI filter state
  selectedSeason = $state<string>('2026-2027');
  selectedAssignee = $state<string>('all');
  selectedExpenseCategory = $state<string>('all');
  searchQuery = $state<string>('');
  activeView = $state<'kanban' | 'table' | 'sponsors' | 'contacts' | 'expenses' | 'analytics' | 'admin'>('kanban');
  toastMessage = $state<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  /**
   * True when `PUBLIC_CONVEX_URL` is set, meaning every table is served live
   * from Convex. False means the legacy localStorage + seed-data mode.
   */
  readonly isRemote = isConvexEnabled;

  /** Remote mode only: true until the first snapshot of each table lands. */
  isLoading = $state<boolean>(isConvexEnabled);
  connectionError = $state<string | null>(null);

  private unsubscribers: Array<() => void> = [];

  constructor() {
    if (this.isRemote) {
      // Collections stay empty until Convex answers; rendering seed rows here
      // would flash data that is not in the deployment.
      this.currentUser = loadStored(STORAGE_KEYS.CURRENT_USER, SEED_USERS[0]);
      if (browser) {
        this.subscribeToConvex();
        this.hcbOrg = loadStored(STORAGE_KEYS.HCB_ORG, null);
        this.hcbTransactions = loadStored(STORAGE_KEYS.HCB_TXNS, []);
        this.hcbLastSyncedAt = loadStored(STORAGE_KEYS.HCB_SYNC, null);
        this.syncHackClubBank(false);
      }
      return;
    }

    if (browser) {
      this.grants = loadStored(STORAGE_KEYS.GRANTS, SEED_GRANTS);
      this.sponsors = loadStored(STORAGE_KEYS.SPONSORS, SEED_SPONSORS);
      this.contacts = loadStored(STORAGE_KEYS.CONTACTS, SEED_CONTACTS);
      this.users = loadStored(STORAGE_KEYS.USERS, SEED_USERS);
      this.accessRequests = loadStored(STORAGE_KEYS.REQUESTS, SEED_ACCESS_REQUESTS);
      this.auditLogs = loadStored(STORAGE_KEYS.AUDIT, SEED_AUDIT_LOGS);
      this.currentUser = loadStored(STORAGE_KEYS.CURRENT_USER, SEED_USERS[0]);
      this.expenses = loadStored(STORAGE_KEYS.EXPENSES, SEED_EXPENSES);
      this.incomeDeposits = loadStored(STORAGE_KEYS.INCOME, SEED_INCOME_DEPOSITS);
      this.hcbOrg = loadStored(STORAGE_KEYS.HCB_ORG, null);
      this.hcbTransactions = loadStored(STORAGE_KEYS.HCB_TXNS, []);
      this.hcbLastSyncedAt = loadStored(STORAGE_KEYS.HCB_SYNC, null);

      // Trigger background HCB sync on startup
      this.syncHackClubBank(false);
    } else {
      this.grants = SEED_GRANTS;
      this.sponsors = SEED_SPONSORS;
      this.contacts = SEED_CONTACTS;
      this.users = SEED_USERS;
      this.accessRequests = SEED_ACCESS_REQUESTS;
      this.auditLogs = SEED_AUDIT_LOGS;
      this.expenses = SEED_EXPENSES;
      this.incomeDeposits = SEED_INCOME_DEPOSITS;
    }
  }

  // ── Convex wiring ────────────────────────────────────────────────────

  /**
   * Open a live subscription per table. Convex pushes a fresh array whenever
   * anything changes, so these assignments are the single source of truth in
   * remote mode and they overwrite any optimistic edit a mutation made.
   */
  private subscribeToConvex() {
    const client = getConvexClient();
    if (!client) return;

    const pending = new Set([
      'grants',
      'sponsors',
      'contacts',
      'users',
      'accessRequests',
      'auditLogs',
      'expenses',
      'incomeDeposits'
    ]);

    const settle = (key: string) => {
      pending.delete(key);
      if (pending.size === 0) this.isLoading = false;
    };

    const onError = (e: Error) => {
      console.error('Convex subscription failed:', e);
      this.connectionError = e.message;
      this.isLoading = false;
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
        onError
      )
    );
    track(
      client.onUpdate(
        api.users.listAccessRequests,
        {},
        (rows) => {
          this.accessRequests = rows;
          settle('accessRequests');
        },
        onError
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
        onError
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
  }

  /** Actor fields every mutation needs for its audit-log entry. */
  private get actor() {
    return {
      actorName: this.currentUser.name,
      actorEmail: this.currentUser.email,
      actorRole: this.currentUser.role
    };
  }

  /**
   * Fire a Convex mutation, or do nothing in local mode. Failures surface as a
   * toast; the live subscription then snaps the UI back to server truth, which
   * undoes whatever optimistic edit the caller applied.
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

  /** Drop every live subscription. Only needed by tests and hot reloads. */
  disconnect() {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  showToast(text: string, type: 'success' | 'info' | 'error' = 'success') {
    this.toastMessage = { text, type };
    setTimeout(() => {
      if (this.toastMessage?.text === text) {
        this.toastMessage = null;
      }
    }, 4000);
  }

  private persistAll() {
    // In remote mode Convex owns the data; only the local profile pick and the
    // HCB cache are worth keeping in localStorage.
    if (this.isRemote) {
      saveStored(STORAGE_KEYS.CURRENT_USER, this.currentUser);
      saveStored(STORAGE_KEYS.HCB_ORG, this.hcbOrg);
      saveStored(STORAGE_KEYS.HCB_TXNS, this.hcbTransactions);
      saveStored(STORAGE_KEYS.HCB_SYNC, this.hcbLastSyncedAt);
      return;
    }

    saveStored(STORAGE_KEYS.GRANTS, this.grants);
    saveStored(STORAGE_KEYS.SPONSORS, this.sponsors);
    saveStored(STORAGE_KEYS.CONTACTS, this.contacts);
    saveStored(STORAGE_KEYS.USERS, this.users);
    saveStored(STORAGE_KEYS.REQUESTS, this.accessRequests);
    saveStored(STORAGE_KEYS.AUDIT, this.auditLogs);
    saveStored(STORAGE_KEYS.CURRENT_USER, this.currentUser);
    saveStored(STORAGE_KEYS.EXPENSES, this.expenses);
    saveStored(STORAGE_KEYS.INCOME, this.incomeDeposits);
    saveStored(STORAGE_KEYS.HCB_ORG, this.hcbOrg);
    saveStored(STORAGE_KEYS.HCB_TXNS, this.hcbTransactions);
    saveStored(STORAGE_KEYS.HCB_SYNC, this.hcbLastSyncedAt);
  }

  private addAudit(
    action: AuditLog['action'],
    entityType: AuditLog['entityType'],
    entityId: string,
    entityName: string,
    summary: string,
    details?: Record<string, any>
  ) {
    // Convex mutations write their own audit rows server-side, so logging here
    // as well would duplicate every entry.
    if (this.isRemote) return;

    const log: AuditLog = {
      _id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      actorName: this.currentUser.name,
      actorEmail: this.currentUser.email,
      actorRole: this.currentUser.role,
      action,
      entityType,
      entityId,
      entityName,
      summary,
      details
    };
    this.auditLogs = [log, ...this.auditLogs];
    saveStored(STORAGE_KEYS.AUDIT, this.auditLogs);
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

      // 2. Fetch recent transactions feed
      const txnRes = await fetch(`https://hcb.hackclub.com/api/v3/organizations/${slug}/transactions?per_page=40`);
      if (txnRes.ok) {
        const txnData: HCBTransaction[] = await txnRes.json();
        this.hcbTransactions = txnData;
        saveStored(STORAGE_KEYS.HCB_TXNS, txnData);
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

  // ── Grants Methods ───────────────────────────────────────────────────
  addGrant(newGrant: Omit<Grant, '_id' | 'createdAt' | 'updatedAt' | 'lastModifiedBy'>) {
    const now = Date.now();
    const id = `grant_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const grant: Grant = {
      ...newGrant,
      _id: id,
      createdAt: now,
      updatedAt: now,
      lastModifiedBy: this.currentUser.name
    };
    this.grants = [grant, ...this.grants];
    this.addAudit('create', 'grant', id, grant.title, `Created grant opportunity "${grant.title}" for $${grant.amount}`);
    this.persistAll();
    // `order` is assigned server-side from the target column's current max.
    const { order, ...fields } = newGrant;
    this.push(api.grants.create, { ...fields, ...this.actor });
    this.showToast(`Created grant "${grant.title}"!`);
  }

  updateGrant(updated: Grant) {
    const index = this.grants.findIndex((g) => g._id === updated._id);
    if (index === -1) return;

    const old = this.grants[index];
    const now = Date.now();
    const grant: Grant = {
      ...updated,
      updatedAt: now,
      lastModifiedBy: this.currentUser.name
    };

    this.grants[index] = grant;
    this.grants = [...this.grants];

    if (old.status !== updated.status) {
      this.addAudit(
        'status_change',
        'grant',
        grant._id,
        grant.title,
        `Moved "${grant.title}" from ${old.status} to ${updated.status}`,
        { oldStatus: old.status, newStatus: updated.status }
      );
    } else {
      this.addAudit('update', 'grant', grant._id, grant.title, `Updated grant "${grant.title}" details`);
    }

    this.persistAll();
    const { _id, createdAt, updatedAt, lastModifiedBy, ...fields } = updated;
    this.push(api.grants.update, { id: asId<'grants'>(_id), ...fields, ...this.actor });
    this.showToast(`Saved changes to "${grant.title}"`);
  }

  updateGrantOrderAndStatus(grantId: string, targetStatus: GrantStatus, newOrder: number) {
    const grant = this.grants.find((g) => g._id === grantId);
    if (!grant) return;

    const oldStatus = grant.status;
    grant.status = targetStatus;
    grant.order = newOrder;
    grant.updatedAt = Date.now();
    grant.lastModifiedBy = this.currentUser.name;

    this.grants = [...this.grants];
    if (oldStatus !== targetStatus) {
      this.addAudit(
        'status_change',
        'grant',
        grant._id,
        grant.title,
        `Shifted "${grant.title}" to ${targetStatus}`,
        { oldStatus, targetStatus }
      );
      this.showToast(`Moved "${grant.title}" to ${targetStatus}`);
    }
    this.persistAll();
    this.push(api.grants.updateStatusAndOrder, {
      id: asId<'grants'>(grantId),
      status: targetStatus,
      order: newOrder,
      ...this.actor
    });
  }

  deleteGrant(grantId: string) {
    const grant = this.grants.find((g) => g._id === grantId);
    if (!grant) return;

    this.grants = this.grants.filter((g) => g._id !== grantId);
    this.addAudit('delete', 'grant', grantId, grant.title, `Deleted grant opportunity "${grant.title}"`);
    this.persistAll();
    this.push(api.grants.remove, { id: asId<'grants'>(grantId), ...this.actor });
    this.showToast(`Deleted "${grant.title}"`, 'info');
  }

  // ── Expenses & Purchase Requests Methods ─────────────────────────────
  addExpense(newExpense: Omit<Expense, '_id' | 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const id = `exp_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const expense: Expense = {
      ...newExpense,
      _id: id,
      createdAt: now,
      updatedAt: now
    };
    this.expenses = [expense, ...this.expenses];
    this.addAudit(
      'create',
      'system',
      id,
      expense.title,
      `Submitted purchase request "${expense.title}" for $${expense.amount} (${expense.vendor})`
    );
    this.persistAll();
    // The workflow timestamps are set by the approve/purchase/reimburse
    // mutations, so a new request never carries them.
    const { approvedBy, approvedAt, purchasedAt, receivedAt, reimbursedAt, ...fields } = newExpense;
    this.push(api.expenses.add, fields);
    this.showToast(`Logged expense request for $${expense.amount}!`);
  }

  updateExpense(updated: Expense) {
    const index = this.expenses.findIndex((e) => e._id === updated._id);
    if (index === -1) return;

    const old = this.expenses[index];
    const now = Date.now();
    const exp: Expense = {
      ...updated,
      updatedAt: now
    };
    this.expenses[index] = exp;
    this.expenses = [...this.expenses];

    if (old.status !== updated.status) {
      this.addAudit(
        'status_change',
        'system',
        exp._id,
        exp.title,
        `Updated expense status from ${old.status} to ${updated.status}`,
        { oldStatus: old.status, newStatus: updated.status }
      );
    } else {
      this.addAudit('update', 'system', exp._id, exp.title, `Updated expense details for "${exp.title}"`);
    }

    this.persistAll();
    const {
      _id,
      createdAt,
      updatedAt,
      approvedBy,
      approvedAt,
      purchasedAt,
      receivedAt,
      reimbursedAt,
      ...fields
    } = updated;
    this.push(api.expenses.update, { id: asId<'expenses'>(_id), ...fields, ...this.actor });
    this.showToast(`Saved changes to "${exp.title}"`);
  }

  approveExpense(expenseId: string) {
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'approved';
    exp.approvedBy = this.currentUser.name;
    exp.approvedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.addAudit('status_change', 'system', exp._id, exp.title, `Mentor approved purchase request "${exp.title}" ($${exp.amount})`);
    this.persistAll();
    this.push(api.expenses.approve, { id: asId<'expenses'>(expenseId), ...this.actor });
    this.showToast(`Approved expense for $${exp.amount}!`);
  }

  recordPurchase(
    expenseId: string,
    details: {
      finalPaidAmount: number;
      paymentMethod: PaymentMethod;
      purchaserName: string;
      orderNumber?: string;
      trackingNumber?: string;
      carrier?: CarrierType;
      expectedDeliveryDate?: string;
      deliveryStatus?: DeliveryStatus;
      receiptUrl?: string;
    }
  ) {
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'purchased';
    exp.finalPaidAmount = details.finalPaidAmount;
    exp.paymentMethod = details.paymentMethod;
    exp.purchaserName = details.purchaserName;
    exp.orderNumber = details.orderNumber;
    exp.trackingNumber = details.trackingNumber;
    exp.carrier = details.carrier;
    exp.expectedDeliveryDate = details.expectedDeliveryDate;
    exp.deliveryStatus = details.deliveryStatus || 'ordered';
    if (details.receiptUrl) exp.receiptUrl = details.receiptUrl;
    exp.purchasedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    const savings = exp.amount - details.finalPaidAmount;
    const savingsNote = savings > 0 ? ` (Saved $${savings.toFixed(2)} with discount/tax-exempt)` : '';
    this.addAudit(
      'status_change',
      'system',
      exp._id,
      exp.title,
      `Recorded purchase for "${exp.title}" via ${details.paymentMethod.replace('_', ' ')} ($${details.finalPaidAmount})${savingsNote}`
    );
    this.persistAll();
    this.push(api.expenses.recordPurchase, {
      id: asId<'expenses'>(expenseId),
      finalPaidAmount: details.finalPaidAmount,
      paymentMethod: details.paymentMethod,
      purchaserName: details.purchaserName,
      orderNumber: details.orderNumber,
      trackingNumber: details.trackingNumber,
      carrier: details.carrier,
      expectedDeliveryDate: details.expectedDeliveryDate,
      deliveryStatus: details.deliveryStatus ?? 'ordered',
      receiptUrl: details.receiptUrl,
      ...this.actor
    });
    this.showToast(`Recorded order for "${exp.title}" ($${details.finalPaidAmount})`);
  }

  markExpenseDelivered(expenseId: string) {
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.deliveryStatus = 'delivered';
    exp.receivedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.addAudit(
      'status_change',
      'system',
      exp._id,
      exp.title,
      `Marked parts for "${exp.title}" as delivered/received in shop`
    );
    this.persistAll();
    this.push(api.expenses.markDelivered, { id: asId<'expenses'>(expenseId), ...this.actor });
    this.showToast(`Marked "${exp.title}" as received in shop!`);
  }

  purchaseExpense(expenseId: string) {
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'purchased';
    exp.purchasedAt = now;
    exp.finalPaidAmount = exp.finalPaidAmount ?? exp.amount;
    exp.deliveryStatus = exp.deliveryStatus || 'ordered';
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.addAudit('status_change', 'system', exp._id, exp.title, `Marked order as placed/purchased: "${exp.title}"`);
    this.persistAll();
    this.push(api.expenses.purchase, { id: asId<'expenses'>(expenseId), ...this.actor });
    this.showToast(`Marked as purchased!`);
  }

  reimburseExpense(expenseId: string) {
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    const now = Date.now();
    exp.status = 'reimbursed';
    exp.reimbursedAt = now;
    exp.updatedAt = now;

    this.expenses = [...this.expenses];
    this.addAudit('status_change', 'system', exp._id, exp.title, `Reimbursed student/mentor for "${exp.title}" ($${exp.amount})`);
    this.persistAll();
    this.push(api.expenses.reimburse, { id: asId<'expenses'>(expenseId), ...this.actor });
    this.showToast(`Marked expense as reimbursed!`);
  }

  deleteExpense(expenseId: string) {
    const exp = this.expenses.find((e) => e._id === expenseId);
    if (!exp) return;

    this.expenses = this.expenses.filter((e) => e._id !== expenseId);
    this.addAudit('delete', 'system', expenseId, exp.title, `Deleted expense "${exp.title}" ($${exp.amount})`);
    this.persistAll();
    this.push(api.expenses.remove, { id: asId<'expenses'>(expenseId), ...this.actor });
    this.showToast(`Deleted expense "${exp.title}"`, 'info');
  }

  // ── Fundraisers & Income Deposit Methods ──────────────────────────────
  addIncomeDeposit(newDeposit: Omit<IncomeDeposit, '_id' | 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const id = `inc_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const deposit: IncomeDeposit = {
      ...newDeposit,
      _id: id,
      createdAt: now,
      updatedAt: now
    };
    this.incomeDeposits = [deposit, ...this.incomeDeposits];
    this.addAudit(
      'create',
      'system',
      id,
      deposit.title,
      `Logged bank deposit of $${deposit.amount} for "${deposit.title}" (${deposit.depositAccount})`
    );
    this.persistAll();
    this.push(api.income.add, newDeposit);
    this.showToast(`Logged $${deposit.amount.toFixed(2)} deposit for ${deposit.title}!`);
  }

  updateIncomeDeposit(updated: IncomeDeposit) {
    const index = this.incomeDeposits.findIndex((d) => d._id === updated._id);
    if (index === -1) return;

    this.incomeDeposits[index] = { ...updated, updatedAt: Date.now() };
    this.incomeDeposits = [...this.incomeDeposits];
    this.addAudit('update', 'system', updated._id, updated.title, `Updated deposit details for "${updated.title}"`);
    this.persistAll();
    const { _id, createdAt, updatedAt, ...fields } = updated;
    this.push(api.income.update, { id: asId<'incomeDeposits'>(_id), ...fields, ...this.actor });
    this.showToast(`Saved changes to "${updated.title}"`);
  }

  deleteIncomeDeposit(id: string) {
    const dep = this.incomeDeposits.find((d) => d._id === id);
    if (!dep) return;

    this.incomeDeposits = this.incomeDeposits.filter((d) => d._id !== id);
    this.addAudit('delete', 'system', id, dep.title, `Removed deposit entry "${dep.title}" ($${dep.amount})`);
    this.persistAll();
    this.push(api.income.remove, { id: asId<'incomeDeposits'>(id), ...this.actor });
    this.showToast(`Deleted deposit "${dep.title}"`, 'info');
  }

  // ── Sponsors Methods ─────────────────────────────────────────────────
  addSponsor(newSponsor: Omit<Sponsor, '_id' | 'createdAt' | 'updatedAt' | 'lastModifiedBy'>) {
    const now = Date.now();
    const id = `sp_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const sponsor: Sponsor = {
      ...newSponsor,
      _id: id,
      createdAt: now,
      updatedAt: now,
      lastModifiedBy: this.currentUser.name
    };
    this.sponsors = [sponsor, ...this.sponsors];
    this.addAudit('create', 'sponsor', id, sponsor.name, `Added new sponsor organization "${sponsor.name}"`);
    this.persistAll();
    this.push(api.sponsors.create, { ...newSponsor, ...this.actor });
    this.showToast(`Added sponsor "${sponsor.name}"!`);
  }

  updateSponsor(updated: Sponsor) {
    const index = this.sponsors.findIndex((s) => s._id === updated._id);
    if (index === -1) return;

    const now = Date.now();
    const sponsor: Sponsor = {
      ...updated,
      updatedAt: now,
      lastModifiedBy: this.currentUser.name
    };
    this.sponsors[index] = sponsor;
    this.sponsors = [...this.sponsors];
    this.addAudit('update', 'sponsor', sponsor._id, sponsor.name, `Updated sponsor profile for "${sponsor.name}"`);
    this.persistAll();
    const { _id, createdAt, updatedAt, lastModifiedBy, ...fields } = updated;
    this.push(api.sponsors.update, { id: asId<'sponsors'>(_id), ...fields, ...this.actor });
    this.showToast(`Saved "${sponsor.name}"`);
  }

  deleteSponsor(sponsorId: string) {
    const sponsor = this.sponsors.find((s) => s._id === sponsorId);
    if (!sponsor) return;

    this.sponsors = this.sponsors.filter((s) => s._id !== sponsorId);
    this.addAudit('delete', 'sponsor', sponsorId, sponsor.name, `Removed sponsor organization "${sponsor.name}"`);
    this.persistAll();
    this.push(api.sponsors.remove, { id: asId<'sponsors'>(sponsorId), ...this.actor });
    this.showToast(`Removed "${sponsor.name}"`, 'info');
  }

  logSponsorOutreach(sponsorId: string, record: AnnualOutreachRecord) {
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
    sponsor.lastModifiedBy = this.currentUser.name;

    this.sponsors = [...this.sponsors];
    this.addAudit(
      'outreach_logged',
      'sponsor',
      sponsor._id,
      sponsor.name,
      `Logged ${record.year} outreach for "${sponsor.name}": status ${record.status}`
    );
    this.persistAll();
    this.push(api.sponsors.logOutreach, {
      sponsorId: asId<'sponsors'>(sponsorId),
      year: record.year,
      status: record.status,
      amount: record.amount,
      notes: record.notes,
      ...this.actor
    });
    this.showToast(`Logged outreach for ${sponsor.name}!`);
  }

  // ── Contacts Methods ─────────────────────────────────────────────────
  addContact(newContact: Omit<Contact, '_id' | 'createdAt' | 'updatedAt'>) {
    const now = Date.now();
    const id = `cnt_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const contact: Contact = {
      ...newContact,
      _id: id,
      createdAt: now,
      updatedAt: now
    };
    this.contacts = [contact, ...this.contacts];
    this.addAudit('create', 'contact', id, contact.name, `Added contact "${contact.name}" (${contact.title})`);
    this.persistAll();
    const { lastContactedAt, ...fields } = newContact;
    this.push(api.contacts.create, { ...fields, ...this.actor });
    this.showToast(`Added contact "${contact.name}"!`);
  }

  updateContact(updated: Contact) {
    const index = this.contacts.findIndex((c) => c._id === updated._id);
    if (index === -1) return;

    const now = Date.now();
    const contact: Contact = { ...updated, updatedAt: now };
    this.contacts[index] = contact;
    this.contacts = [...this.contacts];
    this.addAudit('update', 'contact', contact._id, contact.name, `Updated contact info for "${contact.name}"`);
    this.persistAll();
    const { _id, createdAt, updatedAt, ...fields } = updated;
    this.push(api.contacts.update, { id: asId<'contacts'>(_id), ...fields, ...this.actor });
    this.showToast(`Saved contact "${contact.name}"`);
  }

  deleteContact(contactId: string) {
    const contact = this.contacts.find((c) => c._id === contactId);
    if (!contact) return;

    this.contacts = this.contacts.filter((c) => c._id !== contactId);
    this.addAudit('delete', 'contact', contactId, contact.name, `Deleted contact "${contact.name}"`);
    this.persistAll();
    this.push(api.contacts.remove, { id: asId<'contacts'>(contactId), ...this.actor });
    this.showToast(`Deleted "${contact.name}"`, 'info');
  }

  // ── Users & Access Requests Methods ──────────────────────────────────
  setCurrentUser(user: User) {
    this.currentUser = user;
    saveStored(STORAGE_KEYS.CURRENT_USER, user);
    this.showToast(`Switched active profile to ${user.name}`);
  }

  submitAccessRequest(request: Omit<AccessRequest, '_id' | 'status' | 'submittedAt'>) {
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newReq: AccessRequest = {
      ...request,
      _id: id,
      status: 'pending',
      submittedAt: Date.now()
    };
    this.accessRequests = [newReq, ...this.accessRequests];
    this.persistAll();
    const { reviewedAt, reviewedBy, ...fields } = request;
    this.push(api.users.submitAccessRequest, fields);
    this.showToast(`Access request submitted for ${newReq.firstName} ${newReq.lastName}!`);
  }

  approveAccessRequest(requestId: string, role: UserRole = 'student') {
    const req = this.accessRequests.find((r) => r._id === requestId);
    if (!req) return;

    const fullName = `${req.firstName} ${req.lastName}`;
    const newUser: User = {
      _id: `user_${Date.now()}`,
      name: fullName,
      email: req.email,
      role,
      gradYear: req.gradYear,
      subteam: req.subteam,
      status: 'active',
      approvedBy: this.currentUser.name,
      approvedAt: Date.now(),
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };

    req.status = 'approved';
    req.reviewedAt = Date.now();
    req.reviewedBy = this.currentUser.name;

    this.users = [...this.users, newUser];
    this.accessRequests = [...this.accessRequests];
    this.addAudit('approve_user', 'user', newUser._id, fullName, `Approved access request for ${fullName} (${req.email}) as ${role}`);
    this.persistAll();
    if (role !== 'graduated') {
      this.push(api.users.approveAccessRequest, {
        requestId: asId<'accessRequests'>(requestId),
        role,
        mentorName: this.currentUser.name,
        mentorEmail: this.currentUser.email
      });
    }
    this.showToast(`Approved ${fullName} (${role})!`);
  }

  rejectAccessRequest(requestId: string) {
    const req = this.accessRequests.find((r) => r._id === requestId);
    if (!req) return;

    req.status = 'rejected';
    req.reviewedAt = Date.now();
    req.reviewedBy = this.currentUser.name;

    this.accessRequests = [...this.accessRequests];
    this.addAudit('reject_user', 'user', requestId, `${req.firstName} ${req.lastName}`, `Denied access request for ${req.email}`);
    this.persistAll();
    this.push(api.users.rejectAccessRequest, {
      requestId: asId<'accessRequests'>(requestId),
      ...this.actor
    });
    this.showToast(`Rejected request for ${req.email}`, 'info');
  }

  graduateClassBatch(gradYear: number) {
    const studentsToGraduate = this.users.filter((u) => u.gradYear === gradYear && u.status === 'active');
    
    studentsToGraduate.forEach((s) => {
      s.role = 'graduated';
      s.status = 'graduated';
    });

    this.users = [...this.users];
    this.addAudit(
      'graduate_batch',
      'user',
      `class_${gradYear}`,
      `Class of ${gradYear}`,
      `Graduated and archived ${studentsToGraduate.length} student account(s) for the Class of ${gradYear}`
    );
    this.persistAll();
    this.push(api.users.graduateClassBatch, {
      gradYear,
      mentorName: this.currentUser.name,
      mentorEmail: this.currentUser.email
    });
    this.showToast(`Graduated ${studentsToGraduate.length} student(s) from Class of ${gradYear}!`);
  }

  verifyMentorPasscode(code: string): boolean {
    const validCodes = ['PANTHER2064', '2064', 'CACAO2064'];
    return validCodes.includes(code.trim().toUpperCase());
  }

  // ── Metrics & Calculations ───────────────────────────────────────────
  get metrics() {
    const totalPotential = this.grants.reduce((sum, g) => sum + (g.amount || 0), 0);
    const awardedGrants = this.grants.filter((g) => g.status === 'awarded');
    const totalAwarded = awardedGrants.reduce((sum, g) => sum + (g.amount || 0), 0);
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
    const cashBoxDepositsTotal = this.incomeDeposits
      .filter((d) => d.depositAccount === 'cash_box')
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

    const pendingRequests = this.accessRequests.filter((r) => r.status === 'pending');

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
      cashBoxDepositsTotal,
      hcbBalanceDollars,
      hcbTotalRaisedDollars,
      staleSponsorsCount: staleSponsors.length,
      pendingRequestsCount: pendingRequests.length
    };
  }

  // ── Reset & Seed ─────────────────────────────────────────────────────

  /**
   * Load the Team 2064 starter dataset.
   *
   * In remote mode this is how a fresh Convex deployment gets bootstrapped: the
   * records are shipped up and written server-side, replacing anything already
   * there. Locally it just refills the store and localStorage.
   */
  async resetToSeedData() {
    if (this.isRemote) {
      const client = getConvexClient();
      if (!client) return;
      try {
        await client.mutation(api.seed.importAll, {
          grants: SEED_GRANTS,
          sponsors: SEED_SPONSORS,
          contacts: SEED_CONTACTS,
          users: SEED_USERS,
          accessRequests: SEED_ACCESS_REQUESTS,
          expenses: SEED_EXPENSES,
          incomeDeposits: SEED_INCOME_DEPOSITS,
          replace: true,
          ...this.actor
        });
        this.showToast('Loaded Team 2064 starter data into Convex!');
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('Seed import failed:', e);
        this.showToast(`Seed import failed: ${message}`, 'error');
      }
      return;
    }

    this.grants = SEED_GRANTS;
    this.sponsors = SEED_SPONSORS;
    this.contacts = SEED_CONTACTS;
    this.users = SEED_USERS;
    this.accessRequests = SEED_ACCESS_REQUESTS;
    this.auditLogs = SEED_AUDIT_LOGS;
    this.expenses = SEED_EXPENSES;
    this.incomeDeposits = SEED_INCOME_DEPOSITS;
    this.currentUser = SEED_USERS[0];
    this.persistAll();
    this.addAudit('import_seed', 'system', 'seed', 'Team 2064 Seed', 'Restored application data to Team 2064 default database seed');
    this.showToast('Database reset to Team 2064 Seed Data!');
  }
}

export const cacao = new CacaoStore();
