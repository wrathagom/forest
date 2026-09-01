# Forest

A localhost web dashboard for keeping many local code projects in view at once —
project cards, per-project terminals, a file editor, a git tab, agent-session
tracking, and tasks, plus a minimal mobile surface.

> **Security:** Forest has **no authentication** on its HTTP or WebSocket
> routes. It must stay bound to `localhost` or a private mesh (netbird /
> tailscale). Do not expose it to the public internet.

## Prerequisites

- [Bun](https://bun.sh) (the project's runtime, package manager, and test runner).
- A POSIX environment (macOS or Linux). Native `node-pty` builds during install;
  a C/C++ toolchain is required.

## Quick start

```sh
bun install
bun run dev:server   # http://localhost:52810
bun run dev:web      # http://localhost:5173 (proxies /api to the server)
```

Open http://localhost:5173 during development.

## Build & run

```sh
bun run build:web
bun run dev:server   # serves the built web/dist as a static fallback at :52810
```

## Test

```sh
bun run test:server
bun run test:web
```

## Run as a service

Run Forest as a per-user background service (macOS launchd / Linux
`systemd --user`):

```sh
./scripts/forest-service.sh install      # builds the web UI, installs + starts the service
./scripts/forest-service.sh status       # running? recent logs, the URL
./scripts/forest-service.sh restart      # rebuild + bounce after a git pull
./scripts/forest-service.sh uninstall    # stop and remove it (data + logs are kept)
```

Or via Bun: `bun run service install`. Then visit http://localhost:52810. For
remote access, expose the port over a private mesh (`netbird` / `tailscale`) or
a tunnel such as `ngrok http 52810` — never directly to the internet.

Runtime data (the SQLite vault `forest.db`, logs, and session-hook queue) lives
in `$XDG_DATA_HOME/forest` (default `~/.local/share/forest`), outside the repo.

## How it works

Click any project card to open its detail page, which has:

- **Terminals** — tabbed PTYs that survive browser refresh and reconnect, and
  all die when Forest stops. The WebSocket route is
  `/ws/projects/:id/sessions/:sid` (no auth — see the security note above).
  Terminal limits and the default shell are configurable under
  **Settings → Terminals**.
- **Files** — a file tree and editor (with image preview/zoom), showing
  git-ignored entries dimmed.
- **Git** — branch-aware status and common actions.
- **Sessions** — Forest scans your Claude Code transcripts and tracks agent
  sessions (waiting / working / recent), with a sessions overview across
  projects.
- **Tasks** — lightweight per-project task tracking.

### Mobile (`/m`)

Visit `/m` from a phone (over your private mesh) for a terminal-free surface: a
list of waiting / working / recent agent sessions, a per-session reply box, and a
"new run" form that launches a headless agent in a project. The same
localhost / private-mesh-only boundary applies — there is no auth here either.

### Settings

`/settings` is a sidebar of seven sections — **appearance**, **dashboard**,
**scan**, **terminals**, **launchers**, **integrations**, **system**. Each saves
independently: scan, terminals, and launchers have their own save button that
persists only that section's fields, and saving keeps you on the page rather
than bouncing you back to the dashboard. If you navigate away with unsaved
edits, a dialog offers save, discard, or cancel.

Appearance and dashboard are per-device preferences stored in `localStorage`, so
they apply immediately and have no save button; system is read-only.

### Dashboard cards

Each project card leads with a colored title band. What the color *means* is up
to you — the **color by** dropdown in the dashboard toolbar switches between:

- **git** — clean / dirty / has errors (the default)
- **heat** — how recently the project was touched, today through months, as a
  five-step ramp off the theme's accent
- **services** — whether anything is running (a container or a listening process)
- **agents** — whether an agent session is live in the project
- **group** — a stable hue per group, for spatially clustering a long grid
- **none** — a neutral band for everyone

A legend next to the dropdown decodes whichever dimension is active. It earns
its place because a color doesn't mean the same thing everywhere: **git**,
**services** and **agents** all draw on the same handful of role colors, so green
means "clean" under one and "something is running" under another. **heat** and
**group** don't use the role colors at all — heat is a five-step ramp off the
theme's accent, and group draws from the chart palette.

Band text colors are *derived*, not authored: for each hue Forest picks whichever
of the theme's own foreground/background tones clears WCAG 4.5:1, falling back to
absolute black or white when neither does. That fallback is always sufficient —
for any color, the better of black and white is at least 4.58:1 — so the band
stays readable in all 16 themes without a per-theme table. A test enforces the
floor across every theme and every band state.

Alongside it, a **compact / status / detail** control sets how much each card
shows:

| Preset | Shows |
|---|---|
| `compact` | One dim line: branch, git summary, age |
| `status` | Branch, any issues, then a wrapping row of git and service chips |
| `detail` | Labelled rows, including the last commit *message*, file-edit recency separate from commit recency, and named containers and processes |

Cards in a row share a height, and the chip row sits on the card's floor, so the
chips line up across the row; the row itself is as tall as its busiest project.

Per-card actions — open, refresh, copy path, pin, archive — live in the **☰** menu
in the band. There's no pin star: pinned projects sort into their own section (and
sort first in search results), so position is what tells you.

