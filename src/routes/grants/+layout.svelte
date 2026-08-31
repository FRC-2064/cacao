<script lang="ts">
  import GrantDrawer from '$lib/components/grants/GrantDrawer.svelte';
  import AddGrantModal from '$lib/components/grants/AddGrantModal.svelte';
  import FinishGrantModal from '$lib/components/grants/FinishGrantModal.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import type { Grant } from '$lib/types';
  import type { Snippet } from 'svelte';

  let finishing = $state<Grant | null>(null);

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children()}

<!-- The drawer and add-modal are shared by the kanban and table views, so they
     live on the /grants layout rather than in either page. -->
{#if ui.selectedGrant}
  <GrantDrawer
    grant={ui.selectedGrant}
    open={ui.isGrantDrawerOpen}
    onclose={() => ui.closeGrant()}
    onfinish={(grant) => {
      // Close the drawer first: the finish dialog replaces it rather than
      // stacking a modal on top of an open sheet.
      ui.closeGrant();
      finishing = grant;
    }}
  />
{/if}

<FinishGrantModal
  grant={finishing}
  open={finishing !== null}
  onclose={() => (finishing = null)}
/>

<AddGrantModal
  open={ui.isAddGrantModalOpen}
  initialStatus={ui.initialAddStatus}
  onclose={() => (ui.isAddGrantModalOpen = false)}
/>
