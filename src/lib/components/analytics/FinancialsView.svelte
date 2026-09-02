<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { PageHeader } from '@frc2064/ui';
  import SankeyFlow from './SankeyFlow.svelte';
  import CategoryBreakdown from './CategoryBreakdown.svelte';
  import AccountBalances from './AccountBalances.svelte';
  import { INCOME_CATEGORY_META, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import type { SankeyCategory } from '$lib/finance/sankey';
  import { Calendar } from 'lucide-svelte';

  /**
   * Which season the charts below cover, as the `YYYY-YYYY` label
   * `getFinancialsForSeason` filters on, or the sentinel `'all'`.
   *
   * Empty until `api.seasons.list` lands. There is deliberately no literal
   * year here: the list used to be four hardcoded options defaulting to
   * `'2026-2027'`, which was already a year out of date and would have gone
   * on silently showing an empty dashboard every September.
   */
  let selectedYearSeason = $state<string>('');

  const availableSeasons = $derived([
    ...cacao.seasons.map((s) => ({ value: s.label, label: s.label })),
    { value: 'all', label: 'All time' }
  ]);

  // The season flagged current, once the query answers -- not a guess, and not
  // sticky against a choice the reader has already made.
  $effect(() => {
    if (selectedYearSeason) return;
    const current = cacao.currentSeason?.label ?? cacao.seasons[0]?.label;
    if (current) selectedYearSeason = current;
  });

  /** What the Sankey titles itself. `'all'` is a sentinel, not a season. */
  const seasonLabel = $derived(
    selectedYearSeason === 'all' ? 'All time' : selectedYearSeason || '—'
  );

  const seasonPhrase = $derived(
    selectedYearSeason === 'all' ? 'across every season' : `in ${selectedYearSeason}`
  );

  const fin = $derived(cacao.getFinancialsForSeason(selectedYearSeason));

  function toCategories(
    totals: Record<string, number>,
    meta: Record<string, { label: string; flow: string }>
  ): SankeyCategory[] {
    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([id, value]) => ({ id, label: meta[id].label, value, color: meta[id].flow }))
      .sort((a, b) => b.value - a.value);
  }

  const incoming = $derived(toCategories(fin.incomeByCategory, INCOME_CATEGORY_META));
  const outgoing = $derived(toCategories(fin.expensesByCategory, EXPENSE_CATEGORY_META));
</script>

<PageHeader title="Dashboard" description={`Where the money came from and went ${seasonPhrase}`} />

<div class="space-y-6">
  <!-- Present tense, and deliberately outside the season filter. -->
  <AccountBalances balances={cacao.accountBalances} />

  <!-- Centred here, directly above the things it actually controls (the
       chart and the breakdown), rather than in the page header where it
       would read as though it also governs the balance strip above. -->
  <div class="flex items-center justify-center">
    <div class="relative flex items-center">
      <Calendar size={16} class="pointer-events-none absolute left-3" style="color: var(--color-primary)" />
      <select
        bind:value={selectedYearSeason}
        class="select-input cursor-pointer rounded-full py-2 pl-9 pr-8 text-sm font-medium"
        style="background: var(--color-surface-container); border: 1px solid var(--color-outline-variant);"
        aria-label="Filter finances by season"
      >
        {#each availableSeasons as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <SankeyFlow {incoming} {outgoing} {seasonLabel} />

  <CategoryBreakdown
    entries={fin.entries}
    incomeByCategory={fin.incomeByCategory}
    expensesByCategory={fin.expensesByCategory}
    totalIn={fin.totalIn}
    totalOut={fin.totalOut}
  />
</div>
