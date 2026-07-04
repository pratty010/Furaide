// packages/cli/src/targets/opencode-fleet/uninstall.ts
//
// Reads the v2 install receipt at the target scope, removes exactly the
// files it recorded (installedFilesByComponent -- immune to drift between
// the manifest at install time and now), restores any backups, unwires the
// merged opencode.json(c) config via unmerge-config.mjs, and deletes the
// receipt.

import { existsSync, unlinkSync, rmdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { confirm, isCancel, cancel, intro, outro, note } from "@clack/prompts";
import type { Scope } from "./manifest-schema.ts";
import { deleteReceipt, readReceipt } from "./receipt.ts";
import { HARNESS_ROOT, resolveScopeDir } from "./install.ts";

function pruneEmptyParents(dst: string, targetDir: string): void {
  let parent = dirname(dst);
  while (parent !== targetDir && parent !== dirname(parent)) {
    if (!existsSync(parent)) {
      parent = dirname(parent);
      continue;
    }
    const entries = readdirSync(parent);
    if (entries.length === 0) {
      try {
        rmdirSync(parent);
      } catch {
        break;
      }
      parent = dirname(parent);
    } else {
      break;
    }
  }
}

function removeOrRestore(relPath: string, targetDir: string, backupRoot: string | null): void {
  const dst = join(targetDir, relPath);
  const restoreSrc = backupRoot ? join(backupRoot, relPath) : null;

  if (restoreSrc && existsSync(restoreSrc)) {
    try {
      unlinkSync(dst);
    } catch {
      /* dst may not exist -- fine, we're about to write it from backup */
    }
    copyFileSync(restoreSrc, dst);
    unlinkSync(restoreSrc);
    process.stdout.write(`[furaide] restored original: ${dst}\n`);
  } else if (existsSync(dst)) {
    unlinkSync(dst);
    process.stdout.write(`[furaide] removed: ${dst}\n`);
  }

  pruneEmptyParents(dst, targetDir);
}

function unwireConfig(targetDir: string, opts: { pluginRelPaths: string[]; hasRules: boolean; hasAgents: boolean; harnessRoot: string }): void {
  const cfgJson = join(targetDir, "opencode.json");
  const cfgJsonc = join(targetDir, "opencode.jsonc");
  const cfg = existsSync(cfgJson) ? cfgJson : existsSync(cfgJsonc) ? cfgJsonc : null;
  if (!cfg) return;

  const runner =
    spawnSync(process.platform === "win32" ? "where" : "command -v", ["bun"], { shell: process.platform !== "win32" }).status === 0 ? "bun" : "node";
  const unmergeScript = join(opts.harnessRoot, "scripts", "unmerge-config.mjs");
  const args = [unmergeScript, cfg, ...opts.pluginRelPaths];
  if (opts.hasRules) args.push("--rules");
  if (opts.hasAgents) {
    const agentsSource = join(opts.harnessRoot, "config", "opencode.jsonc");
    if (existsSync(agentsSource)) args.push("--agents-source", agentsSource);
  }

  const result = spawnSync(runner, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.stderr.write(`[furaide] warning: unmerge-config.mjs failed for ${cfg} (exit code ${result.status ?? "unknown"}); config may still reference removed plugins/agents.\n`);
  }
}

export async function performUninstall(targetDir: string): Promise<void> {
  const receipt = readReceipt(targetDir);
  if (!receipt) {
    process.stdout.write(`[furaide] No install receipt found at ${targetDir} -- nothing to uninstall.\n`);
    return;
  }

  const allFiles = Object.values(receipt.installedFilesByComponent).flat();
  for (const relPath of allFiles) removeOrRestore(relPath, targetDir, receipt.backup.root);

  const pluginRelPaths = allFiles.filter((f) => /^plugins\/.*\.(js|ts)$/.test(f));
  const hasRules = allFiles.some((f) => f.startsWith("rules/"));
  unwireConfig(targetDir, { pluginRelPaths, hasRules, hasAgents: receipt.selectedAgents.length > 0, harnessRoot: HARNESS_ROOT });

  deleteReceipt(targetDir);

  if (receipt.backup.root && existsSync(receipt.backup.root)) {
    try {
      if (readdirSync(receipt.backup.root).length === 0) rmdirSync(receipt.backup.root);
    } catch {
      /* not empty or already gone -- fine */
    }
  }

  process.stdout.write(`[furaide] Uninstall complete: ${targetDir}\n`);
}

interface UninstallFlags {
  scope?: Scope;
  customDir?: string;
  yes?: boolean;
}

function parseFlags(argv: string[]): UninstallFlags {
  const flags: UninstallFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--scope":
        flags.scope = argv[++i] as Scope;
        break;
      case "--custom-dir":
        flags.customDir = argv[++i];
        break;
      case "--yes":
        flags.yes = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}. Run 'furaide uninstall opencode-fleet --help' for usage.`);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: furaide uninstall opencode-fleet [flags]",
      "",
      "  --scope <global|project|custom>   Scope to uninstall from (default: project)",
      "  --custom-dir <path>                Absolute path, required when --scope custom",
      "  --yes                              Skip the confirmation prompt",
      "  -h, --help                         Show this help",
    ].join("\n") + "\n"
  );
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const flags = parseFlags(argv);
  const scope: Scope = flags.scope ?? "project";
  if (scope === "custom" && (!flags.customDir || !isAbsolute(flags.customDir))) {
    throw new Error("--scope custom requires --custom-dir <absolute path>");
  }
  const targetDir = resolveScopeDir(scope, flags.customDir);

  const receipt = readReceipt(targetDir);
  if (!receipt) {
    process.stdout.write(`[furaide] No install receipt found at ${targetDir} -- nothing to uninstall.\n`);
    return;
  }

  if (!flags.yes) {
    intro("Furaide's Fleet -- OpenCode uninstaller");
    note(
      [
        `Target: ${targetDir}`,
        `Installed: ${receipt.installedAt}`,
        `Agents (${receipt.selectedAgents.length}): ${receipt.selectedAgents.join(", ")}`,
        `Backup root: ${receipt.backup.root ?? "(none recorded)"}`,
      ].join("\n"),
      "About to remove"
    );
    const proceed = await confirm({ message: `Uninstall Furaide's Fleet from ${targetDir}?`, initialValue: false });
    if (isCancel(proceed) || proceed !== true) {
      cancel("Uninstall cancelled.");
      return;
    }
  }

  await performUninstall(targetDir);
  if (!flags.yes) outro("Done.");
}
