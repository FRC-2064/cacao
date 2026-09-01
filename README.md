# Cacao

Grants, sponsors, expenses and contacts for **FRC Team 2064 (The Panther
Project)**. Internal tool, live at
[finance.2064.team](https://finance.2064.team).

SvelteKit 2 · Svelte 5 runes · Tailwind v4 over a hand-written Material 3
layer · Convex · Vercel.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173, also on your LAN
```

`.env.local` points at the **test** Convex deployment, so nothing you do
locally can reach the live site. To fill it with a copy of real data:

```bash
npm run sync:test-data
```

That snapshots production and replaces the test deployment with it. It is
read-only against production and always safe to re-run.

To work on the backend, run `npx convex dev` alongside `npm run dev` — it
watches `convex/` and pushes on save.

## Checks

```bash
npm test             # vitest: unit, convex, auth and store projects
npm run check        # svelte-check
npm run check:convex # tsc over convex/
```

`npm run check` does not cover `convex/`, which is why `check:convex` is
separate. Both run in CI.

## Layout

| Path | What |
| --- | --- |
| `src/routes/` | `/` sign-in, then `/dashboard`, `/grants`, `/money`, `/sponsors`, `/team`, `/admin` |
| `src/lib/stores/cacaoStore.svelte.ts` | The one store. Subscribes to Convex, writes optimistically, mutations push. |
| `src/lib/finance/` | Ledger, balances, donors, categories, Sankey — pure functions, heavily tested |
| `src/lib/components/` | Feature folders plus `m3/` for the four components that carry real behavior |
| `src/styles/app.css` | The Material 3 layer: color roles, shape scale, motion tokens, `.btn`/`.card`/`.chip` classes |
| `convex/` | Schema, queries and mutations. Every mutation writes its own audit row server-side. |

Two things worth knowing before editing:

- **Convex is the only source of truth.** The store applies an edit locally,
  then pushes; the subscription's next snapshot overwrites it, so a failed
  mutation self-corrects and toasts.
- **Motion is tokenised in two families.** `*-effects` curves resolve in place
  and never overshoot; `*-spatial` curves move or resize and deliberately
  overshoot. CSS reads `--ease-*` / `--dur-*` from `app.css`, Svelte
  transitions read the same curves from `src/lib/motion.ts` — keep the two in
  step.

## Releasing

Production deploys are driven by **version tags**, not by pushes:

```bash
npm version minor
git push origin trunk --follow-tags
```

`.github/workflows/release.yml` runs the tests and both typechecks, and only
then asks Vercel for a production deploy. A failing test is a failed release
rather than a broken site. Running the workflow by hand runs the gate and
stops without deploying.

Vercel builds with `npm run build:vercel` (set in `vercel.json`), which runs
`convex deploy --cmd 'npm run build'` when `CONVEX_DEPLOY_KEY` is present so
the backend is pushed before the frontend is built. `PUBLIC_CONVEX_URL` must
*also* be set as a plain Vercel *Config* variable — the client reads it through
`$env/dynamic/public` at request time, and Vercel's Sensitive variables do not
reach the SvelteKit runtime.

| Deployment | Role |
| --- | --- |
| `festive-lion-592` | Production. What finance.2064.team talks to. |
| `charming-poodle-399` | Test. What `npm run dev` talks to. Disposable. |
