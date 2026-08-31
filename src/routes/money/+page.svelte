<script lang="ts">
  import ExpensesList from '$lib/components/expenses/ExpensesList.svelte';
  import DepositsList from '$lib/components/deposits/DepositsList.svelte';
  import DonorsList from '$lib/components/donors/DonorsList.svelte';
  import SegmentedToggle from '$lib/components/layout/SegmentedToggle.svelte';
  import { Receipt, Landmark, HeartHandshake } from 'lucide-svelte';

  let view = $state<'expenses' | 'deposits' | 'donors'>('expenses');

  const viewOptions = [
    { value: 'expenses', label: 'Expenses', icon: Receipt },
    { value: 'deposits', label: 'Deposits', icon: Landmark },
    { value: 'donors', label: 'Donors', icon: HeartHandshake }
  ];
</script>

<SegmentedToggle
  options={viewOptions}
  bind:value={view}
  class="mb-4"
  ariaLabel="Money view"
/>

{#if view === 'expenses'}
  <ExpensesList />
{:else if view === 'deposits'}
  <DepositsList />
{:else}
  <DonorsList />
{/if}
