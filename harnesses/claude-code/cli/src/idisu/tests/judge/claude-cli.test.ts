import { test, expect } from "bun:test";
import {
  ClaudeCliJudgeBackend,
  parseJudgeLabel,
  type SpawnSyncLike,
} from "../../src/judge/claude-cli.js";

// Fake `spawnSync` — never shells out to a real `claude` process. Matches
// the `SpawnSyncLike` seam `ClaudeCliJudgeBackend` accepts via constructor
// injection (mirrors the existing `ClaudeCodeAdapter` pattern of
// constructor-injecting the I/O boundary for testability).
function fakeSpawnSync(
  behavior: (
    command: string,
    args: string[],
  ) => { stdout: string; status: number | null; error?: Error },
): SpawnSyncLike {
  return behavior;
}

test("parseJudgeLabel accepts each of the four exact tokens", () => {
  expect(parseJudgeLabel("success")).toBe("success");
  expect(parseJudgeLabel("failure")).toBe("failure");
  expect(parseJudgeLabel("abandoned")).toBe("abandoned");
  expect(parseJudgeLabel("unknown")).toBe("unknown");
});

test("parseJudgeLabel tolerates whitespace, case, and light markdown wrapping", () => {
  expect(parseJudgeLabel("  success\n")).toBe("success");
  expect(parseJudgeLabel("SUCCESS")).toBe("success");
  expect(parseJudgeLabel("Failure.")).toBe("failure");
  expect(parseJudgeLabel("`abandoned`")).toBe("abandoned");
  expect(parseJudgeLabel("**unknown**")).toBe("unknown");
  expect(parseJudgeLabel('"success"')).toBe("success");
});

test("parseJudgeLabel rejects prose, wrong tokens, and empty output", () => {
  expect(parseJudgeLabel("The session was a success.")).toBe("unknown");
  expect(parseJudgeLabel("success failure")).toBe("unknown");
  expect(parseJudgeLabel("maybe")).toBe("unknown");
  expect(parseJudgeLabel("")).toBe("unknown");
  expect(parseJudgeLabel(null)).toBe("unknown");
  expect(parseJudgeLabel(undefined)).toBe("unknown");
});

test("ClaudeCliJudgeBackend.label returns the parsed token on a clean exit", async () => {
  const backend = new ClaudeCliJudgeBackend(
    fakeSpawnSync(() => ({ stdout: "success\n", status: 0 })),
  );
  expect(await backend.label("was this session successful?", "haiku")).toBe(
    "success",
  );
});

test("ClaudeCliJudgeBackend.label passes command/args through to spawnSync", async () => {
  let seenCommand = "";
  let seenArgs: string[] = [];
  const backend = new ClaudeCliJudgeBackend(
    fakeSpawnSync((command, args) => {
      seenCommand = command;
      seenArgs = args;
      return { stdout: "abandoned", status: 0 };
    }),
  );
  await backend.label("prompt text", "claude-haiku-4-5");
  expect(seenCommand).toBe("claude");
  expect(seenArgs).toEqual([
    "-p",
    "prompt text",
    "--model",
    "claude-haiku-4-5",
  ]);
});

test("ClaudeCliJudgeBackend.label falls back to unknown on garbage/prose stdout", async () => {
  const backend = new ClaudeCliJudgeBackend(
    fakeSpawnSync(() => ({
      stdout: "I think this session went well overall.",
      status: 0,
    })),
  );
  expect(await backend.label("p", "m")).toBe("unknown");
});

test("ClaudeCliJudgeBackend.label falls back to unknown on non-zero exit code", async () => {
  const backend = new ClaudeCliJudgeBackend(
    fakeSpawnSync(() => ({ stdout: "success", status: 1 })),
  );
  expect(await backend.label("p", "m")).toBe("unknown");
});

test("ClaudeCliJudgeBackend.label falls back to unknown when spawnSync reports an error", async () => {
  const backend = new ClaudeCliJudgeBackend(
    fakeSpawnSync(() => ({
      stdout: "",
      status: null,
      error: new Error("ENOENT: claude binary not found"),
    })),
  );
  expect(await backend.label("p", "m")).toBe("unknown");
});

test("ClaudeCliJudgeBackend.label falls back to unknown when spawnSync throws", async () => {
  const backend = new ClaudeCliJudgeBackend(() => {
    throw new Error("boom");
  });
  expect(await backend.label("p", "m")).toBe("unknown");
});

test("ClaudeCliJudgeBackend.label falls back to unknown on empty stdout", async () => {
  const backend = new ClaudeCliJudgeBackend(
    fakeSpawnSync(() => ({ stdout: "", status: 0 })),
  );
  expect(await backend.label("p", "m")).toBe("unknown");
});
