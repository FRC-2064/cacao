<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { Sponsor, SponsorTier, Tone } from '$lib/types';
  import { TONE_CHIP } from '$lib/types';
  import SponsorModal from './SponsorModal.svelte';
  import LogOutreachModal from './LogOutreachModal.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import { Plus, Send, Mail, AlertCircle, Clock } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '$lib/motion';

  let activeTierFilter = $state<string>('all');
  let selectedSponsorForEdit = $state<Sponsor | null>(null);
  let selectedSponsorForOutreach = $state<Sponsor | null>(null);
  let isAddModalOpen = $state(false);

  const filteredSponsors = $derived.by(() => {
    return cacao.sponsors.filter((s) => {
      if (activeTierFilter !== 'all' && s.tier !== activeTierFilter) return false;
      if (cacao.searchQuery.trim()) {
        const q = cacao.searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.notes?.toLowerCase().includes(q) ||
          s.primaryContactName?.toLowerCase().includes(q) ||
          s.primaryContactEmail?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  });

  const tierOrder: SponsorTier[] = [
    'platinum',
    'gold',
    'silver',
    'bronze',
    'panther_partner',
    'in_kind'
  ];

  /** Top tiers get the primary role; the rest stay neutral so the board reads calmly. */
  function tierTone(tier: SponsorTier): Tone {
    if (tier === 'platinum' || tier === 'gold') return 'primary';
    if (tier === 'panther_partner') return 'secondary';
    return 'neutral';
  }

  /** A year cell reflects how far that year's outreach got. */
  function yearTone(status?: string): Tone {
    if (status === 'received') return 'success';
    if (status === 'pledged') return 'primary';
    if (status === 'contacted' || status === 'report_sent') return 'secondary';
    if (status === 'declined') return 'error';
    return 'neutral';
  }

  function titleCase(value: string) {
    return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  const NINE_MONTHS_MS = 1000 * 60 * 60 * 24 * 270;

  function isStale(sponsor: Sponsor): boolean {
    if (!sponsor.lastContactDate) return true;
    return new Date(sponsor.lastContactDate).getTime() < Date.now() - NINE_MONTHS_MS;
  }
</script>

<PageHeader
  title="Sponsors"
  stat={`$${cacao.metrics.totalSponsorFunding.toLocaleString()} lifetime · $${cacao.metrics.currentYearPledges.toLocaleString()} pledged this year`}
>
  {#snippet actions()}
    <button type="button" class="btn btn-filled" onclick={() => (isAddModalOpen = true)}>
      <Plus size={18} />
      <span>Add sponsor</span>
    </button>
  {/snippet}
</PageHeader>

<div class="space-y-4">
  {#if cacao.metrics.staleSponsorsCount > 0}
    <div
      class="type-body flex items-center gap-2.5 p-4"
      style="border-radius: var(--shape-m); background: var(--color-tertiary-container); color: var(--color-on-tertiary-container)"
      role="status"
    >
      <AlertCircle size={20} class="shrink-0" />
      <p>
        <strong>{cacao.metrics.staleSponsorsCount}</strong>
        {cacao.metrics.staleSponsorsCount === 1 ? 'sponsor is' : 'sponsors are'} due for an annual
        outreach report.
      </p>
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      aria-pressed={activeTierFilter === 'all'}
      onclick={() => (activeTierFilter = 'all')}
      class="filter-chip"
    >
      All
      <span class="type-num opacity-70">{cacao.sponsors.length}</span>
    </button>
    {#each tierOrder as tier}
      {@const count = cacao.sponsors.filter((s) => s.tier === tier).length}
      {#if count > 0}
        <button
          type="button"
          aria-pressed={activeTierFilter === tier}
          onclick={() => (activeTierFilter = tier)}
          class="filter-chip"
        >
          {titleCase(tier)}
          <span class="type-num opacity-70">{count}</span>
        </button>
      {/if}
    {/each}
  </div>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each filteredSponsors as sponsor (sponsor._id)}
      {@const stale = isStale(sponsor)}
      <article
        class="card-elevated flex flex-col gap-3 p-4"
        animate:flip={listItem.flip}
        in:fly={listItem.in}
        out:scale={listItem.out}
      >
        <div class="flex items-start justify-between gap-2">
          <span class={`chip chip-sm ${TONE_CHIP[tierTone(sponsor.tier)]}`}>
            {titleCase(sponsor.tier)}
          </span>

          {#if stale}
            <span class="chip chip-sm chip-tertiary">
              <Clock size={13} />
              <span>Renewal due</span>
            </span>
          {/if}
        </div>

        <div>
          <h2 class="type-title-lg leading-snug">{sponsor.name}</h2>
          <p class="type-body" style="color: var(--color-on-surface-variant)">
            {titleCase(sponsor.category)}
          </p>
        </div>

        <div
          class="grid grid-cols-2 gap-3 p-3"
          style="border-radius: var(--shape-m); background: var(--color-surface-container)"
        >
          <div>
            <span class="type-label-sm" style="color: var(--color-on-surface-variant)">Lifetime</span>
            <p class="type-title type-num">${sponsor.totalDonated.toLocaleString()}</p>
          </div>
          <div>
            <span class="type-label-sm" style="color: var(--color-on-surface-variant)">
              This year
            </span>
            <p class="type-title type-num">
              ${(sponsor.currentYearPledge || 0).toLocaleString()}
            </p>
          </div>
        </div>

        {#if sponsor.primaryContactName}
          <p
            class="type-body flex items-center gap-1.5"
            style="color: var(--color-on-surface-variant)"
          >
            <Mail size={16} class="shrink-0" />
            <span class="truncate">{sponsor.primaryContactName}</span>
          </p>
        {/if}

        <div class="flex items-center gap-1.5">
          {#each [2024, 2025, 2026] as yr}
            {@const record = sponsor.annualHistory.find((h) => h.year === yr)}
            <span
              class={`chip chip-sm type-num flex-1 justify-center ${TONE_CHIP[yearTone(record?.status)]}`}
              title={`${yr}: ${record?.status ? titleCase(record.status) : 'No record'}`}
            >
              {yr}
            </span>
          {/each}
        </div>

        <div class="mt-auto flex items-center gap-2 pt-1">
          <button
            type="button"
            class="btn btn-tonal btn-sm flex-1"
            onclick={() => (selectedSponsorForOutreach = sponsor)}
          >
            <Send size={16} />
            <span>Log touchpoint</span>
          </button>

          <button
            type="button"
            class="btn btn-text btn-sm"
            onclick={() => (selectedSponsorForEdit = sponsor)}
          >
            Edit
          </button>
        </div>
      </article>
    {/each}

    {#if filteredSponsors.length === 0}
      <p
        class="type-body col-span-full py-12 text-center"
        style="color: var(--color-on-surface-variant)"
      >
        No sponsors match this filter.
      </p>
    {/if}
  </div>
</div>

{#if selectedSponsorForEdit || isAddModalOpen}
  <SponsorModal
    sponsor={selectedSponsorForEdit}
    open={true}
    onclose={() => {
      selectedSponsorForEdit = null;
      isAddModalOpen = false;
    }}
  />
{/if}

{#if selectedSponsorForOutreach}
  <LogOutreachModal
    sponsor={selectedSponsorForOutreach}
    open={true}
    onclose={() => (selectedSponsorForOutreach = null)}
  />
{/if}
