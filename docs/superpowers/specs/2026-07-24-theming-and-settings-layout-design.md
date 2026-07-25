# Theming and settings layout — design

**Date:** 2026-07-24
**Status:** approved, ready for planning

## Problem

Forest has one hardcoded dark look. `web/src/styles.css` declares 10 CSS custom
properties, but 53 further colors are written literally — `rgba(110,231,183,0.08)`
tints of the accent, raw `#0e0e10` backgrounds, `#2a2a2d` borders. The CodeMirror
syntax theme, the xterm terminal colors, the mermaid diagram theme, and the chart
series colors are each hardcoded separately, in TypeScript.

Separately, the settings page is a single 480px-wide column
(`.settings form { max-width: 480px }`) holding six unrelated groups in one form.
It occupies about a third of the screen and its organization is flat. Adding a
theme setting to it as-is would make both problems worse.

## Goals

- Ship 16 selectable themes, with Catppuccin's four flavors as the headline.
- Cover app chrome, code-editor syntax highlighting, charts, and mermaid.
- Restructure settings into a navigable, full-width layout that scales.
- Make saving coherent, and stop losing edits when the user navigates away.

## Non-goals

- **Terminal ANSI palette.** Slots 0–15 keep xterm's defaults. Programs running
  in the PTY choose their own colors, and modern prompts (starship among them)
  emit 24-bit truecolor that no theme can or should override. Only the terminal
  background, foreground, and cursor follow the theme.
- **Per-theme accent override.** Catppuccin's own idiom is picking an accent per
  install. Genuinely appealing, deliberately deferred.
- **Server-side or synced theme storage.** Per-device localStorage only.
- **User-authored custom themes.** The registry is compile-time.

## Decisions

| Question | Decision |
|---|---|
| Theming scope | App chrome, CodeMirror syntax, charts, mermaid. Not terminal ANSI. |
| Catalog | 16 themes including light variants (see §3) |
| Storage | `localStorage`, per-device, following the `autoRefresh` precedent |
| Architecture | TypeScript registry as single source of truth (§1) |
| Tints | `color-mix()` against semantic tokens |
| Settings layout | Sidebar rail, one section at a time, real routes |
| Save model | Per-section save, no redirect, unsaved-changes guard |
| Mobile theme picking | Swatch button in the `/m` bar opening a bottom sheet |

## 1. Theme architecture

### Why a TypeScript registry rather than CSS blocks

The deciding constraint is that **some consumers cannot read CSS variables**.
CodeMirror can — `EditorView.theme()` and `HighlightStyle.define()` compile to
real CSS via StyleModule, so `color: "var(--syn-keyword)"` works and recolors
automatically. But xterm renders to canvas/WebGL and parses literal color
strings, and mermaid takes a config object of literal values. Under a pure-CSS
approach those two would need `getComputedStyle` reads re-run on every theme
change — fragile plumbing that fails silently.

A TypeScript registry also makes a missing token a compile error across all 16
themes at once, which hand-maintained CSS blocks cannot do.

Generating everything from a seed color (OKLCH ramps) was considered and
rejected on the premise: faithful Catppuccin is the actual request, and no
generator reproduces a hand-tuned palette.

### Token set — 38 CSS custom properties

| Group | Tokens |
|---|---|
| Surfaces | `--bg`, `--bg-2`, `--bg-3` |
| Text | `--fg`, `--fg-dim`, `--fg-faint` |
| Lines | `--border`, `--border-strong` |
| Roles | `--accent`, `--accent-fg`, `--ok`, `--warn`, `--error`, `--info` |
| Syntax | `--syn-keyword`, `--syn-string`, `--syn-number`, `--syn-function`, `--syn-property`, `--syn-type`, `--syn-tag`, `--syn-comment`, `--syn-operator`, `--syn-invalid` |
| Charts | `--chart-1` … `--chart-8` |
| Terminal | `--term-bg`, `--term-fg`, `--term-cursor` |
| Token meter | `--tok-in`, `--tok-out`, `--tok-cache` |

