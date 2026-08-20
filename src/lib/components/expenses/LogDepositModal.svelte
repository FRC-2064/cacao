<script lang="ts">
  import type { IncomeDeposit, IncomeCategory, DepositAccount } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { DollarSign, Landmark, Plus, Trash2 } from 'lucide-svelte';

  interface Props {
    deposit?: IncomeDeposit | null;
    open: boolean;
    onclose: () => void;
  }

  let { deposit = null, open = $bindable(false), onclose }: Props = $props();

  let title = $state('');
  let amount = $state<number>(100);
  let category = $state<IncomeCategory>('fundraiser');
  let depositAccount = $state<DepositAccount>('hcb_bank');
  let date = $state(new Date().toISOString().split('T')[0]);
  let receiptUrl = $state('');
  let notes = $state('');
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
    } else {
      title = '';
      amount = 100;
      category = 'fundraiser';
      depositAccount = 'hcb_bank';
      date = new Date().toISOString().split('T')[0];
      receiptUrl = '';
      notes = '';
    }
  });

  const categoryOptions = [
    { value: 'fundraiser', label: '🍕 Community Fundraiser (Panera, Bake Sale, Trivia)' },
    { value: 'bottle_can_drive', label: '🥫 Town Bottle & Can Redemption Drive' },
    { value: 'merch_sales', label: '👕 Team Merch, T-Shirts & Hoodies' },
    { value: 'camp_registration', label: '🤖 Summer STEM & Robotics Camp Fees' },
    { value: 'donation', label: '🎁 Parent / Booster Club Donation' },
    { value: 'sponsorship_check', label: '🏢 Direct Sponsor / Company Check' },
    { value: 'other_income', label: '💵 Other Income' }
  ];

  const accountOptions = [
    { value: 'hcb_bank', label: '🏦 Hack Club Bank (the-panther-project)' },
    { value: 'school_account', label: '🏫 Region 15 School Activity Account' },
    { value: 'cash_box', label: '📦 Team Pit / Shop Cash Box' }
  ];

  function handleSubmit() {
    if (!title.trim() || !amount) {
      formError = 'A description and deposit amount are required.';
      return;
    }
    formError = '';

    if (deposit) {
      cacao.updateIncomeDeposit({
        ...deposit,
        title: title.trim(),
        amount: Number(amount) || 0,
        category,
        depositAccount,
        date,
        receiptUrl: receiptUrl.trim() || undefined,
        notes: notes.trim() || undefined
      });
    } else {
      cacao.addIncomeDeposit({
        title: title.trim(),
        amount: Number(amount) || 0,
        category,
        depositAccount,
        date,
        loggedByName: cacao.currentUser.name,
        loggedByEmail: cacao.currentUser.email,
        season: cacao.selectedSeason || '2026-2027',
        receiptUrl: receiptUrl.trim() || undefined,
        notes: notes.trim() || undefined
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

    <!-- Category & Destination Account -->
    <div class="grid sm:grid-cols-2 gap-3">
      <M3Select label="Revenue Category" bind:value={category as any} options={categoryOptions} />
      <M3Select label="Deposited Into Account" bind:value={depositAccount as any} options={accountOptions} />
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
