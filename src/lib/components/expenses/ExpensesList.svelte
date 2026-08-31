<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { Expense, PaymentMethod, Tone } from '$lib/types';
  import { buildLedger, nonSpendExpenseEntry, type LedgerEntry } from '$lib/finance/ledger';
  import { EXPENSE_FORM_CATEGORIES, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import CategorizeTransactionModal from '$lib/components/finance/CategorizeTransactionModal.svelte';
  import DateRangeFilter from '$lib/components/finance/DateRangeFilter.svelte';
  import FilterPopover from '$lib/components/finance/FilterPopover.svelte';
  import {
    dateRangeFor,
    formatDay,
    todayISO,
    withinDateRange,
    type DateRangePreset
  } from '$lib/finance/dates';
  import ExpenseModal from './ExpenseModal.svelte';
  import AddExpenseModal from './AddExpenseModal.svelte';
  import MarkPurchasedModal from './MarkPurchasedModal.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import {
    Plus,
    Download,
    ExternalLink,
    Receipt,
    ShoppingCart,
    Truck,
    PackageCheck,
    CreditCard,
    User,
    School,
    Ticket,
    Banknote,
    HandCoins,
    Landmark,
    RefreshCw,
    Tag,
    CircleAlert
  } from 'lucide-svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem, listRow } from '$lib/motion';

  let selectedExpenseForEdit = $state<Expense | null>(null);
  let selectedExpenseForPurchase = $state<Expense | null>(null);
  let isAddExpenseModalOpen = $state(false);
  let entryToCategorize = $state<LedgerEntry | null>(null);

  let statusFilter = $state<string>('all');
  let categoryFilter = $state<string>('all');
  let sourceFilter = $state<'all' | 'logged' | 'hcb'>('all');
  let datePreset = $state<DateRangePreset>('all');
  let customStart = $state('');
  let customEnd = $state('');

  const dateRange = $derived(dateRangeFor(datePreset, { start: customStart, end: customEnd }, todayISO()));

  /**
   * How many of the collapsed filters are narrowing the list. Shown on the
   * trigger so a hidden filter can never silently remove rows.
   */
  const secondaryFilterCount = $derived(
    (categoryFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0) + (datePreset !== 'all' ? 1 : 0)
  );

  function clearSecondaryFilters() {
    categoryFilter = 'all';
    sourceFilter = 'all';
    datePreset = 'all';
    customStart = '';
    customEnd = '';
  }

  const isViewer = $derived(cacao.currentUser.role === 'viewer');

  // The Expenses tab has never filtered by season -- every logged record and
  // bank charge stays visible here regardless of the dashboard's selected
  // season. Season scoping is a Finances-dashboard concept, not a list-tab one.
  const ledger = $derived(
    buildLedger({
      expenses: cacao.expenses,
      deposits: [],
      hcbTransactions: cacao.hcbTransactions,
      season: 'all',
      hcbCategoryOverrides: cacao.hcbCategoryOverrides
    })
  );

  // buildLedger excludes rejected/pending requests from spend entirely (they
  // never left an account, so they must not count toward a total or absorb a
  // bank match) -- but this tab is a record of every request ever filed, so
  // they are added back here as plain read-only rows that were never in the
  // running to match anything.
  const nonSpendEntries = $derived(
    cacao.expenses
      .filter((e) => e.status === 'rejected' || e.status === 'pending_approval')
      .map(nonSpendExpenseEntry)
  );

  const outEntries = $derived(
    [...ledger.entries.filter((e) => e.direction === 'out'), ...nonSpendEntries].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    )
  );

  const rows = $derived.by(() => {
    let list = outEntries;
    if (sourceFilter !== 'all') list = list.filter((e) => e.source === sourceFilter);
    if (statusFilter !== 'all') {
      // Bank-sourced rows have no status at all, so a status filter can only
      // ever match a logged row -- this naturally drops bank rows instead of
      // crashing on a missing `.status`.
      list = list.filter((e) => e.source === 'logged' && e.expense?.status === statusFilter);
    }
    if (categoryFilter !== 'all') list = list.filter((e) => e.category === categoryFilter);
    if (dateRange) list = list.filter((e) => withinDateRange(e.date, dateRange));
    return list;
  });

  // The date shown, filtered, and exported is the ledger's, not the raw
  // record's: it already resolves a set date against the purchase/created
  // fallback, so the column, the filter, and the CSV can never disagree about
  // which day a row is on. Built from every row rather than the filtered set,
  // so an export can never hit a missing date because the filters were narrower.
  const rowDates = $derived(new Map(outEntries.map((r) => [r.id, r.date])));

  // Export stays scoped to logged records: the CSV's columns (vendor, PO
  // number, requester, etc.) describe data this app owns, not a bank feed.
  const exportRows = $derived.by(() => {
    if (sourceFilter === 'hcb') return [];
    let list = [...cacao.expenses];
    if (statusFilter !== 'all') list = list.filter((e) => e.status === statusFilter);
    if (categoryFilter !== 'all') list = list.filter((e) => e.category === categoryFilter);
    if (dateRange) {
      const kept = new Set(rows.map((r) => r.expense?._id).filter(Boolean));
      list = list.filter((e) => kept.has(e._id));
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  });

  /**
   * Bank rows the memo rules could not classify. `EXPENSE_FORM_CATEGORIES` is
   * the list a human can pick from when logging an expense, so it has no
   * `uncategorized` entry -- which left these rows with no chip anywhere and
   * no way to filter to them.
   */
  const uncategorizedCount = $derived(
    outEntries.filter((e) => e.category === 'uncategorized').length
  );

  const expenseCategories = EXPENSE_FORM_CATEGORIES.map((id) => ({
    id,
    label: EXPENSE_CATEGORY_META[id].label
  }));

  const statusFilters = [
    { id: 'all', label: 'All' },
    { id: 'pending_approval', label: 'Pending review' },
    { id: 'approved', label: 'Approved' },
    { id: 'purchased', label: 'Purchased' },
    { id: 'reimbursed', label: 'Reimbursed' },
    { id: 'donated', label: 'Donated' }
  ];

  // Narrowed to exactly what this reads. A ledger entry's `expense` is a
  // `LedgerExpense` -- a structural subset of `Expense` -- so a call site
  // holding one of those needs no cast to call this.
  function statusMeta(exp: Pick<Expense, 'status' | 'paymentMethod'>): { label: string; tone: Tone } {
    switch (exp.status) {
      case 'pending_approval':
        return { label: 'Pending review', tone: 'tertiary' };
      case 'approved':
        return exp.paymentMethod === 'personal_reimbursement'
          ? { label: 'Approved (to repay)', tone: 'primary' }
          : { label: 'Approved to buy', tone: 'primary' };
      case 'purchased':
        return { label: 'Purchased', tone: 'secondary' };
      case 'reimbursed':
        return { label: 'Reimbursed', tone: 'success' };
      case 'donated':
        return { label: 'Donated', tone: 'success' };
      case 'rejected':
        return { label: 'Rejected', tone: 'error' };
    }
  }

  function paymentMeta(method?: PaymentMethod) {
    switch (method) {
      case 'hcb_card':
        return { label: 'HCB card', icon: CreditCard };
      case 'personal_reimbursement':
        return { label: 'Out of pocket', icon: User };
      case 'school_po':
        return { label: 'School PO', icon: School };
      case 'grant_voucher':
        return { label: 'Voucher', icon: Ticket };
      case 'cash':
        return { label: 'Cash', icon: Banknote };
      default:
        return null;
    }
  }

  function getTrackingUrl(carrier?: string, trackingNumber?: string): string | null {
    if (!trackingNumber) return null;
    const n = trackingNumber.trim();
    if (carrier === 'UPS') return `https://www.ups.com/track?tracknum=${n}`;
    if (carrier === 'FedEx') return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    if (carrier === 'USPS') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    if (carrier === 'DHL') return `https://www.dhl.com/en/express/tracking.html?AWB=${n}`;
    if (carrier === 'Amazon')
      return `https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?itemId=${n}`;
    return null;
  }

  /**
   * The title of the grant an expense was funded by.
   *
   * Resolved here rather than read off the row: `expenses.linkedGrantTitle`
   * was a denormalised copy and is gone, because a stored title goes stale the
   * moment the grant is renamed. An id that names no grant we hold reads as
   * blank -- the grant may simply be one this caller cannot see.
   */
  function grantTitleFor(linkedGrantId?: string): string {
    if (!linkedGrantId) return '';
    return (cacao.grants.find((g) => g._id === linkedGrantId)?.title ?? '').replace(/"/g, '""');
  }

  function downloadCSV(headers: string[], rows: (string | number)[][], filename: string) {
    const csv =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportExpensesCSV() {
    downloadCSV(
      [
        'Date',
        'Description',
        'Vendor',
        'Requested Amount ($)',
        'Final Amount Paid ($)',
        'Payment Method',
        'Purchaser / Cardholder',
        'Order Number',
        'Carrier',
        'Tracking Number',
        'Delivery Status',
        'Category',
        'Requester',
        'Status',
        'Season',
        'Linked Grant',
        'Receipt Link'
      ],
      exportRows.map((e) => [
        rowDates.get(e._id) ?? '',
        `"${e.title.replace(/"/g, '""')}"`,
        `"${e.vendor.replace(/"/g, '""')}"`,
        e.amount,
        e.finalPaidAmount ?? e.amount,
        e.paymentMethod || '',
        `"${e.purchaserName || ''}"`,
        `"${e.orderNumber || ''}"`,
        e.carrier || '',
        `"${e.trackingNumber || ''}"`,
        e.deliveryStatus || '',
        e.category,
        `"${e.requesterName ?? ''}"`,
        e.status,
        e.season,
        `"${grantTitleFor(e.linkedGrantId)}"`,
        `"${e.receiptUrl || ''}"`
      ]),
      `2064_Expenses_${cacao.selectedSeason}.csv`
    );
    cacao.showToast('Expenses exported to CSV');
  }
</script>

<PageHeader title="Expenses">
  {#snippet actions()}
    <button
      type="button"
      class="btn btn-outlined"
      disabled={cacao.isHcbSyncing}
      onclick={() => cacao.syncHackClubBank(true)}
    >
      <RefreshCw size={18} class={cacao.isHcbSyncing ? 'animate-spin' : ''} />
      <span>Sync bank</span>
    </button>
    <button type="button" class="btn btn-outlined" onclick={exportExpensesCSV}>
      <Download size={18} />
      <span>Export CSV</span>
    </button>
    <button
      type="button"
      class="btn btn-filled"
      disabled={isViewer}
      title={isViewer ? 'Viewer mode: editing is disabled' : undefined}
      onclick={() => (isAddExpenseModalOpen = true)}
    >
      <Plus size={18} />
      <span>New request</span>
    </button>
  {/snippet}
</PageHeader>

<div class="space-y-5">
  <!-- Status is the filter people actually reach for, so it stays a visible
       row. Category, source and date used to sit beside it as two more rows of
       chips, which put seventeen of them above the table. -->
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      {#each statusFilters as st}
        {@const count =
          st.id === 'all'
            ? cacao.expenses.length
            : cacao.expenses.filter((e) => e.status === st.id).length}
        <button
          type="button"
          aria-pressed={statusFilter === st.id}
          onclick={() => (statusFilter = st.id)}
          class="filter-chip"
        >
          {st.label}
          <span class="type-num opacity-70">{count}</span>
        </button>
      {/each}

      <!-- Work still to do, so it sits with the primary filters rather than
           inside the popover, and disappears once there is none. -->
      {#if uncategorizedCount > 0}
        <button
          type="button"
          aria-pressed={categoryFilter === 'uncategorized'}
          onclick={() =>
            (categoryFilter = categoryFilter === 'uncategorized' ? 'all' : 'uncategorized')}
          class="filter-chip"
          style="color: var(--color-tertiary)"
          title="Bank charges with no category yet"
        >
          <CircleAlert size={14} />
          <span>Needs category</span>
          <span class="type-num opacity-70">{uncategorizedCount}</span>
        </button>
      {/if}
    </div>

    <FilterPopover activeCount={secondaryFilterCount} onclear={clearSecondaryFilters}>
      <div>
        <p class="type-label-sm mb-1.5" style="color: var(--color-on-surface-variant)">Category</p>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={categoryFilter === 'all'}
            onclick={() => (categoryFilter = 'all')}
            class="filter-chip"
          >
            All
          </button>
          {#each expenseCategories as cat}
            {@const count = outEntries.filter((e) => e.category === cat.id).length}
            {#if count > 0}
              <button
                type="button"
                aria-pressed={categoryFilter === cat.id}
                onclick={() => (categoryFilter = cat.id)}
                class="filter-chip"
              >
                {cat.label}
                <span class="type-num opacity-70">{count}</span>
              </button>
            {/if}
          {/each}
        </div>
      </div>

      <div>
        <p class="type-label-sm mb-1.5" style="color: var(--color-on-surface-variant)">Source</p>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={sourceFilter === 'all'}
            onclick={() => (sourceFilter = 'all')}
            class="filter-chip"
          >
            All
          </button>
          <button
            type="button"
            aria-pressed={sourceFilter === 'logged'}
            onclick={() => (sourceFilter = 'logged')}
            class="filter-chip"
          >
            Logged
            <span class="type-num opacity-70">
              {outEntries.filter((e) => e.source === 'logged').length}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={sourceFilter === 'hcb'}
            onclick={() => (sourceFilter = 'hcb')}
            class="filter-chip"
          >
            Bank only
            <span class="type-num opacity-70">
              {outEntries.filter((e) => e.source === 'hcb').length}
            </span>
          </button>
        </div>
      </div>

      <div>
        <p class="type-label-sm mb-1.5" style="color: var(--color-on-surface-variant)">Date</p>
        <DateRangeFilter
          bind:preset={datePreset}
          bind:customStart
          bind:customEnd
          matchCount={rows.length}
          ariaLabel="Filter expenses by date"
        />
      </div>
    </FilterPopover>
  </div>

  <!-- Narrow screens: a seven-column table forced horizontal scrolling with no
       affordance saying the remaining columns existed, so it becomes a card
       list — the same treatment the grants tab already uses. -->
  <div class="space-y-3 md:hidden">
    {#each rows as row (row.id)}
      {@const exp =
        row.source === 'logged'
          ? cacao.expenses.find((e) => e._id === row.expense?._id)
          : undefined}
      {@const meta = exp ? statusMeta(exp) : null}
      {@const pay = exp ? paymentMeta(exp.paymentMethod) : null}
      {@const trackingUrl = exp ? getTrackingUrl(exp.carrier, exp.trackingNumber) : null}
      {@const displayAmount = exp ? (exp.finalPaidAmount ?? exp.amount) : row.amount}
      {@const hasDiscount = exp ? exp.finalPaidAmount != null && exp.finalPaidAmount < exp.amount : false}
      {@const interactive = row.source === 'logged' && !isViewer && exp !== undefined}
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex -->
      <div
        class={`card-elevated p-4 ${interactive ? 'card-interactive' : ''}`}
        animate:flip={listItem.flip}
        in:fly={listItem.in}
        out:scale={listItem.out}
        role={interactive ? 'button' : undefined}
        tabindex={interactive ? 0 : undefined}
        onclick={() => {
          if (interactive && exp) selectedExpenseForEdit = exp;
        }}
        onkeydown={(e) => {
          if (interactive && exp && (e.key === 'Enter' || e.key === ' ')) selectedExpenseForEdit = exp;
        }}
      >
        <div class="mb-1 flex items-start justify-between gap-2">
          <span class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
            {#if exp}
              {exp.vendor}{exp.orderNumber ? ` · ${exp.orderNumber}` : ''}
            {:else}
              Hack Club Bank
            {/if}
          </span>
          {#if row.source === 'hcb'}
            <span class="chip chip-sm shrink-0" title="On the bank feed, never logged here">
              <Landmark size={11} />
              Bank only
            </span>
          {:else if meta}
            <span class="chip chip-sm shrink-0">{meta.label}</span>
          {/if}
        </div>

        <h3 class="type-title mb-1 line-clamp-2">{row.title}</h3>

        <p class={`type-title-lg type-num ${hasDiscount ? 'mb-0.5' : 'mb-3'}`}>
          ${displayAmount.toFixed(2)}
        </p>
        {#if hasDiscount && exp}
          <p class="type-label-sm mb-3">
            <span class="type-num line-through opacity-60">${exp.amount.toFixed(2)}</span>
            <span class="type-num ml-1.5" style="color: var(--color-success)">
              Saved ${(exp.amount - displayAmount).toFixed(2)}
            </span>
          </p>
        {/if}

        <dl class="type-label-sm grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div class="col-span-2 flex items-center justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">Date</dt>
            <dd class="type-num">{formatDay(row.date)}</dd>
          </div>

          <div class="col-span-2 flex items-center justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">Payment</dt>
            <dd class="flex min-w-0 items-center gap-1.5">
              {#if row.source === 'hcb'}
                <span class="chip chip-sm">
                  <Landmark size={13} />
                  Bank charge
                </span>
              {:else if pay}
                <span class="chip chip-sm">
                  <pay.icon size={13} />
                  {pay.label}
                </span>
                {#if exp?.purchaserName}
                  <span class="truncate" style="color: var(--color-on-surface-variant)">
                    by {exp.purchaserName.split(' ')[0]}
                  </span>
                {/if}
              {:else}
                <span style="color: var(--color-on-surface-variant)">—</span>
              {/if}
              {#if row.hcbTransactionId}
                <span
                  class="chip chip-sm chip-success"
                  title="Logged here and confirmed against the bank"
                >
                  Cleared
                </span>
              {/if}
            </dd>
          </div>

          <div class="flex justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">Category</dt>
            <dd class="truncate">
              {EXPENSE_CATEGORY_META[row.category as keyof typeof EXPENSE_CATEGORY_META]?.label ??
                row.category}
            </dd>
          </div>

          {#if exp?.status === 'purchased'}
            <div class="col-span-2 flex items-center justify-between gap-2">
              <dt style="color: var(--color-on-surface-variant)">Delivery</dt>
              <dd class="flex items-center gap-1.5">
                {#if exp.deliveryStatus === 'delivered'}
                  <span class="inline-flex items-center gap-1" style="color: var(--color-success)">
                    <PackageCheck size={13} /> In shop
                  </span>
                {:else if exp.deliveryStatus === 'shipped'}
                  <span class="inline-flex items-center gap-1">
                    <Truck size={13} /> In transit
                  </span>
                {:else}
                  <span style="color: var(--color-on-surface-variant)">Processing</span>
                {/if}

                {#if trackingUrl}
                  <a
                    href={trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onclick={(e) => e.stopPropagation()}
                    class="underline"
                    style="color: var(--color-primary)"
                    title={`Track via ${exp.carrier || 'carrier'}`}
                  >
                    Track
                  </a>
                {/if}
              </dd>
            </div>
          {/if}
        </dl>

        {#if exp}
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
          <div
            class="mt-3 flex flex-wrap items-center justify-end gap-1"
            onclick={(e) => e.stopPropagation()}
          >
            {#if exp.status === 'pending_approval' && cacao.currentUser.role === 'admin'}
              <button
                type="button"
                class="btn btn-filled btn-sm"
                onclick={() => cacao.approveExpense(exp._id)}
              >
                Approve
              </button>
            {/if}

            {#if exp.status === 'approved'}
              {#if exp.paymentMethod === 'personal_reimbursement' && cacao.currentUser.role === 'admin'}
                <button
                  type="button"
                  class="btn btn-tonal btn-sm"
                  onclick={() => cacao.reimburseExpense(exp._id)}
                  title="Mark student/mentor as reimbursed and paid back"
                >
                  <HandCoins size={16} />
                  <span>Pay back</span>
                </button>
              {:else if exp.paymentMethod !== 'personal_reimbursement'}
                <button
                  type="button"
                  class="btn btn-tonal btn-sm"
                  onclick={() => (selectedExpenseForPurchase = exp)}
                >
                  <ShoppingCart size={16} />
                  <span>Mark bought</span>
                </button>
              {/if}
            {/if}

            {#if exp.status === 'purchased' && exp.deliveryStatus !== 'delivered'}
              <button
                type="button"
                class="btn btn-outlined btn-sm"
                onclick={() => cacao.markExpenseDelivered(exp._id)}
                title="Mark as received in the pit/shop"
              >
                <PackageCheck size={16} />
                <span>Arrived</span>
              </button>
            {/if}

            {#if exp.receiptUrl}
              <a
                href={exp.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-text btn-sm"
              >
                <Receipt size={16} />
                <span>Receipt</span>
              </a>
            {/if}

            {#if exp.itemLink}
              <a
                href={exp.itemLink}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-text btn-sm"
              >
                <ExternalLink size={16} />
                <span>Product</span>
              </a>
            {/if}
          </div>
        {:else if !isViewer}
          <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
          <div
            class="mt-3 flex items-center justify-end gap-1"
            onclick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              class={`btn btn-sm ${row.category === 'uncategorized' ? 'btn-filled' : 'btn-outlined'}`}
              onclick={() => (entryToCategorize = row)}
              title="File this bank charge under a category"
            >
              <Tag size={14} />
              <span>{row.category === 'uncategorized' ? 'Categorize' : 'Change category'}</span>
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if rows.length === 0}
      <p class="type-body py-12 text-center" style="color: var(--color-on-surface-variant)">
        No expense requests match this filter.
      </p>
    {/if}
  </div>

  <div class="card-elevated hidden overflow-hidden md:block">
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Item & supplier</th>
            <th>Paid / estimate</th>
            <th>Category</th>
            <th>Status</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const exp =
              row.source === 'logged'
                ? cacao.expenses.find((e) => e._id === row.expense?._id)
                : undefined}
            {@const meta = exp ? statusMeta(exp) : null}
            {@const pay = exp ? paymentMeta(exp.paymentMethod) : null}
            {@const trackingUrl = exp ? getTrackingUrl(exp.carrier, exp.trackingNumber) : null}
            {@const displayAmount = exp ? (exp.finalPaidAmount ?? exp.amount) : row.amount}
            {@const hasDiscount = exp ? exp.finalPaidAmount != null && exp.finalPaidAmount < exp.amount : false}

            <tr
              class={row.source === 'hcb' || isViewer ? '' : 'row-interactive'}
              animate:flip={listRow.flip}
              in:fade={listRow.in}
              out:fade={listRow.out}
              onclick={() => {
                if (row.source === 'logged' && !isViewer && exp) selectedExpenseForEdit = exp;
              }}
            >
              <td class="type-num whitespace-nowrap" style="color: var(--color-on-surface-variant)">
                {formatDay(row.date)}
              </td>

              <!-- Supplier, order number and how it was paid all describe the
                   same purchase, so they share the item cell as a subtitle
                   rather than each claiming a column. Eight columns forced
                   horizontal scrolling with no sign the rest were there. -->
              <td class="max-w-sm">
                <p class="type-label truncate">{row.title}</p>
                <p class="type-label-sm mt-0.5 flex items-center gap-1.5 truncate" style="color: var(--color-on-surface-variant)">
                  {#if exp}
                    {#if pay}
                      <span class="flex shrink-0" title={`Paid by ${pay.label}`}>
                        <pay.icon size={13} />
                      </span>
                    {/if}
                    <span class="truncate">
                      {exp.vendor}{exp.orderNumber ? ` · ${exp.orderNumber}` : ''}{exp.purchaserName
                        ? ` · ${exp.purchaserName.split(' ')[0]}`
                        : ''}
                    </span>
                  {:else}
                    <span class="flex shrink-0" title="Bank charge">
                      <Landmark size={13} />
                    </span>
                    <span class="truncate">Hack Club Bank</span>
                  {/if}
                </p>
              </td>

              <td>
                <span class="type-label type-num">${displayAmount.toFixed(2)}</span>
                {#if hasDiscount && exp}
                  <span class="type-label-sm type-num ml-1.5 line-through opacity-60">
                    ${exp.amount.toFixed(2)}
                  </span>
                  <span
                    class="type-label-sm type-num block"
                    style="color: var(--color-success)"
                  >
                    Saved ${(exp.amount - displayAmount).toFixed(2)}
                  </span>
                {/if}
              </td>

              <td style="color: var(--color-on-surface-variant)">
                {EXPENSE_CATEGORY_META[row.category as keyof typeof EXPENSE_CATEGORY_META]?.label ??
                  row.category}
              </td>

              <td>
                {#if row.source === 'hcb'}
                  <span class="chip chip-sm" title="On the bank feed, never logged here">
                    <Landmark size={11} />
                    Bank only
                  </span>
                {:else if meta}
                  <span class="chip chip-sm">{meta.label}</span>
                  {#if row.hcbTransactionId}
                    <span
                      class="chip chip-sm chip-success ml-1"
                      title="Logged here and confirmed against the bank"
                    >
                      Cleared
                    </span>
                  {/if}

                  {#if exp?.status === 'purchased'}
                    <span class="type-label-sm mt-1 flex items-center gap-1.5">
                      {#if exp.deliveryStatus === 'delivered'}
                        <span
                          class="inline-flex items-center gap-1"
                          style="color: var(--color-success)"
                        >
                          <PackageCheck size={13} /> In shop
                        </span>
                      {:else if exp.deliveryStatus === 'shipped'}
                        <span class="inline-flex items-center gap-1">
                          <Truck size={13} /> In transit
                        </span>
                      {:else}
                        <span style="color: var(--color-on-surface-variant)">Processing</span>
                      {/if}

                      {#if trackingUrl}
                        <a
                          href={trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onclick={(e) => e.stopPropagation()}
                          class="underline"
                          style="color: var(--color-primary)"
                          title={`Track via ${exp.carrier || 'carrier'}`}
                        >
                          Track
                        </a>
                      {/if}
                    </span>
                  {/if}
                {/if}
              </td>

              <td>
                {#if exp}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="flex items-center justify-end gap-1"
                    onclick={(e) => e.stopPropagation()}
                  >
                    {#if exp.status === 'pending_approval' && cacao.currentUser.role === 'admin'}
                      <button
                        type="button"
                        class="btn btn-filled btn-sm"
                        onclick={() => cacao.approveExpense(exp._id)}
                      >
                        Approve
                      </button>
                    {/if}

                    {#if exp.status === 'approved'}
                      {#if exp.paymentMethod === 'personal_reimbursement' && cacao.currentUser.role === 'admin'}
                        <button
                          type="button"
                          class="btn btn-tonal btn-sm"
                          onclick={() => cacao.reimburseExpense(exp._id)}
                          title="Mark student/mentor as reimbursed and paid back"
                        >
                          <HandCoins size={16} />
                          <span>Pay back</span>
                        </button>
                      {:else if exp.paymentMethod !== 'personal_reimbursement'}
                        <button
                          type="button"
                          class="btn btn-tonal btn-sm"
                          onclick={() => (selectedExpenseForPurchase = exp)}
                        >
                          <ShoppingCart size={16} />
                          <span>Mark bought</span>
                        </button>
                      {/if}
                    {/if}

                    {#if exp.status === 'purchased' && exp.deliveryStatus !== 'delivered'}
                      <button
                        type="button"
                        class="btn btn-outlined btn-sm"
                        onclick={() => cacao.markExpenseDelivered(exp._id)}
                        title="Mark as received in the pit/shop"
                      >
                        <PackageCheck size={16} />
                        <span>Arrived</span>
                      </button>
                    {/if}

                    {#if exp.receiptUrl}
                      <a
                        href={exp.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="icon-btn icon-btn-sm"
                        title="View receipt"
                      >
                        <Receipt size={16} />
                      </a>
                    {/if}

                    {#if exp.itemLink}
                      <a
                        href={exp.itemLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="icon-btn icon-btn-sm"
                        title="Product page"
                      >
                        <ExternalLink size={16} />
                      </a>
                    {/if}
                  </div>
                {:else if !isViewer}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="flex items-center justify-end gap-1"
                    onclick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      class={`btn btn-sm ${row.category === 'uncategorized' ? 'btn-filled' : 'btn-text'}`}
                      onclick={() => (entryToCategorize = row)}
                      title="File this bank charge under a category"
                    >
                      <Tag size={14} />
                      <span>{row.category === 'uncategorized' ? 'Categorize' : 'Change'}</span>
                    </button>
                  </div>
                {:else}
                  <span style="color: var(--color-on-surface-variant)">—</span>
                {/if}
              </td>
            </tr>
          {/each}

          {#if rows.length === 0}
            <tr>
              <td colspan="6" class="py-12 text-center" style="color: var(--color-on-surface-variant)">
                No expense requests match this filter.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>

{#if selectedExpenseForEdit}
  <ExpenseModal
    expense={selectedExpenseForEdit}
    open={true}
    onclose={() => (selectedExpenseForEdit = null)}
  />
{/if}

<AddExpenseModal
  open={isAddExpenseModalOpen}
  onclose={() => (isAddExpenseModalOpen = false)}
/>

{#if selectedExpenseForPurchase}
  <MarkPurchasedModal
    expense={selectedExpenseForPurchase}
    open={true}
    onclose={() => (selectedExpenseForPurchase = null)}
  />
{/if}

<CategorizeTransactionModal
  entry={entryToCategorize}
  open={entryToCategorize !== null}
  onclose={() => (entryToCategorize = null)}
/>
