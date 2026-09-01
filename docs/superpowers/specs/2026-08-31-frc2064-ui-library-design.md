# `@frc2064/ui` — a shared design system for 2064's web apps

**Date:** 2026-08-31
**Status:** approved design, not yet implemented

## The problem

Cacao carries a complete Material 3 Expressive design system — 1,344 lines of
`src/styles/app.css`, a JavaScript motion system in `src/lib/motion.ts`, four
`M3*` primitives, and a set of layout components — and every line of it is
locked inside one application. The team is about to have a second web app
(`FRC-2064/2064.team`, an Astro site) and expects more after that. Without
extraction, the second app either looks like a different organisation built it
or copy-pastes a stylesheet that begins diverging the day it lands.

The goal is one library, `@frc2064/ui`, that every 2064 web app depends on, so
that a button, a modal, and a tab strip move and read identically wherever they
appear.

## Decisions

These were settled in brainstorming and are not open questions:

| Decision | Choice |
|---|---|
| Consumers | Custom apps are SvelteKit; `2064.team` is Astro |
| Distribution | Own repo `FRC-2064/ui`, installed from a git tag |
| Tailwind | Required in every consumer (Tailwind v4) |
| Scope | Tokens + CSS + motion, primitives, app shell, brand layer |
| Build | None — the package ships source, Vite compiles it |
| Cutover | Cacao converts to consume the library in the same effort |
| Name | `@frc2064/ui` |

**Astro renders Svelte components, not SvelteKit.** This is the single
constraint that shapes the whole design: no library component may import from
`$app/*`. Anything routing-aware takes what it needs as a prop.

## Package shape

```
ui/
  package.json
  README.md
  assets/              wordmark.png, favicon.svg
  src/lib/
    styles/ui.css      tokens, dark roles, @layer components, brand voice
    styles/fonts.css   Roboto Flex / Roboto / JetBrains Mono
    motion.ts          durations, cubicBezier, easings, list presets
    theme.svelte.ts    createTheme({ key })
    prepaint.ts        prepaint(key) -> no-flash script text
    nav.ts             NavItem, isActive
    initials.ts        initials for an avatar
    actions/pill.ts    the sliding-indicator action
    components/        M3Modal M3Input M3Select M3Drawer SegmentedToggle
                       Toast ScrollToTop PageHeader SiteHeader BottomNav
                       ThemeToggle ThemePicker
    toasts.svelte.ts   the toast store
    index.ts           barrel
  src/routes/          demo page rendering every component, light and dark
```

`package.json` exports:

- `.` — the barrel, under the `svelte` condition so `vite-plugin-svelte`
  compiles it out of `node_modules`
- `./ui.css`, `./fonts.css`
- `./motion`, `./theme`, `./nav`
- `./assets/*`

`svelte`, `tailwindcss`, and `lucide-svelte` are **peer** dependencies. One copy
of Svelte in the tree is a correctness requirement, not a preference.

Installed as:

```json
"@frc2064/ui": "github:FRC-2064/ui#v0.1.0"
```

### Tailwind wiring

Today `app.css` opens with `@import "tailwindcss"`. In the library it must not —
the consumer owns that import, and `ui.css` carries only `@theme`, `:root`, and
`@layer components`. An app's whole stylesheet becomes:

```css
@import "tailwindcss";
@import "@frc2064/ui/ui.css";
```

Library components use Tailwind utilities in their markup, and Tailwind v4 does
not scan `node_modules`. `ui.css` therefore ships `@source "../components";`,
which Tailwind resolves relative to the stylesheet the directive appears in, so
consumers get the scanning with no configuration.

**This resolution behaviour must be proved with a throwaway build before the
rest of the extraction is built on it.** If it does not hold, the fallback is a
documented `@source` line in each consuming app — a one-line cost, but the
README must then carry it.

## What moves

Every class in `app.css` is generic or brand — there is no `.grant-*` or
`.sponsor-*` in it — so the stylesheet moves wholesale.

**Verbatim, no API change:** `ui.css`, `motion.ts`, `M3Modal`, `M3Input`,
`M3Select`, `M3Drawer`, `SegmentedToggle`, `ScrollToTop`, `PageHeader`,
`initials.ts`.

**Stays in Cacao:** all domain component folders (`grants`, `sponsors`,
`expenses`, `deposits`, `donors`, `analytics`, `contacts`, `team`, `admin`,
`finance`), `UserProfileModal` (roles, edit-access requests, Convex),
`cacaoStore`, `ui.svelte.ts`, and the *contents* of `nav.ts` — `NAV_ITEMS`,
`visibleNavItems`, `pendingFor`. The nav's contents are Cacao's; only its
rendering is the library's.

