// packages/cli/src/targets/opencode-fleet/manifest-schema.ts
//
// zod schemas + shared constants for the OpenCode Fleet installer.
// Ground truth for the workflow/agent closure below is
// harnesses/opencode/scripts/workflow-state.mjs's WORKFLOW_ALLOWED_CALLERS,
// cross-checked against each agent's frontmatter permission.task allow-list.

import { z } from "zod";

export const WORKFLOW_IDS = ["wf1", "wf2", "wf3", "wf4", "wf5"] as const;
export const WorkflowIdSchema = z.enum(WORKFLOW_IDS);
export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const WORKFLOW_CATALOG: ReadonlyArray<{ id: WorkflowId; label: string; description: string }> = [
  { id: "wf1", label: "Feature / Change", description: "New features, enhancements, or architectural changes." },
  { id: "wf2", label: "Bug / Regression", description: "Fixing reported bugs or performance regressions." },
  { id: "wf3", label: "Security", description: "Security audits, vulnerability patching, or hardening." },
  { id: "wf4", label: "Research", description: "Codebase exploration, documentation research, or feasibility studies." },
  { id: "wf5", label: "Public-Company Finance", description: "Financial reporting, compliance, or audit-related tasks." },
];

/** Always included the moment ANY workflow is selected. */
export const CORE_AGENTS: readonly string[] = [
  "kantoku--workflow-director",
  "general",
  "kagami--verifier",
  "oni--red-team-reviewer",
  "hanko--git-seal",
  "hansei--lesson-keeper",
  "explore",
  "scout",
  "tsukumogami--code-forgemaster",
];

/** Agents exclusive to one workflow (not shared with any other workflow). */
export const WORKFLOW_EXCLUSIVE_AGENTS: Record<WorkflowId, string[]> = {
  wf1: ["kyakuhon--spec-planner"],
  wf2: ["bakeneko--bug-hunter"],
  wf3: ["fudo--security-guardian"],
  wf4: ["tsuchigumo--research-weaver"],
  wf5: ["daikoku--finance-steward", "kura--knowledge-banker"],
};

/** wf5's SOURCE_GATHERING state delegates to tsuchigumo (wf4's exclusive
 * agent) even when wf4 itself was not separately selected. */
export const WORKFLOW_EXTRA_DEPENDENCIES: Partial<Record<WorkflowId, string[]>> = {
  wf5: ["tsuchigumo--research-weaver"],
};

export const ALL_FLEET_AGENTS: readonly string[] = Array.from(
  new Set<string>([...CORE_AGENTS, ...Object.values(WORKFLOW_EXCLUSIVE_AGENTS).flat()])
);

export const ScopeSchema = z.enum(["global", "project", "custom"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const AgentRequirementsSchema = z.object({
  agent: z.string(),
  requiredScripts: z.array(z.string()),
  requiredSkills: z.object({
    external: z.array(z.string()),
    bundled: z.array(z.string()),
  }),
});
export type AgentRequirements = z.infer<typeof AgentRequirementsSchema>;

export const WorkflowPackSchema = z.object({
  id: WorkflowIdSchema,
  label: z.string(),
  description: z.string(),
  exclusiveAgents: z.array(z.string()).min(1),
  extraDependencies: z.array(z.string()).default([]),
});
export type WorkflowPack = z.infer<typeof WorkflowPackSchema>;

export const WebToolsExtraSchema = z.object({
  id: z.literal("web-tools"),
  label: z.string(),
  description: z.string(),
  defaultOn: z.boolean(),
  credentialEnvVars: z.array(z.string()),
  files: z.array(z.string()),
  globs: z.array(z.string()),
});
export type WebToolsExtra = z.infer<typeof WebToolsExtraSchema>;

/** Schema-only artifact for now -- resolve.ts derives closures from the
 * constants above and live agent-frontmatter reads, not from a JSON file.
 * Exists so a future config/fleet-manifest.v2.json can be authored and
 * validated against a real schema. See Task 42A.12 "known gaps". */
export const FleetManifestSchema = z.object({
  schemaVersion: z.literal(2),
  coreInfra: z.object({
    agents: z.array(z.string()).min(1),
    files: z.array(z.string()),
    globs: z.array(z.string()),
  }),
  workflows: z.record(WorkflowIdSchema, WorkflowPackSchema),
  webTools: WebToolsExtraSchema,
  agentRequirements: z.array(AgentRequirementsSchema).optional(),
});
export type FleetManifest = z.infer<typeof FleetManifestSchema>;

export const RECEIPT_SCHEMA_VERSION = 2 as const;

export const InstallReceiptV2Schema = z.object({
  version: z.literal(RECEIPT_SCHEMA_VERSION),
  installedAt: z.string().min(1),
  targetDir: z.string().min(1),
  scope: ScopeSchema,
  selectedWorkflows: z.array(WorkflowIdSchema),
  selectedAgents: z.array(z.string()),
  installedFilesByComponent: z.record(z.string(), z.array(z.string())),
  backup: z.object({
    root: z.string().nullable(),
    created: z.boolean(),
  }),
  requiredSkills: z.object({
    external: z.array(z.string()),
    bundled: z.array(z.string()),
  }),
  /** Opt-in "extras" the user explicitly selected in the wizard's extras
   * step (E4) -- repo-bundled skills NOT required by any selected agent
   * (e.g. the relocated finance/security skills). Distinct from
   * requiredSkills.bundled, which is auto-resolved from agent frontmatter,
   * never user-chosen. `.default([])` keeps pre-E4 receipts valid on read. */
  selectedExtraSkills: z.array(z.string()).default([]),
});
export type InstallReceiptV2 = z.infer<typeof InstallReceiptV2Schema>;
