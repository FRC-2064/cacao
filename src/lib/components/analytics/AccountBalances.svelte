<script lang="ts">
  import { EPOCH_DATE, type AccountBalance } from '$lib/finance/balances';
  import { ACCOUNT_META } from '$lib/finance/categories';
  import { Landmark, School, Sigma } from 'lucide-svelte';

  interface Props {
    balances: AccountBalance[];
  }

  let { balances }: Props = $props();

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  const ICONS = { hcb_bank: Landmark, school_account: School };

  // An unreachable account contributes nothing to the total rather than zero:
  // its balance is unknown, and folding an unknown in as 0 would understate
  // what the team has without saying so.
  const total = $derived(
    balances.reduce((sum, b) => (b.source === 'unavailable' ? sum : sum + b.balance), 0)
  );
  const anyUnavailable = $derived(balances.some((b) => b.source === 'unavailable'));
</script>

<section class="card-elevated space-y-4 p-5">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <div>
      <h2 class="type-title">What we have right now</h2>
      <!-- The season dropdown does not apply here, and saying so prevents the
           strip reading as though it were filtered along with the rest. -->
      <p class="type-body-sm text-xs" style="color: var(--color-on-surface-variant)">
        Current balances across all accounts, not filtered by season
      </p>
    </div>
  </div>

  <div class="grid gap-3 sm:grid-cols-3">
    {#each balances as bal (bal.account)}
      {@const meta = ACCOUNT_META[bal.account]}
      {@const Icon = ICONS[bal.account]}
      <div class="p-3" style="border-radius: var(--shape-m); background: var(--color-surface-container)">
        <div class="flex items-center gap-2">
          <Icon size={16} style="color: var(--color-on-surface-variant)" />
          <span class="type-label-sm truncate">{meta.label}</span>
        </div>

        <p class="stat-value mt-1 text-xl type-num">
          {#if bal.source === 'unavailable'}
            <span style="color: var(--color-on-surface-variant)">—</span>
          {:else}
            {money(bal.balance)}
          {/if}
        </p>

        <p class="type-label-sm mt-0.5 text-xs" style="color: var(--color-on-surface-variant)">
          {#if bal.source === 'measured'}
            Live balance from Hack Club Bank
          {:else if bal.source === 'unavailable'}
            Could not reach Hack Club Bank
          {:else if bal.asOfDate === EPOCH_DATE}
            No verified balance set
          {:else}
            Verified {bal.asOfDate}, plus activity since
          {/if}
        </p>
      </div>
    {/each}

    <!-- The total rides in the grid rather than the header: with the cash box
         retired there are two accounts in a three-column strip, and a hole
         where the third used to be looked like something had failed to load.
         It also sits beside the figures it sums. -->
    <div
      class="p-3"
      style="border-radius: var(--shape-m); background: var(--color-surface-container-high)"
    >
      <div class="flex items-center gap-2">
        <Sigma size={16} style="color: var(--color-on-surface-variant)" />
        <span class="type-label-sm truncate">Total</span>
      </div>

      <p class="stat-value mt-1 text-xl type-num">{money(total)}</p>

      <p class="type-label-sm mt-0.5 text-xs" style="color: var(--color-on-surface-variant)">
        {#if anyUnavailable}
          Hack Club Bank not included
        {:else}
          Across both accounts
        {/if}
      </p>
    </div>
  </div>
</section>
