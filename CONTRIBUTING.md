# Contributing to Forest

Thanks for your interest in improving Forest.

## Setup

```sh
bun install
bun run dev:server   # http://localhost:52810
bun run dev:web      # http://localhost:5173
```

## Tests

Run both suites before opening a PR:

```sh
bun run test:server
bun run test:web
```

New behavior should come with tests. The server uses `bun test`; the web app
uses Vitest with `@solidjs/testing-library`.

## Pull requests

- Branch off `main`; keep PRs focused.
- Use clear, conventional commit messages (`feat:`, `fix:`, `docs:`, etc.).
- Make sure `bun run build:web` succeeds and both test suites pass.

## Security model — please respect it

Forest has **no authentication** on its HTTP or WebSocket routes and is designed
to run only on `localhost` or a private mesh (netbird / tailscale). Do not add
features that assume or encourage exposing it to the public internet, and do not
weaken the localhost-only default.
