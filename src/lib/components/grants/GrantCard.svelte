<script lang="ts">
  import { GRANT_COLUMNS, type Grant, type GrantStatus } from '$lib/types';
  import { Calendar, FileText, ExternalLink, Check } from 'lucide-svelte';

  interface Props {
    grant: Grant;
    onclick: () => void;
    /**
     * Touch fallback for drag-and-drop. HTML5 drag events never fire from
     * touch input on iOS Safari or Android Chrome, so on a phone the board
     * was read-only until this landed.
     */
    onmove?: (status: GrantStatus) => void;
  }

  let { grant, onclick, onmove }: Props = $props();

  const completedReqs = $derived(grant.requirements.filter((r) => r.done).length);
  const totalReqs = $derived(grant.requirements.length);
  const progressPct = $derived(totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 100);
  const allDone = $derived(totalReqs > 0 && completedReqs === totalReqs);

  const deadlineInfo = $derived.by(() => {
    if (grant.deadlineType === 'rolling') return { label: 'Rolling', urgent: false };
    if (grant.deadlineType === 'tbd') return { label: 'Date TBD', urgent: false };
    if (!grant.deadline) return { label: 'No deadline', urgent: false };

    const diffDays = Math.ceil((new Date(grant.deadline).getTime() - Date.now()) / 86400000);
    if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, urgent: true };
    if (diffDays <= 7) return { label: `Due in ${diffDays}d`, urgent: true };
    return { label: grant.deadline, urgent: false };
  });

  const showPriority = $derived(grant.priority === 'urgent' || grant.priority === 'high');

  function handleDragStart(e: DragEvent) {
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', grant._id);
      e.dataTransfer.effectAllowed = 'move';
    }
  }
</script>

<div
  draggable="true"
  ondragstart={handleDragStart}
  tabindex="0"
  role="button"
  {onclick}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onclick()}
  class="card-elevated card-interactive p-4 text-left select-none"
>
  <div class="mb-1 flex items-start justify-between gap-2">
    <span class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
      {grant.funder}
    </span>
    {#if showPriority}
      <span class="chip chip-sm chip-error shrink-0 capitalize">{grant.priority}</span>
    {/if}
  </div>

  <h3 class="type-title mb-2 line-clamp-2">{grant.title}</h3>

  <p class="type-title-lg type-num mb-3">${grant.amount.toLocaleString()}</p>

  {#if totalReqs > 0}
    <div class="mb-3">
      <div class="type-label-sm mb-1.5 flex items-center justify-between">
        <span style="color: var(--color-on-surface-variant)">Requirements</span>
        <span class="type-num" style="color: var(--color-on-surface-variant)">
          {completedReqs}/{totalReqs}
        </span>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Requirements complete"
      >
        <span
          class="progress-bar"
          style={`width: ${progressPct}%; background: ${allDone ? 'var(--color-success)' : 'var(--color-primary)'}`}
        ></span>
      </div>
    </div>
  {/if}

  {#if onmove}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="touch-only mb-3" onclick={(e) => e.stopPropagation()}>
      <select
        class="card-move-select"
        aria-label={`Move ${grant.title} to another column`}
        value={grant.status}
        onchange={(e) => onmove?.(e.currentTarget.value as GrantStatus)}
      >
        {#each GRANT_COLUMNS as col}
          <option value={col.id}>{col.title}</option>
        {/each}
      </select>
    </div>
  {/if}

  <div class="flex items-center justify-between gap-2">
    <span class={`chip chip-sm ${deadlineInfo.urgent ? 'chip-error' : ''}`}>
      {#if allDone && !deadlineInfo.urgent}
        <Check size={13} />
      {:else}
        <Calendar size={13} />
      {/if}
      <span>{deadlineInfo.label}</span>
    </span>

    <div class="flex shrink-0 items-center gap-0.5">
      {#if grant.docUrl}
        <a
          href={grant.docUrl}
          target="_blank"
          rel="noopener noreferrer"
          onclick={(e) => e.stopPropagation()}
          title="Open draft doc"
          class="icon-btn icon-btn-sm"
        >
          <FileText size={16} />
        </a>
      {/if}

      {#if grant.portalUrl}
        <a
          href={grant.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          onclick={(e) => e.stopPropagation()}
          title="Open submission portal"
          class="icon-btn icon-btn-sm"
        >
          <ExternalLink size={16} />
        </a>
      {/if}

      {#if grant.assigneeName}
        <span
          title={`Assigned to ${grant.assigneeName}`}
          class="type-label-sm ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full"
          style="background: var(--color-secondary-container); color: var(--color-on-secondary-container)"
        >
          {grant.assigneeName.charAt(0)}
        </span>
      {/if}
    </div>
  </div>
</div>
