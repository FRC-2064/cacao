<script lang="ts">
  import { page } from '$app/state';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { visibleNavItems, pendingFor, isActive } from '$lib/nav';

  /**
   * Material 3 navigation bar for narrow screens. The wide layout's segmented
   * strip needed ~770px and scrolled horizontally with no affordance, so on a
   * phone you could not tell the remaining tabs existed.
   */
  const items = $derived(visibleNavItems(cacao.currentUser.role === 'admin'));
</script>

<nav class="bottom-nav md:hidden" aria-label="Views">
  {#each items as item (item.href)}
    {@const active = isActive(page.url.pathname, item.href)}
    {@const pending = pendingFor(item)}
    <a href={item.href} class="bottom-nav-item" aria-current={active ? 'page' : undefined}>
      <span class="bottom-nav-indicator" class:is-active={active}>
        <item.icon size={20} />
        {#if pending > 0}
          <span class="bottom-nav-badge">{pending}</span>
        {/if}
      </span>
      <span class="bottom-nav-label">{item.label}</span>
    </a>
  {/each}
</nav>
