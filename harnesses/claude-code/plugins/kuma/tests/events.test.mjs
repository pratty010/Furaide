import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOpencodeEvent, normalizePiEvent, parseJsonLines } from "../scripts/lib/events.mjs";

test("normalizeOpencodeEvent maps a text event to a message", () => {
  const event = normalizeOpencodeEvent({ type: "text", text: "hello" });
  assert.deepEqual(event, { type: "message", message: "hello" });
});

test("normalizePiEvent maps an assistant_message event to a message", () => {
  const event = normalizePiEvent({ event: "assistant_message", text: "hi" });
  assert.deepEqual(event, { type: "message", message: "hi" });
});

test("parseJsonLines skips malformed lines", () => {
  const lines = parseJsonLines('{"a":1}\nnot json\n{"b":2}\n');
  assert.deepEqual(lines, [{ a: 1 }, { b: 2 }]);
});
