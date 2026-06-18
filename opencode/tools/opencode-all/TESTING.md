# opencode-all — Human Testing Guide

This is a step-by-step protocol for exercising the TUI on a throwaway database
so your real sessions and `audit.log` are never touched.

## 0. Where the worktree lives

- Source: `/d/Everything/Furaidē/.worktrees/opencode-all/opencode/tools/opencode-all/`
- Symlink: `~/.local/bin/opencode-all` → `~/.local/share/opencode/tools/opencode-all/src/tui.tsx`
- Spec: `opencode/docs/superpowers/specs/2026-06-18-opencode-all-design.md`
- Plan: `opencode/docs/superpowers/plans/2026-06-18-opencode-all-implementation-plan.md`

The symlink points at the runtime install (`~/.local/share/opencode/tools/opencode-all/`),
which is a copy of the worktree's `src/`. After any source edit, re-run:

```bash
cd /d/Everything/Furaidē/.worktrees/opencode-all
bash opencode/tools/opencode-all/scripts/install.sh
```

## 1. Build the test fixture

```bash
bash /d/Everything/Furaidē/.worktrees/opencode-all/opencode/tools/opencode-all/scripts/test-fixture.sh
```

This creates a fresh SQLite DB at `/tmp/opencode-all-test/opencode.db` with **5
fake sessions** (3 active in `/tmp/test-cwd`, 1 active elsewhere, 1 archived)
and prints the exact launch commands.

The script also reports the launch commands and the tear-down command.

## 2. Launch the TUI against the fixture

Open a fresh terminal. **Do not** source your real env or `cd` into a real repo.
Run the commands the fixture script printed, summarized here:

```bash
export OPENCODE_ALL_DB_PATH="/tmp/opencode-all-test/opencode.db"
export XDG_DATA_HOME="/tmp/opencode-all-test/xdg"
mkdir -p "$XDG_DATA_HOME"
cd /tmp/test-cwd
opencode-all
```

The TUI should appear, list 4 active sessions in the left pane, and put
**Alpha**, **Bravo**, **Charlie** (the `/tmp/test-cwd` group) ahead of **Delta**
because of the cwd-boost. Status bar should read `ready`.

> **Quit at any time** with `q` or `Ctrl+C`. The TUI restores the cursor on exit.

## 3. Test checklist

Tick each item as you verify it. Report failures with the key sequence and the
resulting status text.

### Navigation
- [ ] `j` / `↓` — cursor moves down; viewport scrolls if needed.
- [ ] `k` / `↑` — cursor moves up.
- [ ] `G` — jumps to bottom.
- [ ] `g g` — two presses of `g` within ~1s — jumps to top.
- [ ] `Ctrl+D` / `Ctrl+U` — half-page down/up.
- [ ] Mouse wheel — scrolls the list pane.

### Tabs
- [ ] `Tab` once — list switches to Archived. Only **Echo** is visible, with
      `[A]` prefix.
- [ ] `Tab` again — switches to All. 5 sessions visible.
- [ ] `Tab` again — back to Active.

### Search (live substring)
- [ ] `/` — focus moves to an inline search field at the top of the list pane.
- [ ] Type `Alpha` — list filters to 1 row.
- [ ] `Esc` — clears filter; full list returns.
- [ ] Type `gpt-5.4` — filters to sessions whose model matches.

### Directory drill-down
- [ ] `\` — opens the directory browser modal.
- [ ] Type `test-cwd` — modal shows `/tmp/test-cwd` and `/tmp/test-cwd/sub` as
      options with session counts.
- [ ] Pick `/tmp/test-cwd` — list filters to Alpha + Charlie.
- [ ] `b` — returns to the unfiltered list (drill stack pops).
- [ ] `\` again, pick `/tmp/test-elsewhere` — list filters to Delta.
- [ ] `B` (Shift) — clears the drill stack, back to initial.

### Inspect (detail pane)
- [ ] `Enter` on Alpha — detail pane shows id, directory, agent, model, cost,
      token counts, message count (2), diff-path field.
- [ ] `Esc` — returns to list.

### Destructive actions (with confirmation)
- [ ] `a` on Alpha — status reads `confirm archive ses_alpha`. `pendingAction` set.
- [ ] `y` — status changes to `executed archive`. Alpha moves to Archived tab.
- [ ] `Tab` → Archived — Alpha appears.
- [ ] `Tab` → Active — Alpha gone.
- [ ] `r` on Alpha (still in Archived tab) — `confirm restore ses_alpha`.
- [ ] `n` — status `cancelled`; Alpha stays archived.
- [ ] `r` then `y` — Alpha restored to Active.
- [ ] `d` on Delta — `confirm delete ses_delta`. `n` to cancel. (We do not
      actually delete in this fixture because `opencode session delete` is
      called against the fixture DB and may not exist as a CLI flag in your
      OpenCode build — `n` is the safe choice here.)

### Continue (process handoff)
- [ ] `c` on Alpha — the TUI exits and `opencode --session ses_alpha` is
      spawned. The current TUI is replaced.
- [ ] If OpenCode starts and runs, you can `q` from inside it; you will
      return to the shell, not to the opencode-all TUI.
- [ ] Re-launch with the export commands in step 2 to test more.

### Refresh
- [ ] `R` — re-queries the DB. List re-renders with current `time_updated`.

### Help / quit
- [ ] `?` — opens help overlay (modal).
- [ ] `Esc` — closes overlay.
- [ ] `q` — clean teardown; cursor restored; back at shell prompt.

## 4. Headless verification (no TTY required)

You can sanity-check the data path without launching the TUI:

```bash
OPENCODE_ALL_DB_PATH="/tmp/opencode-all-test/opencode.db" \
  XDG_DATA_HOME="/tmp/opencode-all-test/xdg" \
  opencode-all --list
```

Expected output (tab-separated, cwd-boosted):

```text
ses_alpha	Alpha in cwd	/tmp/test-cwd
ses_bravo	Bravo in cwd sub	/tmp/test-cwd/sub
ses_charlie	Charlie in cwd	/tmp/test-cwd
ses_delta	Delta elsewhere	/tmp/test-elsewhere
```

## 5. Tear down

When done testing:

```bash
unset OPENCODE_ALL_DB_PATH XDG_DATA_HOME
rm -rf /tmp/opencode-all-test
rm -rf /tmp/test-cwd /tmp/test-elsewhere
```

Nothing real was modified. The symlink at `~/.local/bin/opencode-all` still
points at the runtime install; running `opencode-all` without the env override
will read your real `~/.local/share/opencode/opencode.db` as before.

## 6. Reporting findings

When you find an issue, please capture:
- Key sequence that triggered it.
- Status text or visible behavior.
- Whether it reproduces in the fixture or only against the real DB.

Then we can write a failing test for the bug, fix it, and re-test before
merging `feat/opencode-all` to `dev`.