`--bg-3`, `--fg-faint`, `--border-strong`, `--accent-fg`, `--info` and `--ok` do
not exist today. They are the raw `#0e0e10`, `#555`, `#3a3a3d`, `#82aaff`,
`#86efac` literals currently scattered through the stylesheet.

### `--accent` and `--ok` must be separate

Forest currently uses `--accent` for two distinct jobs: brand/selection (active
tab, pins, focus rings, the `ƒ` mark) and positive state (`.dot-ok`,
`.svc-running`, `.git-ahead`, `.diff-add`, `.banner-ok`, `.tree-badge-A`,
`.svc-terminals`). This only works because Forest's accent happens to be green.

Under Catppuccin Mocha, where the accent is mauve, every added line in a diff and
every running service would render purple. So the two roles split: brand keeps
`--accent`, positive state moves to `--ok`. In the Forest Dark theme both are
`#6ee7b7`, so the default look is unchanged.

Likewise `.diff-del` → `--error` and `.diff-hunk` → `--info`.

### The 53 tints become `color-mix()`

Every literal tint is rewritten against its semantic token:

```css
/* before */  background: rgba(110, 231, 183, 0.08);
/* after  */  background: color-mix(in srgb, var(--accent) 8%, transparent);
```

A theme therefore never authors its own tint ladder; the relationships hold
automatically across all 16.

**This is a hard browser requirement, not progressive enhancement.**
`color-mix()` needs Chrome 111 / Safari 16.2 / Firefox 113, all shipped in early
2023. Acceptable for a localhost tool aimed at developers; recorded here because
it is a real floor.

### The `Theme` type

```ts
export type ThemeScheme = "light" | "dark";

export type ThemeTokens = {
  bg: string; bg2: string; bg3: string;
  fg: string; fgDim: string; fgFaint: string;
  border: string; borderStrong: string;
  accent: string; accentFg: string;
  ok: string; warn: string; error: string; info: string;
  synKeyword: string; synString: string; synNumber: string;
  synFunction: string; synProperty: string; synType: string;
  synTag: string; synComment: string; synOperator: string; synInvalid: string;
  chart1: string; chart2: string; chart3: string; chart4: string;
  chart5: string; chart6: string; chart7: string; chart8: string;
  termBg: string; termFg: string; termCursor: string;
  tokIn: string; tokOut: string; tokCache: string;
};

export type Theme = {
  id: string;          // "catppuccin-mocha" — the localStorage value
  name: string;        // "Mocha" — shown in the picker
  family: string;      // "Catppuccin" — groups cards in the picker
  scheme: ThemeScheme; // drives `color-scheme`
  tokens: ThemeTokens;
};
```

Every field is required. Adding a token to `ThemeTokens` breaks compilation on
all 16 theme files until each supplies it, which is the point.

### Registry layout

```
web/src/lib/themes/
  types.ts          Theme, ThemeTokens, ThemeScheme
  apply.ts          applyTheme(), current theme signal, boot-cache write
  index.ts          THEMES array, THEME_BY_ID map, DEFAULT_THEME_ID
  forest-dark.ts
  catppuccin.ts     all four flavors from one shared palette module
  dracula.ts  nord.ts  gruvbox.ts  tokyo-night.ts
  one.ts  rose-pine.ts  solarized.ts
```

Each file is authored against the theme's own published palette so review is
possible against upstream:

