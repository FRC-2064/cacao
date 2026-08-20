<script lang="ts">
  import type { Grant, RequirementItem } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Drawer from '$lib/components/m3/M3Drawer.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { Check, Plus, Trash2, Save } from 'lucide-svelte';

  interface Props {
    grant: Grant | null;
    open: boolean;
    onclose: () => void;
  }

  let { grant, open = $bindable(false), onclose }: Props = $props();

  const emptyGrant: Grant = {
    _id: '',
    title: '',
    funder: '',
    amount: 0,
    currency: 'USD',
    status: 'drafting',
    deadlineType: 'fixed',
    priority: 'medium',
    season: '2026-2027',
    deadline: '',
    deadlineNote: '',
    assigneeName: '',
    docUrl: '',
    portalUrl: '',
    notes: '',
    requirements: [],
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    lastModifiedBy: ''
  };

  let draft = $state<Grant>({ ...emptyGrant });
  let newRequirementInput = $state('');

  /**
   * Optional string fields arrive as `undefined`, but the form inputs bind to
   * props that declare a `''` fallback — Svelte rejects binding undefined to
   * those. So the editor works on a fully-populated copy, and `handleSave`
   * converts empty strings back to undefined on the way out.
   */
  $effect(() => {
    if (!grant) return;
    const copy: Grant = JSON.parse(JSON.stringify(grant));
    draft = {
      ...copy,
      deadline: copy.deadline ?? '',
      deadlineNote: copy.deadlineNote ?? '',
      assigneeName: copy.assigneeName ?? '',
      docUrl: copy.docUrl ?? '',
      portalUrl: copy.portalUrl ?? '',
      notes: copy.notes ?? ''
    };
  });

  /** Empty string means "not set" for every optional field on a Grant. */
  function blankToUndefined(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  const statusOptions = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'drafting', label: 'Drafting' },
    { value: 'awaiting_approval', label: 'Awaiting mentor review' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'awarded', label: 'Awarded' },
    { value: 'rejected', label: 'Closed / declined' }
  ];

  const priorityOptions = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' }
  ];

  const deadlineTypeOptions = [
    { value: 'fixed', label: 'Specific target date' },
    { value: 'rolling', label: 'Rolling (all year long)' },
    { value: 'tbd', label: 'TBD after season ends' }
  ];

  const assigneeOptions = $derived([
    { value: '', label: 'Unassigned' },
    ...cacao.users.map((u) => ({ value: u.name, label: u.name }))
  ]);

  const doneCount = $derived(draft.requirements.filter((r) => r.done).length);

  function handleSave() {
    if (!draft._id) return;
    const assignee = cacao.users.find((u) => u.name === draft.assigneeName);
    cacao.updateGrant({
      ...draft,
      deadline: draft.deadlineType === 'fixed' ? blankToUndefined(draft.deadline) : undefined,
      deadlineNote: draft.deadlineType === 'fixed' ? undefined : blankToUndefined(draft.deadlineNote),
      assigneeId: assignee?._id,
      assigneeName: blankToUndefined(draft.assigneeName),
      docUrl: blankToUndefined(draft.docUrl),
      portalUrl: blankToUndefined(draft.portalUrl),
      notes: blankToUndefined(draft.notes)
    });
    onclose();
  }

  function handleDelete() {
    if (!draft._id) return;
    if (confirm(`Delete "${draft.title}"? This cannot be undone.`)) {
      cacao.deleteGrant(draft._id);
      onclose();
    }
  }

  function handleAddRequirement() {
    if (!newRequirementInput.trim()) return;
    const newReq: RequirementItem = {
      id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      title: newRequirementInput.trim(),
      done: false
    };
    draft.requirements = [...draft.requirements, newReq];
    newRequirementInput = '';
  }

  function handleToggleReq(id: string) {
    draft.requirements = draft.requirements.map((r) =>
      r.id === id ? { ...r, done: !r.done } : r
    );
  }

  function handleRemoveReq(id: string) {
    draft.requirements = draft.requirements.filter((r) => r.id !== id);
  }
</script>

