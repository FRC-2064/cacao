<script lang="ts">
  import { ArrowUp } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { dur, fastSpatial, emphasizedAccel } from '@frc2064/ui/motion';

  /**
   * Back-to-top for the long list views. A season's worth of expenses runs to
   * a few hundred rows, and the filters and totals all live at the top of the
   * page — so the way back up was a lot of flicking.
   */
  let scrollY = $state(0);

  /** Far enough down that the page header is well out of view. */
  const visible = $derived(scrollY > 400);

  function toTop() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }
</script>

<svelte:window bind:scrollY />

{#if visible}
  <button
    type="button"
    class="scroll-top-fab"
    onclick={toTop}
    aria-label="Back to top"
    title="Back to top"
    in:fly={{ y: 16, duration: dur.fastSpatial, easing: fastSpatial }}
    out:fly={{ y: 16, duration: dur.fastEffects, easing: emphasizedAccel }}
  >
    <ArrowUp size={22} />
  </button>
{/if}
