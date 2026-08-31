<script lang="ts">
  import SponsorsList from '$lib/components/sponsors/SponsorsList.svelte';
  import ContactsView from '$lib/components/contacts/ContactsView.svelte';
  import SegmentedToggle from '$lib/components/layout/SegmentedToggle.svelte';
  import { Handshake, Contact } from 'lucide-svelte';

  let view = $state<'sponsors' | 'contacts'>('sponsors');

  const viewOptions = [
    { value: 'sponsors', label: 'Sponsors', icon: Handshake },
    { value: 'contacts', label: 'Contacts', icon: Contact }
  ];
</script>

<SegmentedToggle
  options={viewOptions}
  bind:value={view}
  class="mb-4"
  ariaLabel="Sponsors view"
/>

{#if view === 'sponsors'}
  <SponsorsList />
{:else}
  <ContactsView />
{/if}
