<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { UserRole } from '$lib/types';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import {
    GraduationCap,
    History,
    Download,
    RefreshCw,
    Check,
    Cloud,
    CloudOff,
    TriangleAlert
  } from 'lucide-svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem, listRow } from '$lib/motion';

  let isSeeding = $state(false);

  let selectedGradYearFilter = $state<string>('all');
  let auditFilter = $state<string>('all');

  const pendingRequests = $derived(cacao.accessRequests.filter((r) => r.status === 'pending'));

  const rosterFilters = [
    { id: 'all', label: 'All members' },
    { id: 'mentors', label: 'Mentors' },
    { id: '2026', label: 'Class of 2026' },
    { id: '2027', label: 'Class of 2027' },
    { id: '2028', label: 'Class of 2028' },
    { id: '2029', label: 'Class of 2029' },
    { id: 'graduated', label: 'Alumni' }
  ];

  const filteredUsers = $derived.by(() => {
    if (selectedGradYearFilter === 'all') return cacao.users;
    if (selectedGradYearFilter === 'mentors') return cacao.users.filter((u) => u.role === 'admin');
    if (selectedGradYearFilter === 'graduated')
      return cacao.users.filter((u) => u.role === 'graduated');
    return cacao.users.filter((u) => u.gradYear === Number(selectedGradYearFilter));
  });

  const filteredAuditLogs = $derived.by(() => {
    if (auditFilter === 'all') return cacao.auditLogs;
    return cacao.auditLogs.filter((log) => log.entityType === auditFilter);
  });

  function handleApprove(reqId: string, role: UserRole = 'student') {
    cacao.approveAccessRequest(reqId, role);
  }

  function handleReject(reqId: string) {
    if (confirm('Deny this student access request?')) {
      cacao.rejectAccessRequest(reqId);
    }
  }

  function handleGraduateBatch(year: number) {
    if (confirm(`Graduate and archive all active students in the Class of ${year}?`)) {
      cacao.graduateClassBatch(year);
    }
  }

  function exportFullBackup() {
    const data = {
      grants: cacao.grants,
      sponsors: cacao.sponsors,
      contacts: cacao.contacts,
      users: cacao.users,
      auditLogs: cacao.auditLogs,
      exportedAt: new Date().toISOString()
    };
    const jsonStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', jsonStr);
    link.setAttribute('download', `2064_Cacao_Backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    cacao.showToast('Backup downloaded');
  }

  async function loadStarterData() {
    const prompt = cacao.isRemote
      ? 'Replace everything in the Convex deployment with the Team 2064 starter data?'
      : 'Reset all grants, sponsors, and contacts to the Team 2064 seed data?';
    if (!confirm(prompt)) return;

    isSeeding = true;
    try {
      await cacao.resetToSeedData();
    } finally {
      isSeeding = false;
    }
  }
</script>

<PageHeader
  title="Admin"
  description="Approve student requests, manage the graduation lifecycle, and audit every change"
>
  {#snippet actions()}
    <button type="button" class="btn btn-outlined" onclick={exportFullBackup}>
      <Download size={18} />
      <span>Backup JSON</span>
    </button>
    <button type="button" class="btn btn-tonal" disabled={isSeeding} onclick={loadStarterData}>
      <RefreshCw size={18} />
      <span>{cacao.isRemote ? 'Load starter data' : 'Reset seed'}</span>
    </button>
  {/snippet}
</PageHeader>

<div class="space-y-8">
  <section class="card-elevated flex flex-wrap items-center gap-3 p-4">
    {#if cacao.connectionError}
      <TriangleAlert size={20} class="text-[var(--md-sys-color-error)]" />
      <div class="min-w-0 flex-1">
        <p class="type-body-medium font-medium">Convex is unreachable</p>
        <p class="type-body-small text-[var(--md-sys-color-on-surface-variant)]">
          {cacao.connectionError}
        </p>
      </div>
    {:else if cacao.isRemote}
      <Cloud size={20} class="text-[var(--md-sys-color-primary)]" />
      <div class="min-w-0 flex-1">
        <p class="type-body-medium font-medium">
          Live on Convex{cacao.isLoading ? ' — syncing…' : ''}
        </p>
        <p class="type-body-small text-[var(--md-sys-color-on-surface-variant)]">
          Every change is saved to the shared deployment and appears for everyone immediately.
        </p>
      </div>
    {:else}
      <CloudOff size={20} class="text-[var(--md-sys-color-on-surface-variant)]" />
      <div class="min-w-0 flex-1">
        <p class="type-body-medium font-medium">Local demo mode</p>
        <p class="type-body-small text-[var(--md-sys-color-on-surface-variant)]">
          No <code>PUBLIC_CONVEX_URL</code> is set, so data lives in this browser only and is not
          shared with the rest of the team.
        </p>
      </div>
    {/if}
  </section>
  <section class="space-y-3">
    <h2 class="type-title flex items-center gap-2">
      <span>Pending access requests</span>
      {#if pendingRequests.length > 0}
        <span class="badge-count">{pendingRequests.length}</span>
      {/if}
    </h2>

    {#if pendingRequests.length > 0}
      <div class="grid gap-4 lg:grid-cols-2">
        {#each pendingRequests as req (req._id)}
          <article
            class="card-elevated space-y-3 p-4"
            animate:flip={listItem.flip}
            in:fly={listItem.in}
            out:scale={listItem.out}
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h3 class="type-title">{req.firstName} {req.lastName}</h3>
                <p class="type-body truncate" style="color: var(--color-on-surface-variant)">
                  {req.email}
                </p>
              </div>
              <span class="chip chip-sm shrink-0">Class of {req.gradYear}</span>
            </div>

            <div class="panel">
              <p class="type-body">
                <span style="color: var(--color-on-surface-variant)">Subteam ·</span>
                {req.subteam}
              </p>
              {#if req.notes}
                <p class="type-body mt-1" style="color: var(--color-on-surface-variant)">
                  {req.notes}
                </p>
              {/if}
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onclick={() => handleReject(req._id)}
                class="btn btn-text btn-sm mr-auto"
                style="color: var(--color-error)"
              >
                Deny
              </button>
              <button
                type="button"
                class="btn btn-tonal btn-sm"
                onclick={() => handleApprove(req._id, 'admin')}
              >
                As mentor
              </button>
              <button
                type="button"
                class="btn btn-filled btn-sm"
                onclick={() => handleApprove(req._id, 'student')}
              >
                <Check size={16} />
                <span>As student</span>
              </button>
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="card p-6 text-center">
        <p class="type-body">No pending access requests.</p>
        <p class="type-body mt-0.5" style="color: var(--color-on-surface-variant)">
          Students can request access with their @region15.org account.
        </p>
      </div>
    {/if}
  </section>

  <section class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="type-title">Team roster</h2>
        <p class="type-body" style="color: var(--color-on-surface-variant)">
          Archive seniors once they graduate
        </p>
      </div>

      <button type="button" class="btn btn-outlined btn-sm" onclick={() => handleGraduateBatch(2026)}>
        <GraduationCap size={16} />
        <span>Graduate class of 2026</span>
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      {#each rosterFilters as tab}
        <button
          type="button"
          aria-pressed={selectedGradYearFilter === tab.id}
          onclick={() => (selectedGradYearFilter = tab.id)}
          class="filter-chip"
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each filteredUsers as user (user._id)}
        <div
          class="card flex items-center gap-3 p-3"
          animate:flip={listItem.flip}
          in:fly={listItem.in}
          out:scale={listItem.out}
        >
          <span
            class="type-label grid h-9 w-9 shrink-0 place-items-center rounded-full"
            style="background: var(--color-secondary-container); color: var(--color-on-secondary-container)"
          >
            {user.name.charAt(0)}
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="type-label truncate">{user.name}</span>
              {#if user.role === 'admin'}
                <span class="chip chip-sm chip-primary">Mentor</span>
              {:else if user.role === 'graduated'}
                <span class="chip chip-sm">Alumni</span>
              {/if}
            </div>
            <span class="type-label-sm block truncate" style="color: var(--color-on-surface-variant)">
              {user.email}
            </span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="type-title flex items-center gap-2">
          <History size={18} />
          <span>Audit trail</span>
        </h2>
        <p class="type-body" style="color: var(--color-on-surface-variant)">
          {filteredAuditLogs.length} timestamped events
        </p>
      </div>

      <select bind:value={auditFilter} aria-label="Filter audit log" class="select-input select-inline">
        <option value="all">All entities</option>
        <option value="grant">Grants</option>
        <option value="sponsor">Sponsors</option>
        <option value="contact">Contacts</option>
        <option value="user">Users</option>
      </select>
    </div>

    <div class="card-elevated max-h-96 overflow-y-auto p-2">
      <!--
        Fade rather than fly: this list lives in a `max-h-96 overflow-y-auto`
        box, so anything that travels horizontally gets cut off at the edge.
      -->
      {#each filteredAuditLogs as log (log._id)}
        <div
          class="flex items-start gap-3 p-2.5"
          animate:flip={listRow.flip}
          in:fade={listRow.in}
          out:fade={listRow.out}
        >
          <span
            class="type-label-sm grid h-8 w-8 shrink-0 place-items-center rounded-full"
            style="background: var(--color-surface-container-high); color: var(--color-on-surface-variant)"
          >
            {log.actorName.charAt(0)}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <span class="type-label truncate">{log.actorName}</span>
              <span
                class="type-label-sm type-num ml-auto shrink-0"
                style="color: var(--color-on-surface-variant)"
              >
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p class="type-body" style="color: var(--color-on-surface-variant)">{log.summary}</p>
          </div>
        </div>
      {/each}

      {#if filteredAuditLogs.length === 0}
        <p class="type-body p-6 text-center" style="color: var(--color-on-surface-variant)">
          No audit events for this filter.
        </p>
      {/if}
    </div>
  </section>
</div>
