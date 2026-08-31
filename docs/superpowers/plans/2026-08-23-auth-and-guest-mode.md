# Authentication, Registration & Guest Viewer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an authentication & guest portal at `/` supporting student email/password login, access requests (registration) for admin activation, a read-only "Guest Viewer" mode with disabled mutations, and complete removal of obsolete subteam fields across the app.

**Architecture:** 
- Root route `/` hosts the login, registration, and guest access portal.
- Authentication state is managed in `cacaoStore` and stored in `localStorage` (`cacao_session_v1`), supporting real sign-in, guest viewer sessions, and clean logout.
- Read-only restrictions (`viewer` role) are applied across all modules with disabled buttons, kanban locks, and a `"Guest (View-Only)"` header pill.
- Subteam properties are stripped from schemas, validators, stores, forms, and views.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind CSS v4, Convex backend.

---

### Task 1: Subteam Cleanup & Schema / Data Updates

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/validators.ts`
- Modify: `convex/users.ts`
- Modify: `convex/expenses.ts`
- Modify: `convex/seed.ts`
- Modify: `src/lib/data/seedData.ts`

- [ ] **Step 1: Update Types in `src/lib/types.ts`**
  - Add `password?: string` to `User` and `password?: string` to `AccessRequest`.
  - Remove `subteam` from `User`, `AccessRequest`, and `Expense`.
- [ ] **Step 2: Update Convex Schemas & Validators**
  - Update `convex/schema.ts`, `convex/validators.ts`, `convex/users.ts`, `convex/expenses.ts`, `convex/seed.ts` to include `password` and remove `subteam`.
- [ ] **Step 3: Update Seed Data in `src/lib/data/seedData.ts`**
  - Add seeded admin account: Levi Fitzpatrick (`levi@2064.team`, password: `fitz`, role: `admin`).
  - Strip `subteam` from seeded expenses, users, and access requests.
- [ ] **Step 4: Verify typecheck**
  - Run `npm run check`.

---

### Task 2: Store Authentication Methods & Session State

**Files:**
- Modify: `src/lib/stores/cacaoStore.svelte.ts`

- [ ] **Step 1: Implement `login()`, `continueAsGuest()`, `submitAccessRequest()`, and `logout()` in `CacaoStore`**
  - Add `isAuthenticated` and `isGuest` runes.
  - Implement email/password matching against `cacao.users`.
  - Implement `continueAsGuest()` to assign a `viewer` role guest session.
  - Implement `logout()` to reset session and navigate to `/`.
  - Persist session in `localStorage`.
- [ ] **Step 2: Update Access Request approval in `CacaoStore`**
  - When admin approves an access request, transfer the user's password into the new `User` record so they can immediately sign in.

---

### Task 3: Build Login & Access Portal at `/`

**Files:**
- Create: `src/routes/+page.svelte`
- Modify: `src/routes/+page.ts`

- [ ] **Step 1: Create `src/routes/+page.svelte`**
  - Render branded card with wordmark logo.
  - Tabs: **Sign In** and **Request Access**.
  - Sign in: Email + Password inputs, "Sign In" button, and prominent "Continue as Guest (View-Only)" button.
  - Request access: Name, Email, Password, Grad Year, Notes, "Submit Request" button.
  - If user is already authenticated, show "Welcome back" with "Enter Workspace" and "Sign Out" buttons.
- [ ] **Step 2: Adjust `src/routes/+page.ts`**
  - Remove the unconditional redirect to `/grants` so `/` renders the portal.

---

### Task 4: Guest / Viewer Mode Enforcements & Subteam Removal in Views

**Files:**
- Modify: `src/lib/components/layout/SiteHeader.svelte`
- Modify: `src/lib/components/layout/UserProfileModal.svelte`
- Modify: `src/lib/components/expenses/ExpenseModal.svelte`
- Modify: `src/lib/components/expenses/AddExpenseModal.svelte`
- Modify: `src/lib/components/expenses/ExpensesList.svelte`
- Modify: `src/lib/components/grants/AddGrantModal.svelte`
- Modify: `src/lib/components/grants/GrantDrawer.svelte`
- Modify: `src/lib/components/grants/GrantsKanban.svelte`
- Modify: `src/lib/components/grants/GrantsTable.svelte`
- Modify: `src/lib/components/sponsors/SponsorsList.svelte`
- Modify: `src/lib/components/contacts/ContactsView.svelte`
- Modify: `src/lib/components/auth/RequestAccessModal.svelte`

- [ ] **Step 1: Update Header & User Profile**
  - Add `"Guest (View-Only)"` chip in `SiteHeader.svelte` when `currentUser.role === 'viewer'`.
  - Add a **Sign Out** button in `UserProfileModal.svelte`.
- [ ] **Step 2: Disable edit actions for `viewer` role**
  - In `GrantsKanban.svelte`, `GrantsTable.svelte`, `ExpensesList.svelte`, `SponsorsList.svelte`, `ContactsView.svelte`:
    - Set `disabled={isViewer}` on all "Add ...", "Edit", "Log ...", and mutation buttons.
    - Set `draggable={!isViewer}` on Kanban cards.
- [ ] **Step 3: Remove subteam fields from all modals and components**
  - Remove subteam selects/displays from `ExpenseModal`, `AddExpenseModal`, `ExpensesList`, `UserProfileModal`, `RequestAccessModal`.

---

### Task 5: Admin Panel Cleanup & Final Verification

**Files:**
- Modify: `src/lib/components/admin/AdminPanel.svelte`

- [ ] **Step 1: Clean up Admin Panel**
  - Remove subteam info from user cards.
  - Verify approval workflow correctly activates requested accounts.
- [ ] **Step 2: Run verification**
  - Run `npm run check` and `npm run build`.
