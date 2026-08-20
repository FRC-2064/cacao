# Cacao — Grants, Sponsorships & Contacts

Grants, sponsors, expenses and contacts for **FRC Team 2064 (The Panther
Project)**, plus `@region15.org` student access requests and mentor audit
logging.

Named for the tree whose beans were Mesoamerican currency, following the
jungle-flora convention the team uses for its software (see `Bromeliad`).
Deployed at **finances.2064.team**, reachable from `2064.team/finances`.

Built with **SvelteKit 2**, **Svelte 5 runes**, **Tailwind CSS v4**, **Convex**, and **Material 3 Expressive** design.

---

## Key Features

1. **Linear-Style Grants Kanban Board**:
   - 6 reactive columns: *Identified / Backlog*, *Drafting & Prep*, *Awaiting Mentor Review*, *Submitted / In Review*, *Awarded & Received*, *Declined / Ineligible*.
   - Live column count badges and cumulative dollar totals (`$`).
   - Smooth drag-and-drop column transitions with automatic status updates and audit trail logging.
   - Requirement checklist progress bar, deadline urgency countdown, assignee avatars, and 1-click links to drafting Google Docs and submission portals.

2. **Spreadsheet-Grade Table View**:
   - Clean, dense, sortable table replacing messy Google Sheets.
   - Column sorting by Opportunity Name, Funder, Value, Status, Deadline, and Assignee.
   - 1-click CSV Export (`2064_Grants_Season.csv`).

3. **Multi-Year Sponsor CRM & Touchpoint Tracker**:
   - Categorized by Sponsor Tiers (Platinum $5k+, Gold $2.5k, Silver $1k, Bronze $500, Panther Partner, In-Kind).
   - Multi-year annual outreach history matrix (2024, 2025, 2026, 2027) tracking report delivery and renewal pledges.
   - **Stale Contact Detection**: Automatically flags sponsors who have not received outreach in >9 months so the team never forgets an annual renewal.

4. **Team Contacts Directory**:
   - Organization-linked directory of corporate liaisons, foundation officers, and local business managers.
   - Click-to-email, click-to-call, communication preference badges, and relationship notes.

5. **Region 15 Student Access & Mentor Approvals**:
   - **Constraint Solved**: Because student emails (`@region15.org`) cannot receive external emails, traditional magic links fail. Cacao implements a Google SSO / Request Access intake form capturing First/Last Name, Graduation Year, and Subteam.
   - **Mentor Queue**: Mentors can approve or deny student accounts with 1 click.
   - **In-Person Meeting PIN**: Optional passcode shortcut (e.g. `PANTHER2064`) for instant account verification during robotics meetings.

6. **Student Lifecycle & Class Graduation Manager**:
   - Filter team roster by Graduation Year (Class of 2026, 2027, 2028, 2029).
   - 1-Click **"Graduate Class of [Year]"** batch archiving tool to gracefully transition graduating seniors to alumni status while preserving historical audit logs.

7. **Full System Audit Log**:
   - Real-time immutable record of every creation, edit, status transition, checklist completion, and role change with actor attribution and timestamps.

8. **Pre-Seeded with Team 2064 Data**:
   - Pre-loaded with the grants from the team spreadsheet (Thomaston Savings Bank, REV Robotics, Newtown Bank Foundation, Gene Haas Foundation, BAE Systems, Boeing).
   - Pre-loaded with official Team 2064 corporate sponsors (BAE Systems, Boeing, Haas, RTX, MannKind, Sperry, Ace, CT MFG, D&V, FRC Tees).

---

## Tech Stack & Architecture

