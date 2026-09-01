<script lang="ts">
  import type { Expense, ExpenseCategory, ExpenseStatus, PaymentMethod, CarrierType, DeliveryStatus } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { M3Modal, M3Input, M3Select } from '@frc2064/ui';
  import { Plus, Receipt, Trash2, ShoppingCart } from 'lucide-svelte';
  import DonorNameInput from '$lib/components/donors/DonorNameInput.svelte';
  import { EXPENSE_FORM_CATEGORIES, EXPENSE_CATEGORY_META } from '$lib/finance/categories';
  import { defaultSeasonId, seasonLabelFor, seasonIdOptions } from '$lib/components/finance/seasons';
  import { todayISO } from '$lib/finance/dates';

  interface Props {
    expense?: Expense | null;
    open: boolean;
    onclose: () => void;
  }

  let { expense = null, open = $bindable(false), onclose }: Props = $props();

  let title = $state('');
  let vendor = $state('');
  let amount = $state<number>(50);
  let finalPaidAmount = $state<number | undefined>(undefined);
  let category = $state<ExpenseCategory>(EXPENSE_FORM_CATEGORIES[0]);
  let itemLink = $state('');
  let receiptUrl = $state('');
  let linkedGrantId = $state('');
  let notes = $state('');
  let formError = $state('');
  let status = $state<ExpenseStatus>('pending_approval');
  let paymentMethod = $state<PaymentMethod>('personal_reimbursement');
  let orderNumber = $state('');
  let trackingNumber = $state('');
  let carrier = $state<CarrierType>('UPS');
  let expectedDeliveryDate = $state('');
  let deliveryStatus = $state<DeliveryStatus>('ordered');
  let donorName = $state('');
  let taxYear = $state<number>(new Date().getFullYear());
  let purchaseDate = $state('');
  let seasonId = $state('');

  $effect(() => {
    if (expense) {
      title = expense.title;
      vendor = expense.vendor;
      amount = expense.amount;
      finalPaidAmount = expense.finalPaidAmount ?? expense.amount;
      category = expense.category;
      itemLink = expense.itemLink || '';
      receiptUrl = expense.receiptUrl || '';
      linkedGrantId = expense.linkedGrantId || '';
      notes = expense.notes || '';
      status = expense.status;
      paymentMethod = expense.paymentMethod || 'personal_reimbursement';
      orderNumber = expense.orderNumber || '';
      trackingNumber = expense.trackingNumber || '';
      carrier = expense.carrier || 'UPS';
      expectedDeliveryDate = expense.expectedDeliveryDate || '';
      deliveryStatus = expense.deliveryStatus || 'ordered';
      donorName = expense.donorName || '';
      taxYear = expense.taxYear ?? new Date().getFullYear();
      seasonId = expense.seasonId;
      // Left blank rather than back-filled from the timestamps: an empty field
      // means "still inferred", which is exactly what the record says.
      purchaseDate = expense.date || '';
    } else {
      title = '';
      vendor = '';
      amount = 50;
      finalPaidAmount = undefined;
      category = EXPENSE_FORM_CATEGORIES[0];
      itemLink = '';
      receiptUrl = '';
      linkedGrantId = '';
      notes = '';
      status = 'pending_approval';
      paymentMethod = 'personal_reimbursement';
      orderNumber = '';
      trackingNumber = '';
      carrier = 'UPS';
      expectedDeliveryDate = '';
      deliveryStatus = 'ordered';
      donorName = '';
      taxYear = new Date().getFullYear();
      seasonId = defaultSeasonId(cacao.seasons, cacao.selectedSeason);
      purchaseDate = todayISO();
    }
  });

  const seasonOptions = $derived(seasonIdOptions(cacao.seasons));

  const categoryOptions = EXPENSE_FORM_CATEGORIES.map((id) => ({
    value: id,
    label: EXPENSE_CATEGORY_META[id].label
  }));

  const statusOptions = [
    { value: 'pending_approval', label: 'Pending Approval' },
    { value: 'approved', label: 'Approved' },
    { value: 'purchased', label: 'Purchased' },
    { value: 'reimbursed', label: 'Reimbursed' },
    { value: 'donated', label: 'Donated (not reimbursed)' },
    { value: 'rejected', label: 'Rejected' }
  ];

  const paymentMethodOptions = $derived([
    ...(expense?.paymentMethod === 'hcb_card' ? [{ value: 'hcb_card', label: 'Hack Club Bank Card' }] : []),
    { value: 'personal_reimbursement', label: 'Personal Card (Reimbursement)' },
    { value: 'school_po', label: 'Region 15 School PO / Check' },
    { value: 'grant_voucher', label: 'Grant Voucher / Credit' },
    { value: 'cash', label: 'Cash / Other' }
  ]);

  const carrierOptions = [
    { value: 'UPS', label: 'UPS' },
    { value: 'FedEx', label: 'FedEx' },
    { value: 'USPS', label: 'USPS' },
    { value: 'Amazon', label: 'Amazon Delivery' },
    { value: 'DHL', label: 'DHL' },
    { value: 'Local Pickup', label: 'Local Store Pickup' },
    { value: 'Other', label: 'Other' }
  ];

  const deliveryStatusOptions = [
    { value: 'ordered', label: 'Order Placed' },
    { value: 'shipped', label: 'In Transit' },
    { value: 'delivered', label: 'Delivered / In Shop' }
  ];

  function handleSubmit() {
    if (!title.trim() || !vendor.trim() || !amount) {
      formError = 'An item description, vendor, and amount are all required.';
      return;
    }
    if (!seasonId) {
      formError = 'No season is available to book this expense against yet.';
      return;
    }
    formError = '';

    const season = seasonLabelFor(cacao.seasons, seasonId);

    if (expense) {
      cacao.updateExpense({
        ...expense,
        title: title.trim(),
        vendor: vendor.trim(),
        amount: Number(amount) || 0,
        finalPaidAmount: finalPaidAmount ? Number(finalPaidAmount) : undefined,
        category,
        itemLink: itemLink.trim() || undefined,
        receiptUrl: receiptUrl.trim() || undefined,
        // The key stays present even when the picker is on "General Team
        // Funds": `expenseLinkedGrantField` reads a present-and-empty key as a
        // deliberate unlink and sends `null`, and an absent one as "this form
        // has no grant picker, leave the link alone". Drop the key here and
        // unlinking a grant silently reverts on the next snapshot.
        linkedGrantId: linkedGrantId || undefined,
        notes: notes.trim() || undefined,
        status,
        seasonId,
        season,
        paymentMethod: (status === 'purchased' || status === 'reimbursed') ? paymentMethod : expense.paymentMethod,
        orderNumber: orderNumber.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        carrier: trackingNumber.trim() ? carrier : undefined,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        date: purchaseDate || undefined,
        deliveryStatus,
        donorName: status === 'donated' ? donorName.trim() || undefined : undefined,
        taxYear: status === 'donated' ? Number(taxYear) || undefined : undefined
      });
    } else {
      cacao.addExpense({
        title: title.trim(),
        vendor: vendor.trim(),
        amount: Number(amount) || 0,
        finalPaidAmount: finalPaidAmount ? Number(finalPaidAmount) : undefined,
        currency: 'USD',
        category,
        status: cacao.currentUser.role === 'admin' ? 'approved' : 'pending_approval',
        seasonId,
        season,
        paymentMethod: paymentMethod || undefined,
        orderNumber: orderNumber.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        carrier: trackingNumber.trim() ? carrier : undefined,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        date: purchaseDate || undefined,
        deliveryStatus: 'ordered',
        itemLink: itemLink.trim() || undefined,
        receiptUrl: receiptUrl.trim() || undefined,
        linkedGrantId: linkedGrantId || undefined,
        notes: notes.trim() || undefined,
        approvedAt: cacao.currentUser.role === 'admin' ? Date.now() : undefined,
        donorName: status === 'donated' ? donorName.trim() || undefined : undefined,
        taxYear: status === 'donated' ? Number(taxYear) || undefined : undefined
      });
    }

    onclose();
  }

  function handleDelete() {
    if (expense && confirm(`Delete expense request "${expense.title}"?`)) {
      cacao.deleteExpense(expense._id);
      onclose();
    }
  }
