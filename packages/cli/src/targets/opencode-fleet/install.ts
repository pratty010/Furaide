// packages/cli/src/targets/opencode-fleet/install.ts
//
// Orchestrates one full install: resolve agent/script/skill closure ->
// back up conflicting files -> copy -> merge config -> write receipt.
// Also the CLI entrypoint (main()) deciding interactive vs non-interactive.

import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, basename, relative, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { type Scope, type WorkflowId, type InstallReceiptV2, RECEIPT_SCHEMA_VERSION } from "./manifest-schema.ts";
import {
  resolveWorkflowClosure,
  resolveAgentScripts,
  resolveAgentSkills,
  resolveAdvancedClosure,
  buildAgentDelegationMap,
  listAllAgentNames,
  findProjectScopeDir,
} from "./resolve.ts";
import { createBackupState, backupExistingFile, wasBackupCreated, existingReceiptBackupRoot, type BackupState } from "./backup.ts";
import { readReceipt, writeReceipt } from "./receipt.ts";
import { runInteractiveWizard, runNonInteractive, type NonInteractiveFlags } from "./wizard.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// this file: packages/cli/src/targets/opencode-fleet/install.ts -> repo root is 5 levels up.
export const REPO_ROOT = resolvePath(__dirname, "..", "..", "..", "..", "..");
export const HARNESS_ROOT = join(REPO_ROOT, "harnesses", "opencode");

export const GLOBAL_SCOPE = join(homedir(), ".config", "opencode");
export function projectScope(cwd: string = process.env.FURAIDE_INVOKED_FROM || process.cwd()): string {
  return findProjectScopeDir(cwd);
}

export function resolveScopeDir(scope: Scope, customDir?: string): string {
  switch (scope) {
    case "global":
      return GLOBAL_SCOPE;
    case "project":
      return projectScope();
    case "custom":
      if (!customDir) throw new Error("resolveScopeDir: scope 'custom' requires customDir");
      return customDir;
  }
}

/** Matches the legacy bash installer's `date -u +%Y%m%dT%H%M%SZ` format. */
export function makeInstallTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Ported from the pre-42F config/fleet-manifest.json's non-agent components
// (workflow-gates, failover, security-gate, rules). RE-VERIFY against the
// current fleet-manifest.json after Task 42F lands (see 42A.12).
const CORE_INFRA_FILES: string[] = [
  "plugins/gates/nio.js",
  "plugins/hooks/audit-logger.js",
  "plugins/hooks/compaction-injector.js",
  "scripts/workflow-state.mjs",
  "scripts/state-path.mjs",
  "docs/workflows.md",
  "plugins/failover/migawari.js",
  "docs/routing-manifest.json",
  "plugins/gates/komainu.js",
  "config/opencode.jsonc",
  "config/AGENTS.md",
];
const CORE_INFRA_GLOBS: string[] = ["scripts/lib/**", "rules/*.md"];

// Only copied when daikoku--finance-steward is in the resolved closure.
const FINANCE_FILES: string[] = [
  "scripts/knowledge-bank-finance.mjs",
  "scripts/finance-artifact-registry.mjs",
  "scripts/finance-source-registry.mjs",
  "scripts/finance/pyproject.toml",
  "scripts/finance/uv.lock",
];
const FINANCE_GLOBS: string[] = ["scripts/finance/*.py", "scripts/finance/tests/**"];

const WEB_TOOLS_FILES: string[] = [
  "plugins/tools/web-tools.ts",
  "config/web-tools.yml",
  "config/package.web-tools.json",
  "commands/tools-config.md",
  "docs/models/gemini-tool-fees.yml",
];
const WEB_TOOLS_GLOBS: string[] = ["plugins/tools/web-tools/**"];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function walkFiles(dir: string, srcBase: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, srcBase, out);
    else if (entry.isFile()) out.push(relative(srcBase, full));
  }
}

/** Expands a manifest glob pattern (either "dir/**" recursive, or
 * "dir/*.ext" flat) against srcBase, returning paths relative to srcBase. */
