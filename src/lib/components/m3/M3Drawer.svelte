<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  import { fade, fly } from 'svelte/transition';
  import { dur, defaultSpatial, fastEffects, emphasizedAccel } from '@frc2064/ui/motion';

  interface Props {
    open: boolean;
    title?: string;
    description?: string;
    onclose: () => void;
    children?: Snippet;
    footer?: Snippet;
  }

  let { open = $bindable(false), title, description, onclose, children, footer }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) onclose();
  }

  // The offset is `100%` rather than a pixel figure: the panel is `w-screen`
  // capped at `max-w-xl`, so a fixed 420px left a slice of it already on screen
  // at the start of the transition on wider viewports, and the drawer appeared
  // to pop rather than slide.
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="fixed inset-0 z-50 overflow-hidden">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0"
      style="background: color-mix(in srgb, var(--color-scrim) 40%, transparent)"
      in:fade={{ duration: dur.defaultEffects, easing: fastEffects }}
      out:fade={{ duration: dur.fastEffects, easing: emphasizedAccel }}
      onclick={onclose}
    ></div>

    <div class="fixed inset-y-0 right-0 flex max-w-full sm:pl-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        class="z-10 flex w-screen max-w-xl flex-col"
        style="background: var(--color-surface-container-low); color: var(--color-on-surface); box-shadow: var(--elev-3);"
        in:fly={{ x: '100%', duration: dur.defaultSpatial, easing: defaultSpatial }}
        out:fly={{ x: '100%', duration: dur.slowEffects, easing: emphasizedAccel }}
      >
        <div
          class="flex items-start justify-between gap-4 px-5 pt-5 pb-4"
          style="background: var(--color-surface-container)"
        >
          <div class="min-w-0">
            {#if title}
              <h2 class="type-title-lg">{title}</h2>
            {/if}
            {#if description}
              <p class="type-body mt-1" style="color: var(--color-on-surface-variant)">
                {description}
              </p>
            {/if}
          </div>
          <button type="button" onclick={onclose} class="icon-btn icon-btn-sm shrink-0" title="Close">
            <X size={20} />
          </button>
        </div>

        <div class="flex-1 space-y-6 overflow-y-auto p-5">
          {@render children?.()}
        </div>

        {#if footer}
          <div
            class="flex items-center justify-end gap-2 p-4"
            style="background: var(--color-surface-container); border-top: 1px solid var(--color-outline-variant)"
          >
            {@render footer()}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
