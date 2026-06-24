# 📊 opencode-all: Session Dashboard for OpenCode

[![Bun](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=fff)](https://bun.sh)
[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![F.R.I.D.A.Y.](https://img.shields.io/badge/F.R.I.D.A.Y.-Furaidē-8b5cf6)](https://github.com/pratty010/Furaide)

An OpenTUI session dashboard for browsing and managing OpenCode sessions with hard archive support.

## ⚡ Quick Install

**Script (recommended)**

```bash
bash scripts/install.sh
```

**Manual**

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
cd ~/Furaidē/harnesses/opencode/tools/opencode-all
bun install
chmod +x src/tui.tsx
mkdir -p ~/.local/bin
ln -sfn "$PWD/src/tui.tsx" ~/.local/bin/opencode-all
```

> `~/.local/bin` must be on your `PATH`. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc file if needed.

## ✨ Features

Session management. Active and Archive tab views with an in-memory session index. Automatic return to dashboard after child session exit.

Fresh session launch. Start a brand-new OpenCode session in the selected active directory without leaving the dashboard. `N` or `n` on a folder or active session row.

Hard archive lifecycle. Export sessions to standalone archive files. Import from archives. Delete archived sessions with confirmation.

Search and navigation. Search by session title, session ID, or directory. Arrow-key result navigation.

Safety and reliability. Centered confirmation modals, compact metadata formatting, input sanitization, bidirectional text filtering.

## ⌨️ Keybindings

| Key | Context | Action |
|-----|---------|--------|
| `Enter` | Active session | Open child session |
| `Enter` | Archived session | Blocked. Use `I` to import first |
| `N` / `n` | Active folder or active session | Start fresh session in that directory |
| `Tab` | Any | Switch between Active / Archive tabs |
| `D` / `d` | Active session | Open archive / delete choice |
| `I` | Archive tab | Import the selected archive |
| `D` / `d` | Archive tab | Delete the selected archive |
| `R` / `r` | Any | Refresh session list (worker-backed) |
| `/` | Any | Enter search mode |
| `ArrowUp` / `ArrowDown` | Search | Navigate search results |
| `j` / `k` | Normal mode | Move selection up / down |
| `Ctrl+Shift+C` | Any | Let the terminal copy selected text without quitting the TUI |
| `Esc` | Any | Back / cancel current action |
| `q` | Any | Quit dashboard |

## 🎨 Theme

Built with a Friday dark theme using violet and magenta accents. Compact and high contrast, tuned for OpenTUI.

## Prerequisites

| Tool | Required | Notes |
|------|----------|-------|
| [Bun](https://bun.sh) | Yes | Runtime and package manager |
| [OpenCode CLI](https://opencode.ai) | Yes | Generates the SQLite DB this tool reads |

## 📦 Installation

**Script install**

```bash
bash scripts/install.sh
```

Copies sources to `~/.local/share/opencode/tools/opencode-all`, runs `bun install --production`, and symlinks `src/tui.tsx` to `~/.local/bin/opencode-all`.

> Re-running the installer mirrors the source tree into the install directory with `rsync --delete`, so local edits inside `~/.local/share/opencode/tools/opencode-all` will be replaced on reinstall.

**Manual install**

```bash
git clone https://github.com/pratty010/Furaide.git ~/Furaidē
cd ~/Furaidē/harnesses/opencode/tools/opencode-all
bun install
chmod +x src/tui.tsx
mkdir -p ~/.local/bin
ln -sfn "$PWD/src/tui.tsx" ~/.local/bin/opencode-all
```

From the fleet repo. This tool ships in `harnesses/opencode/tools/opencode-all` but installs independently from the fleet config. No `install-fleet.sh` required.

Development install. Clone the repo, `cd harnesses/opencode/tools/opencode-all`, then `bun install`. Use `ln -sfn "$PWD/src/tui.tsx" ~/.local/bin/opencode-all` for live iteration.

## 🧪 Verification

Run the test suite and typecheck:

```bash
bun test
bunx tsc --noEmit
bun run src/tui.tsx --list
```

**Interactive smoke test:**

```bash
bun run src/tui.tsx
```

**Fixture-based test:**

```bash
bash scripts/test-fixture.sh
```

Follow the printed instructions to launch against a synthetic, throwaway database.

**Start a fresh session without opening the dashboard:**

```bash
opencode-all --new /path/to/project
```

The `--new` flag validates that the directory exists, then spawns `opencode <directory>` with inherited stdio. Exit code mirrors the spawned OpenCode process.

## 🗂️ Architecture

`opencode-all` is a standalone Bun / OpenTUI companion app. It reads the OpenCode SQLite database (`opencode.db`) and archive files from the filesystem, providing a terminal UI for session browsing and management. It does not participate in the fleet runtime. No agent wiring, plugin loading, or config merging.

## 🗑️ Uninstall

```bash
rm -f ~/.local/bin/opencode-all
rm -rf ~/.local/share/opencode/tools/opencode-all
```

## 🛠️ Development

```bash
bun install
bun test
bun test tests/tui.test.tsx
bun run src/tui.tsx --list
```

Major UI changes should be validated with `bash scripts/test-fixture.sh` (fixture-based smoke test) and an interactive `bun run src/tui.tsx` session.

## 📚 Part of F.R.I.D.A.Y.

Part of the [Furaidē monorepo](https://github.com/pratty010/Furaide). See [`harnesses/opencode/README.md`](../README.md) for the full fleet overview.
