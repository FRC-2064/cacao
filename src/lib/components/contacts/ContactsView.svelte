<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { Contact } from '$lib/types';
  import ContactModal from './ContactModal.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import { Plus, Mail, Phone, Building2, Pencil } from 'lucide-svelte';
  import { fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem } from '$lib/motion';

  let selectedContactForEdit = $state<Contact | null>(null);
  let isAddModalOpen = $state(false);

  const filteredContacts = $derived.by(() => {
    let list = [...cacao.contacts];
    if (cacao.searchQuery.trim()) {
      const q = cacao.searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.sponsorName?.toLowerCase().includes(q) ||
          c.notes?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  });
</script>

<PageHeader
  title="Contacts"
  stat={`${filteredContacts.length} ${filteredContacts.length === 1 ? 'contact' : 'contacts'} in the directory`}
>
  {#snippet actions()}
    <button type="button" class="btn btn-filled" onclick={() => (isAddModalOpen = true)}>
      <Plus size={18} />
      <span>Add contact</span>
    </button>
  {/snippet}
</PageHeader>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {#each filteredContacts as contact (contact._id)}
    <article
      class="card-elevated flex flex-col gap-3 p-4"
      animate:flip={listItem.flip}
      in:fly={listItem.in}
      out:scale={listItem.out}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="type-title leading-tight">{contact.name}</h2>
          <p class="type-body" style="color: var(--color-on-surface-variant)">{contact.title}</p>
        </div>
        <span
          class="type-label grid h-10 w-10 shrink-0 place-items-center rounded-full"
          style="background: var(--color-secondary-container); color: var(--color-on-secondary-container)"
        >
          {contact.name.charAt(0)}
        </span>
      </div>

      {#if contact.sponsorName}
        <span class="chip chip-sm self-start">
          <Building2 size={13} />
          <span>{contact.sponsorName}</span>
        </span>
      {/if}

      <div class="space-y-0.5">
        <a href={`mailto:${contact.email}`} class="list-row">
          <Mail size={16} class="shrink-0" style="color: var(--color-on-surface-variant)" />
          <span class="truncate">{contact.email}</span>
        </a>

        {#if contact.phone}
          <a href={`tel:${contact.phone}`} class="list-row">
            <Phone size={16} class="shrink-0" style="color: var(--color-on-surface-variant)" />
            <span class="type-num">{contact.phone}</span>
          </a>
        {/if}
      </div>

      {#if contact.notes}
        <p
          class="type-body p-3"
          style="border-radius: var(--shape-m); background: var(--color-surface-container); color: var(--color-on-surface-variant)"
        >
          {contact.notes}
        </p>
      {/if}

      <div class="mt-auto flex items-center justify-between gap-2 pt-1">
        <span class="type-label-sm" style="color: var(--color-on-surface-variant)">
          Prefers {contact.preferredMethod.replace('_', ' ')}
        </span>

        <button
          type="button"
          class="btn btn-text btn-sm"
          onclick={() => (selectedContactForEdit = contact)}
        >
          <Pencil size={16} />
          <span>Edit</span>
        </button>
      </div>
    </article>
  {/each}

  {#if filteredContacts.length === 0}
    <p
      class="type-body col-span-full py-12 text-center"
      style="color: var(--color-on-surface-variant)"
    >
      No contacts match your search.
    </p>
  {/if}
</div>

{#if selectedContactForEdit || isAddModalOpen}
  <ContactModal
    contact={selectedContactForEdit}
    open={true}
    onclose={() => {
      selectedContactForEdit = null;
      isAddModalOpen = false;
    }}
  />
{/if}
