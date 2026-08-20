<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import {
    Landmark,
    RefreshCw,
    ExternalLink,
    CreditCard,
    ArrowDownLeft,
    ArrowUpRight
  } from 'lucide-svelte';

  const org = $derived(cacao.hcbOrg);
  const txns = $derived(cacao.hcbTransactions);
  const balance = $derived(cacao.metrics.hcbBalanceDollars);
  const totalRaised = $derived(cacao.metrics.hcbTotalRaisedDollars);

  const money = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<section class="card-elevated space-y-4 p-5">
  <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
    <div class="flex items-center gap-3">
      <span
        class="grid h-10 w-10 shrink-0 place-items-center"
        style="border-radius: var(--shape-m); background: var(--color-primary-container); color: var(--color-on-primary-container)"
      >
        <Landmark size={20} />
      </span>
      <div class="min-w-0">
        <h2 class="type-title">Hack Club Bank</h2>
        <p class="type-label-sm" style="color: var(--color-on-surface-variant)">
          the-panther-project{cacao.hcbLastSyncedAt
            ? ` · synced ${new Date(cacao.hcbLastSyncedAt).toLocaleTimeString()}`
            : ''}
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <button
        type="button"
        class="btn btn-tonal btn-sm"
        disabled={cacao.isHcbSyncing}
        onclick={() => cacao.syncHackClubBank(true)}
      >
        <RefreshCw size={16} class={cacao.isHcbSyncing ? 'animate-spin' : ''} />
        <span>{cacao.isHcbSyncing ? 'Syncing…' : 'Sync'}</span>
      </button>

      <a
        href="https://hcb.hackclub.com/the-panther-project"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-outlined btn-sm"
      >
        <span>Open HCB</span>
        <ExternalLink size={16} />
      </a>
    </div>
  </div>

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <div class="stat-tile">
      <span class="stat-label">Cash balance</span>
      <p class="stat-value">${money(balance)}</p>
      <p class="stat-note">Available team cash</p>
    </div>

    <div class="stat-tile">
      <span class="stat-label">Lifetime raised</span>
      <p class="stat-value" style="color: var(--color-success)">${money(totalRaised)}</p>
      <p class="stat-note">All-time donor & sponsor inflows</p>
    </div>

    <div class="stat-tile sm:col-span-2 lg:col-span-1">
      <span class="stat-label">Authorized members ({org?.users?.length || 0})</span>
      <div class="mt-2 flex items-center gap-1 overflow-x-auto">
        {#each (org?.users || []).slice(0, 6) as u}
          <span
            title={u.full_name}
            class="type-label grid h-8 w-8 shrink-0 place-items-center rounded-full"
            style="background: var(--color-secondary-container); color: var(--color-on-secondary-container)"
          >
            {u.full_name.charAt(0)}
          </span>
        {/each}
      </div>
      <p class="stat-note">Mentors & cardholders on HCB</p>
    </div>
  </div>

  <div>
    <div class="mb-2 flex items-center justify-between">
      <h3 class="type-label flex items-center gap-1.5">
        <CreditCard size={16} />
        <span>Recent transactions</span>
      </h3>
      <span class="type-label-sm type-num" style="color: var(--color-on-surface-variant)">
        {txns.length} loaded
      </span>
    </div>

    <div class="max-h-56 overflow-y-auto" style="border-radius: var(--shape-m)">
      {#each txns.slice(0, 10) as txn (txn.id)}
        {@const isCredit = txn.amount_cents > 0}
        {@const dollars = Math.abs(txn.amount_cents) / 100}
        <div class="flex items-center justify-between gap-3 px-3 py-2.5" style="border-radius: var(--shape-s)">
          <div class="flex min-w-0 items-center gap-2.5">
            <span
              class="grid h-8 w-8 shrink-0 place-items-center rounded-full"
              style={`background: ${
                isCredit ? 'var(--color-success-container)' : 'var(--color-surface-container-high)'
              }; color: ${isCredit ? 'var(--color-on-success-container)' : 'var(--color-on-surface-variant)'}`}
            >
              {#if isCredit}
                <ArrowDownLeft size={16} />
              {:else}
                <ArrowUpRight size={16} />
              {/if}
            </span>

            <div class="min-w-0">
              <p class="type-body truncate">{txn.memo}</p>
              <p class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
                {txn.date}{txn.user ? ` · ${txn.user.full_name}` : ''}
              </p>
            </div>
          </div>

          <span
            class="type-label type-num shrink-0"
            style={isCredit ? 'color: var(--color-success)' : ''}
          >
            {isCredit ? '+' : '−'}${dollars.toFixed(2)}
          </span>
        </div>
      {/each}

      {#if txns.length === 0}
        <p class="type-body p-6 text-center" style="color: var(--color-on-surface-variant)">
          No transactions loaded yet — hit Sync to pull from HCB.
        </p>
      {/if}
    </div>
  </div>
</section>
