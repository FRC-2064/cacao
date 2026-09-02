<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import {
    donorsToCsv,
    giftsToCsv,
    CSV_CAVEAT,
    type DonorTotals,
    type GiftSource
  } from '$lib/finance/donors';
  import { PageHeader, M3Input } from '@frc2064/ui';
  import { Download, RefreshCw, ChevronRight } from 'lucide-svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem, listRow } from '@frc2064/ui/motion';

  const ALL = 'all' as const;

  let selectedYear = $state<number | typeof ALL>(new Date().getFullYear());
  let query = $state('');
  let expandedKey = $state<string | null>(null);
  let dismissed = $state<string[]>([]);

  const years = $derived(cacao.donorTaxYears());
  const data = $derived(cacao.donorData(selectedYear));

  const donors = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.donors;
    return data.donors.filter((d) => d.displayName.toLowerCase().includes(q));
  });

  const pairKey = (keys: [string, string]) => [...keys].sort().join('|');

  const suggestions = $derived(
    data.suggestions.filter((s) => !dismissed.includes(pairKey(s.keys)))
  );

  const periodLabel = $derived(selectedYear === ALL ? 'all time' : String(selectedYear));

  const grandTotal = $derived(donors.reduce((sum, d) => sum + d.total, 0));

  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const SOURCE_LABELS: Record<GiftSource, string> = {
    hcb: 'Hack Club Bank',
    check: 'Check',
    in_kind: 'In-kind'
  };

  /**
   * The two list tabs each hand-roll a `downloadCSV(headers, rows, name)`
   * helper. This one takes an already-rendered document instead, because the
   * donor exports carry a caveat line above the header row that a
   * headers-plus-rows signature has nowhere to put.
   */
  function downloadCsvText(filename: string, text: string) {
    const link = document.createElement('a');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(text));
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function exportAll() {
    downloadCsvText(`2064_Donors_${periodLabel}.csv`, donorsToCsv(donors, periodLabel));
    cacao.showToast('Donor totals exported to CSV');
  }

  function exportOne(donor: DonorTotals) {
    downloadCsvText(`${slugify(donor.displayName)}_${periodLabel}.csv`, giftsToCsv(donor, periodLabel));
    cacao.showToast(`Exported giving for ${donor.displayName}`);
  }

  function toggle(key: string) {
    expandedKey = expandedKey === key ? null : key;
  }
</script>

<PageHeader
  title="Donors"
  stat={`${donors.length} ${donors.length === 1 ? 'donor' : 'donors'} · ${money(grandTotal)} for ${periodLabel}`}
>
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
    <button type="button" class="btn btn-outlined" disabled={donors.length === 0} onclick={exportAll}>
      <Download size={18} />
      <span>Export CSV</span>
    </button>
  {/snippet}
</PageHeader>