```ts
const mocha = {
  base: "#1e1e2e", mantle: "#181825", crust: "#11111b",
  text: "#cdd6f4", subtext0: "#a6adc8", overlay0: "#6c7086",
  surface0: "#313244", surface1: "#45475a",
  mauve: "#cba6f7", green: "#a6e3a1", yellow: "#f9e2af",
  red: "#f38ba8", blue: "#89b4fa", peach: "#fab387",
  sky: "#89dceb", teal: "#94e2d5", pink: "#f5c2e7", lavender: "#b4befe",
} as const;

export const catppuccinMocha: Theme = {
  id: "catppuccin-mocha", name: "Mocha", family: "Catppuccin", scheme: "dark",
  tokens: {
    bg: mocha.base, bg2: mocha.mantle, bg3: mocha.surface0,
    fg: mocha.text, fgDim: mocha.subtext0, fgFaint: mocha.overlay0,
    border: mocha.surface0, borderStrong: mocha.surface1,
    accent: mocha.mauve, accentFg: mocha.crust,
    ok: mocha.green, warn: mocha.yellow, error: mocha.red, info: mocha.blue,
    // …syntax, charts, terminal, token meter
  },
};
```

### Applying a theme

```ts
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(cssVarName(key), value); // synKeyword → --syn-keyword
  }
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
  writeBootCache(theme);
}
```

`color-scheme` matters beyond aesthetics: it makes native scrollbars, form
controls, and the canvas background follow the theme, which is exactly what
breaks first on a light theme.

The current theme is a `persistedSignal` under `forest.theme`, matching
`lib/preferences.ts`. Setting it calls `applyTheme` as a side effect, so every
consumer — including `/m` — reacts.

### No flash of the default theme, without duplicating palettes

The built bundle is a deferred module, so the browser paints the default theme
before any JS runs. On a dark → light switch that is a visible white flash.

Inlining a copy of the palettes into `index.html` would fix it but create a
second source of truth that silently drifts. Instead, `applyTheme()` writes a
three-value cache:

```js
localStorage["forest.theme.boot"] = JSON.stringify({ bg, fg, scheme });
```

and a small blocking script in `index.html` applies it before first paint:

```html
<script>
  try {
    var b = JSON.parse(localStorage.getItem("forest.theme.boot") || "null");
    if (b) {
      var s = document.documentElement.style;
      s.setProperty("--bg", b.bg);
      s.setProperty("--fg", b.fg);
      s.colorScheme = b.scheme;
    }
  } catch (e) {}
</script>
```

Background luminance is what the eye catches; the remaining 36 tokens land
microseconds later when the module evaluates. On a first-ever visit there is no
cache, but the default theme is what would render anyway, so there is nothing to
flash. Self-healing, single source of truth, no build step.

## 2. Surface coverage

### CSS — `styles.css`, `mobile.css`

Mechanical conversion: 53 tints to `color-mix()`, and the raw `#0e0e10`,
`#2a2a2d`, `#555`, `#3a3a3d`, `#82aaff`, `#86efac`, `#fca5a5` literals onto real
tokens. The accent/ok split from §1 is applied at the same time. `mobile.css`
carries three tints and converts identically.

`:root { color-scheme: dark }` is removed — `applyTheme` owns it now.

### CodeMirror — `components/FileEditor.tsx`

The straightforward case. Both `EditorView.theme()` and `HighlightStyle.define()`
compile to CSS via StyleModule, so token references work directly:

```ts
{ tag: t.keyword, color: "var(--syn-keyword)" }
```

No reactivity, no subscription: the editor recolors when the root variables
change. The existing 19 tag rules collapse onto the 10 `--syn-*` tokens, keeping
the current groupings (`t.propertyName` and `t.attributeName` share
`--syn-property`; `t.regexp` and `t.escape` share `--syn-operator`; `t.heading`
uses `--syn-keyword`; `t.link` uses `--syn-function`).

The gutter, cursor, and editor background move to `--bg`, `--fg-faint`,
`--accent`, `--border`.

### xterm — `components/TerminalView.tsx`

Canvas/WebGL rendering means literal strings only. `TerminalView` reads
`termBg` / `termFg` / `termCursor` from the registry, and a `createEffect` on the
current-theme signal re-assigns `term.options.theme` when it changes. ANSI 0–15
are left unset, so xterm's defaults stand and truecolor output is untouched.

