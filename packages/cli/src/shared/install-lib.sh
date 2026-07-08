#!/usr/bin/env bash
# install-lib.sh — shared bash helpers for the claude-code and pi-agent
# installers/uninstallers. NOT used by opencode-fleet (TypeScript, has its
# own backup.ts/receipt.ts with equivalent behavior).
#
# Source this file, don't execute it:
#   source "$(dirname "${BASH_SOURCE[0]}")/../../shared/install-lib.sh"
#
# Functions:
#   furaide_detect_js_runtime   -> sets JS_RUNTIME, PKG_INSTALL, PKG_RUN
#   furaide_backup_file <dst> <target_dir> <timestamp>
#                               -> copies dst to <target_dir>/.furaide-backup/<timestamp>/<rel>
#                                  if dst exists and no backup for that rel path exists yet
#   furaide_find_project_dir <marker_name>
#                               -> walks up from CWD to nearest dir containing
#                                  <marker_name>, or nearest .git/ parent, or CWD;
#                                  echoes the resolved path (may not exist yet)
#   furaide_write_receipt <path> <json>
#                               -> atomic write (temp file + mv)

# ── JS runtime detection ────────────────────────────────────────────────────
# Sets three globals: JS_RUNTIME ("bun"|"npm"), PKG_INSTALL, PKG_RUN.
# Exits 1 with an install-instructions message if neither is found.
furaide_detect_js_runtime() {
  if command -v bun >/dev/null 2>&1; then
    JS_RUNTIME="bun"
    PKG_INSTALL="bun install"
    PKG_RUN="bun run"
  elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    JS_RUNTIME="npm"
    PKG_INSTALL="npm install"
    PKG_RUN="npx --yes"
  else
    printf 'Neither bun nor node+npm found.\n' >&2
    printf '  Install bun (recommended): https://bun.sh\n' >&2
    printf '  or Node.js 18+ with npm:  https://nodejs.org\n' >&2
    return 1
  fi
  export JS_RUNTIME PKG_INSTALL PKG_RUN
}

# ── In-target-dir backup ────────────────────────────────────────────────────
# furaide_backup_file <dst> <target_dir> <timestamp>
# No-op if dst doesn't exist/isn't a symlink, or a backup for that relative
# path already exists under this timestamp's backup root (first backup wins,
# matching opencode-fleet's backup.ts semantics).
furaide_backup_file() {
  local dst="$1" target_dir="$2" timestamp="$3"
  [[ -e "$dst" || -L "$dst" ]] || return 0

  local rel="${dst#"$target_dir"/}"
  if [[ "$rel" == "$dst" ]]; then
    # dst is not inside target_dir — refuse to backup outside the target's own tree
    return 0
  fi

  local backup_root="$target_dir/.furaide-backup/$timestamp"
  local backup_path="$backup_root/$rel"
  [[ -e "$backup_path" || -L "$backup_path" ]] && return 0

  mkdir -p "$(dirname "$backup_path")"
  if [[ -L "$dst" ]]; then
    ln -s "$(readlink "$dst")" "$backup_path"
  else
    cp "$dst" "$backup_path"
  fi
}

# ── CWD walk-up scope detection ─────────────────────────────────────────────
# furaide_find_project_dir <marker_name>
# Walks up from CWD looking for an existing directory named <marker_name>
# (e.g. ".claude" or ".opencode"). Stops at the nearest .git/ parent or
# filesystem root. Echoes:
#   - the found marker dir's path, if one exists along the walk
#   - otherwise, "<repo-root-or-cwd>/<marker_name>" as a not-yet-created default
# Never fails — always echoes a usable path.
furaide_find_project_dir() {
  local marker_name="$1"
  local dir="$PWD"
  local repo_root=""

  while true; do
    if [[ -d "$dir/$marker_name" ]]; then
      printf '%s\n' "$dir/$marker_name"
      return 0
    fi
    if [[ -d "$dir/.git" && -z "$repo_root" ]]; then
      repo_root="$dir"
    fi
    local parent
    parent="$(dirname "$dir")"
    if [[ "$parent" == "$dir" ]]; then
      break
    fi
    dir="$parent"
  done

  if [[ -n "$repo_root" ]]; then
    printf '%s\n' "$repo_root/$marker_name"
  else
    printf '%s\n' "$PWD/$marker_name"
  fi
}

# ── Receipt read/write (plain JSON, atomic write) ───────────────────────────
# furaide_write_receipt <path> <json_string>
furaide_write_receipt() {
  local path="$1" json="$2"
  mkdir -p "$(dirname "$path")"
  local tmp="${path}.tmp.$$"
  printf '%s\n' "$json" > "$tmp"
  mv -f "$tmp" "$path"
}

# furaide_read_receipt <path> -> prints the file contents, or nothing if absent
furaide_read_receipt() {
  local path="$1"
  [[ -f "$path" ]] && cat "$path"
}
