<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { GRANT_COLUMNS, TONE_VAR, TONE_CHIP, type Grant, type GrantStatus } from '$lib/types';
  import GrantCard from './GrantCard.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import { Plus } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '$lib/motion';

  interface Props {
    onselectgrant: (grant: Grant) => void;
    onaddgrantforstatus: (status: GrantStatus) => void;
  }

  let { onselectgrant, onaddgrantforstatus }: Props = $props();

  let dragOverColumn = $state<GrantStatus | null>(null);

  const filteredGrants = $derived.by(() => {
    return cacao.grants.filter((g) => {
      if (cacao.selectedAssignee !== 'all') {
        if (g.assigneeId !== cacao.selectedAssignee) return false;
      }
      if (cacao.searchQuery.trim()) {
        const query = cacao.searchQuery.toLowerCase();
        const matchesTitle = g.title.toLowerCase().includes(query);
        const matchesFunder = g.funder.toLowerCase().includes(query);
        const matchesNotes = g.notes?.toLowerCase().includes(query);
        const matchesAssignee = g.assigneeName?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesFunder && !matchesNotes && !matchesAssignee) {
          return false;
        }
      }
      return true;
    });
  });

  function getGrantsForColumn(status: GrantStatus): Grant[] {
    return filteredGrants.filter((g) => g.status === status).sort((a, b) => a.order - b.order);
  }

  function getColumnTotal(status: GrantStatus): number {
    return getGrantsForColumn(status).reduce((sum, g) => sum + (g.amount || 0), 0);
  }

  function handleDragOver(e: DragEvent, status: GrantStatus) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverColumn = status;
  }

  function handleDragLeave(status: GrantStatus) {
    if (dragOverColumn === status) dragOverColumn = null;
  }

  function handleDrop(e: DragEvent, targetStatus: GrantStatus) {
    e.preventDefault();
    dragOverColumn = null;
    const grantId = e.dataTransfer?.getData('text/plain');
    if (!grantId) return;
    cacao.updateGrantOrderAndStatus(grantId, targetStatus, getGrantsForColumn(targetStatus).length);
  }
</script>

<PageHeader
  title="Grants Pipeline"
  stat={`$${cacao.metrics.totalPotential.toLocaleString()} tracked across ${filteredGrants.length} ${filteredGrants.length === 1 ? 'grant' : 'grants'}`}
>
  {#snippet actions()}
    <select
      bind:value={cacao.selectedAssignee}
      aria-label="Filter by assignee"
      class="select-input select-inline"
    >
      <option value="all">All assignees</option>
      {#each cacao.users as u}
        <option value={u._id}>{u.name}</option>
      {/each}
    </select>

    <button type="button" class="btn btn-filled" onclick={() => onaddgrantforstatus('drafting')}>
      <Plus size={18} />
      <span>New grant</span>
    </button>
  {/snippet}
</PageHeader>

<div class="flex snap-x gap-4 overflow-x-auto pb-8">
  {#each GRANT_COLUMNS as col}
    {@const columnGrants = getGrantsForColumn(col.id)}
    {@const columnTotal = getColumnTotal(col.id)}
    {@const isDragActive = dragOverColumn === col.id}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex w-[85vw] max-w-[19rem] flex-shrink-0 snap-start flex-col p-3 sm:w-[19rem]"
      style={`border-radius: var(--shape-l); background: var(--color-surface-container-low); outline: 2px solid ${
        isDragActive ? 'var(--color-primary)' : 'transparent'
      }; outline-offset: -2px; transition: outline-color var(--dur-fast-effects) var(--ease-fast-effects);`}
      ondragover={(e) => handleDragOver(e, col.id)}
      ondragleave={() => handleDragLeave(col.id)}
      ondrop={(e) => handleDrop(e, col.id)}
    >
      <div class="mb-3 flex items-center justify-between gap-2 px-1 select-none">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            style={`background: ${TONE_VAR[col.tone]}`}
          ></span>
          <h2 class="type-title truncate" title={col.description}>{col.title}</h2>
          <span class={`chip chip-sm type-num ${TONE_CHIP[col.tone]}`}>{columnGrants.length}</span>
        </div>

        {#if columnTotal > 0}
          <span class="type-label-sm type-num shrink-0" style="color: var(--color-on-surface-variant)">
            ${columnTotal.toLocaleString()}
          </span>
        {/if}
      </div>

      <div class="min-h-24 flex-1 space-y-2.5 p-0.5 md:overflow-y-auto">
        <!--
          `animate:flip` needs a real element, and directives cannot be put on a
          component, so each card gets a wrapper. `space-y-2.5` on the parent
          spaces these wrappers exactly as it spaced the cards.

          A card moving between columns is a leave here and an enter there, not
          one continuous flight. `crossfade` would give it that flight, but the
          column list is `overflow-y-auto` and the board itself is
          `overflow-x-auto`, so a card travelling between them gets clipped by
          both — it would vanish mid-air. Leaving and arriving separately is the
          honest version of the motion in a scroll container.
        -->
        {#each columnGrants as grant (grant._id)}
          <div animate:flip={listItem.flip} in:fly={listItem.in} out:scale={listItem.out}>
            <GrantCard
              {grant}
              onclick={() => onselectgrant(grant)}
              onmove={(status) =>
                cacao.updateGrantOrderAndStatus(
                  grant._id,
                  status,
                  getGrantsForColumn(status).length
                )}
            />
          </div>
        {/each}

        {#if columnGrants.length === 0}
          <p class="type-body px-4 py-8 text-center" style="color: var(--color-on-surface-variant)">
            Nothing here yet
          </p>
        {/if}
      </div>

      <button
        type="button"
        onclick={() => onaddgrantforstatus(col.id)}
        class="btn btn-text btn-sm mt-2 w-full"
      >
        <Plus size={16} />
        <span>Add</span>
      </button>
    </div>
  {/each}
</div>