### mermaid — `components/Markdown.tsx`

`mermaid.initialize({ theme: "dark" })` is wrong on light themes. It becomes
`theme: "base"` with `themeVariables` fed literal registry values
(`background`, `primaryColor`, `primaryTextColor`, `lineColor`, `textColor`,
`mainBkg`, `nodeBorder`). Diagrams already rendered when the theme changes are
re-rendered; the module already tracks blocks by a counter id, so re-render
reuses that path.

### Charts — `components/charts/profileColors.ts`

The eight literal hex values become `--chart-1` … `--chart-8`, read from the
registry rather than CSS because they are applied as SVG fill attributes in JS.
The `?? "#888"` fallback in `TokensOverTimeChart.tsx` becomes `--fg-faint`.

## 3. Theme catalog

16 themes across 9 families. Forest Dark is the default, so an existing install
looks identical after upgrade.

| Family | Themes |
|---|---|
| Forest | Forest Dark *(default)* |
| Catppuccin | Latte *(light)*, Frappé, Macchiato, Mocha |
| Rosé Pine | Rosé Pine, Rosé Pine Dawn *(light)* |
| Gruvbox | Gruvbox Dark, Gruvbox Light *(light)* |
| One | One Dark, One Light *(light)* |
| Solarized | Solarized Dark, Solarized Light *(light)* |
| Dracula | Dracula |
| Nord | Nord |
| Tokyo Night | Tokyo Night |

### Mapping recipe

Every theme maps its own published palette onto the 38 tokens by the same rule,
so the result is reviewable rather than taste-driven:

| Token | Rule |
|---|---|
| `bg` | the theme's primary background |
| `bg2` | adjacent raised or recessed surface (mantle / bg1 / surface) |
| `bg3` | inset surface for inputs (surface0 / bg2 / overlay) |
| `fg` | primary text |
| `fgDim` | published secondary text, else `mix(fg, bg, 35%)` |
| `fgFaint` | published muted/comment text, else `mix(fg, bg, 60%)` |
| `border` | lowest-contrast line surface |
| `borderStrong` | the next step up |
| `accent` | the family's signature hue (mauve, purple, cyan, iris…) |
| `accentFg` | darkest base on dark themes, lightest on light themes |
| `ok` / `warn` / `error` / `info` | the theme's green / yellow / red / blue |
| `synKeyword` … | published syntax roles where the theme defines them, else: keyword=purple, string=green, number=orange, function=blue, property=cyan, type=yellow, tag=red, comment=muted, operator=cyan, invalid=red |
| `chart1..8` | blue, pink, green, yellow, purple, cyan, orange, teal |
| `termBg` / `termFg` / `termCursor` | `bg` / `fg` / `accent` unless the theme publishes a distinct terminal background |
| `tokIn` / `tokOut` / `tokCache` | `ok` / `warn` / the theme's purple |

**Derived values are computed once and written literally into the theme file**,
not computed at runtime. They stay reviewable and diffable, and the contrast
tests in §5 check them like any other value.

### Core token values

Published values from each project's spec. Cells marked *derived* follow the
`mix()` rule above.

