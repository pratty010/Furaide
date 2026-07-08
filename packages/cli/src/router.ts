// packages/cli/src/router.ts
//
// Top-level `furaide install|uninstall <target> [flags]` dispatch.
// opencode-fleet routes to real TypeScript logic. claude-code and pi-agent
// dispatch, unchanged, to their relocated shell installers (Task 42B).
//
// Unified skill model (see harnesses/*/README.md "Shared skills" section):
//   ~/.agents/skills/            <- master pool. OpenCode + Pi read natively;
//                                   Claude Code reads via ~/.claude/skills/<n> symlinks.
//   ~/.config/opencode/skills/   <- OpenCode-only fleet-specific skills (not shareable).
//   ~/.claude/skills/<name>      <- CC-only direct skills OR symlinks into ~/.agents/.
// The claude-code target must never write to ~/.config/opencode/skills/.
// The opencode-fleet target's *external* skills (skills-manifest.json) install
// to ~/.agents/skills/ (Phase 6) — its *bundled* fleet-specific skills still
// install to ~/.config/opencode/skills/ via copySkillTree() in install.ts.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// this file: packages/cli/src/router.ts -> repo root is 3 levels up.
const REPO_ROOT = resolvePath(__dirname, "..", "..", "..");

export type Action = "install" | "uninstall";
export type Target = "opencode-fleet" | "claude-code" | "pi-agent";

const KNOWN_ACTIONS: readonly Action[] = ["install", "uninstall"];
const KNOWN_TARGETS: readonly Target[] = ["opencode-fleet", "claude-code", "pi-agent"];

type ShellTarget = Exclude<Target, "opencode-fleet">;

const SHELL_TARGET_SCRIPTS: Record<ShellTarget, { install: string; uninstall?: string }> = {
  "claude-code": {
    install: join(__dirname, "targets", "claude-code", "install.sh"),
    uninstall: join(__dirname, "targets", "claude-code", "uninstall.sh"),
  },
  "pi-agent": {
    install: join(__dirname, "targets", "pi-agent", "install.sh"),
  },
};

function printUsage(): string {
  return [
    "Usage: furaide <install|uninstall> <opencode-fleet|claude-code|pi-agent> [flags]",
    "",
    "Targets:",
    "  opencode-fleet   Furaide's Fleet for OpenCode (native TypeScript installer)",
    "  claude-code      Claude Code harness (dispatches to its relocated .sh installer)",
    "  pi-agent         pi.dev agent harness (dispatches to its relocated .sh installer)",
    "",
    "Run 'furaide <install|uninstall> opencode-fleet --help' for opencode-fleet-specific flags.",
  ].join("\n");
}

export async function runCli(argv: string[]): Promise<void> {
  const [action, target, ...rest] = argv;

  if (!action || !KNOWN_TARGETS.includes(target as Target) || !KNOWN_ACTIONS.includes(action as Action)) {
    process.stderr.write(printUsage() + "\n");
    process.exit(action || target ? 1 : 0);
  }

  const resolvedAction = action as Action;
  const resolvedTarget = target as Target;

  if (resolvedTarget === "opencode-fleet") {
    const mod = resolvedAction === "install" ? await import("./targets/opencode-fleet/install.ts") : await import("./targets/opencode-fleet/uninstall.ts");
    await mod.main(rest);
    return;
  }

  if (resolvedTarget === "pi-agent" && resolvedAction === "uninstall") {
    process.stdout.write(
      "pi-agent has no bundled uninstaller — remove it via Pi's own extension management:\n" +
      "  pi extensions list\n" +
      "  pi uninstall friday-furaidee\n"
    );
    return;
  }

  const scripts = SHELL_TARGET_SCRIPTS[resolvedTarget];
  const scriptPath = resolvedAction === "install" ? scripts.install : scripts.uninstall;
  if (!scriptPath) {
    process.stderr.write(`${resolvedTarget} has no ${resolvedAction} script.\n`);
    process.exit(1);
  }
  const result = spawnSync("bash", [scriptPath, ...rest], { stdio: "inherit", cwd: REPO_ROOT });
  process.exit(result.status ?? 1);
}
