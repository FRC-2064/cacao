<script lang="ts">
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import type { UserRole } from '$lib/types';
  import { ACCOUNT_META } from '$lib/finance/categories';
  import { computeBalances, EPOCH_DATE, type AccountBalance } from '$lib/finance/balances';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import SegmentedToggle from '$lib/components/layout/SegmentedToggle.svelte';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import { initialsOf } from '$lib/components/layout/initials';
  import { localDay, formatDay, todayISO } from '$lib/finance/dates';
  import {
    History,
    Download,
    Landmark,
    School,
    ShieldCheck,
    Users,
    UserPlus,
    TriangleAlert
  } from 'lucide-svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { listItem, listRow } from '$lib/motion';

  let view = $state<'verification' | 'users' | 'log'>('verification');

  // Per-account in-progress edits for the balance verification form below.
  // Keyed so editing one account's fields never touches another's, and absent
  // until the admin actually types -- `draftFor` then seeds the fields from the
  // current server values, so an untouched row never counts as edited.
  type BalanceDraft = { openingBalance: string; asOfDate: string };
  let drafts = $state<Record<string, BalanceDraft>>({});

  let rosterFilter = $state<'all' | 'mentors' | 'requests'>('all');
  let auditFilter = $state<string>('all');


  // Requests waiting on someone ride as a badge, so the count is visible from
  // whichever tab you happen to be on. This is what the comment here claimed
  // for three commits before `cacao.editRequests` existed to count.
  const viewOptions = $derived([
    { value: 'verification', label: 'Verification', icon: ShieldCheck },
    {
      value: 'users',
      label: 'Users',
      icon: Users,
      badge: cacao.editRequests.length || undefined
    },
    { value: 'log', label: 'Log', icon: History }
  ]);
  const verifiableBalances = $derived(
    cacao.accountBalances.filter((b) => b.account !== 'hcb_bank')
  );

  const ACCOUNT_ICONS = { hcb_bank: Landmark, school_account: School };

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  /**
   * How long ago an account was last checked. Colour is spent only on the rows
   * that need work, so a recently verified account gets a plain chip.
   */
  function freshness(asOfDate: string): { label: string; tone: string } {
    if (asOfDate === EPOCH_DATE) return { label: 'Never checked', tone: 'chip-tertiary' };
    const days = Math.round((localDay(todayISO()).getTime() - localDay(asOfDate).getTime()) / 86_400_000);
    if (days < 0) return { label: 'Dated in the future', tone: 'chip-tertiary' };
    if (days === 0) return { label: 'Checked today', tone: '' };
    if (days === 1) return { label: 'Checked yesterday', tone: '' };
    if (days < 45) return { label: `Checked ${days} days ago`, tone: '' };
    return { label: `Checked ${Math.round(days / 30)} months ago`, tone: 'chip-tertiary' };
  }

  function draftFor(bal: AccountBalance): BalanceDraft {
    const existing = drafts[bal.account];
    if (existing) return existing;
    const never = bal.asOfDate === EPOCH_DATE;
    return {
      openingBalance: never ? '' : String(bal.openingBalance),
      asOfDate: never ? todayISO() : bal.asOfDate
    };
  }

  function editDraft(bal: AccountBalance, patch: Partial<BalanceDraft>) {
    drafts[bal.account] = { ...draftFor(bal), ...patch };
  }

  /**
   * What the account would read today if this baseline were saved. Recomputed
   * from scratch rather than added on top of the old figure, because moving
   * `asOfDate` also moves which activity still counts.
   */
  function previewBalance(bal: AccountBalance, openingBalance: number, asOfDate: string): number {
    const rows = computeBalances({
      configs: [{ account: bal.account, openingBalance, asOfDate }],
      deposits: cacao.incomeDeposits,
      expenses: cacao.expenses
    });
    return rows.find((r) => r.account === bal.account)?.computed ?? openingBalance;
  }

  function saveBalance(bal: AccountBalance, openingBalance: number, asOfDate: string) {
    cacao.setAccountBalance(bal.account, openingBalance, asOfDate);
    delete drafts[bal.account];
  }

  /**
   * The roster is filtered by what the roster actually holds. The class-year
   * chips that used to sit here selected on `users.gradYear`, and there is no
   * such column any more -- a graduation year is student personal information
   * and went with the rest of it. "Graduating" a member is now the same
   * operation as revoking their access: set their role to viewer, which is
   * what the select on each card does.
   */
  const rosterFilters = [
    { id: 'all', label: 'All members' },
    { id: 'mentors', label: 'Mentors' },
    { id: 'requests', label: 'Awaiting approval' }
  ] as const;

  const filteredUsers = $derived.by(() => {
    if (rosterFilter === 'mentors') return cacao.users.filter((u) => u.role === 'admin');
    if (rosterFilter === 'requests') return cacao.users.filter((u) => u.requested);
    return cacao.users;
  });

  /**
   * What an audit row says happened. `summary` was a free-text column and it
   * is gone: anything could be written into it, a person's name included, so
   * the feed now renders only the typed fields -- the action, the kind of
   * thing acted on, and at most one field-level before/after.
   */
  const AUDIT_ACTION_LABEL: Record<string, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    status_change: 'Moved',
    assign: 'Assigned',
    requirement_toggle: 'Ticked a requirement on',
    approve_user: 'Approved',
    reject_user: 'Declined',
    graduate_batch: 'Graduated',
    outreach_logged: 'Logged outreach on',
    import_seed: 'Replaced the database from'
  };

  function auditSummary(log: { action: string; entityType: string; change?: { field: string; from: string; to: string } }) {
    const verb = AUDIT_ACTION_LABEL[log.action] ?? log.action;
    const subject = log.entityType.replace(/_/g, ' ');
    if (!log.change) return `${verb} a ${subject}`;
    const { field, from, to } = log.change;
    return from
      ? `${verb} a ${subject} — ${field}: ${from} → ${to}`
      : `${verb} a ${subject} — ${field}: ${to}`;
  }

  const filteredAuditLogs = $derived.by(() => {
    if (auditFilter === 'all') return cacao.auditLogs;
    return cacao.auditLogs.filter((log) => log.entityType === auditFilter);
  });


  const roleOptions: { value: UserRole; label: string }[] = [
    { value: 'viewer', label: 'Viewer' },
    { value: 'student', label: 'Student' },
    { value: 'admin', label: 'Mentor' }
  ];

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
    link.setAttribute('download', `2064_Panther_Project_Backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    cacao.showToast('Backup downloaded');
  }

</script>

<PageHeader
  title="Admin"
  description="Approve access requests, set what each member can do, and audit every change"
>
  {#snippet actions()}
    <button type="button" class="btn btn-outlined" onclick={exportFullBackup}>
      <Download size={18} />
      <span>Backup JSON</span>
    </button>
  {/snippet}
</PageHeader>

<SegmentedToggle
  options={viewOptions}
  bind:value={view}
  class="mb-4"
  ariaLabel="Admin view"
/>

<div class="space-y-8">
  <!-- Only the failure state earns space here. A banner announcing that
       things are working is noise on every visit; a banner saying the backend
       is unreachable explains why nothing you do is saving. -->
  {#if cacao.connectionError}
    <section class="card-elevated flex flex-wrap items-center gap-3 p-4">
      <TriangleAlert size={20} style="color: var(--color-error)" />
      <div class="min-w-0 flex-1">
        <p class="type-label">Convex is unreachable</p>
        <p class="type-body-sm" style="color: var(--color-on-surface-variant)">
          {cacao.connectionError}
        </p>
      </div>
    </section>
  {/if}

  {#if view === 'verification'}
  <section class="card-elevated space-y-4 p-5">
    <div>
      <h2 class="type-title">Verify account balances</h2>
      <!-- This is re-run after each audit, not filled in once. -->
      <p class="type-body-sm mt-0.5" style="color: var(--color-on-surface-variant)">
        Check an account against its real statement, then record what it actually held and the day
        you checked it. Everything logged after that day is added on top.
      </p>
    </div>

    <div class="space-y-3">
      {#each verifiableBalances as bal (bal.account)}
        {@const meta = ACCOUNT_META[bal.account]}
        {@const Icon = ACCOUNT_ICONS[bal.account]}
        {@const fresh = freshness(bal.asOfDate)}
        {@const draft = draftFor(bal)}
        {@const typed = Number(draft.openingBalance)}
        {@const valid =
          draft.openingBalance.trim() !== '' && Number.isFinite(typed) && draft.asOfDate !== ''}
        {@const pending =
          valid && (typed !== bal.openingBalance || draft.asOfDate !== bal.asOfDate)}
        {@const never = bal.asOfDate === EPOCH_DATE && !pending}
        {@const baseline = pending ? typed : bal.openingBalance}
        {@const today = pending ? previewBalance(bal, typed, draft.asOfDate) : bal.computed}
        {@const activity = today - baseline}
        {@const accent = pending ? 'color: var(--color-primary)' : ''}
        <div
          class="space-y-4 p-4"
          style="border-radius: var(--shape-l); background: var(--color-surface-container)"
        >
          <div class="flex items-center gap-3">
            <Icon size={18} style="color: var(--color-on-surface-variant)" />
            <div class="min-w-0 flex-1">
              <p class="type-label truncate">{meta.label}</p>
              <p class="type-body-sm truncate" style="color: var(--color-on-surface-variant)">
                {meta.note}
              </p>
            </div>
            <span class="chip chip-sm shrink-0 {fresh.tone}">{fresh.label}</span>
          </div>

          <!-- The arithmetic the app is actually doing, so the two fields below
               read as an edit to a running total rather than as raw settings.
               While an edit is pending every figure is the previewed one. -->
          <div class="grid grid-cols-3 gap-2">
            <div class="min-w-0">
              <p class="type-label-sm uppercase" style="color: var(--color-on-surface-variant)">
                Verified
              </p>
              <p class="type-num mt-1 text-sm font-semibold sm:text-base" style={accent}>{money(baseline)}</p>
              <p class="type-body-sm mt-0.5" style="color: var(--color-on-surface-variant)">
                {never ? 'Never — assumed $0' : formatDay(pending ? draft.asOfDate : bal.asOfDate)}
              </p>
            </div>
            <div class="min-w-0">
              <p class="type-label-sm uppercase" style="color: var(--color-on-surface-variant)">
                Since then
              </p>
              <p class="type-num mt-1 text-sm font-semibold sm:text-base" style={accent}>
                {activity < 0 ? '−' : '+'}{money(Math.abs(activity))}
              </p>
              <p class="type-body-sm mt-0.5" style="color: var(--color-on-surface-variant)">
                Deposits and spending
              </p>
            </div>
            <div class="min-w-0">
              <p class="type-label-sm uppercase" style="color: var(--color-on-surface-variant)">
                Today
              </p>
              <p class="type-num mt-1 text-sm font-semibold sm:text-base" style={accent}>{money(today)}</p>
              <p class="type-body-sm mt-0.5" style="color: var(--color-on-surface-variant)">
                {pending ? 'After you save' : 'What the app shows'}
              </p>
            </div>
          </div>

          <div
            class="grid gap-3 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
            style="border-top: 1px solid var(--color-outline-variant)"
          >
            <M3Input
              id="verified-balance-{bal.account}"
              label="Balance on the statement ($)"
              type="number"
              placeholder="0.00"
              value={draft.openingBalance}
              oninput={(e) => editDraft(bal, { openingBalance: e.currentTarget.value })}
            />
            <M3Input
              id="verified-on-{bal.account}"
              label="Date you checked"
              type="date"
              value={draft.asOfDate}
              oninput={(e) => editDraft(bal, { asOfDate: e.currentTarget.value })}
            />
            <div class="flex items-center gap-2">
              {#if pending}
                <button
                  type="button"
                  class="btn btn-text btn-sm"
                  onclick={() => delete drafts[bal.account]}
                >
                  Cancel
                </button>
              {/if}
              <button
                type="button"
                class="btn btn-filled btn-sm flex-1 sm:flex-none"
                disabled={!pending}
                onclick={() => saveBalance(bal, typed, draft.asOfDate)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <p class="type-body-sm" style="color: var(--color-on-surface-variant)">
      Hack Club Bank is not listed. Its balance comes straight from the bank, so there is nothing to
      verify by hand.
    </p>
  </section>

  {/if}

  {#if view === 'users'}

  <!-- The approval feed.
       `cacao.editRequests` is a live subscription to `users.listRequests`,
       which is `requireAdmin` and therefore only open while this browser's own
       roster row says admin. Until this section existed the four mutations
       behind the request flow had no call sites at all: a student could sign
       in, land as a viewer, and had no way to ask -- while eleven tests
       defended a flow no user could reach. -->
  <section class="space-y-3">
    <div>
      <h2 class="type-title flex items-center gap-2">
        <UserPlus size={18} />
        <span>Access requests</span>
        {#if cacao.editRequests.length > 0}
          <span class="chip chip-sm">{cacao.editRequests.length}</span>
        {/if}
      </h2>
      <p class="type-body" style="color: var(--color-on-surface-variant)">
        Someone who signed in and asked to be able to edit. Approving makes them
        a student; declining only clears the request, so they can ask again.
      </p>
    </div>

    {#if cacao.editRequests.length === 0}
      <p class="type-body-sm" style="color: var(--color-on-surface-variant)">
        Nobody is waiting.
      </p>
    {:else}
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {#each cacao.editRequests as request (request._id)}
          <div
            class="card flex items-center gap-3 p-3"
            animate:flip={listItem.flip}
            in:fly={listItem.in}
            out:scale={listItem.out}
          >
            <span
              class="type-label grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style="background: var(--color-tertiary-container); color: var(--color-on-tertiary-container)"
            >
              {initialsOf(request.displayName)}
            </span>
            <div class="min-w-0">
              <span class="type-label block truncate">{request.displayName}</span>
              <!-- A first name and a last initial is the whole of what they
                   gave, and the whole of what there is to show. -->
              <span class="type-label-sm block" style="color: var(--color-on-surface-variant)">
                Wants edit access
              </span>
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                class="btn btn-text"
                onclick={() => cacao.declineRequest(request._id)}
              >
                Decline
              </button>
              <button
                type="button"
                class="btn btn-filled"
                onclick={() => cacao.approveRequest(request._id)}
              >
                Approve
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="space-y-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="type-title">Team roster</h2>
        <p class="type-body" style="color: var(--color-on-surface-variant)">
          Change what someone can do. Dropping a member to viewer is how both
          graduating and revoking access are recorded.
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      {#each rosterFilters as tab}
        <button
          type="button"
          aria-pressed={rosterFilter === tab.id}
          onclick={() => (rosterFilter = tab.id)}
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
            {initialsOf(user.displayName)}
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="type-label truncate">{user.displayName}</span>
              {#if user.role === 'admin'}
                <span class="chip chip-sm">Mentor</span>
              {/if}
            </div>
            <!-- A first name and a last initial is the whole of what a roster
                 row holds about a person. There is no email column to show
                 beside it, and there is deliberately never going to be one. -->
            {#if user.requested}
              <span class="type-label-sm block truncate" style="color: var(--color-tertiary)">
                Asked for edit access
              </span>
            {/if}
          </div>

          <!-- Signing in only ever grants `viewer`, which is what the public
               already sees. This select is where write access is handed out. -->
          {#if user._id === cacao.currentUser._id}
            <span
              class="type-label-sm ml-auto shrink-0"
              style="color: var(--color-on-surface-variant)"
              title="You can't change your own role"
            >
              You
            </span>
          {:else}
            <select
              class="select-input select-inline ml-auto shrink-0"
              aria-label={`Role for ${user.displayName}`}
              value={user.role}
              onchange={(e) =>
                cacao.setUserRole(user._id, e.currentTarget.value as 'admin' | 'student' | 'viewer')}
            >
              {#each roleOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          {/if}
        </div>
      {/each}
    </div>
  </section>
  {/if}

  {#if view === 'log'}

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

    <div class="card-elevated p-2">
      <!-- Fade rather than fly: flying rows in and out would jump the page
           scroll position on every log update. -->
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
            {initialsOf(log.actorName)}
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
            <p class="type-body" style="color: var(--color-on-surface-variant)">
              {auditSummary(log)}
            </p>
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
  {/if}
</div>