## New contracts

Four pieces reach into globals today and need a real API.

### Toast

`Toast.svelte` reads `cacao.toastMessage` directly. The library gets its own
store:

```ts
toasts.show(text, type?)   // type: 'success' | 'info' | 'error', default 'info'
toasts.current             // { text, type } | null
toasts.dismiss()
```

`<Toast />` renders from it, keeping the existing auto-dismiss behaviour.
Cacao's `showToast` becomes a one-line delegation. The state is confined to
`cacaoStore.svelte.ts:311` and `:643`, so this is contained.

### SiteHeader and BottomNav

Both import `$app/state` and the Cacao store — exactly what Astro cannot run.
Both become prop-driven:

```ts
interface Props {
  items: NavItem[];        // { href, label, icon, badge? }
  pathname: string;        // page.url.pathname | Astro.url.pathname
  brand?: Snippet;         // wordmark link
  actions?: Snippet;       // theme toggle, avatar, role chip
}
```

`badge` is a resolved number, not a key — the app decides what a badge counts.
`NavItem` and `isActive` move to the library because both components need them.
Cacao keeps `visibleNavItems`/`pendingFor` and hands down a finished array.

### Theme

`ThemeStore` hardcodes `cacao_theme_v1`. It becomes `createTheme({ key })`, and
Cacao passes its existing key so no saved preference resets. Two components come
with it: `ThemeToggle` (the header's sun/moon icon button) and `ThemePicker`
(the segmented light/dark/system control).

The pre-paint no-flash script ships as `prepaint(key)` returning script text.
Astro can emit it inline. SvelteKit's `app.html` is static and cannot call a
function, so **Cacao keeps a literal copy of that script** and the README
carries the canonical snippet. This duplication is unavoidable; it is named here
rather than hidden.

### Brand layer

`wordmark.png` and `favicon.svg` ship as files — `import wordmark from
'@frc2064/ui/assets/wordmark.png'` resolves through Vite in both stacks. Fonts
ship as `@frc2064/ui/fonts.css` for convenience, with the faster `preconnect` +
`<link>` head block documented as the preferred path.

## One targeted improvement

`SiteHeader` and `SegmentedToggle` contain the same ~30-line pill-measuring
effect, copy-pasted, and both depend on the same shared CSS. They collapse into
one exported Svelte action (`actions/pill.ts`) during the move rather than being
carried across as two copies.

## Cacao's cutover

1. Build `FRC-2064/ui` standalone, with a demo route rendering every component
   in light and dark. That demo is the library's smoke test and the thing to
   point a student at.
2. On a Cacao branch, **delete** `src/styles/app.css`, `src/lib/motion.ts`,
   `src/lib/components/m3/`, and the moved layout components, and import from
   the package instead. Deleted, not copied — if `app.css` survives in Cacao the
   whole exercise is undone within a month.
3. Develop against `"@frc2064/ui": "file:../ui"`; the last commit before merge
   flips it to `github:FRC-2064/ui#v0.1.0`.

## Verification

No new test framework. There is no Svelte component test harness in Cacao today
and adding one is not what this task is for. The bar is:

- `npm run check` clean in both repos
- `npm run build` clean in Cacao
- a manual pass over all seven routes in light and dark, phone and desktop,
  with attention to the segmented pill, the modals, and list transitions —
  where a missed token or an unscanned utility class will show first

`motion.ts`, `isActive`, and the theme store move **with their unit tests**. The
first two are pure functions and the store is testable against a fake storage,
so the library does not ship untested logic.

## Risks

- **`@source` resolution from an imported stylesheet** — must be proved first;
  see above.
- **Tailwind utilities inside library markup** silently not being generated is
  the most likely failure mode, and it looks like "slightly wrong spacing"
  rather than an error. The light/dark demo route is the defence.
- **Node is currently broken on the development machine** (`libada.so.3` missing
  against an installed `libada.so.4`), so nothing above can be verified until
  that is fixed. `pacman -Syu`, or a `nodejs` rebuilt against ada 4.
- **Two repos, one design system** means a library change needs a tag and a bump
  in each app. Acceptable for two apps; revisit if it reaches four.

## Out of scope

Wiring `2064.team` to the library. It is a separate repo with its own unknowns
and belongs in a follow-up once `v0.1.0` is tagged and Cacao is proven on it.
