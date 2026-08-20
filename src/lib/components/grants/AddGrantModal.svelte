<script lang="ts">
  import type { GrantStatus, Priority, DeadlineType } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { Plus, X } from 'lucide-svelte';

  interface Props {
    open: boolean;
    initialStatus?: GrantStatus;
    onclose: () => void;
  }

  let { open = $bindable(false), initialStatus = 'drafting', onclose }: Props = $props();

  let title = $state('');
  let funder = $state('');
  let amount = $state<number>(1000);
  let status = $state<GrantStatus>('drafting');
  let priority = $state<Priority>('medium');
  let deadlineType = $state<DeadlineType>('fixed');
  let deadline = $state('');
  let deadlineNote = $state('');
  let assigneeName = $state(cacao.currentUser.name);
  let season = $state(cacao.selectedSeason || '2026-2027');
  let portalUrl = $state('');
  let docUrl = $state('');
  let notes = $state('');
  let requirements = $state<Array<{ id: string; title: string; done: boolean }>>([
    { id: 'req_1', title: '501(c)(3) tax-exempt documentation', done: false },
    { id: 'req_2', title: 'Team budget / expense itemization', done: false },
    { id: 'req_3', title: 'Essay / project description', done: false }
  ]);
  let newReqTitle = $state('');
  let formError = $state('');

  $effect(() => {
    if (open) status = initialStatus;
  });

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

  function handleSubmit() {
    if (!title.trim() || !funder.trim()) {
      formError = 'A grant name and funding organization are both required.';
      return;
    }
    formError = '';

    const assignedUser = cacao.users.find((u) => u.name === assigneeName);

    cacao.addGrant({
      title: title.trim(),
      funder: funder.trim(),
      amount: Number(amount) || 0,
      currency: 'USD',
      status,
      priority,
      deadlineType,
      deadline: deadlineType === 'fixed' ? deadline : undefined,
      deadlineNote: deadlineType !== 'fixed' ? deadlineNote : undefined,
      assigneeId: assignedUser?._id,
      assigneeName,
      season,
      portalUrl: portalUrl.trim() || undefined,
      docUrl: docUrl.trim() || undefined,
      requirements,
      notes: notes.trim() || undefined,
      order: 1000
    });

    title = '';
    funder = '';
    amount = 1000;
    docUrl = '';
    portalUrl = '';
    notes = '';
    onclose();
  }

  function addRequirement() {
    if (!newReqTitle.trim()) return;
    requirements = [
      ...requirements,
      { id: `req_${Date.now()}`, title: newReqTitle.trim(), done: false }
    ];
    newReqTitle = '';
  }

  function removeRequirement(id: string) {
    requirements = requirements.filter((r) => r.id !== id);
  }
</script>

<M3Modal
  bind:open
  {onclose}
  title="New grant"
  description="Add a funding opportunity to the team pipeline"
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
    class="space-y-4"
  >
    <M3Input
      label="Grant name"
      placeholder="e.g. Thomaston Savings Bank Foundation Grant"
      bind:value={title}
      required
    />

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Input
        label="Funder"
        placeholder="e.g. Thomaston Savings Bank"
        bind:value={funder}
        required
      />
      <M3Input label="Value ($)" type="number" bind:value={amount} required />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Select label="Status" bind:value={status} options={statusOptions} />
      <M3Select label="Priority" bind:value={priority} options={priorityOptions} />
    </div>

    <div class="panel grid gap-3 sm:grid-cols-2">
      <M3Select label="Schedule" bind:value={deadlineType} options={deadlineTypeOptions} />
      {#if deadlineType === 'fixed'}
        <M3Input label="Deadline" type="date" bind:value={deadline} />
      {:else}
        <M3Input label="Schedule note" placeholder="e.g. All year long" bind:value={deadlineNote} />
      {/if}
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Select label="Assignee" bind:value={assigneeName} options={assigneeOptions} />
      <M3Input label="Season" bind:value={season} placeholder="2026-2027" />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Input
        label="Draft doc URL"
        type="url"
        placeholder="https://docs.google.com/…"
        bind:value={docUrl}
      />
      <M3Input label="Portal URL" type="url" placeholder="https://…" bind:value={portalUrl} />
    </div>

    <div>
      <span class="field-label mb-2 block">Requirements checklist</span>
      <div class="mb-2 flex flex-wrap gap-1.5">
        {#each requirements as req (req.id)}
          <span class="chip">
            {req.title}
            <button
              type="button"
              onclick={() => removeRequirement(req.id)}
              class="-mr-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100"
              title={`Remove ${req.title}`}
            >
              <X size={13} />
            </button>
          </span>
        {/each}
      </div>

      <div class="flex gap-2">
        <input
          type="text"
          placeholder="Add a requirement…"
          bind:value={newReqTitle}
          aria-label="New requirement"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addRequirement();
            }
          }}
          class="text-input flex-1"
        />
        <button
          type="button"
          class="btn btn-tonal shrink-0"
          onclick={addRequirement}
          disabled={!newReqTitle.trim()}
        >
          Add
        </button>
      </div>
    </div>

    {#if formError}
      <p class="field-error" role="alert">{formError}</p>
    {/if}

    <div class="flex items-center justify-end gap-2 pt-2">
      <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn btn-filled">
        <Plus size={18} />
        <span>Create grant</span>
      </button>
    </div>
  </form>
</M3Modal>
