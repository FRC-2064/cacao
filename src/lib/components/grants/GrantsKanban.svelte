<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import {
    GRANT_COLUMNS,
    TONE_VAR,
    TONE_CHIP,
    type Grant,
    type BoardGrantStatus
  } from '$lib/types';
  import GrantCard from './GrantCard.svelte';
  import { PageHeader } from '@frc2064/ui';
  import { Plus } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '@frc2064/ui/motion';

  interface Props {
    onselectgrant: (grant: Grant) => void;
    onaddgrantforstatus: (status: BoardGrantStatus) => void;
  }

  let { onselectgrant, onaddgrantforstatus }: Props = $props();

  let dragOverColumn = $state<BoardGrantStatus | null>(null);

  const filteredGrants = $derived.by(() => {
    return cacao.boardGrants.filter((g) => {
      if (cacao.selectedAssignee !== 'all') {
        if (g.assigneeId !== cacao.selectedAssignee) return false;
      }
      return true;
    });
  });

  function getGrantsForColumn(status: BoardGrantStatus): Grant[] {
    return filteredGrants.filter((g) => g.status === status).sort((a, b) => a.order - b.order);
  }

  function getColumnTotal(status: BoardGrantStatus): number {
    return getGrantsForColumn(status).reduce((sum, g) => sum + (g.amount || 0), 0);
  }

  const isViewer = $derived(cacao.currentUser.role === 'viewer');

  function handleDragOver(e: DragEvent, status: BoardGrantStatus) {
    if (isViewer) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverColumn = status;
  }

  function handleDragLeave(status: BoardGrantStatus) {
    if (dragOverColumn === status) dragOverColumn = null;
  }

  function handleDrop(e: DragEvent, targetStatus: BoardGrantStatus) {
    if (isViewer) return;
    e.preventDefault();
    dragOverColumn = null;
    const grantId = e.dataTransfer?.getData('text/plain');
    if (!grantId) return;
    cacao.updateGrantOrderAndStatus(grantId, targetStatus, getGrantsForColumn(targetStatus).length);
  }
</script>

<PageHeader title="Grants">
  {#snippet actions()}
    <select
      bind:value={cacao.selectedAssignee}
      aria-label="Filter by assignee"
      class="select-input select-inline"
    >
      <option value="all">All assignees</option>
      {#each cacao.users as u}
        <option value={u._id}>{u.displayName}</option>
      {/each}
    </select>

    <button
      type="button"
      class="btn btn-filled"
      disabled={isViewer}
      title={isViewer ? 'Viewer mode: editing is disabled' : undefined}
      onclick={() => onaddgrantforstatus('drafting')}
    >
      <Plus size={18} />
      <span>New grant</span>
    </button>
  {/snippet}
</PageHeader>

<!--
  A swipeable carousel while the columns cannot all fit, a plain grid once they
  can. Four columns at a fixed 19rem plus gaps need 1264px, but `max-w-7xl`
  caps the page at 1232px of content -- so the flex row overflowed by 32px at
  every window size, and no monitor was ever wide enough to clear it.
-->
<div class="flex snap-x gap-4 overflow-x-auto pb-8 lg:grid lg:grid-cols-4 lg:overflow-x-visible">
  {#each GRANT_COLUMNS as col}
    {@const columnGrants = getGrantsForColumn(col.id)}
    {@const columnTotal = getColumnTotal(col.id)}
    {@const isDragActive = dragOverColumn === col.id}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex w-[85vw] max-w-[19rem] flex-shrink-0 snap-start flex-col p-3 sm:w-[19rem] lg:w-auto lg:max-w-none"
      style={`border-radius: var(--shape-l); background: var(--color-surface-container-low); outline: 2px solid ${
        isDragActive ? 'var(--color-primary)' : 'transparent'
      }; outline-offset: -2px; transition: outline-color var(--dur-fast-effects) var(--ease-fast-effects);`}
      ondragover={(e) => handleDragOver(e, col.id)}
      ondragleave={() => handleDragLeave(col.id)}
      ondrop={(e) => handleDrop(e, col.id)}
    >
      <div class="mb-3 items-center justify-between gap-2 px-1 select-none">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="type-title truncate" title={col.description}>{col.title}</h2>
          <div class="flex-1 flex-fill"></div>
          <span class="chip chip-sm type-num">{columnGrants.length}</span>
        </div>
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
            <GrantCard {grant} onclick={() => onselectgrant(grant)} />
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
        disabled={isViewer}
        title={isViewer ? 'Viewer mode: editing is disabled' : undefined}
        onclick={() => onaddgrantforstatus(col.id)}
        class="btn btn-text btn-sm mt-2 w-full"
      >
        <Plus size={16} />
        <span>Add</span>
      </button>
    </div>
  {/each}
</div>
