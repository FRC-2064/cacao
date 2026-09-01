<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { IncomeDeposit, DepositAccount } from '$lib/types';
  import { buildLedger, type LedgerEntry } from '$lib/finance/ledger';
  import {
    DEPOSIT_FORM_CATEGORIES,
    INCOME_CATEGORY_META,
    migrateAccount
  } from '$lib/finance/categories';
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
  import LogDepositModal from './LogDepositModal.svelte';
  import { PageHeader } from '@frc2064/ui';
  import {
    Plus,
    Download,
    Receipt,
    Landmark,
    School,
    Trash2,
    RefreshCw,
    Tag,
    CircleAlert
  } from 'lucide-svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem, listRow } from '@frc2064/ui/motion';

  let selectedDepositForEdit = $state<IncomeDeposit | null>(null);
  let isAddDepositModalOpen = $state(false);
  let entryToCategorize = $state<LedgerEntry | null>(null);
  let depositCategoryFilter = $state<string>('all');
  let sourceFilter = $state<'all' | 'logged' | 'hcb'>('all');
  let datePreset = $state<DateRangePreset>('all');
  let customStart = $state('');
  let customEnd = $state('');

  const dateRange = $derived(dateRangeFor(datePreset, { start: customStart, end: customEnd }, todayISO()));

  /** Collapsed filters that are narrowing the list, shown on the trigger. */
  const secondaryFilterCount = $derived(
    (sourceFilter !== 'all' ? 1 : 0) + (datePreset !== 'all' ? 1 : 0)
  );

  function clearSecondaryFilters() {
    sourceFilter = 'all';
    datePreset = 'all';
    customStart = '';
    customEnd = '';
  }

  const isViewer = $derived(cacao.currentUser.role === 'viewer');

  // The Deposits tab has never filtered by season -- every logged deposit and
  // bank credit stays visible here regardless of the dashboard's selected
  // season. Season scoping is a Finances-dashboard concept, not a list-tab one.
  const ledger = $derived(
    buildLedger({
      expenses: [],
      deposits: cacao.incomeDeposits,
      hcbTransactions: cacao.hcbTransactions,
      season: 'all',
      hcbCategoryOverrides: cacao.hcbCategoryOverrides
    })
  );

  const inEntries = $derived(ledger.entries.filter((e) => e.direction === 'in'));

  const rows = $derived.by(() => {
    let list = inEntries;
    if (sourceFilter !== 'all') list = list.filter((e) => e.source === sourceFilter);
    if (depositCategoryFilter !== 'all') list = list.filter((e) => e.category === depositCategoryFilter);
    if (dateRange) list = list.filter((e) => withinDateRange(e.date, dateRange));
    return list;
  });

  // The filter chips should reflect categories that actually appear in the
  // data, not only the three the form offers -- migrated `sponsorships`
  // deposits and classifier-assigned `uncategorized` rows can both exist.
  /** Bank credits the memo rules could not classify. */
  const uncategorizedCount = $derived(
    inEntries.filter((e) => e.category === 'uncategorized').length
  );

  const depositCategories = $derived.by(() => {
    const seen = new Set(inEntries.map((e) => e.category));
    const ordered = [...DEPOSIT_FORM_CATEGORIES, 'sponsorships', 'grants', 'uncategorized'] as const;
    return ordered.filter((c) => seen.has(c));
  });

  // Routed through migrateAccount so a deposit written against the retired
  // cash box still renders, as the school-account row it now is.
  function accountMeta(account: DepositAccount) {
    switch (migrateAccount(account)) {
      case 'hcb_bank':
        return { label: 'Hack Club Bank', icon: Landmark };
      case 'school_account':
        return { label: 'Region 15 account', icon: School };
    }
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

  // Export stays scoped to logged records: the CSV's columns (logged-by,
  // notes, receipt link) describe data this app owns, not a bank feed.
  const exportRows = $derived.by(() => {
    if (sourceFilter === 'hcb') return [];
    let list = [...cacao.incomeDeposits];
    if (depositCategoryFilter !== 'all') list = list.filter((d) => d.category === depositCategoryFilter);
    if (dateRange) list = list.filter((d) => withinDateRange(d.date, dateRange));
    return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  });

  function exportDepositsCSV() {
    downloadCSV(
      ['Event / Source', 'Amount ($)', 'Category', 'Account', 'Date', 'Logged By', 'Notes', 'Receipt Link'],
      exportRows.map((d) => [
        `"${d.title.replace(/"/g, '""')}"`,
        d.amount,
        d.category,
        d.depositAccount,
        d.date,
        // Absent for a stranger -- the money is public, the person who logged
        // it is not -- and an unguarded template literal writes "undefined".
        `"${d.loggedByName ?? ''}"`,
        `"${d.notes || ''}"`,
        `"${d.receiptUrl || ''}"`
      ]),
      `2064_Fundraiser_Deposits_${cacao.selectedSeason}.csv`
    );
    cacao.showToast('Deposits exported to CSV');
  }
</script>

<PageHeader title="Deposits">
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
    <button type="button" class="btn btn-outlined" onclick={exportDepositsCSV}>
      <Download size={18} />
      <span>Export CSV</span>
    </button>
    <button
      type="button"
      class="btn btn-filled"
      disabled={isViewer}
      title={isViewer ? 'Viewer mode: editing is disabled' : undefined}
      onclick={() => (isAddDepositModalOpen = true)}
    >
      <Plus size={18} />
      <span>Log deposit</span>
    </button>
  {/snippet}
</PageHeader>

<div class="space-y-5">
  <!-- Category is the filter worth a permanent row here; source and date sat
       beside it as two more rows of chips. -->
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={depositCategoryFilter === 'all'}
        onclick={() => (depositCategoryFilter = 'all')}
        class="filter-chip"
      >
        All categories
        <span class="type-num opacity-70">{inEntries.length}</span>
      </button>
      {#each depositCategories as cat}
        {@const count = inEntries.filter((e) => e.category === cat).length}
        {#if count > 0}
          <button
            type="button"
            aria-pressed={depositCategoryFilter === cat}
            onclick={() => (depositCategoryFilter = cat)}
            class="filter-chip"
          >
            {INCOME_CATEGORY_META[cat].label}
            <span class="type-num opacity-70">{count}</span>
          </button>
        {/if}
      {/each}

      <!-- Deposits already had this category, but only inside the popover.
           It is a to-do list, so it belongs where it can be seen. -->
      {#if uncategorizedCount > 0}
        <button
          type="button"
          aria-pressed={depositCategoryFilter === 'uncategorized'}
          onclick={() =>
            (depositCategoryFilter =
              depositCategoryFilter === 'uncategorized' ? 'all' : 'uncategorized')}
          class="filter-chip"
          style="color: var(--color-tertiary)"
          title="Bank credits with no category yet"
        >
          <CircleAlert size={14} />
          <span>Needs category</span>
          <span class="type-num opacity-70">{uncategorizedCount}</span>
        </button>
      {/if}
    </div>

    <FilterPopover activeCount={secondaryFilterCount} onclear={clearSecondaryFilters}>
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
              {inEntries.filter((e) => e.source === 'logged').length}
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
              {inEntries.filter((e) => e.source === 'hcb').length}
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
          ariaLabel="Filter deposits by date"
        />
      </div>
    </FilterPopover>
  </div>

  <!-- Narrow screens: a seven-column table forced horizontal scrolling with no
       affordance saying the remaining columns existed, so it becomes a card
       list — the same treatment the grants tab already uses. -->
  <div class="space-y-3 md:hidden">
    {#each rows as row (row.id)}
      {@const dep =
        row.source === 'logged'
          ? cacao.incomeDeposits.find((d) => d._id === row.deposit?._id)
          : undefined}
      {@const acct = dep ? accountMeta(dep.depositAccount) : null}
      {@const interactive = row.source === 'logged' && !isViewer && dep !== undefined}
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex -->
      <div
        class={`card-elevated p-4 ${interactive ? 'card-interactive' : ''}`}
        animate:flip={listItem.flip}
        in:fly={listItem.in}
        out:scale={listItem.out}
        role={interactive ? 'button' : undefined}
        tabindex={interactive ? 0 : undefined}
        onclick={() => {
          if (interactive && dep) selectedDepositForEdit = dep;
        }}
        onkeydown={(e) => {
          if (interactive && dep && (e.key === 'Enter' || e.key === ' ')) selectedDepositForEdit = dep;
        }}
      >
        <div class="mb-1 flex items-start justify-between gap-2">
          <span class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
            {#if dep?.notes}
              {dep.notes}
            {:else if row.source === 'hcb'}
              Hack Club Bank
            {:else}
              &nbsp;
            {/if}
          </span>
          {#if row.hcbTransactionId}
            <span
              class="chip chip-sm chip-success shrink-0"
              title="Logged here and confirmed against the bank"
            >
              Cleared
            </span>
          {/if}
        </div>

        <h3 class="type-title mb-1 line-clamp-2">{row.title}</h3>
        <p class="type-title-lg type-num mb-3" style="color: var(--color-success)">
          +${row.amount.toFixed(2)}
        </p>

        <dl class="type-label-sm grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div class="col-span-2 flex items-center justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">Category</dt>
            <dd class="flex min-w-0 items-center gap-1.5">
              <span class="flex shrink-0" title={row.source === 'hcb' ? 'Hack Club Bank' : (acct?.label ?? '')}>
                {#if row.source === 'hcb'}
                  <Landmark size={14} />
                {:else if acct}
                  <acct.icon size={14} />
                {/if}
              </span>
              <span class="truncate">
                {INCOME_CATEGORY_META[row.category as keyof typeof INCOME_CATEGORY_META]?.label ??
                  row.category}
              </span>
            </dd>
          </div>

          <div class="col-span-2 flex justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">Date</dt>
            <dd class="type-num truncate">{formatDay(row.date)}</dd>
          </div>
        </dl>

        {#if dep}
          {#if dep.receiptUrl || cacao.currentUser.role === 'admin'}
            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
            <div
              class="mt-3 flex flex-wrap items-center justify-end gap-1"
              onclick={(e) => e.stopPropagation()}
            >
              {#if dep.receiptUrl}
                <a
                  href={dep.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-text btn-sm"
                >
                  <Receipt size={16} />
                  <span>Deposit slip</span>
                </a>
              {/if}

              {#if cacao.currentUser.role === 'admin'}
                <button
                  type="button"
                  class="btn btn-text btn-sm"
                  onclick={() => {
                    if (confirm(`Delete deposit "${dep.title}"?`)) {
                      cacao.deleteIncomeDeposit(dep._id);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              {/if}
            </div>
          {/if}
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
              title="File this bank credit under a category"
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
        No deposits logged for this category.
      </p>
    {/if}
  </div>

  <div class="card-elevated hidden overflow-hidden md:block">
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Fundraiser / source</th>
            <th>Deposited</th>
            <th>Category</th>
            <th>Date</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const dep =
              row.source === 'logged'
                ? cacao.incomeDeposits.find((d) => d._id === row.deposit?._id)
                : undefined}
            {@const acct = dep ? accountMeta(dep.depositAccount) : null}
            <tr
              class={row.source === 'hcb' || isViewer ? '' : 'row-interactive'}
              animate:flip={listRow.flip}
              in:fade={listRow.in}
              out:fade={listRow.out}
              onclick={() => {
                if (row.source === 'logged' && !isViewer && dep) selectedDepositForEdit = dep;
              }}
            >
              <td class="max-w-sm">
                <p class="type-label truncate">{row.title}</p>
                {#if dep?.notes}
                  <p
                    class="type-label-sm mt-0.5 truncate"
                    style="color: var(--color-on-surface-variant)"
                  >
                    {dep.notes}
                  </p>
                {:else if row.source === 'hcb'}
                  <p
                    class="type-label-sm mt-0.5 truncate"
                    style="color: var(--color-on-surface-variant)"
                  >
                    Hack Club Bank
                  </p>
                {/if}
              </td>

              <td class="type-label type-num" style="color: var(--color-success)">
                +${row.amount.toFixed(2)}
              </td>

              <!-- Which account a deposit landed in is one bit of information,
                   so it rides as an icon on the category rather than spending a
                   column on a name that only ever reads "Hack Club Bank" or
                   "Region 15 account". -->
              <td style="color: var(--color-on-surface-variant)">
                <span class="flex items-center gap-1.5">
                  <span class="flex shrink-0" title={row.source === 'hcb' ? 'Hack Club Bank' : (acct?.label ?? '')}>
                    {#if row.source === 'hcb'}
                      <Landmark size={14} />
                    {:else if acct}
                      <acct.icon size={14} />
                    {/if}
                  </span>
                  <span class="truncate">
                    {INCOME_CATEGORY_META[row.category as keyof typeof INCOME_CATEGORY_META]?.label ??
                      row.category}
                  </span>
                  {#if row.source === 'logged' && row.hcbTransactionId}
                    <span
                      class="chip chip-sm shrink-0"
                      style="background: var(--color-success-container); color: var(--color-on-success-container)"
                      title="Logged here and confirmed against the bank"
                    >
                      Cleared
                    </span>
                  {/if}
                </span>
              </td>
              <td class="type-num whitespace-nowrap" style="color: var(--color-on-surface-variant)">
                {formatDay(row.date)}
              </td>
              <td>
                {#if dep}
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
                      title="File this bank credit under a category"
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
              <td colspan="5" class="py-12 text-center" style="color: var(--color-on-surface-variant)">
                No deposits logged for this category.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>

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

<CategorizeTransactionModal
  entry={entryToCategorize}
  open={entryToCategorize !== null}
  onclose={() => (entryToCategorize = null)}
/>
