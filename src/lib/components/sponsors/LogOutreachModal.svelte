<script lang="ts">
  import type { Sponsor, AnnualOutreachRecord } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { M3Modal, M3Input, M3Select } from '@frc2064/ui';
  import { Send } from 'lucide-svelte';

  interface Props {
    sponsor: Sponsor | null;
    open: boolean;
    onclose: () => void;
  }

  let { sponsor, open = $bindable(false), onclose }: Props = $props();

  let year = $state<number>(2026);
  let status = $state<AnnualOutreachRecord['status']>('report_sent');
  let amount = $state<number>(1000);
  let notes = $state('');

  $effect(() => {
    if (sponsor) {
      amount = sponsor.currentYearPledge || 1000;
      notes = `Sent 2026 Season Summary packet and requested renewal for ${sponsor.tier.toUpperCase()} tier.`;
    }
  });

  const statusOptions = [
    { value: 'contacted', label: 'Initial Email / Letter Sent' },
    { value: 'report_sent', label: 'Annual Summary Report Delivered' },
    { value: 'pledged', label: 'Pledged Support for Season' },
    { value: 'received', label: 'Check / Funds Received' },
    { value: 'declined', label: 'Declined for this Season' }
  ];

  /**
   * Outreach is a row in `sponsorOutreach` now, not an entry in an embedded
   * array, so a record carries its own `_id` and the sponsor it belongs to.
   *
   * `sponsors.logOutreach` upserts on (sponsor, year) server-side and assigns
   * the real id; the one built here is only for the optimistic copy the store
   * splices into `sponsor.annualHistory` while the mutation is in flight.
   * Reusing the existing row's id where there is one keeps that copy a
   * replacement rather than a duplicate of the same year.
   */
  function handleSubmit() {
    if (!sponsor) return;
    const existing = sponsor.annualHistory.find((h) => h.year === Number(year));
    cacao.logSponsorOutreach(sponsor._id, {
      _id: existing?._id ?? `outreach_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sponsorId: sponsor._id,
      year: Number(year),
      status,
      amount: Number(amount) || undefined,
      notes: notes.trim() || undefined,
      contactedDate: new Date().toISOString().split('T')[0]
    });
    onclose();
  }
</script>

{#if sponsor && cacao.currentUser.role !== 'viewer'}
  <M3Modal
    bind:open
    {onclose}
    title={`Log touchpoint · ${sponsor.name}`}
    description="Record the annual report, renewal, or conversation"
  >
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <M3Input label="Season year" type="number" bind:value={year} required />
        <M3Select label="Outcome" bind:value={status} options={statusOptions} />
      </div>

      <M3Input
        label="Amount / pledge ($)"
        type="number"
        bind:value={amount}
      />

      <div class="field">
        <label for="outreach_notes_text" class="field-label">Communication notes</label>
        <textarea
          id="outreach_notes_text"
          bind:value={notes}
          rows={3}
          placeholder="Details of the discussion, who reached out, meeting date…"
          class="textarea-input"
        ></textarea>
      </div>

      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
        <button type="submit" class="btn btn-filled">
          <Send size={18} />
          <span>Save touchpoint</span>
        </button>
      </div>
    </form>
  </M3Modal>
{/if}
