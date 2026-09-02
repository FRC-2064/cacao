<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SlidersHorizontal, X } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { dur, emphasizedDecel } from '@frc2064/ui/motion';

  interface Props {
    /**
     * How many filters in here are currently narrowing the list. Drives the
     * badge, which is the whole point of hiding them: a collapsed panel that
     * gives no sign it is filtering is how people end up staring at a list
     * with rows missing and no idea why.
     */
    activeCount: number;
    /** Called when the user clears everything inside the panel. */
    onclear: () => void;
    children: Snippet;
  }

  let { activeCount, onclear, children }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);

  // Pointerdown rather than click: a click listener fires after the target has
  // already reacted, which makes the panel close a frame late when the pointer
  // lands on something that itself re-renders.
  function onPointerDown(e: PointerEvent) {
    if (!open || !root) return;
    if (!root.contains(e.target as Node)) open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) open = false;
  }
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKeydown} />

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="filter-chip"
    aria-expanded={open}
    aria-haspopup="dialog"
    aria-pressed={activeCount > 0}
    onclick={() => (open = !open)}
  >
    <SlidersHorizontal size={14} />
    <span>Filters</span>
    {#if activeCount > 0}
      <span class="type-num opacity-70">{activeCount}</span>
    {/if}
  </button>

  {#if open}
    <div
      role="dialog"
      aria-label="Filters"
      class="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] p-4"
      style="background: var(--color-surface-container-high); border-radius: var(--shape-l); box-shadow: var(--elev-3)"
      in:fly={{ y: -6, duration: dur.fastSpatial, easing: emphasizedDecel }}
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <p class="type-label">Filters</p>
        <div class="flex items-center gap-1">
          {#if activeCount > 0}
            <button type="button" class="btn btn-text btn-sm" onclick={onclear}>Clear</button>
          {/if}
          <button
            type="button"
            class="icon-btn icon-btn-sm"
            title="Close filters"
            onclick={() => (open = false)}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div class="space-y-4">
        {@render children()}
      </div>
    </div>
  {/if}
</div>
