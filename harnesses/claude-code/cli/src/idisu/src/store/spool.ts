import { appendFileSync, readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// One file per UTC day. flock is provided by the shell hook on the write side;
// the TS drain reads-then-removes whole files, so a concurrent append races only
// on the *current* day file — acceptable: a missed line is re-spooled next event.
export function appendSpool(dir: string, event: unknown): void {
  mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify(event) + "\n");
}

export function drainSpool(dir: string): unknown[] {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort(); }
  catch { return []; }
  const out: unknown[] = [];
  for (const f of files) {
    const p = join(dir, f);
    for (const line of readFileSync(p, "utf8").split("\n"))
      if (line.trim()) { try { out.push(JSON.parse(line)); } catch { /* skip corrupt line */ } }
    rmSync(p, { force: true });
  }
  return out;
}