| Theme | bg | bg2 | bg3 | fg | fgDim | fgFaint | border | accent | ok | warn | error | info |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Forest Dark | `#0e0e10` | `#1a1a1d` | `#0e0e10` | `#e6e6e6` | `#9a9a9a` | `#666666` | `#2a2a2d` | `#6ee7b7` | `#6ee7b7` | `#f59e0b` | `#f87171` | `#82aaff` |
| Catppuccin Latte | `#eff1f5` | `#e6e9ef` | `#ccd0da` | `#4c4f69` | `#6c6f85` | `#9ca0b0` | `#ccd0da` | `#8839ef` | `#40a02b` | `#df8e1d` | `#d20f39` | `#1e66f5` |
| Catppuccin Frappé | `#303446` | `#292c3c` | `#414559` | `#c6d0f5` | `#a5adce` | `#737994` | `#414559` | `#ca9ee6` | `#a6d189` | `#e5c890` | `#e78284` | `#8caaee` |
| Catppuccin Macchiato | `#24273a` | `#1e2030` | `#363a4f` | `#cad3f5` | `#a5adcb` | `#6e738d` | `#363a4f` | `#c6a0f6` | `#a6da95` | `#eed49f` | `#ed8796` | `#8aadf4` |
| Catppuccin Mocha | `#1e1e2e` | `#181825` | `#313244` | `#cdd6f4` | `#a6adc8` | `#6c7086` | `#313244` | `#cba6f7` | `#a6e3a1` | `#f9e2af` | `#f38ba8` | `#89b4fa` |
| Rosé Pine | `#191724` | `#1f1d2e` | `#26233a` | `#e0def4` | `#908caa` | `#6e6a86` | `#26233a` | `#c4a7e7` | `#9ccfd8` | `#f6c177` | `#eb6f92` | `#31748f` |
| Rosé Pine Dawn | `#faf4ed` | `#fffaf3` | `#f2e9e1` | `#575279` | `#797593` | `#9893a5` | `#dfdad9` | `#907aa9` | `#56949f` | `#ea9d34` | `#b4637a` | `#286983` |
| Gruvbox Dark | `#282828` | `#1d2021` | `#3c3836` | `#ebdbb2` | `#bdae93` | `#928374` | `#3c3836` | `#83a598` | `#b8bb26` | `#fabd2f` | `#fb4934` | `#83a598` |
| Gruvbox Light | `#fbf1c7` | `#f9f5d7` | `#ebdbb2` | `#3c3836` | `#665c54` | `#928374` | `#ebdbb2` | `#076678` | `#79740e` | `#b57614` | `#9d0006` | `#076678` |
| One Dark | `#282c34` | `#21252b` | `#3e4451` | `#abb2bf` | *derived* | `#5c6370` | `#3e4451` | `#c678dd` | `#98c379` | `#e5c07b` | `#e06c75` | `#61afef` |
| One Light | `#fafafa` | `#f0f0f1` | `#e5e5e6` | `#383a42` | *derived* | `#a0a1a7` | `#e5e5e6` | `#a626a4` | `#50a14f` | `#c18401` | `#e45649` | `#4078f2` |
| Solarized Dark | `#002b36` | `#073642` | `#073642` | `#839496` | `#93a1a1` | `#586e75` | `#073642` | `#268bd2` | `#859900` | `#b58900` | `#dc322f` | `#268bd2` |
| Solarized Light | `#fdf6e3` | `#eee8d5` | `#eee8d5` | `#657b83` | `#586e75` | `#93a1a1` | `#eee8d5` | `#268bd2` | `#859900` | `#b58900` | `#dc322f` | `#268bd2` |
| Dracula | `#282a36` | `#21222c` | `#343746` | `#f8f8f2` | *derived* | `#6272a4` | `#44475a` | `#bd93f9` | `#50fa7b` | `#f1fa8c` | `#ff5555` | `#8be9fd` |
| Nord | `#2e3440` | `#3b4252` | `#434c5e` | `#eceff4` | `#d8dee9` | `#4c566a` | `#434c5e` | `#88c0d0` | `#a3be8c` | `#ebcb8b` | `#bf616a` | `#81a1c1` |
| Tokyo Night | `#1a1b26` | `#16161e` | `#292e42` | `#c0caf5` | `#a9b1d6` | `#565f89` | `#292e42` | `#bb9af7` | `#9ece6a` | `#e0af68` | `#f7768e` | `#7aa2f7` |

Reading the table — four things that look like mistakes but are not:

- **`bg2` moves in different directions by family.** Catppuccin, Gruvbox, and
  Tokyo Night publish a *recessed* secondary surface (mantle, `bg0_h`,
  `bg_dark`), so `bg2` is darker than `bg`. Nord and Rosé Pine build *upward*,
  so `bg2` is lighter. The recipe permits either because that is how the themes
  themselves are constructed; what matters is that `bg2` is the adjacent surface.
