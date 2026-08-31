<script lang="ts">
  import GrantsKanban from '$lib/components/grants/GrantsKanban.svelte';
  import GrantsTable from '$lib/components/grants/GrantsTable.svelte';
  import GrantsArchive from '$lib/components/grants/GrantsArchive.svelte';
  import SegmentedToggle from '$lib/components/layout/SegmentedToggle.svelte';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { LayoutGrid, Table2, Archive } from 'lucide-svelte';

  let view = $state<'board' | 'table' | 'archive'>('board');

  const viewOptions = $derived([
    { value: 'board', label: 'Board', icon: LayoutGrid },
    { value: 'table', label: 'Table', icon: Table2 },
    { value: 'archive', label: 'Archive', icon: Archive, badge: cacao.archivedGrants.length }
  ]);
</script>

<SegmentedToggle
  options={viewOptions}
  bind:value={view}
  class="mb-4"
  ariaLabel="Grants view"
/>

{#if view === 'board'}
  <GrantsKanban
    onselectgrant={(grant) => ui.openGrant(grant)}
    onaddgrantforstatus={(status) => ui.openAddGrant(status)}
  />
{:else if view === 'table'}
  <GrantsTable
    onselectgrant={(grant) => ui.openGrant(grant)}
    onaddgrant={() => ui.openAddGrant('drafting')}
  />
{:else}
  <GrantsArchive onselectgrant={(grant) => ui.openGrant(grant)} />
{/if}
