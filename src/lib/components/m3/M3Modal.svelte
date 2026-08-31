<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  import { fade, scale } from 'svelte/transition';
  import { dur, fastSpatial, fastEffects, emphasizedAccel } from '$lib/motion';

  interface Props {
    open: boolean;
    title?: string;
    description?: string;
    onclose: () => void;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    children?: Snippet;
  }

  let {
    open = $bindable(false),
    title,
    description,
    onclose,
    maxWidth = 'lg',
    children
  }: Props = $props();

  const widthStyles = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-5xl'
  };

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) onclose();
  }

  // Enter and exit are deliberately asymmetric. Opening is the moment worth
  // animating, so it runs long on a spatial curve and settles with a slight
  // overshoot; closing is just the dialog getting out of the way, so it runs
  // short and accelerates out. A symmetric close feels sluggish because the
  // user has already moved on.
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0"
      style="background: color-mix(in srgb, var(--color-scrim) 40%, transparent)"
      in:fade={{ duration: dur.defaultEffects, easing: fastEffects }}
      out:fade={{ duration: dur.fastEffects, easing: emphasizedAccel }}
      onclick={onclose}
    ></div>

    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class={`relative z-10 my-auto w-full ${widthStyles[maxWidth]} overflow-hidden`}
      style="background: var(--color-surface-container-high); color: var(--color-on-surface); border-radius: var(--shape-xl); box-shadow: var(--elev-3);"
      in:scale={{ duration: dur.fastSpatial, start: 0.92, opacity: 0, easing: fastSpatial }}
      out:scale={{ duration: dur.fastEffects, start: 0.96, opacity: 0, easing: emphasizedAccel }}
    >
      {#if title || description}
        <div class="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div class="min-w-0">
            {#if title}
              <h2 class="type-headline">{title}</h2>
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
      {/if}

      <div class="max-h-[75vh] overflow-y-auto px-6 pt-1 pb-6">
        {@render children?.()}
      </div>
    </div>
  </div>
{/if}
