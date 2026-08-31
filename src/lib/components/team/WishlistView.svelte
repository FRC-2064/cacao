<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { WISHLIST_SOURCE_META, TONE_CHIP, type WishlistItem, type WishlistSource } from '$lib/types';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { Plus, Pencil, Trash2, ExternalLink } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '$lib/motion';

  const items = $derived(cacao.orderedWishlist);
  const isViewer = $derived(cacao.currentUser.role === 'viewer');

  let editing = $state<WishlistItem | null>(null);
  let isAdding = $state(false);

  let tool = $state('');
  let company = $state('');
  let cost = $state<string | number>('');
  let source = $state<WishlistSource>('grant');
  let priority = $state<string | number>(5);
  let description = $state('');
  let itemLink = $state('');

  const sourceOptions = [
    { value: 'grant', label: 'Grant funded' },
    { value: 'purchase', label: 'Direct purchase' }
  ];

  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

  function openAdd() {
    tool = '';
    company = '';
    cost = '';
    source = 'grant';
    priority = 5;
    description = '';
    itemLink = '';
    isAdding = true;
  }

  function openEdit(item: WishlistItem) {
    tool = item.tool;
    company = item.company ?? '';
    cost = item.cost;
    source = item.source;
    priority = item.priority;
    description = item.description ?? '';
    itemLink = item.itemLink ?? '';
    editing = item;
  }

  function close() {
    isAdding = false;
    editing = null;
  }

  const parsedCost = $derived(Number(cost));
  const canSave = $derived(tool.trim().length > 0 && Number.isFinite(parsedCost) && parsedCost > 0);

  function save() {
    if (!canSave) return;
    const fields = {
      tool: tool.trim(),
      company: company.trim() || undefined,
      cost: parsedCost,
      source,
      priority: Math.min(10, Math.max(1, Math.round(Number(priority)) || 5)),
      description: description.trim() || undefined,
      itemLink: itemLink.trim() || undefined
    };

    if (editing) cacao.updateWishlistItem({ ...editing, ...fields });
    else cacao.addWishlistItem(fields);
    close();
  }

  function remove(item: WishlistItem) {
    if (!confirm(`Remove "${item.tool}" from the wishlist?`)) return;
    cacao.deleteWishlistItem(item._id);
  }
</script>

<PageHeader
  title="Wishlist"
  stat={`${items.length} ${items.length === 1 ? 'item' : 'items'} · ${usd(cacao.wishlistTotal)} total`}
>
  {#snippet actions()}
    <button
      type="button"
      class="btn btn-filled"
      disabled={isViewer}
      title={isViewer ? 'Viewer mode: editing is disabled' : undefined}
      onclick={openAdd}
    >
      <Plus size={18} />
      <span>Add item</span>
    </button>
  {/snippet}
</PageHeader>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {#each items as item (item._id)}
    {@const meta = WISHLIST_SOURCE_META[item.source]}
    <article
      class="card-elevated flex flex-col gap-3 p-4"
      animate:flip={listItem.flip}
      in:fly={listItem.in}
      out:scale={listItem.out}
    >
      <div class="flex items-start gap-3">
        <!-- The list is sorted by priority, but in a grid that ordering reads
             across rows and is easy to miss. Leading with the score as a solid
             badge is what makes the ranking visible at a glance. -->
        <span
          class="type-num grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
          style={`background: ${
            item.priority >= 8
              ? 'var(--color-primary-container); color: var(--color-on-primary-container)'
              : 'var(--color-surface-container-high); color: var(--color-on-surface-variant)'
          }`}
          title={`Priority ${item.priority} of 10`}
        >
          {item.priority}
        </span>

        <div class="min-w-0 flex-1">
          <h2 class="type-title leading-tight">{item.tool}</h2>
          {#if item.company}
            <p class="type-body" style="color: var(--color-on-surface-variant)">{item.company}</p>
          {/if}
        </div>
        <span class="type-num type-title shrink-0">{usd(item.cost)}</span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class={`chip ${TONE_CHIP[meta.tone]}`}>{meta.label}</span>
      </div>

      {#if item.description}
        <p
          class="type-body p-3"
          style="border-radius: var(--shape-m); background: var(--color-surface-container); color: var(--color-on-surface-variant)"
        >
          {item.description}
        </p>
      {/if}

      <div class="mt-auto flex items-center justify-between gap-2 pt-1">
        {#if item.itemLink}
          <a
            href={item.itemLink}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-text btn-sm"
          >
            <ExternalLink size={16} />
            <span>Product page</span>
          </a>
        {:else}
          <!-- `wishlist` records no requester. The column was dropped, not
               renamed: the list is public, and who wants a tool is not a fact
               worth publishing about a student. -->
          <span></span>
        {/if}

        {#if !isViewer}
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="icon-btn icon-btn-sm"
              title={`Edit ${item.tool}`}
              onclick={() => openEdit(item)}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn-sm"
              title={`Remove ${item.tool}`}
              onclick={() => remove(item)}
            >
              <Trash2 size={16} style="color: var(--color-error)" />
            </button>
          </div>
        {/if}
      </div>
    </article>
  {:else}
    <p
      class="type-body col-span-full py-12 text-center"
      style="color: var(--color-on-surface-variant)"
    >
      Nothing on the wishlist yet. Add the tools the team wants next.
    </p>
  {/each}
</div>

<M3Modal
  open={isAdding || editing !== null}
  title={editing ? `Edit ${editing.tool}` : 'Add to the wishlist'}
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
    <M3Input label="Tool" bind:value={tool} required placeholder="Metal laser cutter" />

    <div class="grid gap-4 sm:grid-cols-2">
      <M3Input label="Company" bind:value={company} placeholder="XTOOL" />
      <M3Input label="Cost" type="number" bind:value={cost} required placeholder="18250" />
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <M3Select label="Funding source" bind:value={source} options={sourceOptions} />
      <M3Input
        label="Priority"
        type="number"
        bind:value={priority}
        helper="1–10, where 10 is most wanted"
      />
    </div>

    <M3Input label="Product page" type="url" bind:value={itemLink} placeholder="https://" />

    <div class="field">
      <label for="wish_desc" class="field-label">What it is for</label>
      <textarea
        id="wish_desc"
        rows="3"
        class="textarea-input"
        bind:value={description}
        placeholder="Up to 0.25&quot; aluminium cutting, engraving"
      ></textarea>
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <button type="button" class="btn btn-text" onclick={close}>Cancel</button>
      <button type="submit" class="btn btn-filled" disabled={!canSave}>
        {editing ? 'Save' : 'Add item'}
      </button>
    </div>
  </form>
</M3Modal>
