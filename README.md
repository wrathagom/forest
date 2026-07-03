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
  Terminal limits and the default shell are configurable in Settings.
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
  **Settings → Big Beautiful Screens**, where you can set the **server URL** (point
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