- **Frontend**: [SvelteKit 2](https://kit.svelte.dev/) with [Svelte 5 Runes](https://svelte.dev/docs/svelte/what-are-runes) (`$state`, `$derived`, `$props`, `$effect`).
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) over a hand-written **Material 3 Expressive** layer in `src/styles/app.css` — M3 color roles, a 4/8/12/16/28/full shape scale, the full M3 Expressive motion set, elevation, and a semantic `.type-*` scale. Panther Red (`#CD2030`) is the source color for the primary tonal palette; it clears 7.9:1 on white, so the brand red *is* `--color-primary` in light mode rather than a decorative accent.
  - **Light and dark**: light by default, following `prefers-color-scheme`, with a manual override persisted to `localStorage` and applied pre-paint (`src/lib/stores/theme.svelte.ts`). Toggle lives in the app bar and in Profile → Appearance.
  - **Components are CSS classes, not wrappers**: `.btn`, `.icon-btn`, `.chip`, `.filter-chip`, `.card`, `.segmented`, `.list-row`, `.data-table`, `.stat-tile`, `.panel`. Interactive elements use M3 **state layers** (`currentColor` at 8%/12%) and **morph their border-radius on press** — never `scale`.
  - **Motion is tokenised in two families**, ported from [caelestia-dots/shell](https://github.com/caelestia-dots/shell) (`plugin/src/Caelestia/Config/tokens.hpp`). `*-effects` curves are for things that resolve in place — colour, opacity, tint — and never overshoot. `*-spatial` curves are for things that move, grow or change shape, and deliberately overshoot and settle back (`--ease-fast-spatial` peaks at y = 1.67), which is what reads as fluid rather than merely animated. CSS reads them from `--ease-*` / `--dur-*` in `app.css`; Svelte transitions read the same curves from `src/lib/motion.ts`, which must be kept in step. `--ease-emphasized` is a two-segment bezier spline that `cubic-bezier()` cannot express, so it ships as a 33-stop `linear()` behind an `@supports` guard.
  - **Brand voice is scoped**: black-italic-uppercase (`.t-display` / `.t-eyebrow`) is reserved for page headings and the 2064 wordmark, matching how 2064.team scopes `.t-h1`. Buttons, chips, labels and table headers use neutral weight-600 sentence case.
  - Only `M3Input`, `M3Select`, `M3Modal` and `M3Drawer` remain as Svelte components, because they carry real behavior (labels, validation, focus/escape handling, transitions).
- **Icons**: [Lucide Svelte](https://lucide.dev/).
- **Backend & Database**: [Convex](https://convex.dev/). `convex/schema.ts` defines
  eight tables and `convex/*.ts` the queries and mutations over them; every
  mutation writes its own audit-log row server-side, so the history is complete
  no matter which client made the change.
  - **Two modes, one store**: `src/lib/stores/cacaoStore.svelte.ts` exposes the
    same fields and methods either way. With `PUBLIC_CONVEX_URL` set it opens a
    live subscription per table and each method fires the matching mutation;
    without it, the app runs entirely on `localStorage` seeded from
    `src/lib/data/seedData.ts`. Components never learn which mode they are in.
  - **Writes are optimistic**: methods update local state first, then push. The
    subscription's next snapshot is authoritative and overwrites it, so a failed
    mutation self-corrects (and toasts).
- **Hosting**: [Vercel](https://vercel.com/) via `@sveltejs/adapter-vercel`. The
  runtime is pinned to `nodejs22.x` in `svelte.config.js` because the adapter
  refuses to infer one from an unrecognised local Node.

### Routes

Every view is a real route, so each one is linkable, survives a refresh and
works with the back button.

| Route | View |
| --- | --- |
| `/` | Redirects to `/grants` |
| `/grants` | Kanban board |
| `/grants/table` | Sortable table (card list below `md`) |
| `/expenses` | Expenses and treasury |
| `/sponsors` | Sponsor CRM |
| `/contacts` | Contacts directory |
| `/analytics` | Financial overview |
| `/admin` | Mentor tools (admin only) |

Cross-route state lives in two small modules: `src/lib/stores/ui.svelte.ts`
holds the drawer and modal state that outlives a single view, and
`src/lib/nav.ts` is the single nav definition shared by the wide top bar and
the narrow bottom bar.

### Responsive behaviour

The breakpoint is `md` (768px). Above it: top segmented nav, inline search, the
grants table, and drag-and-drop on the board. Below it: a Material 3 bottom
navigation bar, search collapsed behind an icon, the table rendered as cards,
and a status select on each grant card — **HTML5 drag events never fire from
touch input**, so the board would otherwise be read-only on a phone. Controls
grow to the 44/48px touch minimum under `@media (pointer: coarse)`, which keys
off the input device rather than the viewport.

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Local Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

The dev server binds `0.0.0.0`, so it is reachable from a phone on the same
network at `http://<your-lan-ip>:5173` — or over Tailscale from anywhere.
Test the board on real hardware: the DevTools device toolbar simulates touch
but still emits mouse and drag events, so it will not reproduce touch bugs.

### 3. Type Checking & Verification
```bash
npm run check
npm run build
```

### 4. Optional: Connect the Convex backend

Without this the app runs in local demo mode — real and fully usable, but the
data lives in your browser only. To point it at the shared deployment:

```bash
npx convex dev
```

This is interactive: it opens a browser to log in, links the local checkout to a
Convex project, writes `CONVEX_DEPLOYMENT` and `CONVEX_URL` into `.env.local`,
regenerates `convex/_generated/`, and then watches `convex/` and pushes on save.
Leave it running alongside `npm run dev`.

Add the public variable it does *not* write, so the browser can reach the same
deployment:

```bash
# .env.local — same value as CONVEX_URL
PUBLIC_CONVEX_URL=https://your-deployment-123.convex.cloud
```

A fresh deployment starts empty. Open **Admin** and use **Load starter data** to
push `src/lib/data/seedData.ts` into Convex; the panel at the top of that page
shows which mode you are in. The button replaces everything in the deployment,
so it is a bootstrap tool, not a routine one.

---

## Deployment

Cacao is its own Vercel project on its own subdomain — the same shape as the
docs site, not a path inside the Astro monorepo. The public site is static and
this app is authenticated, so keeping the deploys separate keeps that boundary
clean and leaves room for the next app to follow the same pattern.

1. Push this repository to GitHub under the team robotics organization.
2. Import it in Vercel; the framework preset is **SvelteKit**.
3. Point `finances.2064.team` at the project.

### Deploying with Convex

Vercel does not know about Convex, so the build has to push the backend before
it builds the frontend. Two settings make that happen:

1. In the Convex dashboard, **Settings → Deploy Keys**, generate a production
   deploy key and add it to Vercel as `CONVEX_DEPLOY_KEY`.
2. Set the Vercel **Build Command** to `npm run build:vercel`.

That script runs `convex deploy --cmd 'npm run build'`, which pushes
`convex/` to the production deployment and then injects that deployment's URL as
`PUBLIC_CONVEX_URL` for the SvelteKit build. Do not also set `PUBLIC_CONVEX_URL`
by hand in Vercel — the deploy key determines which deployment is live, and a
stale hand-set URL would point the frontend somewhere else.

Leaving the build command as the default `npm run build` is a valid choice too:
the app deploys in local demo mode and never contacts Convex.

The `2064.team` repo carries the other half: `FINANCES_PRODUCTION_URL` and
`getFinancesUrl()` in `main-site/src/data/site.ts`, and a redirect page at
`main-site/src/pages/finances.astro` so `2064.team/finances` resolves here.
It is deliberately not in the public nav — this is an internal tool.
