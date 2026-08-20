<script lang="ts">
  interface Props {
    label?: string;
    placeholder?: string;
    type?: 'text' | 'number' | 'email' | 'url' | 'date' | 'password';
    value?: string | number;
    required?: boolean;
    disabled?: boolean;
    helper?: string;
    error?: string;
    id?: string;
    class?: string;
    oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
  }

  let {
    label,
    placeholder = '',
    type = 'text',
    value = $bindable(''),
    required = false,
    disabled = false,
    helper,
    error,
    id,
    class: className = '',
    oninput
  }: Props = $props();

  const generatedId = $derived(
    id || (label ? `inp_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : undefined)
  );
</script>

<div class={`field ${className}`}>
  {#if label}
    <label for={generatedId} class="field-label">
      {label}
      {#if required}<span style="color: var(--color-error)">*</span>{/if}
    </label>
  {/if}
  <input
    id={generatedId}
    {type}
    {placeholder}
    {required}
    {disabled}
    bind:value
    {oninput}
    aria-invalid={error ? 'true' : undefined}
    class={`text-input ${error ? 'input-invalid' : ''}`}
  />
  {#if error}
    <p class="field-error">{error}</p>
  {:else if helper}
    <p class="field-helper">{helper}</p>
  {/if}
</div>
