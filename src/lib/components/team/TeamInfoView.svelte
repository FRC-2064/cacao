<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { TeamInfoField } from '$lib/types';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import { Plus, Copy, Check, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '$lib/motion';

  const fields = $derived(cacao.orderedTeamInfo);
  const isAdmin = $derived(cacao.currentUser.role === 'admin');

  let editing = $state<TeamInfoField | null>(null);
  let isAdding = $state(false);
  let draftLabel = $state('');
  let draftValue = $state('');

  /**
   * Which row most recently went to the clipboard, so its button can confirm.
   * Cleared on a timer rather than on blur: the point of the tick is that it
   * is visible after the pointer has already moved on to the form being
   * filled in.
   */
  let copiedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(field: TeamInfoField) {
    try {
      await navigator.clipboard.writeText(field.value);
      copiedId = field._id;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedId = null), 1600);
    } catch {
      // Clipboard access is denied in some browsers and every insecure
      // context. Saying so beats a button that silently does nothing.
      cacao.showToast('Could not reach the clipboard — copy it by hand', 'error');
    }
  }

  function openAdd() {
    draftLabel = '';
    draftValue = '';
    isAdding = true;
  }

  function openEdit(field: TeamInfoField) {
    editing = field;
    draftLabel = field.label;
    draftValue = field.value;
  }

  function close() {
    isAdding = false;
    editing = null;
  }

  function save() {
    const label = draftLabel.trim();
    const value = draftValue.trim();
    if (!label || !value) return;

    if (editing) cacao.updateTeamInfoField(editing._id, label, value);
    else cacao.addTeamInfoField(label, value);
    close();
  }

  function remove(field: TeamInfoField) {
    if (!confirm(`Remove "${field.label}" from team info?`)) return;
    cacao.deleteTeamInfoField(field._id);
  }
</script>

<!-- PageHeader shows `stat` in preference to `description`, so only one is
     given: the count is on screen anyway, the explanation is not. -->
<PageHeader
  title="Team info"
  description="The details grant applications keep asking for. Copy them straight into a form."
>
  {#snippet actions()}
    <button
      type="button"
      class="btn btn-filled"
      disabled={!isAdmin}
      title={isAdmin ? undefined : 'Only admins can edit team info'}
      onclick={openAdd}
    >
      <Plus size={18} />
      <span>Add field</span>
    </button>
  {/snippet}
</PageHeader>

<div class="card-elevated divide-y" style="border-color: var(--color-outline-variant)">
  {#each fields as field, i (field._id)}
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:flex-nowrap"
      animate:flip={listItem.flip}
      in:fly={listItem.in}
      out:scale={listItem.out}
    >
      <div class="w-full min-w-0 sm:w-56 sm:shrink-0">
        <p class="type-label" style="color: var(--color-on-surface-variant)">{field.label}</p>
      </div>

      <p class="type-body min-w-0 flex-1 break-words">{field.value}</p>

      <div class="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="icon-btn icon-btn-sm"
          title={`Copy ${field.label}`}
          onclick={() => copy(field)}
        >
          {#if copiedId === field._id}
            <Check size={16} style="color: var(--color-success)" />
          {:else}
            <Copy size={16} />
          {/if}
        </button>

        {#if isAdmin}
          <button
            type="button"
            class="icon-btn icon-btn-sm"
            title="Move up"
            disabled={i === 0}
            onclick={() => cacao.moveTeamInfoField(field._id, -1)}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-sm"
            title="Move down"
            disabled={i === fields.length - 1}
            onclick={() => cacao.moveTeamInfoField(field._id, 1)}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-sm"
            title={`Edit ${field.label}`}
            onclick={() => openEdit(field)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-sm"
            title={`Remove ${field.label}`}
            onclick={() => remove(field)}
          >
            <Trash2 size={16} style="color: var(--color-error)" />
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <p class="type-body p-12 text-center" style="color: var(--color-on-surface-variant)">
      No team info yet. Add the EIN, address and anything else applications ask for.
    </p>
  {/each}
</div>

<M3Modal
  open={isAdding || editing !== null}
  title={editing ? `Edit ${editing.label}` : 'Add team info field'}
  description="A label and the value to paste into applications."
  maxWidth="md"
  onclose={close}
>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <M3Input label="Label" bind:value={draftLabel} required placeholder="501(c)(3) EIN" />
    <M3Input label="Value" bind:value={draftValue} required placeholder="06-0854923" />

    <div class="flex justify-end gap-2 pt-2">
      <button type="button" class="btn btn-text" onclick={close}>Cancel</button>
      <button type="submit" class="btn btn-filled" disabled={!draftLabel.trim() || !draftValue.trim()}>
        {editing ? 'Save' : 'Add field'}
      </button>
    </div>
  </form>
</M3Modal>
