<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import HCBTreasuryCard from '$lib/components/expenses/HCBTreasuryCard.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import { Building2, Landmark, PiggyBank, School, Package } from 'lucide-svelte';

  const seasonGoal = 25000;
  const metrics = $derived(cacao.metrics);
  const totalRaised = $derived(
    metrics.totalAwarded +
      metrics.currentYearPledges +
      metrics.totalFundraiserIncome +
      metrics.hcbTotalRaisedDollars
  );
  const totalSpent = $derived(metrics.approvedExpenses);
  const goalProgressPct = $derived(Math.min(100, Math.round((totalRaised / seasonGoal) * 100)));

  const money = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const accounts = $derived([
    {
      label: 'Hack Club Bank',
      icon: Landmark,
      note: 'Can drives, merch, booster club',
      total: metrics.hcbDepositsTotal
    },
    {
      label: 'School account',
      icon: School,
      note: 'Summer camps & district transfers',
      total: metrics.schoolAccountDepositsTotal
    },
    {
      label: 'Pit cash box',
      icon: Package,
      note: 'Cash bake sales & petty cash',
      total: metrics.cashBoxDepositsTotal
    }
  ]);

  const tiers = ['platinum', 'gold', 'silver', 'bronze'] as const;
</script>

<PageHeader title="Finances" description={`Season ${cacao.selectedSeason} overview`} />

<div class="space-y-5">
  <section class="card-elevated space-y-5 p-5">
    <div class="grid gap-4 sm:grid-cols-3">
      <div class="stat-tile">
        <span class="stat-label">Total inflow</span>
        <p class="stat-value" style="color: var(--color-success)">${money(totalRaised)}</p>
        <p class="stat-note">Grants, sponsors, fundraisers & bank</p>
      </div>
      <div class="stat-tile">
        <span class="stat-label">Cash on hand</span>
        <p class="stat-value">${money(metrics.hcbBalanceDollars)}</p>
        <p class="stat-note">Live HCB balance</p>
      </div>
      <div class="stat-tile">
        <span class="stat-label">Approved spend</span>
        <p class="stat-value">${money(totalSpent)}</p>
        <p class="stat-note">{cacao.expenses.length} purchase requests</p>
      </div>
    </div>

    <div>
      <div class="type-body mb-2 flex flex-wrap justify-between gap-2">
        <span style="color: var(--color-on-surface-variant)">
          Season target ${seasonGoal.toLocaleString()}
        </span>
        <span class="type-label type-num">{goalProgressPct}% of goal</span>
      </div>
      <div
        class="progress-track"
        style="height: 8px"
        role="progressbar"
        aria-valuenow={goalProgressPct}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="Progress toward season fundraising goal"
      >
        <span class="progress-bar" style={`width: ${goalProgressPct}%`}></span>
      </div>
    </div>
  </section>

  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div class="card-elevated p-4">
      <span class="stat-label">Awarded grants</span>
      <p class="stat-value">${metrics.totalAwarded.toLocaleString()}</p>
      <p class="stat-note">
        {metrics.awardedCount}
        {metrics.awardedCount === 1 ? 'grant' : 'grants'} won
      </p>
    </div>

    <div class="card-elevated p-4">
      <span class="stat-label">Fundraisers</span>
      <p class="stat-value" style="color: var(--color-success)">
        ${money(metrics.totalFundraiserIncome)}
      </p>
      <p class="stat-note">{cacao.incomeDeposits.length} deposits logged</p>
    </div>

    <div class="card-elevated p-4">
      <span class="stat-label">Sponsor pledges</span>
      <p class="stat-value">${metrics.currentYearPledges.toLocaleString()}</p>
      <p class="stat-note">${metrics.totalSponsorFunding.toLocaleString()} lifetime</p>
    </div>

    <div class="card-elevated p-4">
      <span class="stat-label">Approved expenses</span>
      <p class="stat-value">${money(metrics.approvedExpenses)}</p>
      <p class="stat-note">{cacao.expenses.length} requests</p>
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <section class="card-elevated space-y-3 p-5">
      <h2 class="type-title flex items-center gap-2">
        <PiggyBank size={18} />
        <span>Where the money landed</span>
      </h2>

      <div class="space-y-2">
        {#each accounts as account}
          <div
            class="flex items-center justify-between gap-3 p-3"
            style="border-radius: var(--shape-m); background: var(--color-surface-container)"
          >
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                style="background: var(--color-surface-container-high); color: var(--color-on-surface-variant)"
              >
                <account.icon size={18} />
              </span>
              <div class="min-w-0">
                <p class="type-label truncate">{account.label}</p>
                <p class="type-label-sm truncate" style="color: var(--color-on-surface-variant)">
                  {account.note}
                </p>
              </div>
            </div>
            <span class="type-label type-num shrink-0" style="color: var(--color-success)">
              +${money(account.total)}
            </span>
          </div>
        {/each}
      </div>
    </section>

    <section class="card-elevated space-y-3 p-5">
      <h2 class="type-title flex items-center gap-2">
        <Building2 size={18} />
        <span>Sponsor tiers</span>
      </h2>

      <div class="space-y-2">
        {#each tiers as tier}
          {@const sponsorsInTier = cacao.sponsors.filter((s) => s.tier === tier)}
          {@const sumDonated = sponsorsInTier.reduce((acc, s) => acc + s.totalDonated, 0)}
          <div
            class="flex items-center justify-between gap-3 p-3"
            style="border-radius: var(--shape-m); background: var(--color-surface-container)"
          >
            <div class="flex items-center gap-2">
              <span class={`chip chip-sm capitalize ${tier === 'platinum' || tier === 'gold' ? 'chip-primary' : ''}`}>
                {tier}
              </span>
              <span class="type-body" style="color: var(--color-on-surface-variant)">
                {sponsorsInTier.length}
                {sponsorsInTier.length === 1 ? 'partner' : 'partners'}
              </span>
            </div>
            <span class="type-label type-num">${sumDonated.toLocaleString()}</span>
          </div>
        {/each}
      </div>
    </section>
  </div>

  <HCBTreasuryCard />
</div>
