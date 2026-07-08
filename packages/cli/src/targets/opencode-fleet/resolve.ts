// packages/cli/src/targets/opencode-fleet/resolve.ts
//
// Pure, framework-free, unit-testable resolution logic. No prompts, no file
// copying, no process.exit -- every function takes explicit inputs and
// returns a value or throws.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  WORKFLOW_IDS,
  CORE_AGENTS,
  WORKFLOW_EXCLUSIVE_AGENTS,
  WORKFLOW_EXTRA_DEPENDENCIES,
  type WorkflowId,
} from "./manifest-schema.ts";

const frontmatterCache = new Map<string, Record<string, unknown>>();

function extractFrontmatterBlock(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  return match ? match[1] : null;
}

/** Reads and parses `<harnessRoot>/agents/<agentName>.md`'s YAML frontmatter.
 * Cached per absolute file path. Throws a descriptive error if the file is
 * missing, has no frontmatter block, or fails to parse -- a broken agent
 * file must fail the install loudly, not silently resolve an empty closure. */
export function readAgentFrontmatter(agentName: string, harnessRoot: string): Record<string, unknown> {
  const filePath = join(harnessRoot, "agents", `${agentName}.md`);
  const cached = frontmatterCache.get(filePath);
  if (cached) return cached;

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`resolve.ts: cannot read agent file for "${agentName}" at ${filePath}: ${(err as Error).message}`);
  }

  const raw = extractFrontmatterBlock(content);
  if (raw === null) {
    throw new Error(`resolve.ts: agent file ${filePath} has no YAML frontmatter block`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(`resolve.ts: failed to parse YAML frontmatter in ${filePath}: ${(err as Error).message}`);
  }

  const result: Record<string, unknown> = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  frontmatterCache.set(filePath, result);
  return result;
}

/** Lists every agent name available under `<harnessRoot>/agents/*.md`. */
export function listAllAgentNames(harnessRoot: string): string[] {
  const agentsDir = join(harnessRoot, "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

/** Derives the monorepo root from a harness root, assuming the standard
 * layout `<repoRoot>/harnesses/opencode`. Used by resolveAgentSkills() to
 * find the repo-root `skills/` directory -- NOT the harness-local
 * `harnesses/opencode/skills/` copy (deleted by Task 42E). */
export function harnessRootToRepoRoot(harnessRoot: string): string {
  return resolvePath(harnessRoot, "..", "..");
}

/** Walks up from `startDir` looking for an existing `.opencode` directory,
 * stopping at the nearest `.git` parent or filesystem root. Mirrors
 * packages/cli/src/shared/install-lib.sh's furaide_find_project_dir() for
 * the bash-based installers -- kept as a separate TS implementation here
 * since opencode-fleet doesn't source that shell library. Always returns a
 * path (existing match, or `<repo-root-or-startDir>/.opencode` as a
 * not-yet-created default); never throws. */
export function findProjectScopeDir(startDir: string): string {
  let dir = resolvePath(startDir);
  let repoRoot: string | null = null;
  while (true) {
    if (existsSync(join(dir, ".opencode"))) return join(dir, ".opencode");
    if (repoRoot === null && existsSync(join(dir, ".git"))) repoRoot = dir;
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return join(repoRoot ?? startDir, ".opencode");
}

function assertKnownWorkflowIds(ids: string[]): WorkflowId[] {
  const seen = new Set<WorkflowId>();
  for (const id of ids) {
    if (!(WORKFLOW_IDS as readonly string[]).includes(id)) {
      throw new Error(`resolve.ts: unknown workflow id "${id}". Known ids: ${WORKFLOW_IDS.join(", ")}`);
    }
    seen.add(id as WorkflowId);
  }
  return Array.from(seen);
}

/** Core infra (always) + each selected workflow's exclusive agents + any
 * WORKFLOW_EXTRA_DEPENDENCIES. Selecting zero workflows returns just the
 * core infra agents (a valid "infrastructure only" install). */
export function resolveWorkflowClosure(selectedWorkflowIds: string[]): { agents: string[] } {
  const ids = assertKnownWorkflowIds(selectedWorkflowIds);
  const agents = new Set<string>(CORE_AGENTS);
  for (const id of ids) {
    for (const a of WORKFLOW_EXCLUSIVE_AGENTS[id]) agents.add(a);
    const extra = WORKFLOW_EXTRA_DEPENDENCIES[id];
    if (extra) for (const a of extra) agents.add(a);
  }
  return { agents: Array.from(agents).sort() };
}

// Matches a scripts/... path with a recognized extension, e.g.
// "bun scripts/workflow-state.mjs *" -> "scripts/workflow-state.mjs".
const SCRIPT_PATH_RE = /\b(?:\.\/)?(scripts\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|sh|py))\b/g;

/** Reads each agent's permission.bash frontmatter block and extracts every
 * scripts/... path referenced in a per-command key. Handles both the
 * shorthand string form (permission.bash: allow -- contributes no scripts)
 * and the per-command object form (extracts each scripts/... key, skipping
 * the literal "*" catch-all). */
export function resolveAgentScripts(agentNames: string[], harnessRoot: string): string[] {
  const scripts = new Set<string>();
  for (const name of agentNames) {
    const fm = readAgentFrontmatter(name, harnessRoot);
    const permission = fm.permission as Record<string, unknown> | undefined;
    const bashPerm = permission?.bash;
    if (!bashPerm || typeof bashPerm !== "object") continue;
    for (const key of Object.keys(bashPerm as Record<string, unknown>)) {
      if (key === "*") continue;
      SCRIPT_PATH_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SCRIPT_PATH_RE.exec(key)) !== null) scripts.add(match[1]);
    }
  }
  return Array.from(scripts).sort();
}

