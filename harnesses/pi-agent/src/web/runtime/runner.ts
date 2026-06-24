import { spawnSync } from "node:child_process";

export interface RunResult {
  ok: boolean;
  data: unknown;
  raw: string;
  errorMsg?: string;
  latencyMs: number;
}

export function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): RunResult {
  const start = Date.now();
  if (signal?.aborted) {
    return { ok: false, data: null, raw: "", errorMsg: "aborted", latencyMs: 0 };
  }

  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const latencyMs = Date.now() - start;

  if (result.error) {
    return { ok: false, data: null, raw: "", errorMsg: result.error.message, latencyMs };
  }
  if (result.status !== 0) {
    const msg = (result.stderr as string)?.trim() || `exit code ${result.status}`;
    return { ok: false, data: null, raw: result.stdout as string, errorMsg: msg, latencyMs };
  }

  const raw = (result.stdout as string) ?? "";
  try {
    return { ok: true, data: JSON.parse(raw), raw, latencyMs };
  } catch {
    return { ok: true, data: raw, raw, latencyMs };
  }
}

export function binaryExists(name: string): boolean {
  const r = spawnSync("which", [name], { encoding: "utf8", timeout: 2000 });
  return r.status === 0;
}
