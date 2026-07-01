import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../scripts/lib/args.mjs";

test("parseArgs parses value and boolean flags", () => {
  const { options, positionals } = parseArgs(["--model", "gpt-5", "--wait", "hello"], {
    valueOptions: ["model"],
    booleanOptions: ["wait"]
  });
  assert.equal(options.model, "gpt-5");
  assert.equal(options.wait, true);
  assert.deepEqual(positionals, ["hello"]);
});
