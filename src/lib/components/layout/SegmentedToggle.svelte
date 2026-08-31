<script lang="ts">
  // lucide-svelte 0.475 still emits legacy class components, so icons are
  // typed as ComponentType rather than Svelte 5's Component.
  import type { ComponentType } from 'svelte';

  export interface SegmentedOption {
    value: string;
    label: string;
    icon?: ComponentType;
    badge?: number;
  }

  interface Props {
    options: SegmentedOption[];
    value: string;
    class?: string;
    ariaLabel?: string;
  }

  let { options, value = $bindable(), class: className = '', ariaLabel }: Props = $props();

  // ── Sliding active-tab pill ───────────────────────────────────────────────
  // CSS cannot animate a background from one sibling to another, so the active
  // fill is a separate absolutely-positioned element whose offset and width are
  // measured from whichever button currently holds the value.
  let segEl = $state<HTMLElement | null>(null);
  let indEl = $state<HTMLElement | null>(null);
  let indReady = $state(false);

  $effect(() => {
    // Tracked so the pill follows a value change and re-measures if the
    // option set itself changes shape.
    value;
    options.length;

    const seg = segEl;
    const ind = indEl;
    if (!seg || !ind) return;

    const sync = () => {
      const active = seg.querySelector<HTMLElement>('.segmented-item.is-active');
      // Zero width means the control is display:none. Leave the pill hidden
      // until it has real geometry to sit on, rather than parking a 0px
      // sliver at the origin.
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

    // Covers viewport resizes and late webfont loads reflowing the labels,
    // both of which move the target out from under it.
    const ro = new ResizeObserver(sync);
    ro.observe(seg);
    return () => ro.disconnect();
  });
</script>

<div class={`segmented ${className}`} bind:this={segEl} role="group" aria-label={ariaLabel}>
  <div class="segmented-indicator" class:is-ready={indReady} bind:this={indEl} aria-hidden="true"></div>
  {#each options as option (option.value)}
    {@const active = option.value === value}
    <button
      type="button"
      aria-pressed={active}
      onclick={() => (value = option.value)}
      class="segmented-item"
      class:is-active={active}
    >
      {#if option.icon}
        <option.icon size={16} />
      {/if}
      <span>{option.label}</span>
      {#if option.badge !== undefined && option.badge > 0}
        <span class={`segmented-badge ${active ? '' : 'segmented-badge-alert'}`}>
          {option.badge}
        </span>
      {/if}
    </button>
  {/each}
</div>
