<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { M3Modal } from '@frc2064/ui';
  import {
    HCB_INCOME_CATEGORIES,
    HCB_EXPENSE_CATEGORIES,
    INCOME_CATEGORY_META,
    EXPENSE_CATEGORY_META,
    type ExpenseCategory,
    type IncomeCategory
  } from '$lib/finance/categories';
  import type { LedgerEntry } from '$lib/finance/ledger';
  import { Check, Landmark, Wand2 } from 'lucide-svelte';

  /**
   * Files one Hack Club Bank transaction under a category. Bank transactions
   * are not records anyone typed in, so there is no expense or deposit form to
   * edit -- this modal is the only place a human decision about them is made.
   */
  interface Props {
    entry: LedgerEntry | null;
    open: boolean;
    onclose: () => void;
  }

  let { entry, open = $bindable(false), onclose }: Props = $props();

  const direction = $derived(entry?.direction ?? 'out');

  const options = $derived(
    direction === 'in'
      ? HCB_INCOME_CATEGORIES.map((id) => ({ id: id as string, ...INCOME_CATEGORY_META[id] }))
      : HCB_EXPENSE_CATEGORIES.map((id) => ({ id: id as string, ...EXPENSE_CATEGORY_META[id] }))
  );

  /**
   * Whether the team has actually filed this one, as opposed to the memo rules
   * having classified it. Only a filing can be cleared, so the "classify
   * automatically" choice is only offered when there is something to clear.
   */
  const isFiled = $derived(entry ? entry.id in cacao.hcbCategoryOverrides : false);

  /**
   * The selection, as its own state rather than derived from the entry: the
   * modal is a draft until Save, so picking a category must not file it. Keyed
   * on the entry so reopening on a different transaction starts fresh --
   * `$derived` on the entry id is what makes that reset happen, since the
   * modal is not remounted between rows.
   */
  let selected = $state<string>('');
  let lastEntryId = $state<string | null>(null);

  $effect(() => {
    // Cleared on close so that reopening always re-reads what is actually on
    // record -- otherwise a draft abandoned with Cancel would come back as
    // though it had been saved.
    if (!entry) {
      lastEntryId = null;
      return;
    }
    if (entry.id !== lastEntryId) {
      lastEntryId = entry.id;
      selected = isFiled ? entry.category : '';
    }
  });

  const amountLabel = $derived(
    entry ? `${direction === 'in' ? '+' : '−'}$${entry.amount.toFixed(2)}` : ''
  );

  function save() {
    if (!entry) return;
    if (selected === '') {
      cacao.clearHcbCategory(entry.id);
    } else {
      cacao.setHcbCategory(entry.id, direction, selected as IncomeCategory | ExpenseCategory);
    }
    onclose();
  }
</script>

{#if entry}
  <M3Modal
    {open}
    maxWidth="sm"
    title="Categorize transaction"
    description="This came off the bank feed and was never logged here, so pick where it belongs."
    {onclose}
  >
    <div class="space-y-4">
      <!-- What is actually being filed. Without the memo and the amount in
           front of you, the category list is a guess. -->
      <div class="panel">
        <p class="type-label truncate">{entry.title}</p>
        <p class="type-label-sm mt-1 flex items-center gap-2" style="color: var(--color-on-surface-variant)">
          <Landmark size={13} />
          <span class="type-num">{amountLabel}</span>
          <span>·</span>
          <span class="type-num">{entry.date}</span>
        </p>
      </div>

      <div class="space-y-1.5">
        {#each options as opt}
          <button
            type="button"
            class="category-option w-full text-left"
            class:is-selected={selected === opt.id}
            onclick={() => (selected = opt.id)}
          >
            <span class="flow-swatch" style={`background: ${opt.flow}`}></span>
            <span class="min-w-0 flex-1">
              <span class="type-label block truncate">{opt.label}</span>
              <span class="type-label-sm block truncate" style="color: var(--color-on-surface-variant)">
                {opt.note}
              </span>
            </span>
            {#if selected === opt.id}
              <Check size={16} style="color: var(--color-primary)" />
            {/if}
          </button>
        {/each}

        {#if isFiled}
          <!-- Only meaningful once there is a filing to undo; otherwise the
               transaction is already classified automatically. -->
          <button
            type="button"
            class="category-option w-full text-left"
            class:is-selected={selected === ''}
            onclick={() => (selected = '')}
          >
            <span class="flow-swatch" style="background: var(--color-flow-muted)"></span>
            <span class="min-w-0 flex-1">
              <span class="type-label flex items-center gap-1.5">
                <Wand2 size={13} />
                Classify automatically
              </span>
              <span class="type-label-sm block truncate" style="color: var(--color-on-surface-variant)">
                Go back to guessing from the memo
              </span>
            </span>
            {#if selected === ''}
              <Check size={16} style="color: var(--color-primary)" />
            {/if}
          </button>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-2 pt-1">
        <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
        <button type="button" class="btn btn-filled" disabled={selected === '' && !isFiled} onclick={save}>
          <Check size={14} />
          <span>Save</span>
        </button>
      </div>
    </div>
  </M3Modal>
{/if}

<style>
  .category-option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    border-radius: var(--shape-md);
    border: 1px solid var(--color-outline-variant);
    background: var(--color-surface-container);
    transition: background 120ms ease, border-color 120ms ease;
  }

  .category-option:hover {
    background: var(--color-surface-container-high);
  }

  .category-option.is-selected {
    border-color: var(--color-primary);
    background: var(--color-primary-container);
  }

  /* The same ribbon colour the category gets in the Sankey, so the choice made
     here is recognisable on the dashboard afterwards. */
  .flow-swatch {
    width: 0.5rem;
    height: 1.75rem;
    flex-shrink: 0;
    border-radius: 999px;
  }
</style>
