<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { theme } from '$lib/theme';
  import { M3Modal, M3Input, ThemePicker, initialsOf } from '@frc2064/ui';
  import { firstNameProblem } from '../../../../convex/personNames';
  import { goto } from '$app/navigation';
  import { LogOut, ShieldQuestion } from 'lucide-svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open = $bindable(false), onclose }: Props = $props();

  /**
   * A first name and one letter is the whole of what this app knows about a
   * person. There is no surname field, no email, no photograph and no
   * graduation year -- the schema has no column any of them could go in, which
   * is the point of the change that removed them, not an oversight to fill in.
   */
  let firstName = $state('');
  let lastInitial = $state('');

  // Refill from the roster row each time the modal opens, so an edit that was
  // abandoned last time does not reappear as if it had been saved.
  $effect(() => {
    if (!open) return;
    firstName = cacao.currentUser.firstName ?? '';
    lastInitial = cacao.currentUser.lastInitial ?? '';
  });

  const dirty = $derived(
    firstName.trim() !== (cacao.currentUser.firstName ?? '') ||
      lastInitial.trim() !== (cacao.currentUser.lastInitial ?? '')
  );

  /**
   * A viewer is signed in and read-only, and this is the only place they can
   * do anything about that.
   *
   * Until this form existed a student signed in, landed as `viewer` -- which
   * is the only role `auth.ensureUser` ever writes -- clicked something, got
   * "Viewer mode: editing is disabled", and had no way to ask. The four
   * mutations behind the flow had zero call sites in `src/`, and this modal
   * said "Your role is set by a mentor." and offered nothing.
   */
  const isViewer = $derived(cacao.currentUser.role === 'viewer');

  /**
   * Why the typed first name cannot be stored, or `null`.
   *
   * The same function `users.requestEditAccess` and `users.updateOwnProfile`
   * throw from -- see `convex/personNames.ts`. The server is the enforcer;
   * this is here so the form says so before it is submitted, instead of a
   * viewer watching an optimistic "Levi Fitzpatrick" appear and a red toast
   * contradict it a moment later.
   */
  const nameProblem = $derived(firstNameProblem(firstName));

  /** Enough to identify them to a mentor, which is the whole bar. */
  const canRequest = $derived(
    firstName.trim().length > 0 && lastInitial.trim().length > 0 && nameProblem === null
  );

  function requestAccess() {
    cacao.requestEditAccess({ firstName, lastInitial });
    onclose();
  }

  const roleLabel: Record<string, string> = {
    admin: 'Mentor',
    student: 'Student',
    viewer: 'Viewer'
  };

  /**
   * Sent as typed, not shortened. `users.updateOwnProfile` truncates
   * `lastInitial` to one character server-side precisely because a client
   * cannot be trusted to have done it; slicing here too would put the only
   * copy of what somebody actually typed in the one place nothing enforces.
   * The field's helper text says what will happen, which is the honest form
   * of the same warning.
   */
  function save() {
    if (nameProblem) return;
    cacao.saveOwnProfile({
      firstName: firstName.trim(),
      lastInitial: lastInitial.trim()
    });
    onclose();
  }
</script>

<M3Modal bind:open {onclose} title="Profile" description="Your details and appearance">
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <span
        class="type-title-lg grid h-14 w-14 shrink-0 place-items-center rounded-full"
        style="background: var(--color-primary); color: var(--color-on-primary)"
      >
        {initialsOf(cacao.currentUser.displayName)}
      </span>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="type-title truncate">{cacao.currentUser.displayName}</h3>
          <span class="chip chip-sm shrink-0">
            {roleLabel[cacao.currentUser.role] ?? cacao.currentUser.role}
          </span>
        </div>
        <p class="type-body truncate" style="color: var(--color-on-surface-variant)">
          {cacao.isSignedIn ? 'Signed in with Google' : 'Not signed in'}
        </p>
      </div>
    </div>

    {#if cacao.isSignedIn && isViewer}
      <!-- The request form. A viewer's account holds an opaque identifier and
           nothing else; a name enters the database here, at the moment they
           ask to be able to change the team's records. `users.updateOwnProfile`
           is gated on `requireWriter` so this is the only door. -->
      <div class="panel space-y-4">
        <div>
          <h4 class="type-title-sm flex items-center gap-2">
            <ShieldQuestion size={16} />
            <span>Ask for edit access</span>
          </h4>
          <p class="type-body-sm" style="color: var(--color-on-surface-variant)">
            {#if cacao.currentUser.requested}
              Your request is with the mentors. You can update the name on it below.
            {:else}
              You can read everything already. To add or change records, a mentor
              has to approve you — give them a first name and a last initial so
              they know who they are approving.
            {/if}
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <M3Input
            label="First name"
            bind:value={firstName}
            placeholder="Levi"
            helper="First name only. No surname, no email address."
          />
          <M3Input
            label="Last initial"
            bind:value={lastInitial}
            placeholder="F"
            helper="One letter. Shortened to one if you type more."
          />
        </div>

        {#if nameProblem}
          <p class="type-label-sm" style="color: var(--color-error)">{nameProblem}</p>
        {/if}

        <p class="type-label-sm" style="color: var(--color-on-surface-variant)">
          A first name and one letter is all this app will ever store about you. No
          surname, no email address, no photo.
        </p>

        <button
          type="button"
          class="btn btn-filled w-full justify-center"
          disabled={!canRequest}
          onclick={requestAccess}
        >
          {cacao.currentUser.requested ? 'Update my request' : 'Request edit access'}
        </button>
      </div>
    {:else if cacao.isSignedIn}
      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <M3Input
            label="First name"
            bind:value={firstName}
            helper="First name only. No surname, no email address."
          />
          <M3Input
            label="Last initial"
            bind:value={lastInitial}
            placeholder="F"
            helper="One letter. Shortened to one if you type more."
          />
        </div>

        {#if nameProblem}
          <p class="type-label-sm" style="color: var(--color-error)">{nameProblem}</p>
        {/if}

        <p class="type-label-sm" style="color: var(--color-on-surface-variant)">
          Your role is set by a mentor.
        </p>

        {#if dirty}
          <button
            type="button"
            class="btn btn-filled w-full justify-center"
            disabled={nameProblem !== null}
            onclick={save}
          >
            Save changes
          </button>
        {/if}
      </div>
    {/if}

    <div>
      <span class="field-label mb-2 block">Appearance</span>
      <ThemePicker {theme} />
    </div>

    <div class="flex justify-end pt-1">
      {#if cacao.isSignedIn}
        <button
          type="button"
          class="btn btn-outlined"
          onclick={() => {
            cacao.logout();
            onclose();
            goto('/');
          }}
        >
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      {:else}
        <button type="button" class="btn btn-filled" onclick={() => { onclose(); goto('/'); }}>
          Sign in
        </button>
      {/if}
    </div>
  </div>
</M3Modal>
