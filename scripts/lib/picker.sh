#!/usr/bin/env bash
# picker.sh — shared target selection for install.sh and uninstall.sh
#
# Provides: pick_target <action>
#   action: "install" or "uninstall" (determines help text)

pick_target() {
  local action="${1:-install}"
  printf 'Which harness would you like to %s?\n\n' "$action" >&2

  if [[ "$action" == "uninstall" ]]; then
    printf '  1) Claude Code\n' >&2
    printf '  2) OpenCode\n' >&2
    printf '  3) Pi Agent\n\n' >&2
  else
    printf '  1) Claude Code   — statusline, agents, skills, Idisu + Rejion plugins\n' >&2
    printf '  2) OpenCode      — 15-agent fleet, plugins, rules, skills\n' >&2
    printf '  3) Pi Agent      — web tools, TUI, themes, skills\n\n' >&2
  fi

  local choice
  read -rp 'Enter 1, 2, or 3: ' choice </dev/tty
  case "$choice" in
    1) printf 'claude-code\n' ;;
    2) printf 'opencode-fleet\n' ;;
    3) printf 'pi-agent\n' ;;
    *) err "invalid choice: $choice"; exit 1 ;;
  esac
}
