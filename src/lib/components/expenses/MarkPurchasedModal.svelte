<script lang="ts">
  import type { Expense, PaymentMethod, CarrierType, DeliveryStatus } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { ShoppingCart, CreditCard, Truck, Check, Receipt } from 'lucide-svelte';

  interface Props {
    expense: Expense | null;
    open: boolean;
    onclose: () => void;
  }

  let { expense, open = $bindable(false), onclose }: Props = $props();

  let finalPaidAmount = $state<number>(0);
  let paymentMethod = $state<PaymentMethod>('hcb_card');
  let purchaserName = $state('');
  let orderNumber = $state('');
  let carrier = $state<CarrierType>('UPS');
  let trackingNumber = $state('');
  let expectedDeliveryDate = $state('');
  let deliveryStatus = $state<DeliveryStatus>('ordered');
  let receiptUrl = $state('');

  $effect(() => {
    if (expense) {
      finalPaidAmount = expense.finalPaidAmount ?? expense.amount;
      paymentMethod = expense.paymentMethod || 'hcb_card';
      purchaserName = expense.purchaserName || cacao.currentUser.name;
      orderNumber = expense.orderNumber || '';
      carrier = expense.carrier || 'UPS';
      trackingNumber = expense.trackingNumber || '';
      expectedDeliveryDate = expense.expectedDeliveryDate || '';
      deliveryStatus = expense.deliveryStatus || 'ordered';
      receiptUrl = expense.receiptUrl || '';
    }
  });

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
    { value: 'ordered', label: '📦 Order Placed (Processing)' },
    { value: 'shipped', label: '🚚 Shipped / In Transit' },
    { value: 'delivered', label: '✅ Delivered / Received in Shop' }
  ];

  const savings = $derived(expense ? expense.amount - Number(finalPaidAmount || 0) : 0);

  function handleSubmit() {
    if (!expense) return;

    cacao.recordPurchase(expense._id, {
      finalPaidAmount: Number(finalPaidAmount) || 0,
      paymentMethod,
      purchaserName: purchaserName.trim() || cacao.currentUser.name,
      orderNumber: orderNumber.trim() || undefined,
      carrier,
      trackingNumber: trackingNumber.trim() || undefined,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      deliveryStatus,
      receiptUrl: receiptUrl.trim() || undefined
    });

    onclose();
  }
</script>

{#if expense}
  <M3Modal
    bind:open
    {onclose}
    title={`Mark Purchased: ${expense.vendor}`}
    description={`Record payment details, markdowns, and tracking for "${expense.title}"`}
  >
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
      <!-- Item Summary & Price Markdown Comparison -->
      <div class="panel space-y-2.5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="type-title">{expense.title}</h3>
            <p class="type-body" style="color: var(--color-on-surface-variant)">
              {expense.vendor} · {expense.subteam}
            </p>
          </div>
          <div class="text-right">
            <span class="type-label-sm block" style="color: var(--color-on-surface-variant)">Estimate</span>
            <span class="type-title type-num">${expense.amount.toFixed(2)}</span>
          </div>
        </div>

        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <M3Input
            label="Actual Amount Paid ($ USD)"
            type="number"
            bind:value={finalPaidAmount}
            required
            helper="Adjust if discounted or tax-exempt"
          />

          <div class="flex flex-col justify-center">
            {#if savings > 0}
              <div class="chip chip-success w-full justify-start">
                <span class="type-label type-num">Saved ${savings.toFixed(2)}</span>
              </div>
            {:else if savings < 0}
              <div class="chip chip-tertiary w-full justify-start">
                <span class="type-label type-num">+${Math.abs(savings).toFixed(2)} over</span>
              </div>
            {:else}
              <div class="chip w-full justify-start">
                <span>Matches exact request estimate</span>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Payment Method & Purchaser -->
      <div class="grid gap-3 sm:grid-cols-2">
        <M3Select
          label="Payment Method"
          bind:value={paymentMethod as any}
          options={paymentMethodOptions}
        />

        <div class="field">
          <label for="purchase_cardholder_input" class="field-label">
            Purchaser / Cardholder
          </label>
          <input
            id="purchase_cardholder_input"
            type="text"
            placeholder="e.g. Robin Alvarez"
            bind:value={purchaserName}
            class="text-input"
          />
        </div>
      </div>

      <!-- Order # and Receipt Link -->
      <div class="grid gap-3 sm:grid-cols-2">
        <M3Input
          label="Order / Confirmation #"
          placeholder="e.g. AM-2026-8812"
          bind:value={orderNumber}
        />

        <M3Input
          label="Receipt / Invoice URL"
          type="url"
          placeholder="https://drive.google.com/..."
          bind:value={receiptUrl}
          helper="Google Drive or HCB transaction link"
        />
      </div>

      <!-- Shipping Carrier, Tracking # & Delivery Status -->
      <div class="panel space-y-3">
        <span class="field-label block">
          Fulfillment & Shipping Tracking
        </span>

        <div class="grid gap-3 sm:grid-cols-2">
          <M3Select label="Carrier" bind:value={carrier as any} options={carrierOptions} />
          <M3Input label="Tracking Number" placeholder="1Z999999..." bind:value={trackingNumber} />
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <M3Input label="Expected Delivery Date" type="date" bind:value={expectedDeliveryDate} />
          <M3Select label="Delivery Status" bind:value={deliveryStatus as any} options={deliveryStatusOptions} />
        </div>
      </div>

      <!-- Footer Buttons -->
      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" class="btn btn-text" onclick={onclose}>
          Cancel
        </button>
        <button type="submit" class="btn btn-filled">
          <ShoppingCart size={14} />
          <span>Record Order</span>
        </button>
      </div>
    </form>
  </M3Modal>
{/if}
