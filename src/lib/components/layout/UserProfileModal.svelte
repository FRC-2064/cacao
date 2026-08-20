<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { theme } from '$lib/stores/theme.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import { Shield, GraduationCap, Check } from 'lucide-svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
    onopenrequest: () => void;
  }

  let { open = $bindable(false), onclose, onopenrequest }: Props = $props();

  const themeOptions = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'system', label: 'System' }
  ] as const;
</script>

<M3Modal
  bind:open
  {onclose}
  title="Profile"
  description="Team membership, appearance, and access"
>
  <div class="space-y-6">
    <div class="panel">
      <div class="flex items-center gap-3">
        <span
          class="type-title-lg grid h-12 w-12 shrink-0 place-items-center rounded-full"
          style="background: var(--color-primary); color: var(--color-on-primary)"
        >
          {cacao.currentUser.name.charAt(0)}
        </span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="type-title">{cacao.currentUser.name}</h3>
            <span class="chip chip-sm capitalize">{cacao.currentUser.role}</span>
          </div>
          <p class="type-body truncate" style="color: var(--color-on-surface-variant)">
            {cacao.currentUser.email}
          </p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <div>
          <span class="type-label-sm" style="color: var(--color-on-surface-variant)">Subteam</span>
          <p class="type-body">{cacao.currentUser.subteam || 'General team'}</p>
        </div>
        {#if cacao.currentUser.gradYear}
          <div>
            <span class="type-label-sm" style="color: var(--color-on-surface-variant)">Class of</span>
            <p class="type-body type-num">{cacao.currentUser.gradYear}</p>
          </div>
        {/if}
      </div>
    </div>

    <div>
      <span class="field-label mb-2 block">Appearance</span>
      <div class="segmented">
        {#each themeOptions as opt}
          <button
            type="button"
            aria-pressed={theme.preference === opt.id}
            onclick={() => theme.set(opt.id)}
            class="segmented-item"
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div>
      <span class="field-label mb-2 block">Switch active user</span>
      <div class="grid gap-1 sm:grid-cols-2">
        {#each cacao.users as u}
          {@const isCurrent = cacao.currentUser.email === u.email}
          <button
            type="button"
            aria-pressed={isCurrent}
            onclick={() => {
              cacao.setCurrentUser(u);
              onclose();
            }}
            class="list-row"
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5">
                <span class="type-label truncate">{u.name}</span>
                {#if u.role === 'admin'}
                  <Shield size={14} class="shrink-0" />
                {:else if u.role === 'graduated'}
                  <GraduationCap size={14} class="shrink-0" />
                {/if}
              </span>
              <span class="type-label-sm block truncate" style="color: var(--color-on-surface-variant)">
                {u.email}
              </span>
            </span>
            {#if isCurrent}
              <Check size={18} class="shrink-0" />
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
      <span class="type-body" style="color: var(--color-on-surface-variant)">
        New student joining the team?
      </span>
      <button
        type="button"
        class="btn btn-tonal"
        onclick={() => {
          onclose();
          onopenrequest();
        }}
      >
        Request access
      </button>
    </div>
  </div>
</M3Modal>
