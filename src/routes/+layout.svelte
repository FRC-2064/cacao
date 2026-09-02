<script lang="ts">
  import '../styles/app.css';
  import { SiteHeader, BottomNav, Toast, ScrollToTop, ThemeToggle, initialsOf } from '@frc2064/ui';
  import wordmark from '@frc2064/ui/assets/wordmark.png';
  import UserProfileModal from '$lib/components/layout/UserProfileModal.svelte';
  import { ui } from '$lib/stores/ui.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { theme } from '$lib/theme';
  import { navItems } from '$lib/nav';
  import { fly } from 'svelte/transition';
  import { dur, emphasizedDecel } from '@frc2064/ui/motion';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  const items = $derived(navItems());

  /**
   * The route gate.
   *
   * The server refuses unauthorised reads on its own, so this is not what
   * makes the app safe -- it is what stops a signed-out visitor staring at an
   * empty dashboard wondering why nothing loaded. It waits for `authReady` so
   * a returning member is never bounced to the sign-in screen mid-restore.
   */
  $effect(() => {
    if (!cacao.authReady) return;
    if (cacao.isAuthenticated) return;
    if (page.url.pathname === '/') return;
    goto('/');
  });
</script>

<div
  class="app-shell flex min-h-screen flex-col"
  style="background: var(--color-surface); color: var(--color-on-surface)"
>
  <SiteHeader {items} pathname={page.url.pathname}>
    {#snippet brand()}
      <a
        href="/dashboard"
        class="group flex shrink-0 items-center"
        aria-label="2064 The Panther Project"
        title="2064 The Panther Project"
      >
        <img
          src={wordmark}
          alt="2064 Panther Project"
          class="h-8 w-auto object-contain transition group-hover:opacity-85 sm:h-9"
          height="36"
        />
      </a>
    {/snippet}
    {#snippet actions()}
      {#if cacao.currentUser.role === 'viewer'}
        <span class="chip chip-sm text-xs font-semibold" title="Viewer mode: editing is disabled">
          Guest (View-Only)
        </span>
      {/if}
      <ThemeToggle {theme} />
      <button
        type="button"
        onclick={() => (ui.isProfileModalOpen = true)}
        class="icon-btn"
        title={`${cacao.currentUser.displayName} — view profile`}
      >
        <span
          class="type-label grid h-9 w-9 place-items-center rounded-full"
          style="background: var(--color-primary-container); color: var(--color-on-primary-container)"
        >
          {initialsOf(cacao.currentUser.displayName)}
        </span>
      </button>
    {/snippet}
  </SiteHeader>

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

  {#if page.url.pathname !== '/'}
    <BottomNav {items} pathname={page.url.pathname} />
    <ScrollToTop />
  {/if}

  <UserProfileModal
    open={ui.isProfileModalOpen}
    onclose={() => (ui.isProfileModalOpen = false)}
  />

  <Toast />
</div>
