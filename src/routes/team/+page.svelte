<script lang="ts">
  import TeamInfoView from '$lib/components/team/TeamInfoView.svelte';
  import WishlistView from '$lib/components/team/WishlistView.svelte';
  import SegmentedToggle from '$lib/components/layout/SegmentedToggle.svelte';
  import { Info, Sparkles } from 'lucide-svelte';

  let view = $state<'info' | 'wishlist'>('info');

  const viewOptions = [
    { value: 'info', label: 'Info', icon: Info },
    { value: 'wishlist', label: 'Wishlist', icon: Sparkles }
  ];
</script>

<SegmentedToggle options={viewOptions} bind:value={view} class="mb-4" ariaLabel="Team view" />

{#if view === 'info'}
  <TeamInfoView />
{:else}
  <WishlistView />
{/if}
