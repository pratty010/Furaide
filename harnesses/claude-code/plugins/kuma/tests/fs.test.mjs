import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { writeJsonFile, readJsonFile, isProbablyText } from "../scripts/lib/fs.mjs";
import { createTempDir } from "../scripts/lib/fs.mjs";
import path from "node:path";

test("writeJsonFile/readJsonFile round-trip", () => {
  const dir = createTempDir("kuma-fs-test-");
  const filePath = path.join(dir, "state.json");
  writeJsonFile(filePath, { hello: "world" });
  assert.deepEqual(readJsonFile(filePath), { hello: "world" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("isProbablyText detects binary content", () => {
  assert.equal(isProbablyText(Buffer.from("hello world")), true);
  assert.equal(isProbablyText(Buffer.from([0, 1, 2, 0])), false);
});
