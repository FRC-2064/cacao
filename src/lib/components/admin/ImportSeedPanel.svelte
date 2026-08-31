<script lang="ts">
  /**
   * Replace the entire database with the committed seed dataset.
   *
   * This is the cutover control. `api.seed.importAll` is the only way the
   * team's real data gets into a fresh deployment, and its payload is the whole
   * of `$lib/data/teamData` -- thousands of rows -- which is not something that
   * can realistically be pasted onto a `npx convex run` command line. Until
   * now nothing in the app called it at all.
   *
   * Three things this screen is careful about:
   *
   *  - **It destroys everything.** `importAll` wipes every table before it
   *    writes, in one transaction. So the button is behind a typed phrase, not
   *    a click, and the counts on both sides -- what is there now, what is
   *    about to replace it -- are shown before anything happens.
   *  - **The caller's own roster row.** `users` is wiped along with the rest,
   *    so the payload has to carry exactly one entry for the importing admin,
   *    named by `actorLocalId`. `importAll` rebuilds that row from the
   *    caller's authenticated identity: its `tokenIdentifier` and `role` are
   *    ignored outright, which is why nothing here sends a real token or goes
   *    looking for one. Everything else on the entry -- a first name, a last
   *    initial -- is written as given.
   *  - **Anything else with that identity locks the deployment.** Two rows
   *    sharing a `tokenIdentifier`, whether from a duplicated `_id` or from a
   *    second entry that happens to carry the caller's real one, make
   *    `getActor`'s `.unique()` throw on every later request, for everyone,
   *    unrecoverably in-app. The mutation refuses all four shapes by design;
   *    `importPayloadProblems` re-checks the three that are answerable without
   *    the caller's own token *before* the button is offered, so the answer is
   *    a sentence on screen rather than a rolled-back transaction and a
   *    production "Server Error".
   *
   * The dataset is imported lazily *and only in development*, and this panel
   * is itself only loaded in development (see `AdminPanel.svelte`). Lazily
   * was never enough on its own: a dynamic import is a code-split chunk, and
   * SvelteKit emitted `$lib/data/teamData` as one, referenced from the admin
   * route node and served to anyone as a static asset. `TEAM_CONTACTS` is
   * thirty-one adult sponsor contacts with names, emails, phone numbers and
   * addresses -- the exact table `contacts.list` gates behind `requireActor`.
   * The panel was correctly never mounted for a non-admin; a static asset
   * does not care who mounts it.
   *
   * `import.meta.env.DEV` is substituted with a literal `false` at build
   * time, so the branch below is dead code the bundler removes and no chunk
   * is emitted for the dataset at all. The guard is kept here as well as in
   * `AdminPanel.svelte` so that re-importing this component statically cannot
   * quietly put the dataset back on the public web.
   */
  import { onMount } from 'svelte';
  import { cacao } from '$lib/stores/cacaoStore.svelte';
  import { getConvexClient } from '$lib/convex/client';
  import { api } from '../../../../convex/_generated/api';
  import {
    buildImportPayload,
    importPayloadProblems,
    payloadRowCounts,
    type SeedDataset
  } from './importPayload';
  import M3Input from '$lib/components/m3/M3Input.svelte';
  import { DatabaseZap, TriangleAlert, Check } from 'lucide-svelte';

  /** The exact words the admin has to type. Deliberately not "yes". */
  const CONFIRM_PHRASE = 'REPLACE ALL DATA';

  type ImportResult = Record<string, number>;

  let dataset = $state<SeedDataset | null>(null);
  let datasetError = $state<string | null>(null);
  let liveCounts = $state<Record<string, number> | null>(null);
  let confirmation = $state('');
  let running = $state(false);
  let result = $state<ImportResult | null>(null);
  let failure = $state<string | null>(null);

  onMount(async () => {
    if (!import.meta.env.DEV) {
      datasetError =
        'The seed dataset ships only in development builds. Run the import from a local `npm run dev` server pointed at this deployment.';
      return;
    }
    try {
      dataset = await import('$lib/data/teamData');
    } catch (e) {
      datasetError = e instanceof Error ? e.message : String(e);
    }
    await refreshLiveCounts();
  });

  /** What the deployment holds right now, so "replace" has a stated cost. */
  async function refreshLiveCounts() {
    const client = getConvexClient();
    if (!client) return;
    try {
      const status = await client.query(api.seed.status, {});
      liveCounts = status.counts;
    } catch (e) {
      // Not fatal: the import itself reports what it did. An admin whose
      // session has not settled yet just sees no "currently" column.
      console.error('Could not read seed status:', e);
    }
  }

  /**
   * Exactly what would be sent, built once and used for the counts, the
   * pre-flight checks and the call itself -- so the figures shown before the
   * confirmation are the figures of the payload that goes, not a second
   * tally that could disagree with it.
   */
  const payload = $derived(
    dataset
      ? buildImportPayload(dataset, {
          firstName: cacao.currentUser.firstName,
          lastInitial: cacao.currentUser.lastInitial
        })
      : null
  );

  const payloadCounts = $derived(payload ? payloadRowCounts(payload) : []);
  const totalRows = $derived(payloadCounts.reduce((sum, row) => sum + row.rows, 0));

  /** The lockout shapes that are answerable without the caller's own token. */
  const problems = $derived(payload ? importPayloadProblems(payload) : []);

  const missingName = $derived(!cacao.currentUser.firstName);

  const canRun = $derived(
    !!payload &&
      problems.length === 0 &&
      !running &&
      cacao.currentUser.role === 'admin' &&
      confirmation.trim() === CONFIRM_PHRASE
  );

  async function runImport() {
    const client = getConvexClient();
    if (!client || !payload || !canRun) return;

    running = true;
    failure = null;
    result = null;

    try {
      result = await client.mutation(api.seed.importAll, payload);
      confirmation = '';
      cacao.showToast('Import finished');
      await refreshLiveCounts();
    } catch (e) {
      // The import is one transaction, so a throw anywhere in it has already
      // rolled back everything it wrote. Nothing here needs cleaning up.
      failure = e instanceof Error ? e.message : String(e);
      cacao.showToast('Import failed — nothing was changed', 'error');
    } finally {
      running = false;
    }
  }
