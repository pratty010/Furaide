import { test, expect, describe, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("tightenPermissions surfaces unexpected failures", () => {
  test("silently returns on ENOENT", async () => {
    const { tightenPermissions } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const dir = mkdtempSync(join(tmpdir(), "wt-tp-"));
      const missing = join(dir, "does-not-exist");
      tightenPermissions(missing, 0o600);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test("silently returns on a real file (success path)", async () => {
    const { tightenPermissions } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const dir = mkdtempSync(join(tmpdir(), "wt-tp-"));
      const file = join(dir, "data.db");
      writeFileSync(file, "x");
      tightenPermissions(file, 0o600);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  test("surfaces unexpected statSync error via console.error", async () => {
    const { tightenPermissions } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
    const fs = await import("node:fs");
    const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
      const err = new Error(`simulated EIO on ${p}`);
      err.code = "EIO";
      throw err;
    });
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      tightenPermissions("/some/path", 0o600);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const message = String(errSpy.mock.calls[0]?.[0] ?? "");
      expect(message).toContain("[web-tools] tightenPermissions");
      expect(message).toContain("statSync unexpected error");
      expect(message).toContain("simulated EIO");
    } finally {
      statSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("surfaces unexpected chmodSync error via console.error", async () => {
    const fs = await import("node:fs");
    const realStatSync = fs.statSync;
    const statSpy = spyOn(fs, "statSync").mockImplementation((p) => realStatSync(p));
    const chmodSpy = spyOn(fs, "chmodSync").mockImplementation(() => {
      const err = new Error("simulated EIO on chmod");
      err.code = "EIO";
      throw err;
    });
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { tightenPermissions } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
      const dir = mkdtempSync(join(tmpdir(), "wt-tp-"));
      const file = join(dir, "data.db");
      writeFileSync(file, "x");
      tightenPermissions(file, 0o600);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const message = String(errSpy.mock.calls[0]?.[0] ?? "");
      expect(message).toContain("chmodSync unexpected error");
    } finally {
      statSpy.mockRestore();
      chmodSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

describe("resolveDataDir falls back when homedir is unavailable", () => {
  test("returns homedir-based path under normal conditions", async () => {
    const { resolveDataDir } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
    const path = resolveDataDir();
    expect(path.length).toBeGreaterThan(0);
    if (process.platform !== "win32") {
      expect(path).toContain(".local/share/opencode/web-tools");
    }
  });

  test("falls back to tmpdir when homedir returns empty string", async () => {
    const os = await import("node:os");
    const spy = spyOn(os, "homedir").mockImplementation(() => "");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { resolveDataDir } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
      const path = resolveDataDir();
      expect(path).toContain("opencode-web-tools");
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });

  test("falls back to tmpdir when homedir throws", async () => {
    const os = await import("node:os");
    const spy = spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("simulated homedir crash");
    });
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { resolveDataDir } = await import("../../plugins/web-tools/util/runtime-helpers.ts");
      const path = resolveDataDir();
      expect(path).toContain("opencode-web-tools");
      expect(errSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
