<script lang="ts">
  /**
   * A donor name field that offers the names already on record.
   *
   * A typeahead rather than a picker, because the client never handles a donor
   * id: `expenses.add`/`update` and `income.add`/`update` take a `donorName`
   * string and resolve or create the `donors` row server-side, inside the same
   * transaction as the gift, so a deposit can never commit with its donor
   * lost. A free-text box is therefore correct -- a name nobody has used
   * before has to be typeable. What the list is for is stopping "Ruth & Paul
   * Harrison" from being entered a second time as "Ruth and Paul Harrison"
   * and becoming two donors on the report.
   *
   * `api.donors.list` is read straight from the Convex client rather than
   * through the store: donors are not store state, nothing else needs them,
   * and this field is the only screen that asks. The query is gated on
   * `requireActor`, which costs nothing here -- this component is mounted only
   * inside `ExpenseModal` and `LogDepositModal`, both writer-only forms. With
   * no client the datalist is simply empty, which degrades to the plain
   * input it already was.
   */
  import { onMount } from 'svelte';
  import { getConvexClient } from '$lib/convex/client';
  import { api } from '../../../../convex/_generated/api';
  import type { Donor } from '$lib/types';

  interface Props {
    label?: string;
    value: string;
    placeholder?: string;
    helper?: string;
    id?: string;
  }

  let {
    label = 'Donor name',
    value = $bindable(''),
    placeholder = 'e.g. Ruth & Paul Harrison',
    helper,
    id = 'donor_name_input'
  }: Props = $props();

  let donors = $state<Donor[]>([]);

  onMount(() => {
    const client = getConvexClient();
    if (!client) return;
    return client.onUpdate(
      api.donors.list,
      {},
      (rows) => {
        donors = rows;
      },
      // A suggestion list failing is not worth a toast on a form the member is
      // in the middle of: they can still type the name.
      (e: Error) => console.error('Could not load donor names:', e)
    );
  });

  const listId = $derived(`${id}_options`);
</script>

<div class="field">
  {#if label}
    <label for={id} class="field-label">{label}</label>
  {/if}
  <input {id} type="text" {placeholder} list={listId} bind:value class="text-input" />
  <datalist id={listId}>
    {#each donors as donor (donor._id)}
      <option value={donor.displayName}></option>
    {/each}
  </datalist>
  {#if helper}
    <p class="field-helper">{helper}</p>
  {/if}
</div>
