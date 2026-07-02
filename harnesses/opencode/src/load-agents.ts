// Loads the bundled 15-agent fleet from agents/*.md, using the shared
// frontmatter parser in scripts/lib/agent-md.mjs as the single source of
// truth (same parser used by scripts/lint-dispatch-graph.mjs).
//
// Model resolution: the frontmatter's own `model:` field (if any) is NOT
// authoritative. Models are resolved through docs/routing-manifest.json —
// the `primary` field per agent, matching the repo-wide rule that the
// routing manifest owns model assignment.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentDef {
  name: string;
  description?: string;
  mode?: string;
  model?: string;
  temperature?: number;
  steps?: unknown;
  permission: Record<string, unknown>;
  prompt: string;
}

interface RoutingManifest {
  version: string;
  specialists?: Record<string, { primary: string; fallback?: string[] }>;
  subagents?: Record<string, { primary: string; fallback?: string[] }>;
  [key: string]: unknown;
}

/**
 * Parse and load every agents/*.md file in the package, resolving each
 * agent's model through the bundled routing manifest.
 */
export async function loadAgents(pkgDir: string): Promise<AgentDef[]> {
  // Bun's TS/ESM interop allows importing a plain .mjs module directly from
  // .ts, so we reuse the same parser as the lint script (single source of
  // truth) instead of re-implementing it here.
  const { loadAgentsFromDir } = await import(
    join(pkgDir, "scripts/lib/agent-md.mjs")
  );

  const agentsDir = join(pkgDir, "agents");
  const parsed = loadAgentsFromDir(agentsDir) as Record<
    string,
    {
      permission: Record<string, unknown>;
      description?: string;
      mode?: string;
      temperature?: number;
      steps?: unknown;
      prompt: string;
    }
  >;

  const manifestPath = join(pkgDir, "docs/routing-manifest.json");
  const manifest: RoutingManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const modelMap: Record<string, { primary: string; fallback?: string[] }> = {
    ...manifest.specialists,
    ...manifest.subagents,
  };

  const agents: AgentDef[] = [];
  for (const [name, agent] of Object.entries(parsed)) {
    agents.push({
      name,
      description: agent.description,
      mode: agent.mode,
      model: modelMap[name]?.primary,
      temperature: agent.temperature,
      steps: agent.steps,
      permission: agent.permission ?? {},
      prompt: agent.prompt,
    });
  }
  return agents;
}
