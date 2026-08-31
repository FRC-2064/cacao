<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { GRANT_OUTCOMES, GRANT_OUTCOME_META, TONE_VAR, type Grant, type GrantOutcome } from '$lib/types';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import { todayISO } from '$lib/finance/dates';
  import { Check } from 'lucide-svelte';

  interface Props {
    grant: Grant | null;
    open: boolean;
    onclose: () => void;
  }

  let { grant, open, onclose }: Props = $props();

  let outcome = $state<GrantOutcome | null>(null);
  let amount = $state<string | number>('');
  let date = $state('');
  let saving = $state(false);

  // Reset whenever a different grant is opened, so last time's answer can
  // never be submitted against this one.
  $effect(() => {
    if (open && grant) {
      outcome = null;
      amount = grant.amount || '';
      date = todayISO();
    }
  });

  const parsedAmount = $derived(Number(amount));
  const awardIsValid = $derived(Number.isFinite(parsedAmount) && parsedAmount > 0 && date !== '');
  const canSubmit = $derived(
    outcome !== null && (outcome !== 'awarded' || awardIsValid) && !saving
  );

  async function submit() {
    if (!grant || !outcome || !canSubmit) return;
    saving = true;
    try {
      await cacao.finishGrant(
        grant._id,
        outcome,
        outcome === 'awarded' ? { amount: parsedAmount, date } : undefined
      );
      onclose();
    } finally {
      saving = false;
    }
  }
</script>

<M3Modal
  {open}
  title={grant ? `Finish “${grant.title}”` : 'Finish grant'}
  description="Records the outcome and takes it off the board. You can still find it in the archive."
  maxWidth="md"
  {onclose}
>
  <form
    class="space-y-5"
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <div class="space-y-2">
      {#each GRANT_OUTCOMES as id}
        {@const meta = GRANT_OUTCOME_META[id]}
        {@const selected = outcome === id}
        <button
          type="button"
          class="flex w-full items-start gap-3 p-3 text-left"
          style={`border-radius: var(--shape-m); border: 1px solid ${
            selected ? TONE_VAR[meta.tone] : 'var(--color-outline-variant)'
          }; background: ${selected ? 'var(--color-surface-container)' : 'transparent'}`}
          aria-pressed={selected}
          onclick={() => (outcome = id)}
        >
          <span
            class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
            style={`border: 2px solid ${selected ? TONE_VAR[meta.tone] : 'var(--color-outline)'}; background: ${
              selected ? TONE_VAR[meta.tone] : 'transparent'
            }`}
          >
            {#if selected}
              <Check size={12} style="color: var(--color-surface)" />
            {/if}
          </span>
          <span class="min-w-0">
            <span class="type-label block">{meta.label}</span>
            <span class="type-body-sm block" style="color: var(--color-on-surface-variant)">
              {meta.note}
            </span>
          </span>
        </button>
      {/each}
    </div>

    {#if outcome === 'awarded'}
      <!-- Awards rarely match the ask, and a cheque logged weeks late belongs
           in the month it arrived -- both drive the deposit this creates. -->
      <div
        class="space-y-4 p-4"
        style="border-radius: var(--shape-m); background: var(--color-surface-container)"
      >
        <p class="type-label-sm" style="color: var(--color-on-surface-variant)">
          This records a deposit into the Region 15 account.
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <M3Input
            label="Amount awarded"
            type="number"
            bind:value={amount}
            required
            helper={grant && grant.amount ? `Asked for $${grant.amount.toLocaleString('en-US')}` : undefined}
          />
          <M3Input label="Date received" type="date" bind:value={date} required />
        </div>
      </div>
    {/if}

    <div class="flex justify-end gap-2">
      <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn btn-filled" disabled={!canSubmit}>
        {saving ? 'Saving…' : 'Finish grant'}
      </button>
    </div>
  </form>
</M3Modal>
