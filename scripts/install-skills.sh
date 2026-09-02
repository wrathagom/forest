#!/usr/bin/env bash
# install-skills.sh — install this repo's skills/ into every detected Claude
# profile directory (~/.claude and ~/.claude-<name>).
#
# A "profile" is a ~/.claude* directory that contains a projects/ subdir or a
# settings.json — the same rule Forest uses to auto-detect profiles. Each skill
# under skills/ is linked (default) or copied into <profile>/skills/<name>.
#
#   scripts/install-skills.sh            # symlink every skill into every profile
#   scripts/install-skills.sh --copy     # copy instead of symlink
#   scripts/install-skills.sh --dry-run  # show what would happen, touch nothing
#   scripts/install-skills.sh --force     # replace an existing real dir/file
set -euo pipefail

# --- paths (resolved at run time — never hardcoded) --------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$REPO_DIR/skills"

DRY_RUN=0
MODE="symlink"   # symlink | copy
FORCE=0

die()  { echo "install-skills: $*" >&2; exit 1; }
note() { echo "install-skills: $*"; }

usage() {
  cat <<'EOF'
install-skills.sh — install this repo's skills into every detected Claude profile.

Usage: scripts/install-skills.sh [options]

Options:
  --symlink    Link <profile>/skills/<name> -> repo/skills/<name> (default).
               A git pull then updates the skill in every profile at once.
  --copy       Copy the skill directory into each profile instead (independent
               of the repo; re-run to pick up updates).
  --force      Replace an existing real directory/file at a target. Without it,
               a non-symlink target is warned about and skipped (data-safe).
  --dry-run    Print the actions without touching the filesystem.
  -h, --help   Show this help.

A profile is any ~/.claude or ~/.claude-<name> directory containing a projects/
subdirectory or a settings.json.
EOF
}

# Run a command, or (in --dry-run) just print it.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "would run: $*"; else "$@"; fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --symlink)  MODE="symlink" ;;
      --copy)     MODE="copy" ;;
      --force)    FORCE=1 ;;
      --dry-run)  DRY_RUN=1 ;;
      -h|--help)  usage; exit 0 ;;
      *)          die "unknown option: $1 (see --help)" ;;
    esac
    shift
  done
}

# Print each detected profile dir, one per line.
detect_profiles() {
  local dir
  for dir in "$HOME"/.claude "$HOME"/.claude-*; do
    [ -d "$dir" ] || continue
    if [ -d "$dir/projects" ] || [ -f "$dir/settings.json" ]; then
      echo "$dir"
    fi
  done
}

# install_one <profile-skills-dir> <skill-name>
install_one() {
  local dest_dir="$1" name="$2"
  local src="$SKILLS_DIR/$name"
  local dest="$dest_dir/$name"

  # Existing symlink: leave it if it already points at src, else repoint it.
  if [ -L "$dest" ]; then
    local cur; cur="$(readlink "$dest")"
    if [ "$cur" = "$src" ]; then
      note "  = $name (already linked)"
      return
    fi
    run rm "$dest"
  # Existing real dir/file: skip unless --force.
  elif [ -e "$dest" ]; then
    if [ "$FORCE" -eq 1 ]; then
      run rm -rf "$dest"
    else
      note "  ! $name (a real file/dir already exists — skipped; use --force to replace)"
      return
    fi
  fi

  if [ "$MODE" = "copy" ]; then
    run cp -R "$src" "$dest"
    note "  + $name (copied)"
  else
    run ln -s "$src" "$dest"
    note "  + $name (linked)"
  fi
}

main() {
  parse_args "$@"

  [ -d "$SKILLS_DIR" ] || die "no skills/ directory at $SKILLS_DIR"

  # Collect skill names (each is a subdir of skills/).
  local skills=()
  local d
  for d in "$SKILLS_DIR"/*/; do
    [ -d "$d" ] || continue
    skills+=("$(basename "$d")")
  done
  [ "${#skills[@]}" -gt 0 ] || die "skills/ is empty — nothing to install"

  local profiles=()
  local p
  while IFS= read -r p; do
    [ -n "$p" ] && profiles+=("$p")
  done < <(detect_profiles)

  if [ "${#profiles[@]}" -eq 0 ]; then
    note "no Claude profile directories found under $HOME (nothing to do)"
    exit 0
  fi

  local dry_note=""
  [ "$DRY_RUN" -eq 1 ] && dry_note=" (dry-run)"
  note "mode: $MODE$dry_note"
  note "skills: ${skills[*]}"

  local profile name
  for profile in "${profiles[@]}"; do
    note "profile: $profile"
    run mkdir -p "$profile/skills"
    for name in "${skills[@]}"; do
      install_one "$profile/skills" "$name"
    done
  done

  note "done — installed ${#skills[@]} skill(s) into ${#profiles[@]} profile(s)."
}

main "$@"