function expandGlob(pattern: string, srcBase: string): string[] {
  if (pattern.endsWith("/**")) {
    const dir = join(srcBase, pattern.slice(0, -3));
    const out: string[] = [];
    walkFiles(dir, srcBase, out);
    return out;
  }
  const dirPart = dirname(pattern);
  const globPart = basename(pattern);
  const dir = join(srcBase, dirPart);
  if (!existsSync(dir)) return [];
  const re = globToRegExp(globPart);
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => relative(srcBase, join(dir, e.name)));
}

function addComponentFile(map: Map<string, Set<string>>, component: string, relPath: string): void {
  const set = map.get(component) ?? new Set<string>();
  set.add(relPath);
  map.set(component, set);
}

/** `relPath` drives both src (relative to srcRoot) and dst (relative to
 * targetDir) in the common case where a component's files live at the same
 * relative path in both the harness and the install target. `trackedRelPath`
 * (defaults to relPath) is what gets recorded in the receipt -- callers whose
 * dst differs from srcRoot's relPath (see copySkillTree below, where files
 * land under an extra `skills/` prefix relative to targetDir) must pass the
 * dst-relative path explicitly, or uninstall will look in the wrong place. */
function copyOneFile(
  srcRoot: string,
  relPath: string,
  targetDir: string,
  installTimestamp: string,
  backupState: BackupState,
  componentFiles: Map<string, Set<string>>,
  component: string,
  trackedRelPath: string = relPath
): void {
  // Two components can legitimately reference the same file (e.g. an agent's
  // permission.bash script list overlapping a fixed component's file list).
  // Without this guard the second pass would back up the copy the first pass
  // JUST wrote (a spurious self-backup, not a real pre-existing user file) and
  // uninstall would "restore" that instead of removing cleanly. Copy once;
  // record the path under every component that references it.
  const alreadyCopied = Array.from(componentFiles.values()).some((set) => set.has(trackedRelPath));
  if (alreadyCopied) {
    addComponentFile(componentFiles, component, trackedRelPath);
    return;
  }

  const src = join(srcRoot, relPath);
  if (!existsSync(src)) {
    process.stderr.write(`[furaide] warning: source not found, skipping: ${src}\n`);
    return;
  }
  const dst = join(targetDir, trackedRelPath);
  backupExistingFile(dst, targetDir, installTimestamp, backupState);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  addComponentFile(componentFiles, component, trackedRelPath);
}

/** Copies an entire bundled skill directory tree from `<repoRoot>/skills/<name>`
 * into `<targetDir>/skills/<name>`. Per the hard requirement: bundled skill
 * content is resolved relative to the REPO ROOT's skills/ directory, never
 * the harness-local `harnesses/opencode/skills/` copy (deleted by 42E).
 * Uses the real `targetDir` (not a "skills"-suffixed one) so backups land
 * under the same backup root as every other component -- receipt.backup.root
 * must be a single consistent location uninstall can restore from. */
function copySkillTree(
  repoRoot: string,
  skillName: string,
  targetDir: string,
  installTimestamp: string,
  backupState: BackupState,
  componentFiles: Map<string, Set<string>>
): void {
  const skillsRoot = join(repoRoot, "skills");
  const srcDir = join(skillsRoot, skillName);
  if (!existsSync(srcDir)) {
    process.stderr.write(`[furaide] warning: bundled skill "${skillName}" not found at ${srcDir}, skipping\n`);
    return;
  }
  const files: string[] = [];
  walkFiles(srcDir, skillsRoot, files);
  for (const rel of files) {
    copyOneFile(skillsRoot, rel, targetDir, installTimestamp, backupState, componentFiles, "skills-bundled", join("skills", rel));
  }
}

function mergeConfig(targetDir: string, opts: { pluginRelPaths: string[]; hasRules: boolean; hasAgents: boolean; harnessRoot: string }): void {
  const cfgJson = join(targetDir, "opencode.json");
  const cfgJsonc = join(targetDir, "opencode.jsonc");
  let cfg = existsSync(cfgJson) ? cfgJson : existsSync(cfgJsonc) ? cfgJsonc : null;
  if (!cfg) {
    cfg = cfgJson;
    mkdirSync(dirname(cfg), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ plugin: [], instructions: [] }, null, 2) + "\n", "utf8");
  }

  const runner =
    spawnSync(process.platform === "win32" ? "where" : "command -v", ["bun"], { shell: process.platform !== "win32" }).status === 0 ? "bun" : "node";
  const mergeScript = join(opts.harnessRoot, "scripts", "merge-config.mjs");
  const args = [mergeScript, cfg, ...opts.pluginRelPaths];
  if (opts.hasRules) args.push("--rules");
  if (opts.hasAgents) {
    const agentsSource = join(opts.harnessRoot, "config", "opencode.jsonc");
    if (existsSync(agentsSource)) args.push("--agents-source", agentsSource);
  }

  const result = spawnSync(runner, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`merge-config.mjs failed for ${cfg} (exit code ${result.status ?? "unknown"})`);
  }
}

