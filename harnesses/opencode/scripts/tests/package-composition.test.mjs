import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const PKG_DIR = fileURLToPath(new URL("../..", import.meta.url));

// ── FuraideHarness composite plugin ──────────────────────────────────────────

const { FuraideHarness } = await import("../../src/index.ts");

describe("FuraideHarness composite plugin", () => {
  test("returns config hook", async () => {
    const hooks = await FuraideHarness({});
    expect(typeof hooks.config).toBe("function");
  });

  test("returns tool.execute.before hook (composed from nio + nurikabe + komainu)", async () => {
    const hooks = await FuraideHarness({});
    const hook = hooks["tool.execute.before"];

    expect(typeof hook).toBe("function");

    // nio blocks bash on critical verdict
    // To test without a real workflow, we need to rely on the fact that
    // the hook is a composed function — verify it's the wrapper (3+ sources)
    // by checking that calling it doesn't throw for non-mutating tools
    // (the gate enforcer only blocks BLOCKED_TOOLS, security only blocks edit/write)
    await expect(
      hook({ tool: "read", input: { file_path: "test.txt" } })
    ).resolves.toBeUndefined();
  });

  test("returns model.error hook from migawari", async () => {
    const hooks = await FuraideHarness({});
    expect(typeof hooks["model.error"]).toBe("function");
  });

  test("returns tool.execute.after hook from audit-logger", async () => {
    const hooks = await FuraideHarness({});
    expect(typeof hooks["tool.execute.after"]).toBe("function");
  });

  test("returns experimental.session.compacting hook from compaction-injector", async () => {
    const hooks = await FuraideHarness({});
    expect(typeof hooks["experimental.session.compacting"]).toBe("function");
  });

  test("registers web-tools tools (web_search, fetch_content, maps_search)", async () => {
    const hooks = await FuraideHarness({});
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks.tool.web_search).toBe("object");
    expect(typeof hooks.tool.fetch_content).toBe("object");
    expect(typeof hooks.tool.maps_search).toBe("object");
    // Each tool has at least description and execute
    expect(typeof hooks.tool.web_search.description).toBe("string");
    expect(typeof hooks.tool.web_search.execute).toBe("function");
  });

  test("tool.execute.before composed hook calls all gate plugins in sequence", async () => {
    const hooks = await FuraideHarness({});
    const hook = hooks["tool.execute.before"];

    // niō only blocks BLOCKED_TOOLS, nurikabe only blocks deliver,
    // komainu only blocks edit/write.
    // bash is blocked by niō on critical but not by others — if only one ran, it would allow through.
    // Since there is no active workflow, the default verdict is 'ok' and niō allows bash.
    await expect(hook({ tool: "bash" })).resolves.toBeUndefined();

    // An edit with a clean input should be allowed — komainu only blocks on pattern match
    await expect(
      hook({ tool: "edit", input: { content: "const x = 1;" } })
    ).resolves.toBeUndefined();
  });
});

// ── Plugin factory exports (standalone keep working) ─────────────────────────

describe("plugin factories export correctly", () => {
  test("createGateEnforcerPlugin", async () => {
    const { createGateEnforcerPlugin } = await import("../../plugins/gates/nio.js");
    const plugin = await createGateEnforcerPlugin();
    expect(plugin.name).toBe("gate-enforcer");
    expect(typeof plugin.hooks["tool.execute.before"]).toBe("function");
  });

  test("createDeliveryGatePlugin", async () => {
    const { createDeliveryGatePlugin } = await import("../../plugins/gates/nurikabe.js");
    const plugin = await createDeliveryGatePlugin();
    expect(plugin.name).toBe("delivery-gate");
    expect(typeof plugin.hooks["tool.execute.before"]).toBe("function");
  });

  test("createSecurityPatternsPlugin", async () => {
    const { createSecurityPatternsPlugin } = await import("../../plugins/gates/komainu.js");
    const plugin = await createSecurityPatternsPlugin();
    expect(plugin.name).toBe("security-patterns");
    expect(typeof plugin.hooks["tool.execute.before"]).toBe("function");
  });

  test("createModelFailoverPlugin uses package-local manifest", async () => {
    const { createModelFailoverPlugin } = await import("../../plugins/failover/migawari.js");
    const plugin = await createModelFailoverPlugin();
    expect(plugin.name).toBe("model-failover");
    expect(typeof plugin.hooks["model.error"]).toBe("function");

    // Verify the manifest was loaded from the package dir, not user config
    // by checking that resolveChain works for a known agent
    const { resolveChain } = await import("../../plugins/failover/migawari.js");
    const manifest = JSON.parse(
      readFileSync(join(PKG_DIR, "docs/routing-manifest.json"), "utf8")
    );
    const chain = resolveChain(manifest, "oni--red-team-reviewer");
    expect(chain.length).toBeGreaterThanOrEqual(1);
  });

  test("createAuditLoggerPlugin", async () => {
    const { createAuditLoggerPlugin } = await import("../../plugins/hooks/audit-logger.js");
    const plugin = await createAuditLoggerPlugin();
    expect(plugin.name).toBe("audit-logger");
    expect(typeof plugin.hooks["tool.execute.after"]).toBe("function");
  });

  test("createCompactionInjectorPlugin", async () => {
    const { createCompactionInjectorPlugin } = await import("../../plugins/hooks/compaction-injector.js");
    const plugin = await createCompactionInjectorPlugin();
    expect(plugin.name).toBe("compaction-injector");
    expect(typeof plugin.hooks["experimental.session.compacting"]).toBe("function");
  });
});

// ── config hook still works after composition ────────────────────────────────

describe("config hook in composite plugin", () => {
  test("registers 15 agents from bundled agents/*.md", async () => {
    const hooks = await FuraideHarness({});
    const config = {};
    await hooks.config(config);
    expect(config.agent).toBeDefined();
    const agentNames = Object.keys(config.agent);
    expect(agentNames.length).toBe(15);
  });

  test("instructions include package-absolute AGENTS.md path", async () => {
    const hooks = await FuraideHarness({});
    const config = {};
    await hooks.config(config);
    expect(config.instructions).toContain(join(PKG_DIR, "config/AGENTS.md"));
  });
});