- **Solarized and Forest Dark collapse two surfaces.** Solarized publishes only
  two background tones per mode, so `bg2` and `bg3` are both `#073642` /
  `#eee8d5`. Forest Dark's `bg3` equals its `bg` because that is the current
  design — inputs sit at page background inside raised cards.
- **`accent` and `info` coincide** for Solarized and Gruvbox, which publish a
  single blue.
- **Dracula's comment colour `#6272a4`** reaches only ~2.8:1 against its
  background, which is why it is `fgFaint` rather than `fgDim` — the contrast
  test in §5 is what surfaced this, and it is exactly the class of problem those
  tests exist to catch.

**Verification.** Every hex above is transcribed from the project's published
spec and must be re-checked against upstream during implementation. Wrong values
in a well-known palette are immediately visible to anyone who uses it.

## 4. Settings restructure

### Routing

`/settings` becomes a parent route rendering the shell:

```tsx
<Route path="/settings" component={Settings}>
  <Route path="/"             component={() => <Navigate href="/settings/appearance" />} />
  <Route path="/appearance"   component={AppearanceSection} />
  <Route path="/dashboard"    component={DashboardSection} />
  <Route path="/scan"         component={ScanSection} />
  <Route path="/terminals"    component={TerminalsSection} />
  <Route path="/launchers"    component={LaunchersSection} />
  <Route path="/integrations" component={IntegrationsSection} />
  <Route path="/system"       component={SystemSection} />
</Route>
```

Real URLs make refresh and deep links work, and they are what causes
`useBeforeLeave` to fire when switching sections.

### Decomposition

`pages/Settings.tsx` is 304 lines and grows with every setting. It becomes a
~60-line shell — rail, `props.children`, and a config context — with each section
in its own file:

```
web/src/pages/Settings.tsx              shell: rail + outlet + config context
web/src/components/settings/
  AppearanceSection.tsx    theme picker
  DashboardSection.tsx     auto-refresh
  ScanSection.tsx          scan root, poll interval, project sub-dirs
  TerminalsSection.tsx     max sessions, scrollback, default shell
  LaunchersSection.tsx     launcher editor
  IntegrationsSection.tsx  wraps the existing BbsSettings
  SystemSection.tsx        claude config dirs (read-only)
web/src/lib/settings-dirty.ts           useUnsavedGuard primitive
```

The shell fetches `/api/config` once and provides it through a context, rather
than each section issuing its own request — mirroring how `ProjectsContext`
already works.

### Save model

`PATCH /api/config` already guards every field with a `typeof` check
(`server/src/routes/config.ts:50-66`), so partial bodies work today. **This
feature requires no server changes.**

Sections divide into three kinds:

- **Instant** — *appearance* and *dashboard* write to localStorage on change.
  No save button, nothing to guard.
- **Explicit** — *scan*, *terminals*, *launchers*, *integrations* each own a save
  button that PATCHes only its own fields and confirms inline. The current
  redirect to `/` after saving is removed.
- **Read-only** — *system*.

Only *scan* calls `runDiscover()` and `refetchProjects()` after saving, since it
is the only section that changes what gets scanned.

### Unsaved-changes guard

`lib/settings-dirty.ts` exports `useUnsavedGuard(dirty, save)`, used by the four
explicit sections:

1. `useBeforeLeave` fires. If `dirty()` and not already `e.defaultPrevented`,
   call `e.preventDefault()`, stash `e`, and open the dialog.
2. The dialog offers three outcomes:
   - **save & continue** — `await save()`, then `e.retry(true)`
   - **discard** — reset fields to last-loaded values, then `e.retry(true)`
   - **cancel** — close the dialog, stay on the section
3. A `beforeunload` listener registered while dirty covers tab close and reload.
   The browser shows its own generic prompt there; not customizable, but it is
   the difference between losing work and not.

