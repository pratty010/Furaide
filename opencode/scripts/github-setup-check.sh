#!/usr/bin/env bash
set -euo pipefail

# Furaidē(Friday) Fleet — GitHub setup verification
# Numbered first-time guide format for onboarding new developers
# Single shared cache at ~/.github-setup-state-friday for the whole F.R.I.D.A.Y. setup

CACHE_FILE="${HOME}/.github-setup-state-friday"
CACHE_TTL=$((24 * 60 * 60))  # 24 hours
FORCE="${1:-}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if cache is fresh
if [[ -f "$CACHE_FILE" && "$FORCE" != "--force" ]]; then
  local_ts=$(stat -f "%m" "$CACHE_FILE" 2>/dev/null || stat -c "%Y" "$CACHE_FILE" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$((now - local_ts))
  if [[ $age -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Run all checks
# ─────────────────────────────────────────────────────────────────────────────

declare -A checks

# Local checks (always run, not cached)
checks[git_format]=$(git config --global gpg.format 2>/dev/null | grep -q "ssh" && echo "✓" || echo "✗")
checks[signing_key]=$([[ -n "$(git config --global user.signingkey 2>/dev/null)" ]] && echo "✓" || echo "✗")
checks[commit_gpgsign]=$(git config --global commit.gpgsign 2>/dev/null | grep -q "true" && echo "✓" || echo "✗")
checks[allowed_signers]=$([[ -f "$(git config --global gpg.ssh.allowedSignersFile 2>/dev/null)" ]] && echo "✓" || echo "✗")
checks[lefthook]=$([[ -f "$(git rev-parse --git-dir)"/hooks/pre-commit ]] 2>/dev/null && echo "✓" || echo "✗")
checks[gitleaks]=$(command -v gitleaks &>/dev/null && echo "✓" || echo "✗")
checks[ssh_agent]=$(ssh-add -l &>/dev/null && echo "✓" || echo "✗")

# API checks (cached)
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
checks[api_access]=$(gh api repos/pratty010/F.R.I.D.A.Y --jq '.name' 2>/dev/null | grep -q "F.R.I.D.A.Y" && echo "✓" || echo "✗")

# Fine-grained PAT check
checks[fine_grained_pat]=$(
  current_token=$(gh auth token 2>/dev/null || echo "")
  [[ "$current_token" == github_pat_* ]] && echo "✓" || echo "⚠"
)

# Check if all critical items passed
all_passed=true
if [[ "${checks[git_format]}" != "✓" || "${checks[signing_key]}" != "✓" || "${checks[commit_gpgsign]}" != "✓" || "${checks[allowed_signers]}" != "✓" || "${checks[gh_signing_key]}" != "✓" ]]; then
  all_passed=false
fi

# Build output
if [[ "$all_passed" == "true" ]]; then
  output="F.R.I.D.A.Y. GitHub setup — all critical checks passed"$'\n'
  if [[ "${checks[fine_grained_pat]}" != "✓" ]]; then
    output+=$'\n'"${YELLOW}[6/7] Fine-grained PAT (recommended — optional)${NC}"$'\n'"  ⚠ gh CLI is using a broad OAuth token"$'\n'"      Industry standard: use a repo-scoped fine-grained token instead"$'\n'"      → github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens"$'\n'"      → Repository: pratty010/F.R.I.D.A.Y only"$'\n'"      → Permissions: Contents(RW), Pull requests(RW), Workflows(RW), Metadata(R)"$'\n'"      → echo \"<TOKEN>\" | gh auth login --with-token"
  fi
else
  output="F.R.I.D.A.Y. GitHub setup — first-time guide"$'\n'

  # [1] Git signing config
  output+=$'\n'"${GREEN}[1/7] Git signing config (local)${NC}"$'\n'
  output+="  ${checks[git_format]} git gpg.format=ssh"$'\n'
  if [[ "${checks[git_format]}" != "✓" ]]; then
    output+="      → git config --global gpg.format ssh"$'\n'
  fi
  output+="  ${checks[signing_key]} user.signingkey configured"$'\n'
  if [[ "${checks[signing_key]}" != "✓" ]]; then
    output+="      → git config --global user.signingkey ~/.ssh/id_ed25519.pub"$'\n'
  fi
  output+="  ${checks[commit_gpgsign]} commit.gpgsign=true"$'\n'
  if [[ "${checks[commit_gpgsign]}" != "✓" ]]; then
    output+="      → git config --global commit.gpgsign true"$'\n'
  fi
  output+="  ${checks[allowed_signers]} allowed_signers file exists"$'\n'
  if [[ "${checks[allowed_signers]}" != "✓" ]]; then
    output+="      → echo \"~/.ssh/id_ed25519.pub\" | xargs -I{} git config --global gpg.ssh.allowedSignersFile {}"$'\n'
  fi

  # [2] GitHub Signing Key
  output+=$'\n'"${GREEN}[2/7] GitHub Signing Key (required for Verified commits)${NC}"$'\n'
  if [[ "${checks[gh_signing_key]}" != "✓" ]]; then
    output+="${RED}  ✗ Not registered as Signing Key on GitHub${NC}"$'\n'
    local_key=$(git config --global user.signingkey 2>/dev/null || echo "~/.ssh/id_ed25519.pub")
    local_pubkey=$(cat "$local_key" 2>/dev/null || echo "ssh-ed25519 AAAA...")
    output+="      → github.com → Settings → SSH and GPG keys → New SSH key"$'\n'
    output+="      → Key type: Signing Key  ← critical, NOT Authentication Key"$'\n'
    output+="      → Title: WSL2 signing (or your machine name)"$'\n'
    output+="      → Key: $local_pubkey"$'\n'
  else
    output+="  ${checks[gh_signing_key]} Registered as Signing Key on GitHub"$'\n'
  fi

  # [3] GitHub repo security
  output+=$'\n'"${GREEN}[3/7] GitHub repo security${NC}"$'\n'
  output+="  ${checks[master_ruleset]} Master ruleset active"$'\n'
  if [[ "${checks[master_ruleset]}" != "✓" ]]; then
    output+="      → github.com/pratty010/F.R.I.D.A.Y → Settings → Rules → Master should have ruleset"$'\n'
  fi
  output+="  ${checks[secret_scanning]} Secret scanning enabled"$'\n'
  if [[ "${checks[secret_scanning]}" != "✓" ]]; then
    output+="      → Settings → Security → Code security and analysis → Enable secret scanning"$'\n'
  fi
  output+="  ${checks[push_protection]} Push protection enabled"$'\n'
  if [[ "${checks[push_protection]}" != "✓" ]]; then
    output+="      → Settings → Security → Code security and analysis → Enable push protection"$'\n'
  fi

  # [4] Local tools
  output+=$'\n'"${GREEN}[4/7] Local tools${NC}"$'\n'
  output+="  ${checks[gitleaks]} gitleaks installed"$'\n'
  if [[ "${checks[gitleaks]}" != "✓" ]]; then
    output+="      → brew install gitleaks (macOS) or download from https://github.com/gitleaks/gitleaks/releases"$'\n'
  fi
  output+="  ${checks[lefthook]} Lefthook hooks installed"$'\n'
  if [[ "${checks[lefthook]}" != "✓" ]]; then
    output+="      → bunx lefthook install (run from repo root)"$'\n'
  fi

  # [5] SSH agent
  output+=$'\n'"${GREEN}[5/7] SSH agent${NC}"$'\n'
  output+="  ${checks[ssh_agent]} SSH agent running with key loaded"$'\n'
  if [[ "${checks[ssh_agent]}" != "✓" ]]; then
    output+="      → eval \"\$(ssh-agent -s)\" && ssh-add ~/.ssh/id_ed25519"$'\n'
  fi

  # [6] Fine-grained PAT (optional)
  output+=$'\n'"${YELLOW}[6/7] Fine-grained PAT (recommended — optional)${NC}"$'\n'
  if [[ "${checks[fine_grained_pat]}" != "✓" ]]; then
    output+="  ⚠ gh CLI is using a broad OAuth token"$'\n'
    output+="      Industry standard: use a repo-scoped fine-grained token instead"$'\n'
    output+="      → github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens"$'\n'
    output+="      → Token name: friday-monorepo"$'\n'
    output+="      → Expiration: 90 days"$'\n'
    output+="      → Repository: Only pratty010/F.R.I.D.A.Y"$'\n'
    output+="      → Permissions: Contents(RW), Pull requests(RW), Workflows(RW), Metadata(R)"$'\n'
    output+="      → Generate → copy token → echo \"<TOKEN>\" | gh auth login --with-token"$'\n'
    output+="      (Optional — existing auth works; this reduces blast radius if token leaks)"$'\n'
  else
    output+="  ✓ Using fine-grained PAT (good practice!)"$'\n'
  fi

  # [7] API connectivity
  output+=$'\n'"${GREEN}[7/7] API connectivity${NC}"$'\n'
  output+="  ${checks[api_access]} GitHub API accessible"$'\n'
  if [[ "${checks[api_access]}" != "✓" ]]; then
    output+="      → Verify gh CLI is authenticated: gh auth status"$'\n'
  fi
fi

# Print and cache
echo -e "$output"
echo -e "$output" > "$CACHE_FILE"
