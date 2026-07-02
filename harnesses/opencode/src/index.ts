import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadAgents } from "./load-agents.js";

// @opencode-ai/plugin is a peer dependency; its types may not be resolvable
// in every consuming environment (e.g. this repo checkout). Fall back to a
// minimal structural shim rather than blocking on the dependency.
type Config = Record<string, any>;
type PluginHooks = {
  config: (config: Config, ctx?: unknown) => Promise<void>;
};
type Plugin = (ctx: unknown) => Promise<PluginHooks>;

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));

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

export const FuraideHarness: Plugin = async () => {
  return {
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
    },
  };
};

export default FuraideHarness;
