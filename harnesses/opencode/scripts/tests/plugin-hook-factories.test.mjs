import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// scripts/tests/ -> harnesses/opencode/
const PKG_DIR = fileURLToPath(new URL("../..", import.meta.url));

// ── Plugin factory exports (standalone, imported directly from their
// bucketed plugin files — no src/index.ts / FuraideHarness composition
// involved). Extracted from package-composition.test.mjs, which also
// contained FuraideHarness/composeHooks assertions that depended on the
// now-relocated npm package (see future-work/npm-package/tests/).
//
// These are deliberately shape-checks only (typeof plugin.hooks[...] ===
// "function") rather than invocations with a mock payload. The real
// OpenCode SDK calls "tool.execute.before" with TWO positional arguments —
// (input: {tool, sessionID, callID}, output: {args}) — per
// node_modules/@opencode-ai/plugin/dist/index.d.ts. None of these
// extracted tests invoke a hook with a single-argument mock, so no
// convention correction is needed here; the actual plugin hook-signature
// fixes (komainu.js etc.) are being handled in a separate pass (H1 in the
// audit).
// ────────────────────────────────────────────────────────────────────────

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
    const { createModelFailoverPlugin, resolveChain } = await import("../../plugins/failover/migawari.js");
    const plugin = await createModelFailoverPlugin();
    expect(plugin.name).toBe("model-failover");
    // Plugin is now a passive event logger, not a model.error hook
    expect(typeof plugin.hooks.event).toBe("function");

    // Verify resolveChain utility works with the package-local manifest
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
