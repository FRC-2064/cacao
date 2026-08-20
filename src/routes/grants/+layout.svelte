<script lang="ts">
  import GrantDrawer from '$lib/components/grants/GrantDrawer.svelte';
  import AddGrantModal from '$lib/components/grants/AddGrantModal.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { page } from '$app/state';
  import { isActive } from '$lib/nav';
  import { LayoutGrid, Table2 } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<!-- Kanban and table are two renderings of one dataset. The wide top nav lists
     them as peers; below `md` that nav is gone, so they collapse to a toggle. -->
<div class="segmented mb-4 md:hidden">
  <a
    href="/grants"
    class="segmented-item"
    class:is-active={isActive(page.url.pathname, '/grants')}
    aria-current={isActive(page.url.pathname, '/grants') ? 'page' : undefined}
  >
    <LayoutGrid size={16} />
    <span>Board</span>
  </a>
  <a
    href="/grants/table"
    class="segmented-item"
    class:is-active={isActive(page.url.pathname, '/grants/table')}
    aria-current={isActive(page.url.pathname, '/grants/table') ? 'page' : undefined}
  >
    <Table2 size={16} />
    <span>List</span>
  </a>
</div>

{@render children()}

<!-- The drawer and add-modal are shared by the kanban and table views, so they
     live on the /grants layout rather than in either page. -->
{#if ui.selectedGrant}
  <GrantDrawer
    grant={ui.selectedGrant}
    open={ui.isGrantDrawerOpen}
    onclose={() => ui.closeGrant()}
  />
{/if}

<AddGrantModal
  open={ui.isAddGrantModalOpen}
  initialStatus={ui.initialAddStatus}
  onclose={() => (ui.isAddGrantModalOpen = false)}
/>
