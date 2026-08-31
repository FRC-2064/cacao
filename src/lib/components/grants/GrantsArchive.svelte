<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import {
    GRANT_OUTCOMES,
    GRANT_OUTCOME_META,
    TONE_CHIP,
    type Grant,
    type GrantOutcome
  } from '$lib/types';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import { formatDay } from '$lib/finance/dates';
  import { Undo2, ExternalLink } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '$lib/motion';

  interface Props {
    onselectgrant: (grant: Grant) => void;
  }

  let { onselectgrant }: Props = $props();

  const isViewer = $derived(cacao.currentUser.role === 'viewer');
  const archived = $derived(cacao.archivedGrants);

  const byOutcome = $derived(
    GRANT_OUTCOMES.map((outcome) => ({
      outcome,
      meta: GRANT_OUTCOME_META[outcome],
      grants: archived.filter((g) => g.status === outcome)
    })).filter((group) => group.grants.length > 0)
  );

  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

  async function reopen(e: MouseEvent, grant: Grant) {
    e.stopPropagation();
    if (
      !confirm(
        `Put "${grant.title}" back on the board?` +
          (grant.linkedDepositId
            ? '\n\nThe deposit this award created stays on the Money tab. Remove it there if it was wrong.'
            : '')
      )
    )
      return;
    await cacao.reopenGrant(grant._id);
  }
</script>

<PageHeader
  title="Archive"
  stat={`${archived.length} finished · ${usd(cacao.totalAwarded)} awarded`}
/>

{#if archived.length === 0}
  <p class="type-body card-elevated p-12 text-center" style="color: var(--color-on-surface-variant)">
    Nothing finished yet. Use <strong>Finish grant</strong> on a card once you hear back from a funder.
  </p>
{:else}
  <div class="space-y-8">
    {#each byOutcome as group (group.outcome)}
      {@const total = group.grants.reduce((sum, g) => sum + (g.awardedAmount ?? 0), 0)}
      <section class="space-y-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="type-title flex items-center gap-2">
            <span class={`chip ${TONE_CHIP[group.meta.tone]}`}>{group.meta.label}</span>
            <span class="type-label-sm" style="color: var(--color-on-surface-variant)">
              {group.grants.length}
            </span>
          </h2>
          {#if group.outcome === 'awarded'}
            <p class="type-title type-num" style="color: var(--color-success)">{usd(total)}</p>
          {/if}
        </div>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each group.grants as grant (grant._id)}
            <div
              class="card-elevated row-interactive flex flex-col gap-2 p-4"
              animate:flip={listItem.flip}
              in:fly={listItem.in}
              out:scale={listItem.out}
              onclick={() => onselectgrant(grant)}
              onkeydown={(e) => e.key === 'Enter' && onselectgrant(grant)}
              role="button"
              tabindex="0"
            >
              <div class="flex items-start justify-between gap-2">
                <h3 class="type-label min-w-0 leading-tight">{grant.title}</h3>
                {#if grant.awardedAmount !== undefined}
                  <span class="type-num type-label shrink-0" style="color: var(--color-success)">
                    {usd(grant.awardedAmount)}
                  </span>
                {/if}
              </div>

              <p class="type-body-sm truncate" style="color: var(--color-on-surface-variant)">
                {grant.funder}
              </p>

              <div class="type-label-sm mt-auto flex items-center justify-between gap-2 pt-1">
                <span style="color: var(--color-on-surface-variant)">
                  {#if grant.awardedDate}
                    Received {formatDay(grant.awardedDate)}
                  {:else if grant.finishedAt}
                    {formatDay(new Date(grant.finishedAt).toISOString().slice(0, 10))}
                  {/if}
                </span>

                <div class="flex shrink-0 items-center gap-1">
                  {#if grant.linkedDepositId}
                    <a
                      href="/money"
                      class="btn btn-text btn-sm"
                      title="This award is recorded as a deposit"
                      onclick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={14} />
                      <span>Deposit</span>
                    </a>
                  {/if}
                  {#if !isViewer}
                    <button
                      type="button"
                      class="icon-btn icon-btn-sm"
                      title="Put back on the board"
                      onclick={(e) => reopen(e, grant)}
                    >
                      <Undo2 size={16} />
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}
