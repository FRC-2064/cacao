<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { KeyRound, Send, CheckCircle2 } from 'lucide-svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open = $bindable(false), onclose }: Props = $props();

  let firstName = $state('');
  let lastName = $state('');
  let email = $state('');
  let gradYear = $state<number>(2027);
  let subteam = $state('Business & Grants');
  let notes = $state('');
  let mentorPasscode = $state('');
  let formError = $state('');
  let isSubmitted = $state(false);

  const subteamOptions = [
    { value: 'Business & Grants', label: 'Business & Grants' },
    { value: 'Mechanical & Build', label: 'Mechanical & Build' },
    { value: 'Software & Controls', label: 'Software & Controls' },
    { value: 'Electrical & Pneumatics', label: 'Electrical & Pneumatics' },
    { value: 'Strategy & Scouting', label: 'Strategy & Scouting' },
    { value: 'Media & Outreach', label: 'Media & Outreach' }
  ];

  const gradYearOptions = [
    { value: '2026', label: 'Class of 2026' },
    { value: '2027', label: 'Class of 2027' },
    { value: '2028', label: 'Class of 2028' },
    { value: '2029', label: 'Class of 2029' }
  ];

  function handleSubmit() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      formError = 'Please fill in your name and email address.';
      return;
    }
    formError = '';

    // Check if in-person mentor passcode provided
    if (mentorPasscode.trim() && cacao.verifyMentorPasscode(mentorPasscode)) {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const newUser = {
        _id: `user_${Date.now()}`,
        name: fullName,
        email: email.trim().toLowerCase(),
        role: 'student' as const,
        gradYear: Number(gradYear),
        subteam,
        status: 'active' as const,
        approvedBy: 'Instant Passcode',
        approvedAt: Date.now(),
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      };
      cacao.users = [...cacao.users, newUser];
      cacao.setCurrentUser(newUser);
      cacao.showToast(`Welcome to Cacao, ${firstName}!`);
      onclose();
      return;
    }

    cacao.submitAccessRequest({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      gradYear: Number(gradYear),
      subteam,
      notes: notes.trim() || undefined
    });

    isSubmitted = true;
  }
</script>

<M3Modal
  bind:open
  {onclose}
  title={isSubmitted ? 'Request submitted' : 'Request access'}
  description={isSubmitted ? 'Pending mentor approval' : 'Join Cacao with your @region15.org student account'}
>
  {#if isSubmitted}
    <div class="space-y-4 py-6 text-center">
      <span
        class="mx-auto grid h-14 w-14 place-items-center rounded-full"
        style="background: var(--color-success-container); color: var(--color-on-success-container)"
      >
        <CheckCircle2 size={28} />
      </span>
      <div>
        <h3 class="type-title-lg">Request received</h3>
        <p class="type-body mx-auto mt-1 max-w-sm" style="color: var(--color-on-surface-variant)">
          A mentor will review your account. Once approved you can edit and manage grants.
        </p>
      </div>
      <button type="button" class="btn btn-filled" onclick={onclose}>Done</button>
    </div>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <M3Input label="First name" placeholder="Sam" bind:value={firstName} required />
        <M3Input label="Last name" placeholder="Okafor" bind:value={lastName} required />
      </div>

      <M3Input
        label="Student email"
        type="email"
        placeholder="yourname@region15.org"
        bind:value={email}
        required
      />

      <div class="grid gap-3 sm:grid-cols-2">
        <M3Select label="Graduation year" bind:value={gradYear as any} options={gradYearOptions} />
        <M3Select label="Subteam" bind:value={subteam} options={subteamOptions} />
      </div>

      <div class="field">
        <label for="req_notes_text" class="field-label">Why do you want access?</label>
        <textarea
          id="req_notes_text"
          bind:value={notes}
          rows={2}
          placeholder="e.g. Help draft local business outreach emails…"
          class="textarea-input"
        ></textarea>
      </div>

      <!-- Skips the approval queue when a mentor reads out the PIN in the room. -->
      <div class="panel">
        <span class="panel-title flex items-center gap-1.5">
          <KeyRound size={14} />
          <span>Mentor passcode (optional)</span>
        </span>
        <input
          type="password"
          placeholder="PIN from a mentor in the room"
          bind:value={mentorPasscode}
          aria-label="Mentor passcode"
          class="text-input"
        />
      </div>

    {#if formError}
      <p class="field-error" role="alert">{formError}</p>
    {/if}

      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
        <button type="submit" class="btn btn-filled">
          <Send size={18} />
          <span>Submit request</span>
        </button>
      </div>
    </form>
  {/if}
</M3Modal>
