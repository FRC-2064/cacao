<script lang="ts">
  import { page } from '$app/state';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import { visibleNavItems, pendingFor, isActive } from '$lib/nav';
  import { Search, Sun, Moon, X } from 'lucide-svelte';

  interface Props {
    onopenprofile: () => void;
  }

  let { onopenprofile }: Props = $props();

  const navItems = $derived(visibleNavItems(cacao.currentUser.role === 'admin'));

  // Below `sm` the app bar cannot hold the logo, a usable search field and the
  // trailing actions at once, so search collapses to an icon that opens a
  // dedicated row underneath.
  let searchOpen = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);

  function openSearch() {
    searchOpen = true;
    // The field is only rendered once `searchOpen` flips, so focus after paint.
    requestAnimationFrame(() => searchEl?.focus());
  }

  function closeSearch() {
    searchOpen = false;
    cacao.searchQuery = '';
  }

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
  <!-- Top app bar -->
  <div class="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
    <a href="/grants" class="flex shrink-0 items-center gap-2.5" title="2064 Cacao">
      <span
        class="grid h-10 w-10 place-items-center"
        style="border-radius: var(--shape-m); background: var(--color-primary); color: var(--color-on-primary)"
      >
        <span class="t-display text-[13px]">2064</span>
      </span>
      <span class="t-display hidden text-xl sm:block">Cacao</span>
    </a>

    <!-- Wide screens: the search field sits inline in the app bar. -->
    <div class="relative mx-auto hidden w-full max-w-md sm:block">
      <Search
        size={18}
        class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2"
        style="color: var(--color-on-surface-variant)"
      />
      <input
        type="search"
        placeholder="Search grants, expenses, sponsors…"
        bind:value={cacao.searchQuery}
        aria-label="Search"
        class="search-input"
      />
      {#if cacao.searchQuery}
        <button
          type="button"
          onclick={() => (cacao.searchQuery = '')}
          class="icon-btn icon-btn-sm absolute top-1/2 right-1 -translate-y-1/2"
          title="Clear search"
        >
          <X size={16} />
        </button>
      {/if}
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
      <button
        type="button"
        onclick={openSearch}
        class="icon-btn sm:hidden"
        aria-expanded={searchOpen}
        title="Search"
      >
        <Search size={20} />
      </button>

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
        title={`${cacao.currentUser.name} — view profile`}
      >
        <span
          class="type-label grid h-9 w-9 place-items-center rounded-full"
          style="background: var(--color-primary-container); color: var(--color-on-primary-container)"
        >
          {cacao.currentUser.name.charAt(0)}
        </span>
      </button>
    </div>
  </div>

  <!-- Narrow screens: search opens as its own full-width row. -->
  {#if searchOpen}
    <div class="flex items-center gap-1 px-4 pb-3 sm:hidden">
      <div class="relative flex-1">
        <Search
          size={18}
          class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2"
          style="color: var(--color-on-surface-variant)"
        />
        <input
          bind:this={searchEl}
          type="search"
          placeholder="Search…"
          bind:value={cacao.searchQuery}
          aria-label="Search"
          class="search-input"
          onkeydown={(e) => e.key === 'Escape' && closeSearch()}
        />
      </div>
      <button type="button" onclick={closeSearch} class="icon-btn" title="Close search">
        <X size={20} />
      </button>
    </div>
  {/if}

  <!-- Primary navigation. Hidden below `md`, where BottomNav takes over. -->
  <nav class="mx-auto hidden w-full max-w-7xl overflow-x-auto px-4 pb-3 md:block sm:px-6" aria-label="Views">
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
</header>
