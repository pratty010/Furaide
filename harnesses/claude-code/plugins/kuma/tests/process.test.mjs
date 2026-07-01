import { test } from "node:test";
import assert from "node:assert/strict";
import { binaryAvailable, terminateProcessTree } from "../scripts/lib/process.mjs";

test("binaryAvailable reports unavailable for a nonexistent command", () => {
  const result = binaryAvailable("kuma-definitely-not-a-real-binary");
  assert.equal(result.available, false);
});

test("terminateProcessTree returns attempted:false for a non-finite pid", () => {
  const result = terminateProcessTree(Number.NaN);
  assert.deepEqual(result, { attempted: false, delivered: false, method: null });
});
