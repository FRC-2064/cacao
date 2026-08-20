<script lang="ts">
  import '../styles/app.css';
  import Toast from '$lib/components/layout/Toast.svelte';
  import SiteHeader from '$lib/components/layout/SiteHeader.svelte';
  import BottomNav from '$lib/components/layout/BottomNav.svelte';
  import UserProfileModal from '$lib/components/layout/UserProfileModal.svelte';
  import RequestAccessModal from '$lib/components/auth/RequestAccessModal.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { page } from '$app/state';
  import { fly } from 'svelte/transition';
  import { dur, emphasizedDecel } from '$lib/motion';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<div
  class="app-shell flex min-h-screen flex-col"
  style="background: var(--color-surface); color: var(--color-on-surface)"
>
  <SiteHeader onopenprofile={() => (ui.isProfileModalOpen = true)} />

  <!--
    Views rise into place on navigation. Keyed on `pathname` alone, so changing
    a query string does not remount the page.

    There is deliberately no `out:` transition. Svelte runs an outgoing
    transition in the same layout slot as the incoming one, so animating both
    stacks two full page bodies on top of each other for the duration — the
    footer jumps and the scroll position lurches. An in-only transition costs
    nothing visually here because the old view is replaced by a rising one.
  -->
  <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
    {#key page.url.pathname}
      <div in:fly={{ y: 10, duration: dur.defaultSpatial, easing: emphasizedDecel }}>
        {@render children()}
      </div>
    {/key}
  </main>

  <BottomNav />

  <UserProfileModal
    open={ui.isProfileModalOpen}
    onclose={() => (ui.isProfileModalOpen = false)}
    onopenrequest={() => (ui.isRequestAccessModalOpen = true)}
  />

  <RequestAccessModal
    open={ui.isRequestAccessModalOpen}
    onclose={() => (ui.isRequestAccessModalOpen = false)}
  />

  <Toast />
</div>