`retry(true)` skips re-running leave handlers, which is what prevents the dialog
from reopening on the retried navigation.

Because only one section is mounted at a time, there is no cross-section dirty
tracking to build — most of why per-section save is simpler than a global bar.
The guard covers leaving `/settings` entirely, not just switching sections.

### Appearance section

A responsive grid of theme cards grouped by `family`. Each card is a four-stripe
swatch — `bg`, `bg-3`, `accent`, `ok` — over the theme name, with the selected
card outlined in `--accent`. Clicking applies immediately; the entire app
recolors underneath, which is the preview. Light and dark families are visually
separated so Latte does not ambush a user scanning dark themes.

### Mobile

A swatch button in `.m-bar` opens a bottom sheet listing the same themes grouped
by family; tapping applies instantly and closes. Same registry, same
`forest.theme` key, so `/m` and `/settings` agree on a given device. This is the
first settings affordance on `/m`; it is deliberately a single control, not a
settings page.

### Responsive

Above ~700px the rail is a fixed 160px left column with the section pane filling
the rest. Below that it collapses to a horizontally scrolling row of section
chips above the pane, which also makes `/settings` usable from a phone.

### Settings CSS

`.settings form { max-width: 480px }` — the direct cause of the one-third-width
complaint — is removed along with the rest of the `.settings` block, which
assumes a single flat form. It is replaced by rail, section-pane, theme-card, and
dialog rules. The `.subdir-*` and `.launcher-*` rules survive largely unchanged;
they move inside their sections and gain the room to use a wider grid.

## 5. Testing

Vitest with `@solidjs/testing-library`, matching the existing suite.

**Themes**
- every theme in `THEMES` defines every `ThemeTokens` key with a valid hex — a
  runtime check alongside the compile-time one, so a bad cast cannot slip through
- theme `id`s are unique, and `DEFAULT_THEME_ID` resolves
- contrast floors, computed per theme: `fg`/`bg` ≥ 4.5:1, `fg-dim`/`bg` ≥ 3:1,
  `accent`/`bg` ≥ 3:1, `ok`/`bg` ≥ 3:1, `error`/`bg` ≥ 3:1. This is what catches
  a role mapped to the wrong palette entry in a light theme.
- `accentFg`/`accent` ≥ 4.5:1, since accent-filled chips carry text
- `applyTheme` writes all 38 custom properties, sets `color-scheme` and
  `data-theme`, and writes the boot cache
- the boot cache round-trips: what `applyTheme` writes is what the bootstrap
  script reads

**Settings**
- `/settings` redirects to `/settings/appearance`
- each explicit section PATCHes only its own fields
- *scan* triggers discover and project refetch; the others do not
- no section redirects after saving
- guard: dirty + navigate opens the dialog; save-and-continue persists then
  navigates; discard resets then navigates; cancel stays put with edits intact
- clean sections navigate without a dialog
- appearance and dashboard persist to localStorage without a save button
- the existing `BbsSettings.test.tsx` continues to pass

## 6. Risks

| Risk | Mitigation |
|---|---|
| `color-mix()` browser floor (2023) | Accepted; developer-facing localhost tool |
| 53 mechanical CSS replacements, easy to typo | Convert by group with visual check per group; the accent/ok split is the one requiring judgment, so it is reviewed by hand |
| Transcribed hex values wrong | Full table above for review; re-check against upstream during implementation |
| Light themes expose hardcoded assumptions beyond the 53 tints | Contrast tests plus a manual pass over every route in Latte, the most distant theme from today's look |
| Mermaid `base` theme renders differently than `dark` | Visual check of the mermaid test fixture in both a light and a dark theme |

## 7. Out of scope

Terminal ANSI 0–15; per-theme accent override; user-authored themes; syncing the
theme across devices; `prefers-color-scheme` auto-switching; theming the BBS
published HUD (server-rendered, own styling).