Both the preset and the color-by choice are per-device, in `localStorage`.

### Project lifecycle (`forest.yaml`)

Drop a `forest.yaml` at a project's repo root to teach Forest how to launch,
stop, and health-check it:

```yaml
# forest.yaml
start:  docker compose up -d          # required for a Start button
stop:   docker compose down           # required for a Stop button
health: curl -fsS localhost:3000/up   # optional; exit 0 = healthy, nonzero = errors
```

Each value is a single shell command run from the project directory. Ask Claude
or Codex to write this file for you — "add a forest.yaml that starts and stops
this project."

The file is **inert until you enable lifecycle** for that project (a one-click
**Enable lifecycle** button on the project page). This is the security boundary:
Forest scans every repo under your scan root, so no discovered `forest.yaml`
runs anything until you opt it in.

Once enabled, the project page gets **Start** / **Stop** buttons, and Forest
reports a **lifecycle** status you can color cards by (the dashboard **color by**
dropdown):

- **stopped** — nothing running.
- **running** — something is up (no health command to judge it).
- **healthy** — up and the `health` command exits 0.
- **errors** — up but the `health` command exits nonzero.

"Up" is decided by Forest's existing container/process detection, and the health
command only runs on a project that's already up.

### Theming

Forest ships 16 themes — Catppuccin (Latte, Frappé, Macchiato, Mocha), Rosé Pine
and Dawn, Gruvbox Dark/Light, One Dark/Light, Solarized Dark/Light, Dracula,
Nord, Tokyo Night, and the original Forest Dark. Pick one under
**Settings → Appearance**, or from the swatch button in the mobile bar on `/m`.

The choice is per-device (stored in `localStorage`), so your laptop and your
phone can differ. Themes cover the app chrome, the code editor's syntax
highlighting, charts, and mermaid diagrams.

Terminal ANSI colors 0–15 are deliberately **not** themed: programs running in
the PTY pick their own colors, and modern prompts emit 24-bit truecolor that no
theme should override. Only the terminal's background, foreground, and cursor
follow the theme.

Adding a theme is one file under `web/src/lib/themes/` plus one line in
`index.ts`; `buildTheme()` expands a published palette into the full token set,
and the test suite checks completeness and contrast automatically.

## Architecture

- **`server/`** — Bun + TypeScript. A project scanner discovers repos under your
  scan root; a SQLite "vault" (`~/.local/share/forest/forest.db`) stores config,
  sessions, and tasks; a PTY registry manages terminals; HTTP + WebSocket routes
  serve the web UI and the live data. Claude Code session transcripts are
  ingested via a hook the service installs into each detected config dir.
- **`web/`** — SolidJS + Vite single-page app (xterm.js terminals, CodeMirror
  editor). Built assets are served by the server as a static fallback.

## Optional integrations

Both are off / absent by default; Forest runs fully without them.

- **[multi-agent-profiles](https://github.com/wrathagom/multi-agent-profiles)** —
  if you run several Claude Code profiles via separate `CLAUDE_CONFIG_DIR`s
  (e.g. `~/.claude-work`, `~/.claude-personal`), Forest auto-detects any
  `~/.claude` or `~/.claude-<name>` directory with a `projects/` subdir or a
  `settings.json`, scans transcripts from all of them, and tags sessions with
  their profile. Forest-launched terminals resolve the right profile by shelling
  out to `multi-agent-profiles resolve <cwd>` (falling back to
  `~/.local/bin/multi-agent-profiles`) and injecting `CLAUDE_CONFIG_DIR` into the
  spawned PTY. If the binary is not on `PATH`, launches fall back to the default
  `~/.claude` — no badge, which is how to spot an unrouted launcher.
- **[Big Beautiful Screens (BBS)](https://bigbeautifulscreens.com)** — an
  API-driven platform for real-time display dashboards and digital signage. Forest
  can optionally push a live session HUD to a BBS screen. Enable it under
  **Settings → Integrations**, where you can set the **server URL** (point
  it at the [hosted service](https://bigbeautifulscreens.com) or your own
  self-hosted instance), the account key, and provision a screen. Disabled by
  default. To self-host, see
  [wrathagom/Big-Beautiful-Screens](https://github.com/wrathagom/Big-Beautiful-Screens)
  — the quickest path is Docker:

  ```sh
  docker run -d -p 8000:8000 ghcr.io/wrathagom/big-beautiful-screens
  ```

## node-pty / terminals troubleshooting

Forest uses `node-pty` for terminals. With Bun the native binding ships as a
prebuilt under `node_modules`. If terminals fail to open and the logs show
`posix_spawnp failed`, the prebuilt `spawn-helper` is missing its execute bit
after install. Fix it (works regardless of where Bun hoisted the package):

```sh
find node_modules -name spawn-helper -exec chmod +x {} \;
```

If the native module itself is missing, reinstall and confirm a `pty.node`
prebuild is present:

```sh
bun install
find node_modules -name pty.node
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Caleb M Keller
