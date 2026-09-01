<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { GRANT_STATUS_META, TONE_CHIP, type Grant } from '$lib/types';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import { Download, ExternalLink, FileText, ChevronUp, ChevronDown, Plus } from 'lucide-svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem, listRow } from '@frc2064/ui/motion';

  interface Props {
    onselectgrant: (grant: Grant) => void;
    onaddgrant: () => void;
  }

  let { onselectgrant, onaddgrant }: Props = $props();

  let sortField = $state<keyof Grant>('amount');
  let sortAsc = $state(false);

  const columns: { field: keyof Grant; label: string; align?: string }[] = [
    { field: 'title', label: 'Name' },
    { field: 'funder', label: 'Funder' },
    { field: 'amount', label: 'Amount' },
    { field: 'status', label: 'Status' },
    { field: 'deadline', label: 'Deadline' },
    { field: 'assigneeName', label: 'Assignee' }
  ];

  const sortedGrants = $derived.by(() => {
    // Finished grants live in the Archive view; mixing them in here would put
    // closed work alongside live work by default.
    let list = [...cacao.boardGrants];

    if (cacao.selectedAssignee !== 'all') {
      list = list.filter((g) => g.assigneeId === cacao.selectedAssignee);
    }

    list.sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      return sortAsc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

    return list;
  });

  function toggleSort(field: keyof Grant) {
    if (sortField === field) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = true;
    }
  }

  function exportCSV() {
    const headers = [
      'Title',
      'Funder',
      'Amount',
      'Status',
      'Deadline',
      'Assignee',
      'Season',
      'Doc URL',
      'Portal URL'
    ];
    const rows = sortedGrants.map((g) => [
      `"${g.title.replace(/"/g, '""')}"`,
      `"${g.funder.replace(/"/g, '""')}"`,
      g.amount,
      g.status,
      `"${g.deadline || g.deadlineNote || ''}"`,
      `"${g.assigneeName || ''}"`,
      g.season,
      `"${g.docUrl || ''}"`,
      `"${g.portalUrl || ''}"`
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `2064_Grants_${cacao.selectedSeason}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    cacao.showToast('Grants exported to CSV');
  }

  const isViewer = $derived(cacao.currentUser.role === 'viewer');
</script>

<PageHeader
  title="Grants List">
  {#snippet actions()}
    <button type="button" class="btn btn-outlined" onclick={exportCSV}>
      <Download size={18} />
      <span>Export CSV</span>
    </button>
    <button
      type="button"
      class="btn btn-filled"
      disabled={isViewer}
      title={isViewer ? 'Viewer mode: editing is disabled' : undefined}
      onclick={onaddgrant}
    >
      <Plus size={18} />
      <span>New grant</span>
    </button>
  {/snippet}
</PageHeader>

<!-- Narrow screens: an eight-column table forced horizontal scrolling, so it
     becomes a card list and the header row's sorting moves into a select. -->
<div class="mb-4 flex items-center gap-2 md:hidden">
  <select class="select-input flex-1" bind:value={sortField} aria-label="Sort grants by">
    {#each columns as col}
      <option value={col.field}>{col.label}</option>
    {/each}
  </select>
  <button
    type="button"
    class="icon-btn"
    onclick={() => (sortAsc = !sortAsc)}
    title={sortAsc ? 'Sort descending' : 'Sort ascending'}
  >
    {#if sortAsc}
      <ChevronUp size={20} />
    {:else}
      <ChevronDown size={20} />
    {/if}
  </button>
</div>

<div class="space-y-3 md:hidden">
  {#each sortedGrants as grant (grant._id)}
    {@const completedReqs = grant.requirements.filter((r) => r.done).length}
    {@const totalReqs = grant.requirements.length}
    {@const meta = GRANT_STATUS_META[grant.status]}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex -->
    <div
      class={`card-elevated p-4 ${isViewer ? '' : 'card-interactive'}`}
      animate:flip={listItem.flip}
      in:fly={listItem.in}
      out:scale={listItem.out}
      role={isViewer ? undefined : 'button'}
      tabindex={isViewer ? undefined : 0}
      onclick={() => {
        if (!isViewer) onselectgrant(grant);
      }}
      onkeydown={(e) => {
        if (!isViewer && (e.key === 'Enter' || e.key === ' ')) onselectgrant(grant);
      }}
    >
      <div class="mb-1 flex items-start justify-between gap-2">
        <span class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
          {grant.funder}
        </span>
        <span class="chip chip-sm shrink-0">{meta.label}</span>
      </div>

      <h3 class="type-title mb-1 line-clamp-2">{grant.title}</h3>
      <p class="type-title-lg type-num mb-3">${grant.amount.toLocaleString()}</p>

      <dl class="type-label-sm grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div class="flex justify-between gap-2">
          <dt style="color: var(--color-on-surface-variant)">Deadline</dt>
          <dd class="type-num truncate">
            {#if grant.deadlineType === 'rolling'}
              Rolling
            {:else if grant.deadlineType === 'tbd'}
              TBD
            {:else}
              {grant.deadline || '—'}
            {/if}
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt style="color: var(--color-on-surface-variant)">Reqs</dt>
          <dd class="type-num">{totalReqs > 0 ? `${completedReqs}/${totalReqs}` : '—'}</dd>
        </div>
        <div class="col-span-2 flex justify-between gap-2">
          <dt style="color: var(--color-on-surface-variant)">Assignee</dt>
          <dd class="truncate">{grant.assigneeName || '—'}</dd>
        </div>
      </dl>

      {#if grant.docUrl || grant.portalUrl}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div
          class="mt-3 flex items-center justify-end gap-1"
          onclick={(e) => e.stopPropagation()}
        >
          {#if grant.docUrl}
            <a
              href={grant.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-text btn-sm"
            >
              <FileText size={16} />
              <span>Draft</span>
            </a>
          {/if}
          {#if grant.portalUrl}
            <a
              href={grant.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-text btn-sm"
            >
              <ExternalLink size={16} />
              <span>Portal</span>
            </a>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if sortedGrants.length === 0}
    <p class="type-body py-12 text-center" style="color: var(--color-on-surface-variant)">
      No grants match the current filter.
    </p>
  {/if}
</div>

<div class="card-elevated hidden overflow-hidden md:block">
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          {#each columns as col}
            <th
              class="sortable"
              aria-sort={sortField === col.field ? (sortAsc ? 'ascending' : 'descending') : 'none'}
              onclick={() => toggleSort(col.field)}
            >
              <span class="flex items-center gap-1">
                {col.label}
                {#if sortField === col.field}
                  {#if sortAsc}
                    <ChevronUp size={14} />
                  {:else}
                    <ChevronDown size={14} />
                  {/if}
                {/if}
              </span>
            </th>
          {/each}
          <th class="text-center">Reqs</th>
          <th class="text-right">Links</th>
        </tr>
      </thead>
      <tbody>
        {#each sortedGrants as grant (grant._id)}
          {@const completedReqs = grant.requirements.filter((r) => r.done).length}
          {@const totalReqs = grant.requirements.length}
          {@const meta = GRANT_STATUS_META[grant.status]}
          <tr
            class={isViewer ? '' : 'row-interactive'}
            animate:flip={listRow.flip}
            in:fade={listRow.in}
            out:fade={listRow.out}
            onclick={() => {
              if (!isViewer) onselectgrant(grant);
            }}
          >
            <td class="type-label max-w-xs truncate">{grant.title}</td>
            <td style="color: var(--color-on-surface-variant)">{grant.funder}</td>
            <td class="type-num type-label">${grant.amount.toLocaleString()}</td>
            <td>
              <span class="chip chip-sm">{meta.label}</span>
            </td>
            <td style="color: var(--color-on-surface-variant)">
              {#if grant.deadlineType === 'rolling'}
                Rolling
              {:else if grant.deadlineType === 'tbd'}
                TBD
              {:else}
                <span class="type-num">{grant.deadline || '—'}</span>
              {/if}
            </td>
            <td style="color: var(--color-on-surface-variant)">{grant.assigneeName || '—'}</td>
            <td class="type-num text-center" style="color: var(--color-on-surface-variant)">
              {totalReqs > 0 ? `${completedReqs}/${totalReqs}` : '—'}
            </td>
            <td>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="flex items-center justify-end gap-0.5"
                onclick={(e) => e.stopPropagation()}
              >
                {#if grant.docUrl}
                  <a
                    href={grant.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="icon-btn icon-btn-sm"
                    title="Draft doc"
                  >
                    <FileText size={16} />
                  </a>
                {/if}
                {#if grant.portalUrl}
                  <a
                    href={grant.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="icon-btn icon-btn-sm"
                    title="Application portal"
                  >
                    <ExternalLink size={16} />
                  </a>
                {/if}
              </div>
            </td>
          </tr>
        {/each}

        {#if sortedGrants.length === 0}
          <tr>
            <td colspan="8" class="py-12 text-center" style="color: var(--color-on-surface-variant)">
              No grants match the current filter.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