</script>

{#if cacao.currentUser.role !== 'viewer'}
<M3Modal
  bind:open
  {onclose}
  title={expense ? 'Edit Expense / Purchase Record' : 'New Purchase Request'}
  description="Request robot parts, tools, materials, or log receipts and payment details"
  maxWidth="xl"
>
  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
    <!-- Description & Vendor -->
    <M3Input
      label="Item Description / Purpose"
      placeholder="e.g. Swerve Drive Wheel Modules & Bearings"
      bind:value={title}
      required
    />

    <div class="grid sm:grid-cols-2 gap-3">
      <M3Input
        label="Vendor / Supplier"
        placeholder="e.g. AndyMark, WCP, McMaster"
        bind:value={vendor}
        required
      />
      <M3Input
        label="Requested Estimate ($ USD)"
        type="number"
        bind:value={amount}
        required
      />
    </div>

    <!-- Category -->
    <div>
      <M3Select label="Expense Category" bind:value={category as any} options={categoryOptions} />
    </div>

    <!-- Linked Grant & Status -->
    <div class="grid sm:grid-cols-2 gap-3">
      <div class="field">
        <label for="exp_grant_select" class="field-label">
          Funded By Grant (Optional)
        </label>
        <select
          id="exp_grant_select"
          bind:value={linkedGrantId}
          class="select-input"
        >
          <option value="">General Team Funds</option>
          {#each cacao.grants as g}
            <option value={g._id}>{g.title} (${g.amount})</option>
          {/each}
        </select>
      </div>

      {#if expense || cacao.currentUser.role === 'admin'}
        <M3Select label="Approval Status" bind:value={status as any} options={statusOptions} />
      {/if}
    </div>

    <div class="grid sm:grid-cols-2 gap-3">
      <M3Select label="Season" bind:value={seasonId} options={seasonOptions} />
    </div>

    <!-- Order, Payment & Fulfillment Section -->
    <div class="panel space-y-3">
      <div class="flex items-center justify-between">
        <span class="field-label block">
          Payment Method & Order Fulfillment (How We Bought It)
        </span>
        {#if finalPaidAmount && finalPaidAmount < amount}
          <span class="type-label-sm type-num" style="color: var(--color-success)">
            Saved ${(amount - finalPaidAmount).toFixed(2)} on this purchase
          </span>
        {/if}
      </div>

      <div class="grid sm:grid-cols-3 gap-3">
        <M3Select label="Payment Method" bind:value={paymentMethod as any} options={paymentMethodOptions} />
        <M3Input
          label="Transaction Date"
          type="date"
          bind:value={purchaseDate}
          helper="The day the money moved"
        />
        <M3Input
          label="Actual Amount Paid ($ USD)"
          type="number"
          placeholder={amount.toString()}
          bind:value={
            () => finalPaidAmount ?? '',
            (v) => (finalPaidAmount = v === '' ? undefined : Number(v))
          }
          helper="Final price with discounts, tax-exempt or shipping"
        />
      </div>

      {#if status === 'donated'}
        <div class="grid sm:grid-cols-2 gap-3">
          <DonorNameInput
            id="exp_donor_name"
            label="Donor name"
            placeholder="Who waived reimbursement"
            bind:value={donorName}
            helper="Credited on the donor totals view. Pick an existing name where there is one."
          />
          <M3Input label="Tax year" type="number" bind:value={taxYear} />
        </div>
      {/if}

      <div class="grid sm:grid-cols-3 gap-3">
        <!-- Who bought it is stamped from the session, not typed. It reads
             back here so the record is legible, but there is no argument on
             `expenses.update` that would let this form set it. -->
        <div class="field">
          <span class="field-label">Purchaser</span>
          <p class="type-body pt-2" style="color: var(--color-on-surface-variant)">
            {expense?.purchaserName ?? 'Recorded when the purchase is marked'}
          </p>
        </div>
        <M3Input label="Order / Confirmation #" placeholder="e.g. AM-2026-8812" bind:value={orderNumber} />
        <M3Select label="Delivery Status" bind:value={deliveryStatus as any} options={deliveryStatusOptions} />
      </div>

      <div class="grid sm:grid-cols-3 gap-3 pt-1">
        <M3Select label="Carrier" bind:value={carrier as any} options={carrierOptions} />
        <M3Input label="Tracking Number" placeholder="1Z999999..." bind:value={trackingNumber} />
        <M3Input label="Expected Delivery Date" type="date" bind:value={expectedDeliveryDate} />
      </div>
    </div>

    <!-- External Links -->
    <div class="grid sm:grid-cols-2 gap-3 panel">
      <M3Input
        label="Product / Cart Link"
        type="url"
        placeholder="https://www.andymark.com/products/..."
        bind:value={itemLink}
      />
      <M3Input
        label="Receipt / Invoice URL"
        type="url"
        placeholder="https://drive.google.com/..."
        bind:value={receiptUrl}
      />
    </div>

    <!-- Notes -->
    <div class="field">
      <label for="exp_notes_text" class="field-label">Notes & justification</label>
      <textarea
        id="exp_notes_text"
        bind:value={notes}
        rows={2}
        placeholder="Why is this purchase required? (e.g. Critical for practice robot intake testing)..."
        class="textarea-input"
      ></textarea>
    </div>

    {#if formError}
      <p class="field-error" role="alert">{formError}</p>
    {/if}

    <div class="flex items-center justify-between gap-2 pt-2">
      {#if expense}
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
          <span>{expense ? 'Save Changes' : 'Submit Request'}</span>
        </button>
      </div>
    </div>
  </form>
</M3Modal>
{/if}