{#if grant && draft._id}
  <M3Drawer
    bind:open
    {onclose}
    title={draft.title || 'Grant details'}
    description={`${draft.funder} · Season ${draft.season}`}
  >
    {#snippet children()}
      <div class="panel grid gap-3 sm:grid-cols-2">
        <M3Select label="Status" bind:value={draft.status} options={statusOptions} />
        <M3Select label="Priority" bind:value={draft.priority} options={priorityOptions} />
      </div>

      <div class="space-y-3">
        <M3Input
          label="Opportunity name"
          placeholder="e.g. Thomaston Savings Bank Foundation Grant"
          bind:value={draft.title}
          required
        />
        <div class="grid gap-3 sm:grid-cols-2">
          <M3Input
            label="Funding organization"
            placeholder="e.g. Thomaston Savings Bank"
            bind:value={draft.funder}
            required
          />
          <M3Input label="Grant value ($)" type="number" bind:value={draft.amount} required />
        </div>
      </div>

      <div class="panel">
        <span class="panel-title">Deadline schedule</span>
        <div class="grid gap-3 sm:grid-cols-2">
          <M3Select
            label="Schedule type"
            bind:value={draft.deadlineType}
            options={deadlineTypeOptions}
          />
          {#if draft.deadlineType === 'fixed'}
            <M3Input label="Target date" type="date" bind:value={draft.deadline} />
          {:else}
            <M3Input
              label="Schedule note"
              placeholder="e.g. All year long"
              bind:value={draft.deadlineNote}
            />
          {/if}
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <M3Select label="Assignee" bind:value={draft.assigneeName} options={assigneeOptions} />
        <M3Input label="Season" bind:value={draft.season} placeholder="2026-2027" />
      </div>

      <div class="panel">
        <span class="panel-title">External links</span>
        <div class="space-y-3">
          <M3Input
            label="Draft doc URL"
            type="url"
            placeholder="https://docs.google.com/…"
            bind:value={draft.docUrl}
          />
          <M3Input
            label="Application portal"
            type="url"
            placeholder="https://…"
            bind:value={draft.portalUrl}
          />
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-baseline justify-between">
          <span class="field-label">Requirements</span>
          <span class="type-label-sm type-num" style="color: var(--color-on-surface-variant)">
            {doneCount}/{draft.requirements.length} done
          </span>
        </div>

        <div class="space-y-1">
          {#each draft.requirements as req (req.id)}
            <div class="group flex items-center gap-1">
              <button
                type="button"
                class="list-row flex-1"
                aria-pressed={req.done}
                onclick={() => handleToggleReq(req.id)}
              >
                <span
                  class="grid h-5 w-5 shrink-0 place-items-center"
                  style={`border-radius: var(--shape-xs); ${
                    req.done
                      ? 'background: var(--color-primary); color: var(--color-on-primary);'
                      : 'border: 2px solid var(--color-outline);'
                  }`}
                >
                  {#if req.done}<Check size={14} />{/if}
                </span>
                <span class={req.done ? 'line-through opacity-60' : ''}>{req.title}</span>
              </button>

              <button
                type="button"
                onclick={() => handleRemoveReq(req.id)}
                class="icon-btn icon-btn-sm shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                title="Remove requirement"
              >
                <Trash2 size={16} />
              </button>
            </div>
          {/each}

          <form
            onsubmit={(e) => {
              e.preventDefault();
              handleAddRequirement();
            }}
            class="flex gap-2 pt-2"
          >
            <input
              type="text"
              placeholder="Add a requirement…"
              bind:value={newRequirementInput}
              aria-label="New requirement"
              class="text-input flex-1"
            />
            <button
              type="submit"
              class="btn btn-tonal shrink-0"
              disabled={!newRequirementInput.trim()}
            >
              <Plus size={18} />
              <span>Add</span>
            </button>
          </form>
        </div>
      </div>

      <div class="field">
        <label for="drawer_notes_text" class="field-label">Team notes</label>
        <textarea
          id="drawer_notes_text"
          bind:value={draft.notes}
          rows={3}
          placeholder="Key tips for the application…"
          class="textarea-input"
        ></textarea>
      </div>
    {/snippet}

    {#snippet footer()}
      <button type="button" onclick={handleDelete} class="btn btn-text mr-auto" style="color: var(--color-error)">
        Delete
      </button>
      <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
      <button type="button" class="btn btn-filled" onclick={handleSave}>
        <Save size={18} />
        <span>Save</span>
      </button>
    {/snippet}
  </M3Drawer>
{/if}
