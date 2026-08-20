<script lang="ts">
  import type { Expense, ExpenseCategory, ExpenseStatus, PaymentMethod, CarrierType, DeliveryStatus } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { Plus, Receipt, Trash2, ShoppingCart } from 'lucide-svelte';

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
  let category = $state<ExpenseCategory>('robot_parts');
  let subteam = $state('Mechanical & Build');
  let itemLink = $state('');
  let receiptUrl = $state('');
  let linkedGrantId = $state('');
  let notes = $state('');
  let formError = $state('');
  let status = $state<ExpenseStatus>('pending_approval');
  let paymentMethod = $state<PaymentMethod>('hcb_card');
  let purchaserName = $state('');
  let orderNumber = $state('');
  let trackingNumber = $state('');
  let carrier = $state<CarrierType>('UPS');
  let expectedDeliveryDate = $state('');
  let deliveryStatus = $state<DeliveryStatus>('ordered');

  $effect(() => {
    if (expense) {
      title = expense.title;
      vendor = expense.vendor;
      amount = expense.amount;
      finalPaidAmount = expense.finalPaidAmount ?? expense.amount;
      category = expense.category;
      subteam = expense.subteam;
      itemLink = expense.itemLink || '';
      receiptUrl = expense.receiptUrl || '';
      linkedGrantId = expense.linkedGrantId || '';
      notes = expense.notes || '';
      status = expense.status;
      paymentMethod = expense.paymentMethod || 'hcb_card';
      purchaserName = expense.purchaserName || '';
      orderNumber = expense.orderNumber || '';
      trackingNumber = expense.trackingNumber || '';
      carrier = expense.carrier || 'UPS';
      expectedDeliveryDate = expense.expectedDeliveryDate || '';
      deliveryStatus = expense.deliveryStatus || 'ordered';
    } else {
      title = '';
      vendor = '';
      amount = 50;
      finalPaidAmount = undefined;
      category = 'robot_parts';
      subteam = cacao.currentUser.subteam || 'Mechanical & Build';
      itemLink = '';
      receiptUrl = '';
      linkedGrantId = '';
      notes = '';
      status = 'pending_approval';
      paymentMethod = 'hcb_card';
      purchaserName = cacao.currentUser.name;
      orderNumber = '';
      trackingNumber = '';
      carrier = 'UPS';
      expectedDeliveryDate = '';
      deliveryStatus = 'ordered';
    }
  });

  const categoryOptions = [
    { value: 'robot_parts', label: 'Robot Hardware & Motors' },
    { value: 'electronics', label: 'Electronics & Control System' },
    { value: 'tools', label: 'Pit, Shop & Hand Tools' },
    { value: 'travel', label: 'Team Travel & Hotel Rooms' },
    { value: 'registration', label: 'FIRST / Competition Registration' },
    { value: 'food', label: 'Team Food & Competition Meals' },
    { value: 'media', label: 'Media, Banners & Team T-shirts' },
    { value: 'general', label: 'General Team Supplies' }
  ];

  const subteamOptions = [
    { value: 'Mechanical & Build', label: 'Mechanical & Build' },
    { value: 'Electrical & Pneumatics', label: 'Electrical & Pneumatics' },
    { value: 'Software & Controls', label: 'Software & Controls' },
    { value: 'Business & Grants', label: 'Business & Grants' },
    { value: 'Media & Outreach', label: 'Media & Outreach' },
    { value: 'Drive Team & Pit', label: 'Drive Team & Pit' }
  ];

  const statusOptions = [
    { value: 'pending_approval', label: 'Pending Mentor Approval' },
    { value: 'approved', label: 'Approved (Ready to Purchase)' },
    { value: 'purchased', label: 'Purchased / Order Placed' },
    { value: 'reimbursed', label: 'Reimbursed / Settled' },
    { value: 'rejected', label: 'Rejected / Cancelled' }
  ];

  const paymentMethodOptions = [
    { value: 'hcb_card', label: '💳 Hack Club Bank Debit Card' },
    { value: 'personal_reimbursement', label: '👤 Personal Card (Reimbursement Needed)' },
    { value: 'school_po', label: '🏫 Region 15 School PO / Check' },
    { value: 'grant_voucher', label: '🎟️ Grant Voucher / Vendor Credit (FIRST/REV/Haas)' },
    { value: 'cash', label: '💵 Cash / Other' }
  ];

  const carrierOptions = [
    { value: 'UPS', label: 'UPS' },
    { value: 'FedEx', label: 'FedEx' },
    { value: 'USPS', label: 'USPS' },
    { value: 'Amazon', label: 'Amazon Delivery' },
    { value: 'DHL', label: 'DHL' },
    { value: 'Local Pickup', label: 'Local Store Pickup' },
    { value: 'Other', label: 'Other Carrier' }
  ];

  const deliveryStatusOptions = [
    { value: 'ordered', label: '📦 Order Placed' },
    { value: 'shipped', label: '🚚 Shipped / In Transit' },
    { value: 'delivered', label: '✅ Delivered / In Shop' }
  ];

  function handleSubmit() {
    if (!title.trim() || !vendor.trim() || !amount) {
      formError = 'An item description, vendor, and amount are all required.';
      return;
    }
    formError = '';

    const linkedGrant = cacao.grants.find((g) => g._id === linkedGrantId);

    if (expense) {
      cacao.updateExpense({
        ...expense,
        title: title.trim(),
        vendor: vendor.trim(),
        amount: Number(amount) || 0,
        finalPaidAmount: finalPaidAmount ? Number(finalPaidAmount) : undefined,
        category,
        subteam,
        itemLink: itemLink.trim() || undefined,
        receiptUrl: receiptUrl.trim() || undefined,
        linkedGrantId: linkedGrantId || undefined,
        linkedGrantTitle: linkedGrant?.title || undefined,
        notes: notes.trim() || undefined,
        status,
        paymentMethod: (status === 'purchased' || status === 'reimbursed') ? paymentMethod : expense.paymentMethod,
        purchaserName: purchaserName.trim() || undefined,
        orderNumber: orderNumber.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        carrier: trackingNumber.trim() ? carrier : undefined,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        deliveryStatus
      });
    } else {
      cacao.addExpense({
        title: title.trim(),
        vendor: vendor.trim(),
        amount: Number(amount) || 0,
        finalPaidAmount: finalPaidAmount ? Number(finalPaidAmount) : undefined,
        currency: 'USD',
        category,
        subteam,
        requesterName: cacao.currentUser.name,
        requesterEmail: cacao.currentUser.email,
        status: cacao.currentUser.role === 'admin' ? 'approved' : 'pending_approval',
        season: cacao.selectedSeason || '2026-2027',
        paymentMethod: paymentMethod || undefined,
        purchaserName: purchaserName.trim() || undefined,
        orderNumber: orderNumber.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        carrier: trackingNumber.trim() ? carrier : undefined,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        deliveryStatus: 'ordered',
        itemLink: itemLink.trim() || undefined,
        receiptUrl: receiptUrl.trim() || undefined,
        linkedGrantId: linkedGrantId || undefined,
        linkedGrantTitle: linkedGrant?.title || undefined,
        notes: notes.trim() || undefined,
        approvedBy: cacao.currentUser.role === 'admin' ? cacao.currentUser.name : undefined,
        approvedAt: cacao.currentUser.role === 'admin' ? Date.now() : undefined
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

    <!-- Category & Subteam -->
    <div class="grid sm:grid-cols-2 gap-3">
      <M3Select label="Expense Category" bind:value={category as any} options={categoryOptions} />
      <M3Select label="Subteam" bind:value={subteam} options={subteamOptions} />
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
          <option value="">General Team Funds / HCB Bank</option>
          {#each cacao.grants as g}
            <option value={g._id}>{g.title} (${g.amount})</option>
          {/each}
        </select>
      </div>

      {#if expense || cacao.currentUser.role === 'admin'}
        <M3Select label="Approval Status" bind:value={status as any} options={statusOptions} />
      {/if}
    </div>

    <!-- Order, Payment & Fulfillment Section -->
    <div class="panel space-y-3">
      <div class="flex items-center justify-between">
        <span class="field-label block">
          Payment Method & Order Fulfillment (How We Bought It)
        </span>
        {#if finalPaidAmount && finalPaidAmount < amount}
          <span class="type-label-sm type-num" style="color: var(--color-success)">
            ✨ Saved ${(amount - finalPaidAmount).toFixed(2)} on discount!
          </span>
        {/if}
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <M3Select label="Payment Method" bind:value={paymentMethod as any} options={paymentMethodOptions} />
        <M3Input
          label="Actual Amount Paid ($ USD)"
          type="number"
          placeholder={amount.toString()}
          bind:value={finalPaidAmount}
          helper="Final price with discounts, tax-exempt or shipping"
        />
      </div>

      <div class="grid sm:grid-cols-3 gap-3">
        <M3Input label="Purchaser / Cardholder" placeholder="e.g. Robin Alvarez" bind:value={purchaserName} />
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
