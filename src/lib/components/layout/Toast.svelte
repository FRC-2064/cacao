<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { CheckCircle2, Info, AlertCircle, X } from 'lucide-svelte';
  import { fly } from 'svelte/transition';
  import { dur, fastSpatial, emphasizedAccel } from '$lib/motion';
</script>

{#if cacao.toastMessage}
  {@const isError = cacao.toastMessage.type === 'error'}
  <div
    class="fixed right-4 bottom-4 z-50 left-4 sm:left-auto"
    role="status"
    aria-live="polite"
    in:fly={{ y: 32, duration: dur.fastSpatial, easing: fastSpatial }}
    out:fly={{ y: 16, duration: dur.fastEffects, easing: emphasizedAccel }}
  >
    <!-- M3 snackbar: inverse surface, so it reads as an overlay in both themes. -->
    <div
      class="type-body flex items-center gap-3 py-3 pr-2 pl-4"
      style={`border-radius: var(--shape-s); box-shadow: var(--elev-3); background: ${
        isError ? 'var(--color-error-container)' : 'var(--color-inverse-surface)'
      }; color: ${isError ? 'var(--color-on-error-container)' : 'var(--color-inverse-on-surface)'};`}
    >
      {#if cacao.toastMessage.type === 'success'}
        <CheckCircle2 size={18} class="shrink-0" />
      {:else if isError}
        <AlertCircle size={18} class="shrink-0" />
      {:else}
        <Info size={18} class="shrink-0" />
      {/if}
      <span class="flex-1">{cacao.toastMessage.text}</span>
      <button
        type="button"
        onclick={() => (cacao.toastMessage = null)}
        class="icon-btn icon-btn-sm shrink-0"
        title="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  </div>
{/if}
