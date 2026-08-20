<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type {
    Expense,
    ExpenseCategory,
    ExpenseStatus,
    PaymentMethod,
    IncomeDeposit,
    IncomeCategory,
    DepositAccount,
    Tone
  } from '$lib/types';
  import { TONE_CHIP } from '$lib/types';
  import ExpenseModal from './ExpenseModal.svelte';
  import MarkPurchasedModal from './MarkPurchasedModal.svelte';
  import LogDepositModal from './LogDepositModal.svelte';
  import HCBTreasuryCard from './HCBTreasuryCard.svelte';
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
    Landmark,
    User,
    School,
    Ticket,
    Banknote,
    Package,
    Trash2
  } from 'lucide-svelte';
  import { fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listRow } from '$lib/motion';

  let activeSubTab = $state<'expenses' | 'deposits'>('expenses');

  let selectedExpenseForEdit = $state<Expense | null>(null);
  let selectedExpenseForPurchase = $state<Expense | null>(null);
  let selectedDepositForEdit = $state<IncomeDeposit | null>(null);
  let isAddExpenseModalOpen = $state(false);
  let isAddDepositModalOpen = $state(false);

  let statusFilter = $state<string>('all');
  let categoryFilter = $state<string>('all');
  let depositCategoryFilter = $state<string>('all');

  const filteredExpenses = $derived.by(() => {
    let list = [...cacao.expenses];

    if (statusFilter !== 'all') list = list.filter((e) => e.status === statusFilter);
    if (categoryFilter !== 'all') list = list.filter((e) => e.category === categoryFilter);

    if (cacao.searchQuery.trim()) {
      const q = cacao.searchQuery.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.vendor.toLowerCase().includes(q) ||
          e.requesterName.toLowerCase().includes(q) ||
          e.purchaserName?.toLowerCase().includes(q) ||
          e.orderNumber?.toLowerCase().includes(q) ||
          e.trackingNumber?.toLowerCase().includes(q) ||
          e.notes?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => b.createdAt - a.createdAt);
  });

  const filteredDeposits = $derived.by(() => {
    let list = [...cacao.incomeDeposits];

    if (depositCategoryFilter !== 'all') {
      list = list.filter((d) => d.category === depositCategoryFilter);
    }

    if (cacao.searchQuery.trim()) {
      const q = cacao.searchQuery.toLowerCase();
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.loggedByName.toLowerCase().includes(q) ||
          d.depositAccount.toLowerCase().includes(q) ||
          d.notes?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  const expenseCategories: ExpenseCategory[] = [
    'robot_parts',
    'electronics',
    'tools',
    'travel',
    'registration',
    'food',
    'media',
    'general'
  ];

  const depositCategories: IncomeCategory[] = [
    'fundraiser',
    'bottle_can_drive',
    'merch_sales',
    'camp_registration',
    'donation',
    'sponsorship_check',
    'other_income'
  ];

  const statusFilters = [
    { id: 'all', label: 'All' },
    { id: 'pending_approval', label: 'Pending review' },
    { id: 'approved', label: 'Approved' },
    { id: 'purchased', label: 'Purchased' },
    { id: 'reimbursed', label: 'Reimbursed' }
  ];

  function statusMeta(status: ExpenseStatus): { label: string; tone: Tone } {
    switch (status) {
      case 'pending_approval':
        return { label: 'Pending review', tone: 'tertiary' };
      case 'approved':
        return { label: 'Approved to buy', tone: 'primary' };
      case 'purchased':
        return { label: 'Purchased', tone: 'secondary' };
      case 'reimbursed':
        return { label: 'Reimbursed', tone: 'success' };
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

  function accountMeta(account: DepositAccount) {
    switch (account) {
      case 'hcb_bank':
        return { label: 'Hack Club Bank', icon: Landmark };
      case 'school_account':
        return { label: 'Region 15 account', icon: School };
      case 'cash_box':
        return { label: 'Pit cash box', icon: Package };
    }
  }

  function titleCase(value: string) {
    return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
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
      filteredExpenses.map((e) => [
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
        `"${e.requesterName}"`,
        e.status,
        e.season,
        `"${e.linkedGrantTitle || ''}"`,
        `"${e.receiptUrl || ''}"`
      ]),
      `2064_Expenses_${cacao.selectedSeason}.csv`
    );
    cacao.showToast('Expenses exported to CSV');
  }

  function exportDepositsCSV() {
    downloadCSV(
      ['Event / Source', 'Amount ($)', 'Category', 'Account', 'Date', 'Logged By', 'Notes', 'Receipt Link'],
      filteredDeposits.map((d) => [
        `"${d.title.replace(/"/g, '""')}"`,
        d.amount,
        d.category,
        d.depositAccount,
        d.date,
        `"${d.loggedByName}"`,
        `"${d.notes || ''}"`,
        `"${d.receiptUrl || ''}"`
      ]),
      `2064_Fundraiser_Deposits_${cacao.selectedSeason}.csv`
    );
    cacao.showToast('Deposits exported to CSV');
  }
</script>

<PageHeader
  title="Money In & Out"
  stat={`$${cacao.metrics.approvedExpenses.toLocaleString()} approved spend · $${cacao.metrics.totalFundraiserIncome.toLocaleString()} raised`}
>
  {#snippet actions()}
    {#if activeSubTab === 'expenses'}
      <button type="button" class="btn btn-outlined" onclick={exportExpensesCSV}>
        <Download size={18} />
        <span>Export CSV</span>
      </button>
      <button type="button" class="btn btn-filled" onclick={() => (isAddExpenseModalOpen = true)}>
        <Plus size={18} />
        <span>New request</span>
      </button>
    {:else}
      <button type="button" class="btn btn-outlined" onclick={exportDepositsCSV}>
        <Download size={18} />
        <span>Export CSV</span>
      </button>
      <button type="button" class="btn btn-filled" onclick={() => (isAddDepositModalOpen = true)}>
        <Plus size={18} />
        <span>Log deposit</span>
      </button>
    {/if}
  {/snippet}
</PageHeader>

<div class="space-y-5">
  <HCBTreasuryCard />

  <div class="segmented max-w-full overflow-x-auto">
    <button
      type="button"
      aria-pressed={activeSubTab === 'expenses'}
      onclick={() => (activeSubTab = 'expenses')}
      class="segmented-item"
    >
      <ShoppingCart size={16} />
      <span>Purchase requests</span>
    </button>
    <button
      type="button"
      aria-pressed={activeSubTab === 'deposits'}
      onclick={() => (activeSubTab = 'deposits')}
      class="segmented-item"
    >
      <Landmark size={16} />
      <span>Fundraisers & deposits</span>
    </button>
  </div>

  {#if activeSubTab === 'expenses'}
    <div class="space-y-2">
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
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={categoryFilter === 'all'}
          onclick={() => (categoryFilter = 'all')}
          class="filter-chip"
        >
          All categories
        </button>
        {#each expenseCategories as cat}
          {@const count = cacao.expenses.filter((e) => e.category === cat).length}
          {#if count > 0}
            <button
              type="button"
              aria-pressed={categoryFilter === cat}
              onclick={() => (categoryFilter = cat)}
              class="filter-chip"
            >
              {titleCase(cat)}
              <span class="type-num opacity-70">{count}</span>
            </button>
          {/if}
        {/each}
      </div>
    </div>

    <div class="card-elevated overflow-hidden">
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Item & supplier</th>
              <th>Paid / estimate</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Requester</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredExpenses as exp (exp._id)}
              {@const meta = statusMeta(exp.status)}
              {@const pay = paymentMeta(exp.paymentMethod)}
              {@const trackingUrl = getTrackingUrl(exp.carrier, exp.trackingNumber)}
              {@const displayAmount = exp.finalPaidAmount ?? exp.amount}
              {@const hasDiscount = exp.finalPaidAmount != null && exp.finalPaidAmount < exp.amount}

              <tr
                class="row-interactive"
                animate:flip={listRow.flip}
                in:fade={listRow.in}
                out:fade={listRow.out}
                onclick={() => (selectedExpenseForEdit = exp)}
              >
                <td class="max-w-sm">
                  <p class="type-label truncate">{exp.title}</p>
                  <p class="type-label-sm mt-0.5 truncate" style="color: var(--color-on-surface-variant)">
                    {exp.vendor}{exp.orderNumber ? ` · ${exp.orderNumber}` : ''}
                  </p>
                </td>

                <td>
                  <span class="type-label type-num">${displayAmount.toFixed(2)}</span>
                  {#if hasDiscount}
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

                <td>
                  {#if pay}
                    <span class="chip chip-sm">
                      <pay.icon size={13} />
                      {pay.label}
                    </span>
                    {#if exp.purchaserName}
                      <span
                        class="type-label-sm mt-1 block truncate"
                        style="color: var(--color-on-surface-variant)"
                      >
                        by {exp.purchaserName.split(' ')[0]}
                      </span>
                    {/if}
                  {:else}
                    <span style="color: var(--color-on-surface-variant)">—</span>
                  {/if}
                </td>

                <td>
                  <span class={`chip chip-sm ${TONE_CHIP[meta.tone]}`}>{meta.label}</span>

                  {#if exp.status === 'purchased'}
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
                </td>

                <td style="color: var(--color-on-surface-variant)">
                  {exp.requesterName.split(' ')[0]}
                </td>

                <td>
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
                      <button
                        type="button"
                        class="btn btn-tonal btn-sm"
                        onclick={() => (selectedExpenseForPurchase = exp)}
                      >
                        <ShoppingCart size={16} />
                        <span>Mark bought</span>
                      </button>
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
                </td>
              </tr>
            {/each}

            {#if filteredExpenses.length === 0}
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
  {:else}
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={depositCategoryFilter === 'all'}
        onclick={() => (depositCategoryFilter = 'all')}
        class="filter-chip"
      >
        All sources
        <span class="type-num opacity-70">{cacao.incomeDeposits.length}</span>
      </button>
      {#each depositCategories as cat}
        {@const count = cacao.incomeDeposits.filter((d) => d.category === cat).length}
        {#if count > 0}
          <button
            type="button"
            aria-pressed={depositCategoryFilter === cat}
            onclick={() => (depositCategoryFilter = cat)}
            class="filter-chip"
          >
            {titleCase(cat)}
            <span class="type-num opacity-70">{count}</span>
          </button>
        {/if}
      {/each}
    </div>

    <div class="card-elevated overflow-hidden">
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fundraiser / source</th>
              <th>Deposited</th>
              <th>Account</th>
              <th>Category</th>
              <th>Date</th>
              <th>Logged by</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredDeposits as dep (dep._id)}
              {@const acct = accountMeta(dep.depositAccount)}
              <tr
                class="row-interactive"
                animate:flip={listRow.flip}
                in:fade={listRow.in}
                out:fade={listRow.out}
                onclick={() => (selectedDepositForEdit = dep)}
              >
                <td class="max-w-sm">
                  <p class="type-label truncate">{dep.title}</p>
                  {#if dep.notes}
                    <p
                      class="type-label-sm mt-0.5 truncate"
                      style="color: var(--color-on-surface-variant)"
                    >
                      {dep.notes}
                    </p>
                  {/if}
                </td>

                <td class="type-label type-num" style="color: var(--color-success)">
                  +${dep.amount.toFixed(2)}
                </td>

                <td>
                  <span class="chip chip-sm">
                    <acct.icon size={13} />
                    {acct.label}
                  </span>
                </td>

                <td style="color: var(--color-on-surface-variant)">{titleCase(dep.category)}</td>
                <td class="type-num" style="color: var(--color-on-surface-variant)">{dep.date}</td>
                <td style="color: var(--color-on-surface-variant)">
                  {dep.loggedByName.split(' ')[0]}
                </td>

                <td>
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="flex items-center justify-end gap-1"
                    onclick={(e) => e.stopPropagation()}
                  >
                    {#if dep.receiptUrl}
                      <a
                        href={dep.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="icon-btn icon-btn-sm"
                        title="Deposit slip"
                      >
                        <Receipt size={16} />
                      </a>
                    {/if}

                    {#if cacao.currentUser.role === 'admin'}
                      <button
                        type="button"
                        class="icon-btn icon-btn-sm"
                        title="Delete deposit"
                        onclick={() => {
                          if (confirm(`Delete deposit "${dep.title}"?`)) {
                            cacao.deleteIncomeDeposit(dep._id);
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}

            {#if filteredDeposits.length === 0}
              <tr>
                <td colspan="7" class="py-12 text-center" style="color: var(--color-on-surface-variant)">
                  No deposits logged for this category.
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

{#if selectedExpenseForEdit || isAddExpenseModalOpen}
  <ExpenseModal
    expense={selectedExpenseForEdit}
    open={true}
    onclose={() => {
      selectedExpenseForEdit = null;
      isAddExpenseModalOpen = false;
    }}
  />
{/if}

{#if selectedExpenseForPurchase}
  <MarkPurchasedModal
    expense={selectedExpenseForPurchase}
    open={true}
    onclose={() => (selectedExpenseForPurchase = null)}
  />
{/if}

{#if selectedDepositForEdit || isAddDepositModalOpen}
  <LogDepositModal
    deposit={selectedDepositForEdit}
    open={true}
    onclose={() => {
      selectedDepositForEdit = null;
      isAddDepositModalOpen = false;
    }}
  />
{/if}
