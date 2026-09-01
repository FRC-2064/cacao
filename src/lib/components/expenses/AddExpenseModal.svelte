<script lang="ts">
  import type { ExpenseCategory } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { M3Modal, M3Input, M3Select, SegmentedToggle, type SegmentedOption } from '@frc2064/ui';
  import { Plus, ShoppingCart, UserCheck } from 'lucide-svelte';
  import { EXPENSE_FORM_CATEGORIES, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import { defaultSeasonId, seasonLabelFor } from '$lib/components/finance/seasons';
  import { todayISO } from '$lib/finance/dates';

  interface Props {
    open: boolean;
    initialType?: 'purchase' | 'reimbursement';
    onclose: () => void;
  }

  let { open = $bindable(false), initialType = 'purchase', onclose }: Props = $props();

  const requestTypeOptions: SegmentedOption[] = [
    { value: 'purchase', label: 'Purchase Request', icon: ShoppingCart },
    { value: 'reimbursement', label: 'Reimbursement Request', icon: UserCheck }
  ];

  let requestType = $state<'purchase' | 'reimbursement'>('purchase');
  let title = $state('');
  let vendor = $state('');
  let amount = $state<number>(50);
  let category = $state<ExpenseCategory>(EXPENSE_FORM_CATEGORIES[0]);
  let itemLink = $state('');
  let receiptUrl = $state('');
  // Only a reimbursement has a purchase date to assert here -- a forward-looking
  // request has not spent anything yet, so it gets its date at "mark bought".
  let purchaseDate = $state(todayISO());
  let linkedGrantId = $state('');
  let notes = $state('');
  let formError = $state('');

  // Which season this request is booked against. Both spellings travel: the
  // mutation takes `seasonId`, the ledger filters on the `YYYY-YYYY` label.
  let seasonId = $state('');

  $effect(() => {
    if (open) {
      requestType = initialType;
      purchaseDate = todayISO();
      seasonId = defaultSeasonId(cacao.seasons, cacao.selectedSeason);
    }
  });

  const categoryOptions = EXPENSE_FORM_CATEGORIES.map((id) => ({
    value: id,
    label: EXPENSE_CATEGORY_META[id].label
  }));

  function handleSubmit() {
    if (!title.trim() || !vendor.trim() || !amount) {
      formError = 'An item description, vendor, and amount are all required.';
      return;
    }
    if (!seasonId) {
      formError = 'No season is available to book this request against yet.';
      return;
    }
    formError = '';

    // `requesterId`, `purchaserId` and the approver are all stamped from the
    // session server-side. There is no argument for any of them, and the names
    // that come back are resolved projections -- so this form sends none.
    const season = seasonLabelFor(cacao.seasons, seasonId);

    if (requestType === 'reimbursement') {
      cacao.addExpense({
        title: title.trim(),
        vendor: vendor.trim(),
        amount: Number(amount) || 0,
        finalPaidAmount: Number(amount) || 0,
        currency: 'USD',
        category,
        status: cacao.currentUser.role === 'admin' ? 'approved' : 'pending_approval',
        seasonId,
        season,
        paymentMethod: 'personal_reimbursement',
        date: purchaseDate || undefined,
        deliveryStatus: 'delivered',
        receiptUrl: receiptUrl.trim() || undefined,
        itemLink: itemLink.trim() || undefined,
        linkedGrantId: linkedGrantId || undefined,
        notes: notes.trim() || undefined,
        approvedAt: cacao.currentUser.role === 'admin' ? Date.now() : undefined
      });
    } else {
      cacao.addExpense({
        title: title.trim(),
        vendor: vendor.trim(),
        amount: Number(amount) || 0,
        currency: 'USD',
        category,
        status: cacao.currentUser.role === 'admin' ? 'approved' : 'pending_approval',
        seasonId,
        season,
        deliveryStatus: 'ordered',
        itemLink: itemLink.trim() || undefined,
        linkedGrantId: linkedGrantId || undefined,
        notes: notes.trim() || undefined,
        approvedAt: cacao.currentUser.role === 'admin' ? Date.now() : undefined
      });
    }

    title = '';
    vendor = '';
    amount = 50;
    category = EXPENSE_FORM_CATEGORIES[0];
    itemLink = '';
    receiptUrl = '';
    purchaseDate = todayISO();
    linkedGrantId = '';
    notes = '';
    formError = '';
    onclose();
  }
</script>

{#if cacao.currentUser.role !== 'viewer'}
<M3Modal
  bind:open
  {onclose}
  title={requestType === 'reimbursement' ? 'Reimbursement Request' : 'New Purchase Request'}
  description={requestType === 'reimbursement'
    ? 'Request reimbursement for items you already purchased with your own money'
    : 'Request parts, materials, tools, or event expenses for the team to purchase'}
  maxWidth="lg"
>
  <div class="mb-4">
    <SegmentedToggle
      options={requestTypeOptions}
      value={requestType}
      onchange={(v) => (requestType = v as 'purchase' | 'reimbursement')}
      class="segmented-full"
      ariaLabel="Request type"
    />
  </div>

  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSubmit();
    }}
    class="space-y-4"
  >
    <M3Input
      label={requestType === 'reimbursement' ? 'Item / Material Description' : 'Item Description / Purpose'}
      placeholder="e.g. Swerve Drive Wheel Modules & Bearings"
      bind:value={title}
      required
    />

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Input
        label="Vendor / Store"
        placeholder="e.g. Home Depot, McMaster, AndyMark"
        bind:value={vendor}
        required
      />
      <M3Input
        label={requestType === 'reimbursement' ? 'Amount Paid Out of Pocket ($ USD)' : 'Estimated Value ($ USD)'}
        type="number"
        bind:value={amount}
        required
      />
    </div>

    <div>
      <M3Select label="Category" bind:value={category as any} options={categoryOptions} />
    </div>

    {#if requestType === 'reimbursement'}
      <M3Input
        label="Purchase Date"
        type="date"
        bind:value={purchaseDate}
        helper="The day you actually paid, not today's date"
      />
      <M3Input
        label="Receipt / Proof of Purchase Link (Optional)"
        type="url"
        placeholder="https://drive.google.com/..."
        bind:value={receiptUrl}
        helper="Upload your receipt or photo to Google Drive/Stripe and paste the link here"
      />
    {:else}
      <M3Input
        label="Product / Store Link"
        type="url"
        placeholder="https://www.andymark.com/products/..."
        bind:value={itemLink}
      />
    {/if}

    <div class="field">
      <label for="new_exp_grant_select" class="field-label">
        Funded By Grant (Optional)
      </label>
      <select
        id="new_exp_grant_select"
        bind:value={linkedGrantId}
        class="select-input"
      >
        <option value="">General Team Funds</option>
        {#each cacao.grants as g}
          <option value={g._id}>{g.title} (${g.amount})</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="new_exp_notes_text" class="field-label">
        {requestType === 'reimbursement' ? 'Reason / Details of Purchase' : 'Notes & Justification'}
      </label>
      <textarea
        id="new_exp_notes_text"
        bind:value={notes}
        rows={2}
        placeholder={requestType === 'reimbursement'
          ? 'e.g. Emergency hardware bought at local store for competition intake repair...'
          : 'Why is this purchase required? (e.g. Needed for practice robot intake testing)...'}
        class="textarea-input"
      ></textarea>
    </div>

    {#if formError}
      <p class="field-error" role="alert">{formError}</p>
    {/if}

    <div class="flex items-center justify-end gap-2 pt-2">
      <button type="button" class="btn btn-text" onclick={onclose}>
        Cancel
      </button>
      <button type="submit" class="btn btn-filled">
        <Plus size={16} />
        <span>{requestType === 'reimbursement' ? 'Submit Reimbursement Request' : 'Submit Request'}</span>
      </button>
    </div>
  </form>
</M3Modal>
{/if}
