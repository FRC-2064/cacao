<script lang="ts">
  import type { Sponsor, SponsorTier, SponsorCategory, SponsorStatus } from '$lib/types';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import M3Modal from '$lib/components/m3/M3Modal.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import M3Select from '$lib/components/m3/M3Select.svelte';
  import { Save } from 'lucide-svelte';

  interface Props {
    sponsor: Sponsor | null;
    open: boolean;
    onclose: () => void;
  }

  let { sponsor, open = $bindable(false), onclose }: Props = $props();

  let name = $state('');
  let category = $state<SponsorCategory>('corporate');
  let tier = $state<SponsorTier>('gold');
  let status = $state<SponsorStatus>('contacted');
  let totalDonated = $state<number>(0);
  let currentYearPledge = $state<number>(1000);
  let website = $state('');
  let logoUrl = $state('');
  let address = $state('');
  let notes = $state('');
  /**
   * The `contacts` row id of this sponsor's point of contact.
   *
   * The two free-text boxes that used to be here wrote `primaryContactName`
   * and `primaryContactEmail` onto the sponsor -- a public row -- while the
   * same adult's details already lived in the gated `contacts` table. Both
   * columns are gone; a sponsor points at a contact instead, and the details
   * are read from `api.contacts.list` by whoever is allowed to see them.
   */
  let primaryContactId = $state('');
  let formError = $state('');

  $effect(() => {
    if (sponsor) {
      name = sponsor.name;
      category = sponsor.category;
      tier = sponsor.tier;
      status = sponsor.status;
      totalDonated = sponsor.totalDonated;
      currentYearPledge = sponsor.currentYearPledge || 0;
      website = sponsor.website || '';
      logoUrl = sponsor.logoUrl || '';
      address = sponsor.address || '';
      notes = sponsor.notes || '';
      primaryContactId = sponsor.primaryContactId || '';
    } else {
      name = '';
      category = 'corporate';
      tier = 'bronze';
      status = 'lead';
      totalDonated = 0;
      currentYearPledge = 500;
      website = '';
      logoUrl = '';
      address = '';
      notes = '';
      primaryContactId = '';
    }
  });

  const categoryOptions = [
    { value: 'corporate', label: 'Corporate Sponsor' },
    { value: 'local_business', label: 'Local Business Partner' },
    { value: 'foundation', label: 'Charitable Foundation' },
    { value: 'community_partner', label: 'Community Organization' },
    { value: 'in_kind_supplier', label: 'In-Kind Supplier / Services' }
  ];

  const tierOptions = [
    { value: 'platinum', label: 'Platinum Tier ($5,000+)' },
    { value: 'gold', label: 'Gold Tier ($2,500)' },
    { value: 'silver', label: 'Silver Tier ($1,000)' },
    { value: 'bronze', label: 'Bronze Tier ($500)' },
    { value: 'panther_partner', label: 'Panther Partner ($250)' },
    { value: 'in_kind', label: 'In-Kind Partner' },
    { value: 'none', label: 'Prospective / Unranked' }
  ];

  const contactOptions = $derived([
    { value: '', label: 'No primary contact' },
    ...cacao.contacts.map((c) => ({
      value: c._id,
      label: c.title ? `${c.name} — ${c.title}` : c.name
    }))
  ]);

  const statusOptions = [
    { value: 'lead', label: 'Lead / Prospect' },
    { value: 'contacted', label: 'Initial Outreach Sent' },
    { value: 'in_discussion', label: 'Meeting / In Discussion' },
    { value: 'packet_sent', label: 'Sponsorship Packet Delivered' },
    { value: 'pledged', label: 'Pledged / Committed' },
    { value: 'paid_active', label: 'Paid & Active' },
    { value: 'declined', label: 'Declined for this cycle' },
    { value: 'stale_renewal_due', label: 'Stale / annual renewal due' }
  ];

  function handleSubmit() {
    if (!name.trim()) {
      formError = 'An organization name is required.';
      return;
    }
    formError = '';

    if (sponsor) {
      cacao.updateSponsor({
        ...sponsor,
        name: name.trim(),
        category,
        tier,
        status,
        totalDonated: Number(totalDonated) || 0,
        currentYearPledge: Number(currentYearPledge) || 0,
        website: website.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        primaryContactId: primaryContactId || undefined
      });
    } else {
      cacao.addSponsor({
        name: name.trim(),
        category,
        tier,
        status,
        totalDonated: Number(totalDonated) || 0,
        currentYearPledge: Number(currentYearPledge) || 0,
        website: website.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        primaryContactId: primaryContactId || undefined,
        // Outreach lives in its own table and is written through
        // `sponsors.logOutreach`, never through `sponsors.create`. Seeding a
        // record here only ever produced a phantom row in the optimistic copy
        // that vanished on the next snapshot, and it asserted a touchpoint
        // that had not happened. "Log touchpoint" records a real one.
        annualHistory: []
      });
    }

    onclose();
  }

  function handleDelete() {
    if (!sponsor) return;
    if (confirm(`Are you sure you want to delete "${sponsor.name}"?`)) {
      cacao.deleteSponsor(sponsor._id);
      onclose();
    }
  }
</script>

{#if cacao.currentUser.role !== 'viewer'}
<M3Modal
  bind:open
  {onclose}
  title={sponsor ? sponsor.name : 'Add sponsor'}
  description="Partnership tier, outreach status, and contact liaison"
>
  <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
    <M3Input
      label="Organization name"
      placeholder="e.g. BAE Systems or Local Hardware Store"
      bind:value={name}
      required
    />

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Select label="Category" bind:value={category} options={categoryOptions} />
      <M3Select label="Sponsorship tier" bind:value={tier} options={tierOptions} />
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <M3Select label="Outreach status" bind:value={status} options={statusOptions} />
      <M3Input
        label="Pledge this season ($)"
        type="number"
        bind:value={currentYearPledge}
      />
    </div>

    <div class="panel">
      <span class="panel-title">Primary contact</span>
      <M3Select
        label="Point of contact"
        bind:value={primaryContactId}
        options={contactOptions}
        helper="Chosen from the contacts list. Add the person there first if they are not listed."
      />
    </div>

    <!-- Media & Links -->
    <div class="grid gap-3 sm:grid-cols-2">
      <M3Input
        label="Website"
        type="url"
        placeholder="https://…"
        bind:value={website}
      />
      <M3Input
        label="Logo path"
        placeholder="/SponsorLogos/Boeing.png"
        bind:value={logoUrl}
      />
    </div>

    <div class="field">
      <label for="sponsor_notes_text" class="field-label">Notes & outreach strategy</label>
      <textarea
        id="sponsor_notes_text"
        bind:value={notes}
        rows={3}
        placeholder="Past sponsorship details, employee connections, preferred meeting times…"
        class="textarea-input"
      ></textarea>
    </div>

    {#if formError}
      <p class="field-error" role="alert">{formError}</p>
    {/if}

    <div class="flex items-center justify-between gap-2 pt-2">
      {#if sponsor}
        <button
          type="button"
          onclick={handleDelete}
          class="btn btn-text"
          style="color: var(--color-error)"
        >
          Delete
        </button>
      {:else}
        <span></span>
      {/if}

      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
        <button type="submit" class="btn btn-filled">
          <Save size={18} />
          <span>{sponsor ? 'Save changes' : 'Add sponsor'}</span>
        </button>
      </div>
    </div>
  </form>
</M3Modal>
{/if}