<div class="space-y-5">
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-1.5">
      {#each years as year (year)}
        <button
          type="button"
          aria-pressed={selectedYear === year}
          onclick={() => (selectedYear = year)}
          class="filter-chip"
        >
          <span class="type-num">{year}</span>
        </button>
      {/each}
      <button
        type="button"
        aria-pressed={selectedYear === ALL}
        onclick={() => (selectedYear = ALL)}
        class="filter-chip"
      >
        All time
      </button>
    </div>

    <M3Input label="Find a donor" bind:value={query} placeholder="Search by name" class="max-w-xs" />
  </div>

  <p class="type-body" style="color: var(--color-on-surface-variant)">
    {CSV_CAVEAT}
  </p>

  {#if suggestions.length > 0}
    <div class="card-elevated p-4 space-y-2">
      <p class="type-label">Possible duplicates</p>
      {#each suggestions as suggestion (pairKey(suggestion.keys))}
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="type-body">
            "{suggestion.displayNames[0]}" and "{suggestion.displayNames[1]}" look like the same
            person.
          </span>
          <button
            type="button"
            class="btn btn-outlined btn-sm"
            onclick={() => (dismissed = [...dismissed, pairKey(suggestion.keys)])}
          >
            Dismiss
          </button>
        </div>
      {/each}
      <p class="type-body" style="color: var(--color-on-surface-variant)">
        These are only suggestions — nothing has been combined. To merge them, rename one on its
        original deposit or expense so both spellings match.
      </p>
    </div>
  {/if}

  {#snippet emptyMessage()}
    {#if query.trim()}
      No donor matches "{query.trim()}".
    {:else}
      No donations recorded for {periodLabel}. Donations sync from Hack Club Bank — add a donor
      name to a deposit, or mark an expense as donated, to include it here.
    {/if}
  {/snippet}

  <!-- Narrow screens: the six-column table scrolled sideways with nothing to
       say the remaining columns existed, so it becomes a card list — matching
       the Expenses and Deposits tabs. Tapping a card opens that donor's gifts
       in place, which is the same disclosure the table row does. -->
  <div class="space-y-3 md:hidden">
    {#each donors as donor (donor.key)}
      {@const open = expandedKey === donor.key}
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex -->
      <div
        class="card-elevated card-interactive p-4"
        animate:flip={listItem.flip}
        in:fly={listItem.in}
        out:scale={listItem.out}
        role="button"
        tabindex="0"
        aria-expanded={open}
        onclick={() => toggle(donor.key)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(donor.key);
          }
        }}
      >
        <div class="mb-1 flex items-start justify-between gap-2">
          <span class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
            {donor.gifts.length}
            {donor.gifts.length === 1 ? 'gift' : 'gifts'}
          </span>
          {#if donor.isAnonymous}
            <span class="chip chip-sm shrink-0" title="Every anonymous gift, added together">
              Anonymous
            </span>
          {/if}
        </div>

        <h3 class="type-title mb-1 line-clamp-2">{donor.displayName}</h3>
        <p class="type-title-lg type-num mb-3">{money(donor.total)}</p>

        <dl class="type-label-sm grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div class="flex justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">Cash</dt>
            <dd class="type-num truncate">{money(donor.cashTotal)}</dd>
          </div>
          <div class="flex justify-between gap-2">
            <dt style="color: var(--color-on-surface-variant)">In-kind</dt>
            <dd class="type-num truncate">{money(donor.inKindTotal)}</dd>
          </div>
        </dl>

        {#if open}
          <ul class="mt-3 divide-y" style="border-color: var(--color-outline-variant)">
            {#each donor.gifts as gift (gift.id)}
              <li class="type-label-sm flex items-center gap-3 py-2">
                <span class="type-num shrink-0" style="color: var(--color-on-surface-variant)">
                  {gift.date}
                </span>
                <span class="min-w-0 flex-1 truncate">{SOURCE_LABELS[gift.source]}</span>
                <span class="type-num shrink-0">{money(gift.amount)}</span>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="mt-3 flex items-center justify-between gap-2">
          <span class="type-label-sm" style="color: var(--color-on-surface-variant)">
            {open ? 'Tap to collapse' : 'Tap for gifts'}
          </span>
          <button
            type="button"
            class="btn btn-outlined btn-sm"
            onclick={(e) => {
              e.stopPropagation();
              exportOne(donor);
            }}
          >
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </div>
    {/each}

    {#if donors.length === 0}
      <div class="card-elevated p-6 text-center" style="color: var(--color-on-surface-variant)">
        {@render emptyMessage()}
      </div>
    {/if}
  </div>

  <div class="card-elevated hidden overflow-hidden md:block">
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Donor</th>
            <th class="text-right">Gifts</th>
            <th class="text-right">Cash</th>
            <th class="text-right">In-kind</th>
            <th class="text-right">Total</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each donors as donor (donor.key)}
            <tr
              class="row-interactive"
              in:fade={listRow.in}
              out:fade={listRow.out}
              onclick={() => toggle(donor.key)}
            >
              <td>
                <button
                  type="button"
                  class="flex items-center gap-1.5 text-left"
                  aria-expanded={expandedKey === donor.key}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggle(donor.key);
                  }}
                >
                  <ChevronRight
                    size={16}
                    class={expandedKey === donor.key ? 'rotate-90 transition-transform' : 'transition-transform'}
                  />
                  <span>{donor.displayName}</span>
                </button>
              </td>
              <td class="text-right type-num">{donor.gifts.length}</td>
              <td class="text-right type-num">{money(donor.cashTotal)}</td>
              <td class="text-right type-num">{money(donor.inKindTotal)}</td>
              <td class="text-right type-num">{money(donor.total)}</td>
              <td class="text-right">
                <button
                  type="button"
                  class="btn btn-outlined btn-sm"
                  onclick={(e) => {
                    e.stopPropagation();
                    exportOne(donor);
                  }}
                >
                  <Download size={16} />
                  <span>Export</span>
                </button>
              </td>
            </tr>

            {#if expandedKey === donor.key}
              <tr>
                <td colspan="6" class="py-0">
                  <ul class="divide-y" style="border-color: var(--color-outline-variant)">
                    {#each donor.gifts as gift (gift.id)}
                      <li class="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                        <span class="type-num" style="color: var(--color-on-surface-variant)">
                          {gift.date}
                        </span>
                        <span class="type-label">{SOURCE_LABELS[gift.source]}</span>
                        <span class="type-body min-w-0 flex-1 truncate">{gift.description}</span>
                        <span class="type-num">{money(gift.amount)}</span>
                      </li>
                    {/each}
                  </ul>
                </td>
              </tr>
            {/if}
          {/each}

          {#if donors.length === 0}
            <tr>
              <td colspan="6" class="py-12 text-center" style="color: var(--color-on-surface-variant)">
                {@render emptyMessage()}
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
