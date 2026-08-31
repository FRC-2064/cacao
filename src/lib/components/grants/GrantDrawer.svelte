<script lang="ts">
  import type { Grant, RequirementItem } from '$lib/types';
  import { cacao, type GrantEdit } from '$lib/stores/cacaoStore.svelte';
  import M3Drawer from '$lib/components/m3/M3Drawer.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { seasonIdOptions } from '$lib/components/finance/seasons';
  import { Check, Plus, Trash2, Save, Flag } from 'lucide-svelte';

  interface Props {
    grant: Grant | null;
    open: boolean;
    onclose: () => void;
    /** Raised so the layout can open the finish dialog over the drawer. */
    onfinish?: (grant: Grant) => void;
  }

  let { grant, open = $bindable(false), onclose, onfinish }: Props = $props();

  /**
   * The placeholder the drawer holds before a grant is handed to it. Both
   * season spellings are blank: `seasonId` is what the mutation takes and
   * `season` is the `YYYY-YYYY` label the ledger filters on, and inventing
   * either one here would file a grant under a season nobody chose.
   */
  const emptyGrant: GrantEdit = {
    _id: '',
    title: '',
    funder: '',
    amount: 0,
    currency: 'USD',
    status: 'drafting',
    deadlineType: 'fixed',
    priority: 'medium',
    seasonId: '',
    season: '',
    deadline: '',
    deadlineNote: '',
    assigneeId: '',
    docUrl: '',
    portalUrl: '',
    notes: '',
    requirements: [],
    order: 0,
    updatedAt: 0
  };

  let draft = $state<GrantEdit>({ ...emptyGrant });
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
      // The assignee picker rides on the id, which `grants.list` emits beside
      // the resolved name for signed-in members only. A stranger gets neither
      // and sees an unassigned-looking picker, which is the whole point of
      // withholding it -- but a stranger cannot save from here either.
      assigneeId: copy.assigneeId ?? '',
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

  /**
   * Pipeline stages only. An outcome is not something you pick from a dropdown
   * -- recording an award also has to create the deposit -- so it goes through
   * "Finish grant" instead.
   */
  const statusOptions = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'drafting', label: 'Drafting' },
    { value: 'awaiting_approval', label: 'Awaiting mentor review' },
    { value: 'submitted', label: 'Submitted' }
  ];


  const deadlineTypeOptions = [
    { value: 'fixed', label: 'Specific target date' },
    { value: 'rolling', label: 'Rolling (all year long)' },
    { value: 'tbd', label: 'TBD after season ends' }
  ];

  const assigneeOptions = $derived([
    { value: '', label: 'Unassigned' },
    ...cacao.users.map((u) => ({ value: u._id, label: u.displayName }))
  ]);

  const seasonOptions = $derived(seasonIdOptions(cacao.seasons));

  const doneCount = $derived(draft.requirements.filter((r) => r.done).length);

  function handleSave() {
    if (!draft._id) return;
    cacao.updateGrant({
      ...draft,
      deadline: draft.deadlineType === 'fixed' ? blankToUndefined(draft.deadline) : undefined,
      deadlineNote: draft.deadlineType === 'fixed' ? undefined : blankToUndefined(draft.deadlineNote),
      assigneeId: blankToUndefined(draft.assigneeId),
      // Kept in step with the id the picker just set, so the card behind the
      // drawer does not go on showing the previous assignee until the next
      // snapshot lands. The server resolves the authoritative value.
      assigneeName: cacao.users.find((u) => u._id === draft.assigneeId)?.displayName,
      season: cacao.seasons.find((s) => s._id === draft.seasonId)?.label ?? draft.season,
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

{#if grant && draft._id && cacao.currentUser.role !== 'viewer'}
  <M3Drawer
    bind:open
    {onclose}
    title={draft.title || 'Grant details'}
    description={`${draft.funder} · Season ${draft.season}`}
  >
    {#snippet children()}
      <div class="panel">
        <M3Select label="Status" bind:value={draft.status} options={statusOptions} />
      </div>

      <div class="space-y-3">
        <M3Input
          label="Name"
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
        <M3Select label="Assignee" bind:value={draft.assigneeId} options={assigneeOptions} />
        <M3Select label="Season" bind:value={draft.seasonId} options={seasonOptions} />
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
      <button type="button" class="btn btn-tonal" onclick={() => onfinish?.(grant)}>
        <Flag size={18} />
        <span>Finish grant</span>
      </button>

      <button type="button" class="btn btn-filled" onclick={handleSave}>
        <Save size={18} />
        <span>Save</span>
      </button>
    {/snippet}
  </M3Drawer>
{/if}
