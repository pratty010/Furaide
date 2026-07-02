import { mkdirSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

export function tightenPermissions(path: string, mode: number): void {
  let stats: import("node:fs").Stats | undefined;
  try {
    stats = statSync(path);
  } catch (e: any) {
    if (e && (e.code === "ENOENT" || e.code === "EPERM" || e.code === "ENOTSUP")) return;
    console.error(`[web-tools] tightenPermissions: statSync unexpected error on ${path}: ${e?.message ?? e}`);
    return;
  }
  if (!stats.isFile() && !stats.isDirectory()) return;
  try {
    chmodSync(path, mode);
  } catch (e: any) {
    if (e && (e.code === "EPERM" || e.code === "ENOTSUP")) return;
    console.error(`[web-tools] tightenPermissions: chmodSync unexpected error on ${path}: ${e?.message ?? e}`);
  }
}

export function resolveDataDir(): string {
  try {
    const home = homedir();
    if (home && home.length > 0) {
      return join(home, ".local", "share", "opencode", "web-tools");
    }
  } catch (e: any) {
    console.error(`[web-tools] homedir() unavailable: ${e?.message ?? e}`);
  }
  return join(tmpdir(), "opencode-web-tools");
}
