// packages/cli/src/targets/opencode-fleet/wizard.ts
//
// @clack/prompts interactive flow, plus the flag-driven non-interactive
// path that runs the same resolution logic with zero prompts.

import { intro, outro, select, multiselect, confirm, text, spinner, note, log, isCancel, cancel } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { WORKFLOW_IDS, WORKFLOW_CATALOG, type WorkflowId, type Scope, type InstallReceiptV2 } from "./manifest-schema.ts";
import { resolveWorkflowClosure, resolveAgentScripts, resolveAgentSkills } from "./resolve.ts";
import { readReceipt } from "./receipt.ts";
import { BACKUP_DIR_NAME } from "./backup.ts";
import { performInstall, resolveScopeDir, GLOBAL_SCOPE, projectScope, makeInstallTimestamp, HARNESS_ROOT, REPO_ROOT } from "./install.ts";

export function commandExists(cmd: string): boolean {
  try {
    if (process.platform === "win32") {
      return spawnSync("where", [cmd], { stdio: "ignore" }).status === 0;
    }
    return spawnSync(`command -v ${cmd}`, { shell: true, stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** Walks up to the nearest existing ancestor of `targetDir` and checks it's
 * writable -- targetDir itself usually doesn't exist yet on a fresh install. */
export function checkWriteAccess(targetDir: string): boolean {
  let dir = targetDir;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const WEB_TOOLS_CREDENTIAL_ENV_VARS = ["BRAVE_API_KEY", "TAVILY_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"] as const;

export function probeWebToolsCredentials(): { anyFound: boolean; found: string[] } {
  const found = WEB_TOOLS_CREDENTIAL_ENV_VARS.filter((v) => typeof process.env[v] === "string" && process.env[v]!.length > 0);
  return { anyFound: found.length > 0, found: [...found] };
}

function bail(message = "Install cancelled."): never {
  cancel(message);
  process.exit(0);
}

export async function runInteractiveWizard(): Promise<void> {
  intro("Furaide's Fleet -- OpenCode installer");

  const bunOk = commandExists("bun");
  const nodeOk = commandExists("node");
  const gitOk = commandExists("git");
  const opencodeOk = commandExists("opencode");

  note(
    [
      `bun:      ${bunOk ? "found" : "MISSING"}`,
      `node:     ${nodeOk ? "found" : "MISSING"}`,
      `git:      ${gitOk ? "found" : "MISSING"}`,
      `opencode: ${opencodeOk ? "found on PATH" : "not found -- install will proceed, but the fleet won't run until opencode is installed"}`,
    ].join("\n"),
    "Pre-checks"
  );

  if (!bunOk && !nodeOk) {
    cancel("Neither bun nor node was found on PATH. One is required to run this installer and the installed fleet's scripts.");
    process.exit(1);
  }

  const credentials = probeWebToolsCredentials();
  const BACK = Symbol("BACK");

  let scope: Scope | undefined;
  let targetDir = "";
  let selectedWorkflows: WorkflowId[] = [];
  let webTools = credentials.anyFound;

  let step: 1 | 2 | 3 = 1;
  while (step <= 3) {
    if (step === 1) {
      const scopeChoice = await select({
        message: "Where should Furaide's Fleet be installed?",
        options: [
          { value: "global" as const, label: "Global", hint: GLOBAL_SCOPE },
          { value: "project" as const, label: "Project", hint: projectScope() },
          { value: "custom" as const, label: "Custom directory" },
        ],
      });
      if (isCancel(scopeChoice)) bail();

      if (scopeChoice === "custom") {
        const customPath = await text({
          message: "Absolute path to install target: (leave empty to go back)",
          validate: (v) => (v === "" || isAbsolute(v) ? undefined : "Must be an absolute path"),
        });
        if (isCancel(customPath)) bail();
        if (customPath === "") continue; // stay on step 1
        scope = "custom";
        targetDir = customPath as string;
      } else {
        scope = scopeChoice as Scope;
        targetDir = resolveScopeDir(scope);
      }

      if (!checkWriteAccess(targetDir)) {
        cancel(`No write access to ${targetDir} (or its nearest existing parent directory). Choose a different scope or fix permissions.`);
        process.exit(1);
      }

      const existingReceipt: InstallReceiptV2 | null = readReceipt(targetDir);
      if (existingReceipt) {
        note(
          `An existing install was found at ${targetDir} (installed ${existingReceipt.installedAt}, ` +
            `workflows: ${existingReceipt.selectedWorkflows.join(", ") || "none"}).\n` +
            `This run will be treated as an UPDATE -- any file it overwrites is backed up first, reusing the original backup location.`,
          "Existing install detected"
        );
        selectedWorkflows = existingReceipt.selectedWorkflows;
      } else if (selectedWorkflows.length === 0) {
        selectedWorkflows = [...WORKFLOW_IDS];
      }

      step = 2;
      continue;
    }

    if (step === 2) {
      const workflowChoice = await multiselect({
        message: "Select workflows to install (core infrastructure is always included). Cancel (Ctrl+C is not back -- use Esc/empty submit per your terminal) to go back to scope.",
        options: [
          { value: BACK as unknown as WorkflowId, label: "← Go back to scope selection" },
          ...WORKFLOW_CATALOG.map((wf) => ({ value: wf.id, label: `${wf.label} (${wf.id})`, hint: wf.description })),
        ],
        initialValues: selectedWorkflows,
        required: false,
      });
      if (isCancel(workflowChoice)) bail();
      const picked = workflowChoice as unknown as Array<WorkflowId | typeof BACK>;
      if (picked.includes(BACK)) {
        step = 1;
        continue;
      }
      selectedWorkflows = picked as WorkflowId[];

      const webToolsChoice = await confirm({
        message: credentials.anyFound
          ? `Install Web Tools plugin (web_search / fetch_content / maps)? Detected credentials: ${credentials.found.join(", ")}.`
          : `Install Web Tools plugin (web_search / fetch_content / maps)? No provider credentials detected (${WEB_TOOLS_CREDENTIAL_ENV_VARS.join(", ")}) -- it will install but calls will fail until configured.`,
        initialValue: webTools,
      });
      if (isCancel(webToolsChoice)) bail();
      webTools = webToolsChoice as boolean;

      step = 3;
      continue;
    }

    if (step === 3) {
      const { agents } = resolveWorkflowClosure(selectedWorkflows);
      const scripts = resolveAgentScripts(agents, HARNESS_ROOT);
      const skills = resolveAgentSkills(agents, HARNESS_ROOT);
      const existingReceipt = readReceipt(targetDir);

      note(
        [
          `Target: ${targetDir} (${existingReceipt ? "update" : "fresh install"})`,
          `Workflows: ${selectedWorkflows.join(", ") || "(none -- core infra only)"}`,
          `Agents (${agents.length}): ${agents.join(", ")}`,
          `Scripts (${scripts.length}): ${scripts.join(", ") || "(none)"}`,
          `Bundled skills (${skills.bundled.length}): ${skills.bundled.join(", ") || "(none)"}`,
          `External skills referenced (${skills.external.length}, not auto-pulled): ${skills.external.join(", ") || "(none)"}`,
          `Web Tools: ${webTools ? "yes" : "no"}`,
          `Backups: any file this run overwrites is copied first to ${targetDir}/${BACKUP_DIR_NAME}/<timestamp-or-reused-root>`,
        ].join("\n"),
        "Install summary"
      );

      const proceedChoice = await select({
        message: "Proceed with install?",
        options: [
          { value: "yes" as const, label: "Yes, install" },
          { value: "back" as const, label: "← Go back to workflow selection" },
          { value: "cancel" as const, label: "Cancel" },
        ],
      });
      if (isCancel(proceedChoice) || proceedChoice === "cancel") bail();
      if (proceedChoice === "back") {
        step = 2;
        continue;
      }

      const s = spinner();
      s.start("Installing Furaide's Fleet...");
      let receipt: InstallReceiptV2;
      try {
        receipt = await performInstall({
          scope: scope!,
          targetDir,
          selectedWorkflows,
          webTools,
          harnessRoot: HARNESS_ROOT,
          repoRoot: REPO_ROOT,
          installTimestamp: makeInstallTimestamp(),
        });
        s.stop("Install complete.");
      } catch (err) {
        s.stop("Install failed.");
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      outro(
        [
          `Furaide's Fleet installed to ${targetDir}.`,
          `${receipt.selectedAgents.length} agent(s), ${receipt.requiredSkills.bundled.length} bundled skill(s).`,
          ``,
          `To uninstall later, run:`,
          `  furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes`,
        ].join("\n")
      );
      return;
    }
  }
}

export interface NonInteractiveFlags {
  scope?: Scope;
  customDir?: string;
  workflows?: string;
  agents?: string;
  webTools?: boolean;
  yes?: boolean;
}

function requireCustomDir(dir: string | undefined): string {
  if (!dir) throw new Error("--scope custom requires --custom-dir <absolute path>");
  if (!isAbsolute(dir)) throw new Error(`--custom-dir must be an absolute path, got: ${dir}`);
  return dir;
}

/** Flag-driven install path: same resolution logic as the interactive
 * wizard, zero prompts. Requires --yes. */
export async function runNonInteractive(flags: NonInteractiveFlags): Promise<void> {
  if (!flags.yes) {
    throw new Error("Non-interactive install requires --yes to confirm.");
  }

  const scope: Scope = flags.scope ?? "project";
  const targetDir = scope === "custom" ? requireCustomDir(flags.customDir) : resolveScopeDir(scope);

  if (!checkWriteAccess(targetDir)) {
    throw new Error(`No write access to ${targetDir} (or its nearest existing parent directory).`);
  }

  let selectedWorkflows: WorkflowId[] = [];
  let advancedAgents: string[] | undefined;

  if (flags.agents) {
    advancedAgents = flags.agents.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const workflowsRaw = flags.workflows ?? "all";
    selectedWorkflows =
      workflowsRaw === "all" ? [...WORKFLOW_IDS] : (workflowsRaw.split(",").map((s) => s.trim()).filter(Boolean) as WorkflowId[]);
    for (const id of selectedWorkflows) {
      if (!(WORKFLOW_IDS as readonly string[]).includes(id)) {
        throw new Error(`Unknown workflow id in --workflows: "${id}". Known ids: ${WORKFLOW_IDS.join(", ")}`);
      }
    }
  }

  const credentials = probeWebToolsCredentials();
  const webTools = flags.webTools ?? credentials.anyFound;

  process.stdout.write(`[furaide] Installing opencode-fleet to ${targetDir} (scope=${scope})...\n`);

  const receipt = await performInstall({
    scope,
    targetDir,
    selectedWorkflows,
    advancedAgents,
    webTools,
    harnessRoot: HARNESS_ROOT,
    repoRoot: REPO_ROOT,
    installTimestamp: makeInstallTimestamp(),
  });

  process.stdout.write(
    `[furaide] Install complete. ${receipt.selectedAgents.length} agent(s) installed to ${targetDir}.\n` +
      `[furaide] To uninstall: furaide uninstall opencode-fleet --scope custom --custom-dir ${targetDir} --yes\n`
  );
}
