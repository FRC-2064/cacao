<script lang="ts">
  import { goto } from '$app/navigation';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import { cacao } from '$lib/stores/cacaoStore.svelte';

  // Hides the panel; it does not secure it. Convex does that -- every query
  // and mutation behind this page derives the actor from the session and
  // checks the role itself.
  //
  // Waits for `authReady`: the role is `viewer` until Convex has accepted a
  // token and `users.me` has answered, so redirecting before then bounces an
  // admin off their own admin page.
  $effect(() => {
    if (!cacao.authReady) return;
    if (cacao.currentUser.role !== 'admin') {
      goto('/grants', { replaceState: true });
    }
  });
</script>

{#if cacao.authReady && cacao.currentUser.role === 'admin'}
  <AdminPanel />
{/if}
