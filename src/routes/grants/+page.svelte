<script lang="ts">
  import GrantsKanban from '$lib/components/grants/GrantsKanban.svelte';
  import { ui } from '$lib/stores/ui.svelte';
</script>

<GrantsKanban
  onselectgrant={(grant) => ui.openGrant(grant)}
  onaddgrantforstatus={(status) => ui.openAddGrant(status)}
/>