</script>

<section class="card-elevated space-y-4 p-5">
  <div>
    <h2 class="type-title flex items-center gap-2">
      <DatabaseZap size={18} />
      <span>Replace the database from the seed dataset</span>
    </h2>
    <p class="type-body-sm mt-0.5" style="color: var(--color-on-surface-variant)">
      Writes every row in <code>src/lib/data/teamData.ts</code>, the file the sheet importer
      generates. This is the cutover step, not a routine one.
    </p>
  </div>

  <div
    class="flex items-start gap-3 p-4"
    style="border-radius: var(--shape-m); background: var(--color-error-container); color: var(--color-on-error-container)"
    role="alert"
  >
    <TriangleAlert size={20} class="mt-0.5 shrink-0" />
    <div class="space-y-1">
      <p class="type-label">Every table is deleted first.</p>
      <p class="type-body-sm">
        Grants, expenses, deposits, sponsors, contacts, the roster and the audit log are all wiped
        and rewritten from the file. Anything entered in the app since the file was generated is
        gone. It happens in one transaction, so it either all lands or none of it does.
      </p>
    </div>
  </div>

  {#if datasetError}
    <p class="field-error" role="alert">Could not load the seed dataset: {datasetError}</p>
  {:else if !dataset}
    <p class="type-body" style="color: var(--color-on-surface-variant)">Loading the dataset…</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="type-body w-full text-left">
        <thead>
          <tr style="color: var(--color-on-surface-variant)">
            <th class="type-label-sm py-1 pr-4 font-normal uppercase">Table</th>
            <th class="type-label-sm py-1 pr-4 text-right font-normal uppercase">Currently</th>
            <th class="type-label-sm py-1 text-right font-normal uppercase">Will write</th>
          </tr>
        </thead>
        <tbody>
          {#each payloadCounts as row (row.table)}
            <tr style="border-top: 1px solid var(--color-outline-variant)">
              <td class="py-1.5 pr-4">{row.table}</td>
              <td class="type-num py-1.5 pr-4 text-right" style="color: var(--color-on-surface-variant)">
                {liveCounts ? (liveCounts[row.table] ?? 0) : '—'}
              </td>
              <td class="type-num py-1.5 text-right">{row.rows}</td>
            </tr>
          {/each}
          <tr style="border-top: 1px solid var(--color-outline)">
            <td class="type-label py-1.5 pr-4">Total</td>
            <td class="type-num py-1.5 pr-4 text-right" style="color: var(--color-on-surface-variant)">
              {liveCounts ? Object.values(liveCounts).reduce((a, b) => a + b, 0) : '—'}
            </td>
            <td class="type-num type-label py-1.5 text-right">{totalRows}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="type-body-sm" style="color: var(--color-on-surface-variant)">
      The <code>users</code> row is yours. The dataset seeds nobody — every real account is created
      when that person signs in with Google — so the one entry sent is your own roster row, rebuilt
      from your session as
      <strong>{cacao.currentUser.displayName}</strong> with the admin role.
    </p>

    {#if missingName}
      <p class="type-body-sm" style="color: var(--color-tertiary)">
        You have no first name set, so your roster row will come back as an unnamed member. Set one
        under Profile first if you would rather it did not.
      </p>
    {/if}

    {#each problems as problem}
      <p class="field-error" role="alert">
        {problem} Fix the dataset before importing — sending this would lock people out of the
        deployment, and it cannot be undone from inside the app.
      </p>
    {/each}

    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <M3Input
        id="seed_import_confirm"
        label={`Type ${CONFIRM_PHRASE} to enable the button`}
        placeholder={CONFIRM_PHRASE}
        bind:value={confirmation}
      />
      <button
        type="button"
        class="btn btn-filled"
        style={canRun ? 'background: var(--color-error); color: var(--color-on-error)' : ''}
        disabled={!canRun}
        onclick={runImport}
      >
        <DatabaseZap size={18} />
        <span>{running ? 'Importing…' : `Replace all data (${totalRows} rows)`}</span>
      </button>
    </div>
  {/if}

  {#if failure}
    <div class="space-y-1 p-4" style="border-radius: var(--shape-m); background: var(--color-error-container); color: var(--color-on-error-container)" role="alert">
      <p class="type-label">The import was refused. Nothing was changed.</p>
      <p class="type-body-sm">{failure}</p>
    </div>
  {/if}

  {#if result}
    <div class="space-y-2 p-4" style="border-radius: var(--shape-m); background: var(--color-surface-container)">
      <p class="type-label flex items-center gap-2">
        <Check size={16} style="color: var(--color-success)" />
        <span>Imported</span>
      </p>
      <div class="type-body-sm grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {#each Object.entries(result) as [table, rows] (table)}
          <div class="flex justify-between gap-4">
            <span style="color: var(--color-on-surface-variant)">{table}</span>
            <span class="type-num">{rows}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>
