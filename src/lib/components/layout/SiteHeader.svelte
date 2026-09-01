<script lang="ts">
  import { page } from '$app/state';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { visibleNavItems, pendingFor, isActive } from '$lib/nav';
  import { initialsOf } from '@frc2064/ui';
  import { Sun, Moon, X } from 'lucide-svelte';

  interface Props {
    onopenprofile: () => void;
  }

  let { onopenprofile }: Props = $props();

  const navItems = $derived(visibleNavItems(cacao.currentUser.role === 'admin'));

  // ── Sliding active-tab pill ───────────────────────────────────────────────
  // CSS cannot animate a background from one sibling to another, so the active
  // fill is a separate absolutely-positioned element whose offset and width are
  // measured from whichever link is currently active.
  let segEl = $state<HTMLElement | null>(null);
  let indEl = $state<HTMLElement | null>(null);
  let indReady = $state(false);

  $effect(() => {
    // Tracked so the pill follows navigation, and so it re-measures when an
    // admin signing in adds a seventh tab.
    page.url.pathname;
    navItems.length;

    const seg = segEl;
    const ind = indEl;
    if (!seg || !ind) return;

    const sync = () => {
      const active = seg.querySelector<HTMLElement>('.segmented-item.is-active');
      // Zero width means the nav is display:none — this is the phone layout,
      // where BottomNav takes over. Leave the pill hidden until it has real
      // geometry to sit on, rather than parking a 0px sliver at the origin.
      if (!active || active.offsetWidth === 0) {
        indReady = false;
        return;
      }
      ind.style.setProperty('--ind-x', `${active.offsetLeft}px`);
      ind.style.setProperty('--ind-w', `${active.offsetWidth}px`);
      // `.is-ready` is what carries the transition, so granting it a frame
      // after the offsets land keeps the pill from sliding in from the left
      // edge on first paint.
      if (!indReady) requestAnimationFrame(() => (indReady = true));
    };

    sync();

    // Covers viewport resizes, the admin tab appearing, and late webfont loads
    // reflowing the labels — all of which move the target out from under it.
    const ro = new ResizeObserver(sync);
    ro.observe(seg);
    return () => ro.disconnect();
  });
</script>

<header
  class="site-header sticky top-0 z-30"
  style="background: var(--color-surface); border-bottom: 1px solid var(--color-outline-variant)"
>
  <div class="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
    <a
      href="/dashboard"
      class="group flex shrink-0 items-center"
      aria-label="2064 The Panther Project"
      title="2064 The Panther Project"
    >
      <img
        src="/brand/wordmark.png"
        alt="2064 Panther Project"
        class="h-8 w-auto object-contain transition group-hover:opacity-85 sm:h-9"
        height="36"
      />
    </a>
    <!-- Primary navigation. Hidden below `md`, where BottomNav takes over. -->
    <nav class="hidden overflow-x-auto md:flex md:items-center" aria-label="Views">
      <div class="segmented" bind:this={segEl}>
        <div class="segmented-indicator" class:is-ready={indReady} bind:this={indEl} aria-hidden="true"></div>
        {#each navItems as item (item.href)}
          {@const active = isActive(page.url.pathname, item.href)}
          {@const pending = pendingFor(item)}
          <a
            href={item.href}
            aria-current={active ? 'page' : undefined}
            class="segmented-item"
            class:is-active={active}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
            {#if pending > 0}
              <span class={`segmented-badge ${active ? '' : 'segmented-badge-alert'}`}>
                {pending}
              </span>
            {/if}
          </a>
        {/each}
      </div>
    </nav>

    <div class="flex shrink-0 items-center gap-2">
      {#if cacao.currentUser.role === 'viewer'}
        <span class="chip chip-sm text-xs font-semibold" title="Viewer mode: editing is disabled">
          Guest (View-Only)
        </span>
      {/if}

      <button
        type="button"
        onclick={() => theme.toggle()}
        class="icon-btn"
        title={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {#if theme.resolved === 'dark'}
          <Sun size={20} />
        {:else}
          <Moon size={20} />
        {/if}
      </button>

      <button
        type="button"
        onclick={onopenprofile}
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
    </div>
  </div>
</header>
