import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CounterEntry {
  at: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Snapshot {
  provider: string;
  windows: { h5: number; d1: number; w1: number; mo1: number };
  costUsd: { h5: number; d1: number; w1: number; mo1: number };
}

export interface Counter {
  record(entry: { kind: "request"; costUsd?: number; inputTokens?: number; outputTokens?: number }): void;
  snapshot(): Snapshot;
  _injectForTest(e: CounterEntry): void;
}

const WINDOWS_MS = {
  h5: 5 * 3600_000,
  d1: 24 * 3600_000,
  w1: 7 * 24 * 3600_000,
  mo1: 30 * 24 * 3600_000,
};

interface CounterFile {
  version: 1;
  byProvider: Record<string, CounterEntry[]>;
}

function loadFile(path: string): CounterFile {
  if (!existsSync(path)) return { version: 1, byProvider: {} };
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    if (obj?.version !== 1 || typeof obj.byProvider !== "object") return { version: 1, byProvider: {} };
    return obj as CounterFile;
  } catch {
    return { version: 1, byProvider: {} };
  }
}

function saveFile(path: string, data: CounterFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export function createCounter(path: string, provider: string): Counter {
  let file = loadFile(path);
  if (!file.byProvider[provider]) file.byProvider[provider] = [];

  function trim(now: number): void {
    const cutoff = now - WINDOWS_MS.mo1;
    file.byProvider[provider] = file.byProvider[provider]!.filter((e) => e.at >= cutoff);
  }

  function record(entry: { kind: "request"; costUsd?: number; inputTokens?: number; outputTokens?: number }): void {
    const now = Date.now();
    file.byProvider[provider]!.push({ at: now, costUsd: entry.costUsd, inputTokens: entry.inputTokens, outputTokens: entry.outputTokens });
    trim(now);
    saveFile(path, file);
  }

  function _injectForTest(e: CounterEntry): void {
    file.byProvider[provider]!.push(e);
    saveFile(path, file);
  }

  function snapshot(): Snapshot {
    const now = Date.now();
    trim(now);
    const entries = file.byProvider[provider] ?? [];
    const within = (msAgo: number) => entries.filter((e) => now - e.at <= msAgo);
    const sumCost = (es: CounterEntry[]) => es.reduce((s, e) => s + (e.costUsd ?? 0), 0);
    return {
      provider,
      windows: {
        h5:  within(WINDOWS_MS.h5).length,
        d1:  within(WINDOWS_MS.d1).length,
        w1:  within(WINDOWS_MS.w1).length,
        mo1: within(WINDOWS_MS.mo1).length,
      },
      costUsd: {
        h5:  sumCost(within(WINDOWS_MS.h5)),
        d1:  sumCost(within(WINDOWS_MS.d1)),
        w1:  sumCost(within(WINDOWS_MS.w1)),
        mo1: sumCost(within(WINDOWS_MS.mo1)),
      },
    };
  }

  return { record, snapshot, _injectForTest };
}

export const DEFAULT_QUOTA_PATH = (() => {
  const home = process.env.HOME ?? "";
  return `${home}/.pi/agent/extensions/friday/state/quotas.json`;
})();
