<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    label?: string;
    value?: string;
    options: Option[];
    required?: boolean;
    disabled?: boolean;
    helper?: string;
    id?: string;
    class?: string;
    onchange?: (event: Event) => void;
  }

  let {
    label,
    value = $bindable(''),
    options = [],
    required = false,
    disabled = false,
    helper,
    id,
    class: className = '',
    onchange
  }: Props = $props();

  const selectId = $derived(
    id || (label ? `sel_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : undefined)
  );
</script>

<div class={`field ${className}`}>
  {#if label}
    <label for={selectId} class="field-label">
      {label}
      {#if required}<span style="color: var(--color-error)">*</span>{/if}
    </label>
  {/if}
  <select id={selectId} bind:value {required} {disabled} {onchange} class="select-input">
    {#each options as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  {#if helper}
    <p class="field-helper">{helper}</p>
  {/if}
</div>
