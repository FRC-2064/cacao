<script lang="ts">
  import { M3Input } from '@frc2064/ui';
  import { DATE_PRESETS, type DateRangePreset } from '$lib/finance/dates';
  import { slide } from 'svelte/transition';

  interface Props {
    preset: DateRangePreset;
    customStart: string;
    customEnd: string;
    /** How many rows the current range keeps, shown on the active chip. */
    matchCount: number;
    ariaLabel: string;
  }

  let {
    preset = $bindable('all'),
    customStart = $bindable(''),
    customEnd = $bindable(''),
    matchCount,
    ariaLabel
  }: Props = $props();
</script>

<div class="space-y-2">
  <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
    {#each DATE_PRESETS as p}
      <button
        type="button"
        aria-pressed={preset === p.id}
        onclick={() => (preset = p.id)}
        class="filter-chip"
      >
        {p.label}
        {#if preset === p.id && p.id !== 'all'}
          <span class="type-num opacity-70">{matchCount}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if preset === 'custom'}
    <!-- Either bound may be left blank, which leaves that side open-ended --
         "everything since March" needs a start and no end. -->
    <div class="grid max-w-md gap-3 sm:grid-cols-2" transition:slide={{ duration: 160 }}>
      <M3Input label="From" type="date" bind:value={customStart} />
      <M3Input label="To" type="date" bind:value={customEnd} />
    </div>
  {/if}
</div>