function listBundledSkillNames(repoRoot: string): Set<string> {
  const skillsDir = join(repoRoot, "skills");
  if (!existsSync(skillsDir)) return new Set();
  return new Set(
    readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  );
}

function listExternalSkillNames(harnessRoot: string): Set<string> {
  const manifestPath = join(harnessRoot, "config", "skills-manifest.json");
  if (!existsSync(manifestPath)) return new Set();
  let manifest: { sources?: Array<{ skills?: string[] }> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`resolve.ts: failed to parse ${manifestPath}: ${(err as Error).message}`);
  }
  const names = new Set<string>();
  for (const source of manifest.sources ?? []) {
    for (const skill of source.skills ?? []) names.add(skill);
  }
  return names;
}

/** Reads each agent's permission.skill allow-list and cross-references each
 * allowed skill name against repo-root `skills/*` (bundled) and
 * `<harnessRoot>/config/skills-manifest.json`'s pinned sources (external).
 * A skill matching neither is categorized "external" as a safe default
 * (never silently dropped) with a stderr warning. */
export function resolveAgentSkills(agentNames: string[], harnessRoot: string): { external: string[]; bundled: string[] } {
  const repoRoot = harnessRootToRepoRoot(harnessRoot);
  const bundledAvailable = listBundledSkillNames(repoRoot);
  const externalAvailable = listExternalSkillNames(harnessRoot);
  const bundled = new Set<string>();
  const external = new Set<string>();
  const unresolved = new Set<string>();

  for (const name of agentNames) {
    const fm = readAgentFrontmatter(name, harnessRoot);
    const permission = fm.permission as Record<string, unknown> | undefined;
    const skillPerm = permission?.skill;
    if (!skillPerm || typeof skillPerm !== "object") continue;
    for (const [skillName, verdict] of Object.entries(skillPerm as Record<string, unknown>)) {
      if (skillName === "*" || verdict !== "allow") continue;
      if (bundledAvailable.has(skillName)) bundled.add(skillName);
      else if (externalAvailable.has(skillName)) external.add(skillName);
      else unresolved.add(skillName);
    }
  }

  if (unresolved.size > 0) {
    process.stderr.write(
      `[resolve] warning: ${unresolved.size} skill(s) not found in bundled or external sources, treating as external: ${Array.from(unresolved).sort().join(", ")}\n`
    );
    for (const s of unresolved) external.add(s);
  }

  return { external: Array.from(external).sort(), bundled: Array.from(bundled).sort() };
}

/** agentName -> the agent names it may dispatch to, derived from
 * permission.task allow-list entries ("allow" verdict, excluding "*"). */
export function buildAgentDelegationMap(agentNames: string[], harnessRoot: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const name of agentNames) {
    const fm = readAgentFrontmatter(name, harnessRoot);
    const permission = fm.permission as Record<string, unknown> | undefined;
    const taskPerm = permission?.task;
    const delegates: string[] = [];
    if (taskPerm && typeof taskPerm === "object") {
      for (const [key, verdict] of Object.entries(taskPerm as Record<string, unknown>)) {
        if (key === "*" || verdict !== "allow") continue;
        delegates.push(key);
      }
    }
    map[name] = delegates.sort();
  }
  return map;
}

/** Advanced (manual individual-agent) mode: does NOT auto-expand the picked
 * set to include delegation targets -- that would defeat the point of a
 * manual pick. Instead surfaces every delegation edge pointing outside the
 * picked set ("dangling") so the caller can warn the user. */
export function resolveAdvancedClosure(
  pickedAgents: string[],
  allAgentDelegationMap: Record<string, string[]>
): { agents: string[]; danglingDelegations: Array<{ from: string; to: string }> } {
  const agents = Array.from(new Set(pickedAgents)).sort();
  const pickedSet = new Set(agents);
  const danglingDelegations: Array<{ from: string; to: string }> = [];
  for (const agent of agents) {
    for (const to of allAgentDelegationMap[agent] ?? []) {
      if (!pickedSet.has(to)) danglingDelegations.push({ from: agent, to });
    }
  }
  return { agents, danglingDelegations };
}
