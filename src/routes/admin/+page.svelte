<script lang="ts">
  import { goto } from '$app/navigation';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import { cacao } from '$lib/stores/cacaoStore.svelte';

  // Client-side guard, carrying over the behaviour of the old activeView
  // check. It hides the panel, it does not secure it — real enforcement
  // belongs in Convex once auth lands.
  $effect(() => {
    if (cacao.currentUser.role !== 'admin') {
      goto('/grants', { replaceState: true });
    }
  });
</script>

{#if cacao.currentUser.role === 'admin'}
  <AdminPanel />
{/if}
