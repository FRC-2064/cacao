<script lang="ts">
  import GrantsTable from '$lib/components/grants/GrantsTable.svelte';
  import { ui } from '$lib/stores/ui.svelte';
</script>

<GrantsTable
  onselectgrant={(grant) => ui.openGrant(grant)}
  onaddgrant={() => ui.openAddGrant('drafting')}
/>
