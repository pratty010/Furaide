import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, delimiter, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execPath } from "node:process";

const FLEET_ROOT = join(import.meta.dir, "../..");
const INSTALLER = join(FLEET_ROOT, "scripts/install-web-tools.sh");

test("fleet-manifest ships web-tools component with required files", () => {
  const manifest = JSON.parse(readFileSync(join(FLEET_ROOT, "fleet-manifest.json"), "utf8"));
  const component = manifest.components.find((item) => item.id === "web-tools");

  expect(component).toBeTruthy();
  expect(component.atomic).toBe(true);
  expect(component.requires_bun).toBe(true);
  expect(component.default_on).toBe(true);
  expect(component.files).toContain("plugins/web-tools.ts");
  expect(component.files).toContain("config/package.web-tools.json");
  expect(component.globs).toContain("plugins/web-tools/**");
});

function stubbedEnv(binDir) {
  const bunDir = dirname(execPath);
  const path = [binDir, bunDir, "/usr/bin", "/bin"].join(delimiter);
  return { ...process.env, PATH: path };
}

test("install-web-tools.sh succeeds with no bx/tvly stubs (CLI trust chain removed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-install-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    // Note: bx/tvly are intentionally NOT created here. The installer must
    // not require them, because the web-tools plugin now uses direct HTTPS
    // calls to the Brave and Tavily REST APIs.

    const out = execFileSync("bash", [INSTALLER, dir], {
      encoding: "utf8",
      stdio: "pipe",
      env: stubbedEnv(binDir),
    });
    expect(out).toContain("complete");
    expect(readFileSync(join(dir, "web-tools.yml"), "utf8")).toContain("webSearch:");
    expect(readFileSync(join(dir, "docs/models/gemini-tool-fees.yml"), "utf8")).toContain("google_search");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install-web-tools.sh warns about missing API keys but does not fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-install-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });

    const envNoKeys = { ...stubbedEnv(binDir) };
    delete envNoKeys.BRAVE_API_KEY;
    delete envNoKeys.TAVILY_API_KEY;
    delete envNoKeys.GEMINI_API_KEY;

    const out = execFileSync("bash", [INSTALLER, dir], {
      encoding: "utf8",
      stdio: "pipe",
      env: envNoKeys,
    });
    expect(out).toContain("BRAVE_API_KEY");
    expect(out).toContain("TAVILY_API_KEY");
    expect(out).toContain("GEMINI_API_KEY");
    expect(out).toContain("complete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("install-web-tools.sh fails when bun install fails", () => {
  // Adversarial-review blocker regression guard: the previous installer masked
  // `bun install` failures with `|| _warn ...`, hiding broken installs as success.
  // The fix must propagate the failure (exit non-zero).
  const dir = mkdtempSync(join(tmpdir(), "wt-install-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    // Stub bun: report a version on `bun --version`, fail on `bun install`.
    writeFileSync(
      join(binDir, "bun"),
      "#!/usr/bin/env bash\nif [[ \"$1\" == \"--version\" ]]; then echo '1.1.0'; exit 0; fi\necho 'stub bun: simulated install failure' >&2\nexit 1\n",
      { mode: 0o755 },
    );

    let status = 0;
    let stderr = "";
    try {
      execFileSync("bash", [INSTALLER, dir], {
        encoding: "utf8",
        stdio: "pipe",
        env: stubbedEnv(binDir),
      });
    } catch (e) {
      status = typeof e.status === "number" ? e.status : 1;
      stderr = (e.stderr || "") + (e.stdout || "");
    }
    expect(status, `installer should exit non-zero when bun install fails; stderr=\n${stderr}`).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
