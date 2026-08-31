<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * Standard view header: display title, optional supporting stat line, and a
   * trailing action slot. Every view used to hand-roll this, which is how the
   * six views drifted apart visually.
   */
  interface Props {
    title: string;
    stat?: string;
    description?: string;
    actions?: Snippet;
  }

  let { title, stat, description, actions }: Props = $props();
</script>

<div class="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
  <div class="min-w-0">
    <h1 class="t-display text-2xl sm:text-[28px]">{title}</h1>
    {#if stat}
      <p class="type-body type-num mt-1.5" style="color: var(--color-on-surface-variant)">
        {stat}
      </p>
    {:else if description}
      <p class="type-body mt-1.5" style="color: var(--color-on-surface-variant)">
        {description}
      </p>
    {/if}
  </div>

  {#if actions}
    <div class="flex flex-wrap items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
