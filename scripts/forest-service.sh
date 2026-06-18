#!/usr/bin/env bash
# forest-service.sh — run Forest as a per-user background service.
#   macOS → launchd LaunchAgent (com.user.forest)
#   Linux → systemd --user unit (forest.service)
set -euo pipefail

LABEL="com.user.forest"
UNIT="forest.service"

# --- paths (resolved at run time — never hardcoded) --------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/forest"
LOG_DIR="$DATA_DIR/logs"
PORT="${FOREST_PORT:-52810}"
OS="$(uname -s)"

DRY_RUN=0
SKIP_BUILD=0
BUN=""        # set by find_bun
PLATFORM=""   # set in main

die()  { echo "forest-service: $*" >&2; exit 1; }
note() { echo "forest-service: $*"; }

# Run a command, or (in --dry-run) just print it.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "would run: $*"; else "$@"; fi
}
# Same, but ignore failure + suppress output when run for real (used for the
# "tear it down if it happens to be loaded" calls).
run_ok() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "would run: $* (ignoring failure)"; else "$@" >/dev/null 2>&1 || true; fi
}
# Write stdin to $1, or (in --dry-run) print it between markers.
write_file() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "--- begin $1 ---"; cat; echo "--- end $1 ---"
  else
    mkdir -p "$(dirname "$1")"; cat > "$1"
  fi
}

find_bun() {
  BUN="$(command -v bun || true)"
  [ -n "$BUN" ] || die "bun not found on PATH — install it from https://bun.sh, then re-run."
}

build_web() {
  if [ "$SKIP_BUILD" -eq 1 ]; then note "skipping web build (--skip-build)"; return; fi
  if [ "$DRY_RUN" -eq 1 ]; then echo "would run: (cd $REPO_DIR && $BUN run build:web)"; return; fi
  note "building web UI…"
  ( cd "$REPO_DIR" && "$BUN" run build:web ) || die "web build failed"
}

# --- service-file paths + templates -----------------------------------------
plist_path() { echo "$HOME/Library/LaunchAgents/$LABEL.plist"; }
unit_path()  { echo "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT"; }

render_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>run</string>
    <string>$REPO_DIR/server/src/index.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$PATH</string>
    <key>FOREST_PORT</key>
    <string>$PORT</string>
    <key>FOREST_STATIC_DIR</key>
    <string>$REPO_DIR/web/dist</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/forest.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/forest.err.log</string>
</dict>
</plist>
EOF
}

render_unit() {
  cat <<EOF
[Unit]
Description=Forest dashboard
After=network.target

[Service]
ExecStart="$BUN" run "$REPO_DIR/server/src/index.ts"
WorkingDirectory=$REPO_DIR
Environment="PATH=$PATH"
Environment="FOREST_PORT=$PORT"
Environment="FOREST_STATIC_DIR=$REPO_DIR/web/dist"
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
}

# --- macOS ops ---------------------------------------------------------------
macos_domain() { echo "gui/$(id -u)"; }
macos_load() {
  local p; p="$(plist_path)"
  run_ok launchctl bootout "$(macos_domain)/$LABEL"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would run: launchctl bootstrap $(macos_domain) $p   (or 'launchctl load -w $p' on older macOS)"
  elif ! launchctl bootstrap "$(macos_domain)" "$p" 2>/dev/null; then
    launchctl load -w "$p"
  fi
}
macos_unload() { run_ok launchctl bootout "$(macos_domain)/$LABEL"; run rm -f "$(plist_path)"; }
macos_restart() { run launchctl kickstart -k "$(macos_domain)/$LABEL"; }
macos_status() {
  local p; p="$(plist_path)"
  if [ -f "$p" ]; then echo "service file: $p"; else echo "service file: (not installed)"; fi
  launchctl print "$(macos_domain)/$LABEL" 2>/dev/null | grep -E '(state|pid) =' || echo "launchd: not loaded"
  local f
  for f in "$LOG_DIR/forest.err.log" "$LOG_DIR/forest.out.log"; do
    if [ -f "$f" ]; then echo "--- tail $f ---"; tail -n 20 "$f"; fi
  done
}