export interface ResolvedInstallOptions {
  scope: Scope;
  targetDir: string;
  selectedWorkflows: WorkflowId[];
  /** Advanced mode: bypasses workflow-closure resolution. */
  advancedAgents?: string[];
  webTools: boolean;
  /** Opt-in "extras" (E4): repo-bundled skill names the user explicitly
   * selected beyond each agent's auto-required set. Installed the same way
   * as required bundled skills (copySkillTree), recorded separately on the
   * receipt under selectedExtraSkills. */
  extraSkills?: string[];
  harnessRoot: string;
  repoRoot: string;
  installTimestamp: string;
}

export async function performInstall(opts: ResolvedInstallOptions): Promise<InstallReceiptV2> {
  const priorReceipt = readReceipt(opts.targetDir);
  const backupState = createBackupState();
  const componentFiles = new Map<string, Set<string>>();

  let agents: string[];
  let danglingDelegations: Array<{ from: string; to: string }> = [];
  if (opts.advancedAgents && opts.advancedAgents.length > 0) {
    const allAgentNames = listAllAgentNames(opts.harnessRoot);
    const delegationMap = buildAgentDelegationMap(allAgentNames, opts.harnessRoot);
    const closure = resolveAdvancedClosure(opts.advancedAgents, delegationMap);
    agents = closure.agents;
    danglingDelegations = closure.danglingDelegations;
  } else {
    agents = resolveWorkflowClosure(opts.selectedWorkflows).agents;
  }
  if (danglingDelegations.length > 0) {
    process.stderr.write(
      `[furaide] warning: ${danglingDelegations.length} delegation edge(s) point outside the selected agent set:\n` +
        danglingDelegations.map((d) => `  - ${d.from} -> ${d.to}\n`).join("")
    );
  }

  for (const rel of CORE_INFRA_FILES) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "core-infra");
  for (const pattern of CORE_INFRA_GLOBS) {
    for (const rel of expandGlob(pattern, opts.harnessRoot)) {
      copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "core-infra");
    }
  }

  for (const name of agents) {
    copyOneFile(opts.harnessRoot, join("agents", `${name}.md`), opts.targetDir, opts.installTimestamp, backupState, componentFiles, "agents");
  }

  const scripts = resolveAgentScripts(agents, opts.harnessRoot);
  for (const rel of scripts) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "agent-scripts");

  if (agents.includes("daikoku--finance-steward")) {
    for (const rel of FINANCE_FILES) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "finance");
    for (const pattern of FINANCE_GLOBS) {
      for (const rel of expandGlob(pattern, opts.harnessRoot)) {
        copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "finance");
      }
    }
  }

  if (opts.webTools) {
    for (const rel of WEB_TOOLS_FILES) copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "web-tools");
    for (const pattern of WEB_TOOLS_GLOBS) {
      for (const rel of expandGlob(pattern, opts.harnessRoot)) {
        copyOneFile(opts.harnessRoot, rel, opts.targetDir, opts.installTimestamp, backupState, componentFiles, "web-tools");
      }
    }
    if (!process.env.BRAVE_API_KEY) process.stderr.write("[furaide] warning: BRAVE_API_KEY not set; web_search via Brave will fail until configured.\n");
    if (!process.env.TAVILY_API_KEY) process.stderr.write("[furaide] warning: TAVILY_API_KEY not set; web_search/fetch_content via Tavily will fail until configured.\n");
  }

  const skills = resolveAgentSkills(agents, opts.harnessRoot);
  for (const skillName of skills.bundled) copySkillTree(opts.repoRoot, skillName, opts.targetDir, opts.installTimestamp, backupState, componentFiles);

  // Opt-in extras (E4): user-selected repo skills beyond the auto-required
  // set. Dedup against skills.bundled -- a skill can't be both required and
  // "extra" in the receipt, though copySkillTree's own alreadyCopied guard
  // would no-op the second copy anyway.
  const extraSkills = (opts.extraSkills ?? []).filter((name) => !skills.bundled.includes(name));
  for (const skillName of extraSkills) copySkillTree(opts.repoRoot, skillName, opts.targetDir, opts.installTimestamp, backupState, componentFiles);

  if (skills.external.length > 0) {
    process.stderr.write(
      `[furaide] Manual follow-up: run 'bun ${opts.harnessRoot}/scripts/pull-external-skills.mjs --pull' to pull/update pinned external skills: ${skills.external.join(", ")}\n`
    );
  }

  const allInstalledFiles = Array.from(componentFiles.values()).flatMap((set) => Array.from(set));
  const pluginRelPaths = allInstalledFiles.filter((f) => /^plugins\/.*\.(js|ts)$/.test(f));
  const hasRules = allInstalledFiles.some((f) => f.startsWith("rules/"));
  mergeConfig(opts.targetDir, { pluginRelPaths, hasRules, hasAgents: agents.length > 0, harnessRoot: opts.harnessRoot });

  const backupRoot = backupState.roots.get(opts.targetDir) ?? existingReceiptBackupRoot(opts.targetDir) ?? null;
  const backupCreated = wasBackupCreated(opts.targetDir, backupState) || (priorReceipt?.backup.created ?? false);

  const receipt: InstallReceiptV2 = {
    version: RECEIPT_SCHEMA_VERSION,
    installedAt: new Date().toISOString(),
    targetDir: opts.targetDir,
    scope: opts.scope,
    selectedWorkflows: opts.selectedWorkflows,
    selectedAgents: agents,
    installedFilesByComponent: Object.fromEntries(Array.from(componentFiles.entries()).map(([c, files]) => [c, Array.from(files).sort()])),
    backup: { root: backupRoot, created: backupCreated },
    requiredSkills: skills,
    selectedExtraSkills: extraSkills,
  };

  writeReceipt(opts.targetDir, receipt);

  // Clean up legacy receipt filename if present
  const legacyReceiptPath = join(opts.targetDir, ".furaide-install-receipt.json");
  if (existsSync(legacyReceiptPath)) {
    try {
      unlinkSync(legacyReceiptPath);
    } catch {
      // Silent on error
    }
  }

  return receipt;
}

