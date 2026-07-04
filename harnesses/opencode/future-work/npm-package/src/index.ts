import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { loadAgents } from "./load-agents.js";
import { createGateEnforcerPlugin } from "../plugins/gates/nio.js";
import { createDeliveryGatePlugin } from "../plugins/gates/nurikabe.js";
import { createSecurityPatternsPlugin } from "../plugins/gates/komainu.js";
import { createModelFailoverPlugin } from "../plugins/failover/migawari.js";
import { createAuditLoggerPlugin } from "../plugins/hooks/audit-logger.js";
import { createCompactionInjectorPlugin } from "../plugins/hooks/compaction-injector.js";
import { WebToolsPlugin } from "../plugins/tools/web-tools.ts";

// @opencode-ai/plugin is a peer dependency; its types may not be resolvable
// in every consuming environment (e.g. this repo checkout). Fall back to a
// minimal structural shim rather than blocking on the dependency.
type Config = Record<string, any>;

/** The opencode plugin function shape: (ctx) => Promise<hooks> */
type Plugin = (ctx: unknown) => Promise<Record<string, any>>;

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

/** Rewrite a scoped-bash pattern's leading `bun <script>` to an absolute package path. */
function rewriteBashPattern(pattern: string, pkgDir: string): string {
  const m = pattern.match(/^bun\s+(scripts\/[^\s]+)(.*)$/);
  if (!m) return pattern;
  const [, scriptPath, rest] = m;
  return `bun ${join(pkgDir, scriptPath)}${rest}`;
}

/** Recursively rewrite any `bun scripts/...` bash pattern keys found in a permission tree. */
function rewritePermissionBashPaths(permission: Record<string, unknown>, pkgDir: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(permission ?? {})) {
    if (key === "bash" && value && typeof value === "object") {
      const bash: Record<string, unknown> = {};
      for (const [pattern, val] of Object.entries(value as Record<string, unknown>)) {
        bash[rewriteBashPattern(pattern, pkgDir)] = val;
      }
      out[key] = bash;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = rewritePermissionBashPaths(value as Record<string, unknown>, pkgDir);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Shallow-merge `desired` fields into `target`, never overwriting a key already present in `target`. */
function mergeMissing(target: Record<string, any>, desired: Record<string, any>): void {
  for (const [key, value] of Object.entries(desired)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

// ── combinator ───────────────────────────────────────────────────────────────

/**
 * Compose multiple plugin `{name, hooks}` objects into a single hooks map.
 *
 * - Hook-name collisions are resolved by sequential invocation in plugin order.
 *   The combinator wraps colliding hooks into a single async function that
 *   calls each hook one after another.
 * - The `tool` key (tool registrations) is merged by spreading into a single
 *   `{tool: {web_search, fetch_content, maps_search}}` object.
 */
function composeHooks(...plugins: Array<{ name: string; hooks: Record<string, any> }>): Record<string, any> {
  const hooksByKey: Record<string, Array<Function>> = {};
  const tools: Record<string, any> = {};

  for (const plugin of plugins) {
    for (const [key, value] of Object.entries(plugin.hooks ?? {})) {
      if (key === "tool") {
        // Tool registrations: merge by spreading
        Object.assign(tools, value);
      } else if (typeof value === "function") {
        if (!hooksByKey[key]) hooksByKey[key] = [];
        hooksByKey[key].push(value);
      }
    }
  }

  const merged: Record<string, any> = {};
  for (const [key, fns] of Object.entries(hooksByKey)) {
    // Single hook: keep as-is. Multiple hooks: wrap in sequential invocation.
    merged[key] =
      fns.length === 1
        ? fns[0]
        : async (...args: any[]) => {
            for (const fn of fns) await fn(...args);
          };
  }
  if (Object.keys(tools).length > 0) merged.tool = tools;

  return merged;
}

// ── skills sync ──────────────────────────────────────────────────────────────

/**
 * Fire-and-forget run of `scripts/sync-skills.mjs` (bundled in the package).
 * The script is idempotent (receipt-gated by version), so re-running on every
 * opencode start is safe — it becomes a no-op after the first successful sync.
 */
function syncSkills(pkgDir: string): void {
  const script = join(pkgDir, "scripts/sync-skills.mjs");
  if (!existsSync(script)) return;
  execFile("bun", [script], { encoding: "utf8", timeout: 30000 }, () => {
    /* fire-and-forget */
  });
}

// ── plugin function ──────────────────────────────────────────────────────────

export const FuraideHarness: Plugin = async () => {
  // Load all sub-plugins in parallel, in the specified order
  const [nioPlugin, nurikabePlugin, komainuPlugin, migawariPlugin, auditPlugin, compactionPlugin, webToolsHooks] =
    await Promise.all([
      createGateEnforcerPlugin(),
      createDeliveryGatePlugin(),
      createSecurityPatternsPlugin(),
      createModelFailoverPlugin(),
      createAuditLoggerPlugin(),
      createCompactionInjectorPlugin(),
      // web-tools gets the package config dir so it reads config/web-tools.yml from the bundle
      WebToolsPlugin({ directory: PKG_DIR }).then((p) => ({
        name: "web-tools",
        hooks: { tool: p.tool },
      })),
    ]);

  const mergedHooks = composeHooks(
    nioPlugin,      // tool.execute.before  — gate enforcer
    nurikabePlugin, // tool.execute.before  — delivery gate
    komainuPlugin,  // tool.execute.before  — security patterns
    migawariPlugin, // model.error          — model failover
    auditPlugin,    // tool.execute.after   — audit logger
    compactionPlugin, // experimental.session.compacting — compaction injector
    webToolsHooks,  // tool.{web_search,fetch_content,maps_search}
  );

  return {
    // ── config hook (Task 38) ──────────────────────────────────────────
    config: async (config: Config) => {
      const agents = await loadAgents(PKG_DIR);

      if (!config.agent) config.agent = {};
      for (const agent of agents) {
        if (!config.agent[agent.name]) config.agent[agent.name] = {};
        const target = config.agent[agent.name];
        const permission = rewritePermissionBashPaths(agent.permission, PKG_DIR);
        mergeMissing(target, {
          description: agent.description,
          mode: agent.mode,
          model: agent.model,
          temperature: agent.temperature,
          steps: agent.steps,
          permission,
          prompt: agent.prompt,
        });
      }

      if (!Array.isArray(config.instructions)) config.instructions = [];
      const instructionPaths: string[] = [join(PKG_DIR, "config/AGENTS.md")];
      const rulesDir = join(PKG_DIR, "rules");
      if (existsSync(rulesDir)) {
        for (const f of readdirSync(rulesDir).filter((f) => f.endsWith(".md"))) {
          instructionPaths.push(join(rulesDir, f));
        }
      }
      for (const p of instructionPaths) {
        if (!config.instructions.includes(p)) config.instructions.push(p);
      }

      const commandsDir = join(PKG_DIR, "commands");
      if (existsSync(commandsDir)) {
        if (!config.command) config.command = {};
        for (const f of readdirSync(commandsDir).filter((f) => f.endsWith(".md"))) {
          const name = f.replace(/\.md$/, "");
          if (!config.command[name]) {
            config.command[name] = { template: readFileSync(join(commandsDir, f), "utf8") };
          }
        }
      }

      // Fire-and-forget skills sync (idempotent via version-stamped receipt)
      syncSkills(PKG_DIR);
    },

    // ── composed event hooks and tools ─────────────────────────────────
    ...mergedHooks,
  };
};

export default FuraideHarness;
