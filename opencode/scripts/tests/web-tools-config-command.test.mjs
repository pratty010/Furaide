import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const COMMAND_PATH = resolve(import.meta.dirname, "../../commands/tools-config.md");

test("command file exists at opencode/commands/tools-config.md", () => {
  expect(existsSync(COMMAND_PATH)).toBe(true);
});

test("command file is NOT at opencode/command/", () => {
  const wrongPath = resolve(import.meta.dirname, "../../command/tools-config.md");
  expect(existsSync(wrongPath)).toBe(false);
});

test("frontmatter has argument-hint", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  expect(content).toMatch(/argument-hint:/);
});

test("frontmatter does NOT pin a fleet agent", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  const frontmatter = content.split("---")[1] || "";
  expect(frontmatter).not.toMatch(/^agent:/m);
});

test("body uses named args $TOOL and $ACTION", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  expect(content).toMatch(/\$TOOL/);
  expect(content).toMatch(/\$ACTION/);
});

test("body resolves project-level path before global", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  expect(content).toMatch(/\.\/\.opencode\/web-tools\.yml/);
  expect(content).toMatch(/~\/.config\/opencode\/web-tools\.yml/);
});

test("body mentions Open Advanced", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  const body = content.split("---")[2] || "";
  expect(body).toMatch(/Open Advanced/i);
});

test("body mentions open in editor", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  const body = content.split("---")[2] || "";
  expect(body).toMatch(/open in editor/i);
});

test("body lists basic fields for at least one tool", async () => {
  const content = await readFile(COMMAND_PATH, "utf-8");
  const body = content.split("---")[2] || "";
  // Check for at least one of the basic field mentions
  const hasBasicFields =
    body.includes("defaultProvider") ||
    body.includes("primaryFallbackOrder") ||
    body.includes("freshness") ||
    body.includes("rawContent");
  expect(hasBasicFields).toBe(true);
});
