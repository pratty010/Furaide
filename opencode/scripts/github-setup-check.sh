#!/usr/bin/env bash
set -euo pipefail

# Furaidē's Fleet (OpenCode) — GitHub setup verification
# Checks if the developer environment is ready for GitHub workflows
# Single shared cache at ~/.github-setup-state-friday for the whole F.R.I.D.A.Y. setup

CACHE_FILE="${HOME}/.github-setup-state-friday"
CACHE_TTL=$((24 * 60 * 60))  # 24 hours
FORCE="${1:-}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Check if cache is fresh
if [[ -f "$CACHE_FILE" && "$FORCE" != "--force" ]]; then
  local_ts=$(stat -f "%m" "$CACHE_FILE" 2>/dev/null || stat -c "%Y" "$CACHE_FILE" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$((now - local_ts))
  if [[ $age -lt $CACHE_TTL ]]; then
    # Cache is fresh, output it
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Run all checks
# ─────────────────────────────────────────────────────────────────────────────

declare -A checks

# Local checks
checks[git_format]=$(git config --global gpg.format 2>/dev/null | grep -q "ssh" && echo "✓" || echo "✗")
checks[signing_key]=$([[ -n "$(git config --global user.signingkey 2>/dev/null)" ]] && echo "✓" || echo "✗")
checks[commit_gpgsign]=$(git config --global commit.gpgsign 2>/dev/null | grep -q "true" && echo "✓" || echo "✗")
checks[allowed_signers]=$([[ -f "$(git config --global gpg.ssh.allowedSignersFile 2>/dev/null)" ]] && echo "✓" || echo "✗")
checks[lefthook]=$([[ -f "$(git rev-parse --git-dir)"/hooks/pre-commit ]] 2>/dev/null && echo "✓" || echo "✗")
checks[gitleaks]=$(command -v gitleaks &>/dev/null && echo "✓" || echo "✗")
checks[ssh_agent]=$(ssh-add -l &>/dev/null && echo "✓" || echo "✗")

# API checks (GitHub)
checks[gh_signing_key]=$(
  local_key=$(git config --global user.signingkey 2>/dev/null || echo "")
  if [[ -z "$local_key" || ! -f "$local_key" ]]; then
    echo "✗"
  else
    local_pubkey=$(cat "$local_key")
    github_keys=$(gh api user/ssh_signing_keys --jq '.[].key' 2>/dev/null || echo "")
    [[ "$github_keys" == *"$local_pubkey"* ]] && echo "✓" || echo "✗"
  fi
)
checks[master_ruleset]=$(gh api repos/pratty010/F.R.I.D.A.Y/rulesets --jq '.[].name' 2>/dev/null | grep -qE "master|master-protection" && echo "✓" || echo "✗")
checks[secret_scanning]=$(gh api repos/pratty010/F.R.I.D.A.Y --jq '.security_and_analysis.secret_scanning.status // "disabled"' 2>/dev/null | grep -q "enabled" && echo "✓" || echo "✗")
checks[push_protection]=$(gh api repos/pratty010/F.R.I.D.A.Y --jq '.security_and_analysis.secret_scanning_push_protection.status // "disabled"' 2>/dev/null | grep -q "enabled" && echo "✓" || echo "✗")

# Check if all passed
all_passed=true
for status in "${checks[@]}"; do
  if [[ "$status" != "✓" ]]; then
    all_passed=false
    break
  fi
done

# Build output
if [[ "$all_passed" == "true" ]]; then
  output="All GitHub setup checks passed."
else
  output="F.R.I.D.A.Y. GitHub setup status:
  ${checks[git_format]} git gpg.format=ssh
  ${checks[signing_key]} user.signingkey configured
  ${checks[commit_gpgsign]} commit.gpgsign=true
  ${checks[allowed_signers]} allowed_signers file exists"

  if [[ "${checks[gh_signing_key]}" != "✓" ]]; then
    local_key=$(git config --global user.signingkey 2>/dev/null || echo "~/.ssh/id_ed25519.pub")
    local_pubkey=$(cat "$local_key" 2>/dev/null || echo "ssh-ed25519 AAAA...")
    output+=$'\n'"  ${RED}✗${NC} GitHub Signing Key registered
      → github.com → Settings → SSH and GPG keys → New SSH key
      → Key type: Signing Key (NOT Authentication Key)
      → Key: $local_pubkey"
  else
    output+=$'\n'"  ${checks[gh_signing_key]} GitHub Signing Key registered"
  fi

  if [[ "${checks[secret_scanning]}" != "✓" ]]; then
    output+=$'\n'"  ${RED}✗${NC} Secret scanning enabled
      → Settings → Security → Secret scanning → Enable"
  else
    output+=$'\n'"  ${checks[secret_scanning]} Secret scanning enabled"
  fi

  if [[ "${checks[push_protection]}" != "✓" ]]; then
    output+=$'\n'"  ${RED}✗${NC} Push protection enabled
      → Settings → Security → Push protection → Enable"
  else
    output+=$'\n'"  ${checks[push_protection]} Push protection enabled"
  fi

  output+=$'\n'"  ${checks[master_ruleset]} Master ruleset active"

  if [[ "${checks[lefthook]}" != "✓" ]]; then
    output+=$'\n'"  ${RED}✗${NC} Lefthook hooks installed
      → bunx lefthook install"
  else
    output+=$'\n'"  ${checks[lefthook]} Lefthook hooks installed"
  fi

  if [[ "${checks[gitleaks]}" != "✓" ]]; then
    output+=$'\n'"  ${RED}✗${NC} gitleaks installed
      → brew install gitleaks"
  else
    output+=$'\n'"  ${checks[gitleaks]} gitleaks installed"
  fi

  if [[ "${checks[ssh_agent]}" != "✓" ]]; then
    output+=$'\n'"  ${RED}✗${NC} SSH agent running
      → eval \"\$(ssh-agent -s)\" && ssh-add ~/.ssh/id_ed25519"
  else
    output+=$'\n'"  ${checks[ssh_agent]} SSH agent running"
  fi
fi

# Print and cache
echo -e "$output"
echo -e "$output" > "$CACHE_FILE"
