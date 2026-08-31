<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { goto } from '$app/navigation';
  import { signIn, isAuthEnabled } from '$lib/auth/google.svelte';
  import { ArrowRight, LogOut, LogIn, Eye } from 'lucide-svelte';

  const signedIn = $derived(cacao.isSignedIn);

</script>

<svelte:head>
  <title>Sign In · 2064 Panther Project</title>
</svelte:head>

<div class="mx-auto flex min-h-[75vh] max-w-md flex-col justify-center py-6">
  <div class="card-elevated overflow-hidden p-6 sm:p-8">
    <div class="mb-6 flex flex-col items-center text-center">
      <img
        src="/brand/wordmark.png"
        alt="2064 Panther Project"
        class="mb-3 h-10 w-auto object-contain"
      />
      <p class="type-body text-sm" style="color: var(--color-on-surface-variant)">
        Robotics Financials &amp; Grants Portal
      </p>
    </div>

    {#if !cacao.authReady}
      <p class="type-body py-8 text-center" style="color: var(--color-on-surface-variant)">
        Checking your session…
      </p>
    {:else if signedIn}
      <div class="space-y-5">
        <div class="panel p-4 text-center">
          <p class="type-label-sm" style="color: var(--color-on-surface-variant)">
            Currently signed in as
          </p>
          <h2 class="type-title-lg mt-1">{cacao.currentUser.displayName}</h2>
          <span class="chip chip-sm mt-2 capitalize">{cacao.currentUser.role}</span>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            class="btn btn-filled flex items-center justify-center gap-2"
            onclick={() => goto('/dashboard')}
          >
            <span>Open workspace</span>
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            class="btn btn-outlined flex items-center justify-center gap-2"
            onclick={() => cacao.logout()}
          >
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    {:else if isAuthEnabled}
      <div class="space-y-4 text-center">
        <p class="type-body" style="color: var(--color-on-surface-variant)">
          Sign in with your Google account.
        </p>
        <button
          type="button"
          class="btn btn-filled w-full justify-center py-2.5 text-base"
          onclick={() => signIn()}
        >
          <LogIn size={18} />
          <span>Sign in</span>
        </button>
        <!-- The team's finances are public to read, so there is nothing to
             unlock here -- signing in is only how you get to edit them. -->
        <button
          type="button"
          class="btn btn-text w-full justify-center"
          onclick={() => goto('/dashboard')}
        >
          <Eye size={16} />
          <span>Just looking? Browse without signing in</span>
        </button>
      </div>
    {:else}
      <p class="type-body py-8 text-center" style="color: var(--color-on-surface-variant)">
        Sign-in is not configured for this deployment.
      </p>
    {/if}
  </div>
</div>
