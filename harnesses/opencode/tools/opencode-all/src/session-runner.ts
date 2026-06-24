import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliRenderer } from "@opentui/core";

export type ContinueRequest = { id: string; fork: boolean };
type RunnerRenderer = Pick<CliRenderer, "requestRender"> & { suspend: () => unknown; resume: () => unknown };

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    return "opencode CLI not found. Set OPENCODE_ALL_OPENCODE_BIN or install opencode.";
  }
  return error instanceof Error ? error.message : String(error);
}

function opencodeBin(): string {
  return process.env.OPENCODE_ALL_OPENCODE_BIN || "opencode";
}

function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || join(process.env.HOME || ".", ".local", "share");
  return join(base, "opencode", "tools", "opencode-all");
}

export function audit(action: string, target: string, status: string): void {
  const file = join(dataDir(), "audit.log");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), action, target, status })}\n`, { flag: "a", mode: 0o600 });
}

async function runOpencode(
  renderer: RunnerRenderer,
  action: string,
  target: string,
  args: string[],
  spawnImpl: typeof spawn,
  auditImpl: (action: string, target: string, status: string) => void,
): Promise<{ status: string; exitCode: number | null }> {
  auditImpl(action, target, "started");
  renderer.suspend();
  const child = spawnImpl(opencodeBin(), args, { stdio: "inherit" });
  const result = await new Promise<{ status: string; exitCode: number | null }>((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) resolve({ status: `signal ${signal}`, exitCode: null });
      else resolve({ status: `exit ${code ?? 0}`, exitCode: code ?? 0 });
    });
    child.on("error", (error) => resolve({ status: `error ${errorMessage(error)}`, exitCode: 1 }));
  });
  auditImpl(action, target, result.status);
  renderer.resume();
  return result;
}

export async function runChildSession(
  renderer: RunnerRenderer,
  req: ContinueRequest,
  spawnImpl: typeof spawn = spawn,
  auditImpl: (action: string, target: string, status: string) => void = audit,
): Promise<{ status: string; exitCode: number | null }> {
  return runOpencode(renderer, "open_session", req.id, ["--session", req.id, ...(req.fork ? ["--fork"] : [])], spawnImpl, auditImpl);
}

export async function runFreshSession(
  renderer: RunnerRenderer,
  directory: string,
  spawnImpl: typeof spawn = spawn,
  auditImpl: (action: string, target: string, status: string) => void = audit,
): Promise<{ status: string; exitCode: number | null }> {
  return runOpencode(renderer, "open_session_fresh", directory, [directory], spawnImpl, auditImpl);
}