function parseFlags(argv: string[]): NonInteractiveFlags {
  const flags: NonInteractiveFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--scope":
        flags.scope = argv[++i] as Scope;
        break;
      case "--custom-dir":
        flags.customDir = argv[++i];
        break;
      case "--workflows":
        flags.workflows = argv[++i];
        break;
      case "--agents":
        flags.agents = argv[++i];
        break;
      case "--extras":
        flags.extras = argv[++i];
        break;
      case "--web-tools":
        flags.webTools = true;
        break;
      case "--no-web-tools":
        flags.webTools = false;
        break;
      case "--yes":
        flags.yes = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}. Run 'furaide install opencode-fleet --help' for usage.`);
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: furaide install opencode-fleet [flags]",
      "",
      "With no flags: launches the interactive wizard.",
      "With any flag below: non-interactive, requires --yes.",
      "",
      "  --scope <global|project|custom>   Install scope (default: project)",
      "  --custom-dir <path>                Absolute path, required when --scope custom",
      "  --workflows <wf1,wf2,...|all>      Workflows to install (default: all)",
      "  --agents <name,name,...>           Advanced mode: install exactly these agents (ignores --workflows)",
      "  --extras <name,name,...>           Opt-in extra repo skills beyond each agent's auto-required set (default: none)",
      "  --web-tools / --no-web-tools       Force Web Tools on/off (default: auto-probe env)",
      "  --yes                              Required to confirm a non-interactive run",
      "  --dry-run                          Print what would be installed, make no changes",
      "  -h, --help                         Show this help",
    ].join("\n") + "\n"
  );
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.length === 0) {
    await runInteractiveWizard();
    return;
  }
  const flags = parseFlags(argv);
  await runNonInteractive(flags);
}
