import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FLEET_ROOT = join(import.meta.dir, "../..");

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
