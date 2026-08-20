<script lang="ts">
  import type { Contact } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { Save, Trash2 } from 'lucide-svelte';

  interface Props {
    contact: Contact | null;
    open: boolean;
    onclose: () => void;
  }

  let { contact, open = $bindable(false), onclose }: Props = $props();

  let name = $state('');
  let title = $state('');
  let email = $state('');
  let phone = $state('');
  let sponsorName = $state('');
  let isPrimary = $state(true);
  let preferredMethod = $state<'email' | 'phone' | 'in_person'>('email');
  let notes = $state('');
  let formError = $state('');

  $effect(() => {
    if (contact) {
      name = contact.name;
      title = contact.title;
      email = contact.email;
      phone = contact.phone || '';
      sponsorName = contact.sponsorName || '';
      isPrimary = contact.isPrimary;
      preferredMethod = contact.preferredMethod;
      notes = contact.notes || '';
    } else {
      name = '';
      title = '';
      email = '';
      phone = '';
      sponsorName = '';
      isPrimary = true;
      preferredMethod = 'email';
      notes = '';
    }
  });

  const methodOptions = [
    { value: 'email', label: 'Email Communication' },
    { value: 'phone', label: 'Phone Call' },
    { value: 'in_person', label: 'In-Person Visit / Meeting' }
  ];

  function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      formError = 'Please provide a name and email.';
      return;
    }
    formError = '';

    const linkedSponsor = cacao.sponsors.find((s) => s.name === sponsorName);

    if (contact) {
      cacao.updateContact({
        ...contact,
        name: name.trim(),
        title: title.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        sponsorId: linkedSponsor?._id,
        sponsorName: sponsorName.trim() || undefined,
        isPrimary,
        preferredMethod,
        notes: notes.trim() || undefined
      });
    } else {
      cacao.addContact({
        name: name.trim(),
        title: title.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        sponsorId: linkedSponsor?._id,
        sponsorName: sponsorName.trim() || undefined,
        isPrimary,
        preferredMethod,
        notes: notes.trim() || undefined
      });
    }

    onclose();
  }

  function handleDelete() {
    if (!contact) return;
    if (confirm(`Delete contact "${contact.name}"?`)) {
      cacao.deleteContact(contact._id);
      onclose();
    }
  }

  const orgOptions = $derived([
    { value: '', label: 'Independent / no organization' },
    ...cacao.sponsors.map((sp) => ({ value: sp.name, label: sp.name }))
  ]);
</script>

<M3Modal
  bind:open
  {onclose}
  title={contact ? contact.name : 'Add contact'}
  description="Sponsor representatives, community liaisons, and grant officers"
>
  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
    <div class="grid gap-3 sm:grid-cols-2">
      <M3Input label="Full name" placeholder="e.g. David Miller" bind:value={name} required />
      <M3Input label="Job title" placeholder="e.g. Director of Community Relations" bind:value={title} required />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Input label="Email" type="email" placeholder="david@company.com" bind:value={email} required />
      <M3Input label="Phone" placeholder="(203) 555-0100" bind:value={phone} />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Select label="Linked organization" bind:value={sponsorName} options={orgOptions} />
      <M3Select label="Preferred contact method" bind:value={preferredMethod} options={methodOptions} />
    </div>

    <div class="field">
      <label for="contact_notes_text" class="field-label">Notes & relationship context</label>
      <textarea
        id="contact_notes_text"
        bind:value={notes}
        rows={3}
        placeholder="Alumni parent, best reached in early fall, prefers weekday calls…"
        class="textarea-input"
      ></textarea>
    </div>

    {#if formError}
      <p class="field-error" role="alert">{formError}</p>
    {/if}

    <div class="flex items-center justify-between gap-2 pt-2">
      {#if contact}
        <button
          type="button"
          onclick={handleDelete}
          class="btn btn-text"
          style="color: var(--color-error)"
        >
          Delete
        </button>
      {:else}
        <span></span>
      {/if}

      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
        <button type="submit" class="btn btn-filled">
          <Save size={18} />
          <span>{contact ? 'Save changes' : 'Add contact'}</span>
        </button>
      </div>
    </div>
  </form>
</M3Modal>
