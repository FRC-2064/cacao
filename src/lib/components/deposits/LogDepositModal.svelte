<script lang="ts">
  import type { IncomeDeposit, IncomeCategory, DepositAccount } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import DonorNameInput from '$lib/components/donors/DonorNameInput.svelte';
  import { defaultSeasonId, seasonLabelFor, seasonIdOptions } from '$lib/components/finance/seasons';
  import { Plus } from 'lucide-svelte';
  import {
    DEPOSIT_FORM_CATEGORIES,
    INCOME_CATEGORY_META,
    ACCOUNT_META,
    MAJOR_DONOR_THRESHOLD
  } from '$lib/finance/categories';

  interface Props {
    deposit?: IncomeDeposit | null;
    open: boolean;
    onclose: () => void;
  }

  let { deposit = null, open = $bindable(false), onclose }: Props = $props();

  let title = $state('');
  let amount = $state<number>(100);
  let category = $state<IncomeCategory>('fundraising');
  let depositAccount = $state<DepositAccount>('school_account');
  let date = $state(new Date().toISOString().split('T')[0]);
  let receiptUrl = $state('');
  let notes = $state('');
  let donorName = $state('');
  let taxYear = $state<number>(new Date().getFullYear());
  let seasonId = $state('');
  let formError = $state('');

  $effect(() => {
    if (deposit) {
      title = deposit.title;
      amount = deposit.amount;
      category = deposit.category;
      depositAccount = deposit.depositAccount;
      date = deposit.date;
      receiptUrl = deposit.receiptUrl || '';
      notes = deposit.notes || '';
      donorName = deposit.donorName || '';
      taxYear = deposit.taxYear ?? new Date().getFullYear();
      seasonId = deposit.seasonId;
    } else {
      title = '';
      amount = 100;
      category = 'fundraising';
      depositAccount = 'school_account';
      date = new Date().toISOString().split('T')[0];
      receiptUrl = '';
      notes = '';
      donorName = '';
      taxYear = new Date().getFullYear();
      seasonId = defaultSeasonId(cacao.seasons, cacao.selectedSeason);
    }
  });

  const categoryOptions = DEPOSIT_FORM_CATEGORIES.map((id) => ({
    value: id,
    label: INCOME_CATEGORY_META[id].label
  }));

  const accountOptions = Object.entries(ACCOUNT_META).map(([value, meta]) => ({
    value,
    label: meta.label
  }));

  const seasonOptions = $derived(seasonIdOptions(cacao.seasons));

  function handleSubmit() {
    if (!title.trim() || !amount) {
      formError = 'A description and deposit amount are required.';
      return;
    }
    if (!seasonId) {
      formError = 'No season is available to file this deposit under yet.';
      return;
    }
    formError = '';

    // A deposit's season is authoritative, not inferred from its date: grant
    // money routinely arrives a season after the one it was applied for.
    const season = seasonLabelFor(cacao.seasons, seasonId);

    if (deposit) {
      cacao.updateIncomeDeposit({
        ...deposit,
        title: title.trim(),
        amount: Number(amount) || 0,
        category,
        depositAccount,
        date,
        seasonId,
        season,
        receiptUrl: receiptUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        donorName: donorName.trim() || undefined,
        taxYear: Number(taxYear) || undefined
      });
    } else {
      cacao.addIncomeDeposit({
        title: title.trim(),
        amount: Number(amount) || 0,
        category,
        depositAccount,
        date,
        seasonId,
        season,
        receiptUrl: receiptUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        donorName: donorName.trim() || undefined,
        taxYear: Number(taxYear) || undefined
      });
    }

    onclose();
  }

  function handleDelete() {
    if (deposit && confirm(`Delete deposit entry "${deposit.title}"?`)) {
      cacao.deleteIncomeDeposit(deposit._id);
      onclose();
    }
  }
</script>

{#if cacao.currentUser.role !== 'viewer'}
  <M3Modal
    bind:open
    {onclose}
    title={deposit ? 'Edit Bank Deposit' : 'Log Bank Deposit / Fundraiser'}
    description="Record money gained from fundraisers, merchandise, can drives, camps, and direct donations"
  >
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
      <!-- Title & Amount -->
      <M3Input
        label="Fundraiser / Deposit Title"
        placeholder="e.g. Panera Bread Community Fundraiser Night"
        bind:value={title}
        required
      />

      <div class="grid sm:grid-cols-2 gap-3">
        <M3Input
          label="Amount Deposited ($ USD)"
          type="number"
          bind:value={amount}
          required
        />
        <M3Input
          label="Deposit Date"
          type="date"
          bind:value={date}
          required
        />
      </div>

      <!-- Donor attribution. The name is resolved or created server-side in
           the same transaction as the deposit, so a gift can never commit with
           its donor lost; the suggestions exist to stop one person becoming
           two donors under two spellings. -->
      <div class="grid sm:grid-cols-2 gap-3">
        <DonorNameInput
          id="deposit_donor_name"
          label="Donor name (optional)"
          bind:value={donorName}
          helper="Who this gift is from, for donor totals"
        />
        <M3Input
          label="Tax Year"
          type="number"
          bind:value={taxYear}
          helper="Calendar year this gift counts toward"
        />
      </div>

      <!-- Category & Destination Account -->
      <div class="grid sm:grid-cols-2 gap-3">
        <M3Select
          label="Revenue Category"
          bind:value={category as any}
          options={categoryOptions}
          helper={`Sponsor cheques and grant awards belong on the Sponsors and Grants tabs, not here. A single gift of $${MAJOR_DONOR_THRESHOLD} or more counts as a major donor.`}
        />
        <M3Select label="Deposited Into Account" bind:value={depositAccount as any} options={accountOptions} />
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <M3Select
          label="Season"
          bind:value={seasonId}
          options={seasonOptions}
          helper="Which season this money belongs to, which is not always the year it landed in"
        />
      </div>

      <!-- Receipt / Deposit Slip Link -->
      <M3Input
        label="Receipt / Deposit Slip / Stripe Link (Optional)"
        type="url"
        placeholder="https://drive.google.com/..."
        bind:value={receiptUrl}
        helper="Scan of bank deposit slip, Stripe link, or photo"
      />

      <!-- Notes -->
      <div class="field">
        <label for="deposit_notes" class="field-label">
          Notes & Event Details
        </label>
        <textarea
          id="deposit_notes"
          bind:value={notes}
          rows={2}
          placeholder="e.g. 20% proceeds from dinner rush, 14,000 cans redeemed..."
          class="textarea-input"
        ></textarea>
      </div>

      <!-- Footer Actions -->
      {#if formError}
        <p class="field-error" role="alert">{formError}</p>
      {/if}

      <div class="flex items-center justify-between gap-2 pt-2">
        {#if deposit}
          <button
            type="button"
            onclick={handleDelete}
            class="btn btn-text"
            style="color: var(--color-error)"
          >
            Delete
          </button>
        {:else}
          <div></div>
        {/if}

        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-text" onclick={onclose}>
            Cancel
          </button>
          <button type="submit" class="btn btn-filled">
            <Plus size={14} />
            <span>{deposit ? 'Save Changes' : 'Record Deposit'}</span>
          </button>
        </div>
      </div>
    </form>
  </M3Modal>
{/if}
