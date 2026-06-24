import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { runChildSession, runFreshSession } from "../src/session-runner.ts";

function fakeRenderer() {
  return {
    suspended: 0,
    resumed: 0,
    requested: 0,
    suspend() { this.suspended += 1; },
    resume() { this.resumed += 1; },
    requestRender() { this.requested += 1; },
  };
}

function spawnOk(calls: any[]) {
  return ((cmd: string, args: string[], options: any) => {
    calls.push({ cmd, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0, null));
    return child as any;
  }) as any;
}

describe("session runner", () => {
  test("runChildSession continues an existing session", async () => {
    const calls: any[] = [];
    const renderer = fakeRenderer();
    const audits: any[] = [];
    const result = await runChildSession(renderer, { id: "ses_123", fork: false }, spawnOk(calls), (action, target, status) => audits.push({ action, target, status }));
    expect(calls[0]).toMatchObject({ cmd: "opencode", args: ["--session", "ses_123"] });
    expect(calls[0].options.stdio).toBe("inherit");
    expect(renderer.suspended).toBe(1);
    expect(renderer.resumed).toBe(1);
    expect(audits.map(a => a.status)).toEqual(["started", "exit 0"]);
    expect(result).toEqual({ status: "exit 0", exitCode: 0 });
  });

  test("runChildSession forks when requested", async () => {
    const calls: any[] = [];
    await runChildSession(fakeRenderer(), { id: "ses_123", fork: true }, spawnOk(calls), () => {});
    expect(calls[0].args).toEqual(["--session", "ses_123", "--fork"]);
  });

  test("runFreshSession starts opencode in a directory", async () => {
    const calls: any[] = [];
    const audits: any[] = [];
    const result = await runFreshSession(fakeRenderer(), "/repo/current", spawnOk(calls), (action, target, status) => audits.push({ action, target, status }));
    expect(calls[0]).toMatchObject({ cmd: "opencode", args: ["/repo/current"] });
    expect(calls[0].options.stdio).toBe("inherit");
    expect(audits[0]).toEqual({ action: "open_session_fresh", target: "/repo/current", status: "started" });
    expect(audits[1]).toEqual({ action: "open_session_fresh", target: "/repo/current", status: "exit 0" });
    expect(result).toEqual({ status: "exit 0", exitCode: 0 });
  });

  test("runFreshSession propagates non-zero exit code", async () => {
    const calls: any[] = [];
    const spawnNonZero = ((_cmd: string, _args: string[], _options: any) => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 7, null));
      return child as any;
    }) as any;
    const result = await runFreshSession(fakeRenderer(), "/repo/current", spawnNonZero, () => {});
    expect(result).toEqual({ status: "exit 7", exitCode: 7 });
  });

  test("runFreshSession audits spawn errors and resumes renderer", async () => {
    const renderer = fakeRenderer();
    const audits: any[] = [];
    const spawnError = (() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })));
      return child as any;
    }) as any;
    const result = await runFreshSession(renderer, "/repo/current", spawnError, (action, target, status) => audits.push({ action, target, status }));
    expect(renderer.suspended).toBe(1);
    expect(renderer.resumed).toBe(1);
    expect(audits.at(-1).status).toContain("error opencode CLI not found");
    expect(result.exitCode).toBe(1);
  });
});
