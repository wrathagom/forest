---
name: forest-yaml
description: Create a forest.yaml lifecycle file for a project so Forest can start, stop, and health-check it. Use when asked to add a forest.yaml, add start/stop/health commands for Forest, or set up project lifecycle for a repo shown in Forest.
---

# Create a forest.yaml File

Write a `forest.yaml` at a project's repo root so [Forest](https://github.com/wrathagom/forest-public)
can launch, stop, and health-check it from the project page.

## File Format

`forest.yaml` has four keys. `start`, `stop`, and `health` are each a **single
shell command** run from the project directory; `url` is a plain link, not a
command:

```yaml
# forest.yaml
start:  docker compose up -d          # required for a Start button
stop:   docker compose down           # required for a Stop button
health: curl -fsS localhost:3000/up   # optional; exit 0 = healthy, nonzero = errors
url:    http://localhost:3000         # optional; quick-link shown while the app is up
```

- `start` — required for a **Start** button. Should launch the project and
  return promptly (background/detached, not a foreground process that blocks).
- `stop` — required for a **Stop** button. Should tear down what `start` brought
  up.
- `health` — optional. Exit `0` = healthy, nonzero = errors. Forest only runs it
  on a project it already considers "up", so it judges health, it doesn't start
  anything.
- `url` — optional. The primary link to open the running app, e.g.
  `http://localhost:3000`. Forest shows a quick-link to it (in the project panel
  and on the dashboard card) only while the app is up. It runs nothing — it's
  just a convenience link.

Emit only the keys that actually apply to this project. A file with just
`start` + `stop` is fine; so is one with all four.

## Security: the file is inert until enabled

Forest scans **every** repo under the user's scan root, so a discovered
`forest.yaml` runs nothing until the user clicks **Enable lifecycle** on that
project's page. After creating the file, tell the user to click *Enable
lifecycle* to activate it — don't imply it works the moment the file exists.

## Instructions

1. **Inspect the repo** to find how it really starts and stops — don't guess.
   Check, in rough order of preference:
   - `docker-compose.yml` / `compose.yaml` → `docker compose up -d` /
     `docker compose down`.
   - `package.json` scripts (`dev`, `start`) → `npm run dev` / the matching
     runtime. There's often no clean stop command for a foreground dev server —
     prefer Compose or a Procfile-style runner when one exists.
   - `Makefile` targets (`up`/`down`, `start`/`stop`, `run`) → `make up` /
     `make down`.
   - `Procfile` → a process runner the repo already uses.
   - A bare binary or `bun`/`node`/`python` entrypoint → run it detached for
     `start`, and `pkill -f <pattern>` for `stop`.

2. **Pick a cheap health check** (only if one is obvious):
   - An HTTP service → `curl -fsS localhost:PORT/health` (or the app's real
     ready path — check the routes; fall back to `localhost:PORT/`).
   - No HTTP surface → `pgrep -f <process pattern>`.
   - Nothing cheap to probe → omit `health` entirely.

3. **Write `forest.yaml`** at the repo root with the keys you could fill in.
   Keep each command to a single line.

4. **Tell the user to click _Enable lifecycle_** on the project's Forest page to
   activate it.

## Examples

### Docker Compose

```yaml
# forest.yaml
start:  docker compose up -d
stop:   docker compose down
health: curl -fsS localhost:8080/healthz
url:    http://localhost:8080
```

### Node / Bun HTTP server

```yaml
# forest.yaml
start:  bun run start &
stop:   pkill -f "bun run start"
health: curl -fsS localhost:3000/
url:    http://localhost:3000
```

### Go binary

```yaml
# forest.yaml
start:  ./bin/app &
stop:   pkill -f "./bin/app"
health: pgrep -f "./bin/app"
```