# --- Linux ops ---------------------------------------------------------------
linux_load() {
  run systemctl --user daemon-reload
  run systemctl --user enable --now "$UNIT"
  note "tip: to keep Forest running while logged out, run: loginctl enable-linger \"$USER\""
}
linux_unload() {
  run_ok systemctl --user disable --now "$UNIT"
  run rm -f "$(unit_path)"
  run systemctl --user daemon-reload
}
linux_restart() { run systemctl --user restart "$UNIT"; }
linux_status() {
  local u; u="$(unit_path)"
  if [ -f "$u" ]; then echo "service file: $u"; else echo "service file: (not installed)"; fi
  systemctl --user status "$UNIT" --no-pager || true
  echo "--- recent logs ---"
  journalctl --user -u "$UNIT" -n 20 --no-pager 2>/dev/null || true
}

service_installed() {
  case "$PLATFORM" in
    macos) [ -f "$(plist_path)" ] ;;
    linux) [ -f "$(unit_path)" ] ;;
  esac
}

# --- subcommands -------------------------------------------------------------
cmd_install() {
  find_bun
  build_web
  run mkdir -p "$LOG_DIR"
  case "$PLATFORM" in
    macos) render_plist | write_file "$(plist_path)"; macos_load ;;
    linux) render_unit  | write_file "$(unit_path)";  linux_load ;;
  esac
  note "Forest is running at http://localhost:$PORT"
  note "manage it: $0 {status|restart|uninstall}"
}

cmd_uninstall() {
  if [ "$DRY_RUN" -eq 0 ] && ! service_installed; then note "Forest service is not installed."; return; fi
  case "$PLATFORM" in macos) macos_unload ;; linux) linux_unload ;; esac
  note "Forest service removed. Data + logs left at $DATA_DIR"
}

cmd_restart() {
  if [ "$DRY_RUN" -eq 0 ] && ! service_installed; then die "Forest service isn't installed — run '$0 install' first."; fi
  find_bun
  build_web
  case "$PLATFORM" in macos) macos_restart ;; linux) linux_restart ;; esac
  note "Forest restarted at http://localhost:$PORT"
}

cmd_status() {
  case "$PLATFORM" in macos) macos_status ;; linux) linux_status ;; esac
  echo "url: http://localhost:$PORT"
}

usage() {
  cat <<EOF
forest-service.sh — run Forest as a per-user background service
                    (macOS launchd / Linux systemd --user)

usage: $0 <command> [options]

commands:
  install      build the web UI, install the service file, and start it
  uninstall    stop and remove the service (data + logs are kept)
  restart      rebuild the web UI and bounce the service (use after 'git pull')
  status       show whether the service is installed/running, plus recent logs

options:
  --port N      port for the service (default: \$FOREST_PORT or 52810; install only)
  --skip-build  don't rebuild the web UI (install, restart)
  --dry-run     print the service file and the commands that would run; change nothing
  -h, --help    show this help
EOF
}

main() {
  [ $# -gt 0 ] || { usage; exit 0; }
  local cmd="$1"; shift
  case "$cmd" in -h|--help|help) usage; exit 0 ;; esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run)    DRY_RUN=1 ;;
      --skip-build) SKIP_BUILD=1 ;;
      --port)       shift; [ $# -gt 0 ] || die "--port needs a value"; PORT="$1" ;;
      --port=*)     PORT="${1#*=}" ;;
      -h|--help)    usage; exit 0 ;;
      *)            die "unknown option: $1 (try --help)" ;;
    esac
    shift
  done
  case "$OS" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      die "unsupported platform '$OS' — run 'bun run dev:server' yourself." ;;
  esac
  case "$cmd" in
    install)   cmd_install ;;
    uninstall) cmd_uninstall ;;
    restart)   cmd_restart ;;
    status)    cmd_status ;;
    *)         usage >&2; exit 1 ;;
  esac
}

main "$@"
