<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { type Grant } from '$lib/types';
  import { initialsOf } from '@frc2064/ui';
  import { Calendar, FileText, ExternalLink, Check } from 'lucide-svelte';

  interface Props {
    grant: Grant;
    onclick: () => void;
  }

  let { grant, onclick }: Props = $props();

  const isViewer = $derived(cacao.currentUser.role === 'viewer');
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


  function handleDragStart(e: DragEvent) {
    if (isViewer) return;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', grant._id);
      e.dataTransfer.effectAllowed = 'move';
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  draggable={!isViewer}
  ondragstart={handleDragStart}
  tabindex={isViewer ? undefined : 0}
  role={isViewer ? undefined : 'button'}
  onclick={() => {
    if (!isViewer) onclick();
  }}
  onkeydown={(e) => {
    if (!isViewer && (e.key === 'Enter' || e.key === ' ')) onclick();
  }}
  class={`card-elevated p-4 text-left select-none ${isViewer ? '' : 'card-interactive'}`}
>
  <div class="mb-1">
    <span class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
      {grant.funder}
    </span>
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
          {initialsOf(grant.assigneeName)}
        </span>
      {/if}
    </div>
  </div>
</div>
