<script lang="ts">
  import type { LedgerEntry } from '$lib/finance/ledger';
  import { INCOME_CATEGORY_META, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import { ChevronRight, Landmark } from 'lucide-svelte';

  interface Props {
    entries: LedgerEntry[];
    incomeByCategory: Record<string, number>;
    expensesByCategory: Record<string, number>;
    totalIn: number;
    totalOut: number;
  }

  let { entries, incomeByCategory, expensesByCategory, totalIn, totalOut }: Props = $props();

  let expanded = $state<string | null>(null);

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  interface Row {
    id: string;
    label: string;
    note: string;
    color: string;
    value: number;
    pct: number;
  }

  function rowsFrom(
    totals: Record<string, number>,
    meta: Record<string, { label: string; note: string; flow: string }>,
    total: number
  ): Row[] {
    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([id, value]) => ({
        id,
        label: meta[id].label,
        note: meta[id].note,
        color: meta[id].flow,
        value,
        pct: total > 0 ? Math.round((value / total) * 100) : 0
      }))
      .sort((a, b) => b.value - a.value);
  }

  const incomeRows = $derived(rowsFrom(incomeByCategory, INCOME_CATEGORY_META, totalIn));
  const expenseRows = $derived(rowsFrom(expensesByCategory, EXPENSE_CATEGORY_META, totalOut));

  function entriesFor(direction: 'in' | 'out', category: string) {
    return entries.filter((e) => e.direction === direction && e.category === category);
  }

  function toggle(key: string) {
    expanded = expanded === key ? null : key;
  }
</script>

{#snippet column(title: string, rows: Row[], direction: 'in' | 'out', total: number)}
  <section class="card-elevated space-y-3 p-5">
    <div class="flex items-baseline justify-between">
      <h2 class="type-title">{title}</h2>
      <span class="type-label type-num">{money(total)}</span>
    </div>

    <div class="space-y-1">
      {#each rows as row (row.id)}
        {@const key = `${direction}:${row.id}`}
        {@const isOpen = expanded === key}
        <div>
          <button
            type="button"
            class="w-full p-2.5 text-left transition-colors hover:bg-[var(--color-surface-container)]"
            style="border-radius: var(--shape-m)"
            aria-expanded={isOpen}
            onclick={() => toggle(key)}
          >
            <div class="flex items-center gap-2">
              <ChevronRight
                size={14}
                class="shrink-0 transition-transform"
                style={isOpen ? 'transform: rotate(90deg)' : ''}
              />
              <span class="type-label flex-1 truncate">{row.label}</span>
              <span class="type-num type-label-sm" style="color: var(--color-on-surface-variant)">
                {row.pct}%
              </span>
              <span class="type-label type-num w-24 text-right">{money(row.value)}</span>
            </div>
            <div class="progress-track mt-1.5 ml-6" style="height: 6px">
              <span class="progress-bar" style={`width: ${row.pct}%; background: ${row.color}`}></span>
            </div>
          </button>

          {#if isOpen}
            <ul class="ml-6 space-y-1 py-2">
              {#each entriesFor(direction, row.id) as entry (entry.id)}
                <li class="flex items-center gap-2 px-2.5 py-1 text-sm">
                  <span class="min-w-0 flex-1 truncate" style="color: var(--color-on-surface-variant)">
                    {entry.title}
                  </span>
                  {#if entry.source === 'hcb'}
                    <span class="chip chip-sm" title="From Hack Club Bank, never logged here">
                      <Landmark size={11} />
                      HCB
                    </span>
                  {:else if entry.hcbTransactionId}
                    <span class="chip chip-sm chip-success" title="Logged here and confirmed against the bank">
                      Cleared
                    </span>
                  {/if}
                  <span class="type-num shrink-0 text-xs">{money(entry.amount)}</span>
                </li>
              {:else}
                <li class="px-2.5 py-1 text-sm" style="color: var(--color-on-surface-variant)">
                  Nothing itemised — this total comes from the Grants or Sponsors tab.
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        <p class="py-6 text-center type-body-sm" style="color: var(--color-on-surface-variant)">
          Nothing recorded yet.
        </p>
      {/each}
    </div>
  </section>
{/snippet}

<div class="grid gap-4 lg:grid-cols-2">
  {@render column('Money in', incomeRows, 'in', totalIn)}
  {@render column('Money out', expenseRows, 'out', totalOut)}
</div>
