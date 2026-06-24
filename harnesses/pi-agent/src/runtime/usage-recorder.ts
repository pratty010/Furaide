import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface UsageEntry {
  at: number;
  sessionId: string;
  model: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface QuotasFile {
  version: 1;
  byProvider: Record<string, UsageEntry[]>;
}

const THIRTY_DAYS_MS = 30 * 24 * 3600_000;

function loadFile(path: string): QuotasFile {
  if (!existsSync(path)) return { version: 1, byProvider: {} };
  try {
    const obj = JSON.parse(readFileSync(path, "utf8"));
    if (obj?.version !== 1 || typeof obj.byProvider !== "object") return { version: 1, byProvider: {} };
    return obj as QuotasFile;
  } catch {
    return { version: 1, byProvider: {} };
  }
}

function saveFile(path: string, data: QuotasFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export interface Recorder {
  readonly sessionId: string;
  recordUsage(provider: string, model: string, opts?: Partial<Omit<UsageEntry, "at" | "sessionId" | "model">>): void;
  flushSync(): void;
  _injectForTest(provider: string, entry: Partial<UsageEntry> & { at: number; sessionId: string; model: string }): void;
}

export function createRecorder(path: string, sessionId: string): Recorder {
  let file = loadFile(path);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function trim(now: number): void {
    const cutoff = now - THIRTY_DAYS_MS;
    for (const provider of Object.keys(file.byProvider)) {
      file.byProvider[provider] = file.byProvider[provider]!.filter((e) => e.at >= cutoff);
      if (file.byProvider[provider]!.length === 0) {
        delete file.byProvider[provider];
      }
    }
  }

  function persist(): void {
    trim(Date.now());
    saveFile(path, file);
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persist();
    }, 10_000);
  }

  function recordUsage(
    provider: string,
    model: string,
    opts?: Partial<Omit<UsageEntry, "at" | "sessionId" | "model">>,
  ): void {
    const now = Date.now();
    if (!file.byProvider[provider]) file.byProvider[provider] = [];
    file.byProvider[provider]!.push({
      at: now,
      sessionId,
      model,
      costUsd: opts?.costUsd,
      inputTokens: opts?.inputTokens,
      outputTokens: opts?.outputTokens,
      cacheReadTokens: opts?.cacheReadTokens,
      cacheWriteTokens: opts?.cacheWriteTokens,
    });
    scheduleSave();
  }

  function flushSync(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persist();
  }

  function _injectForTest(
    provider: string,
    entry: Partial<UsageEntry> & { at: number; sessionId: string; model: string },
  ): void {
    if (!file.byProvider[provider]) file.byProvider[provider] = [];
    file.byProvider[provider]!.push({
      at: entry.at,
      sessionId: entry.sessionId,
      model: entry.model,
      costUsd: entry.costUsd,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
    });
    saveFile(path, file);
  }

  return { recordUsage, flushSync, _injectForTest, sessionId };
}

export const SESSION_ID = process.env.FRIDAY_SESSION_ID ?? randomUUID();

export const DEFAULT_QUOTA_PATH = `${process.env.HOME ?? ""}/.pi/agent/extensions/friday/state/quotas.json`;

let _defaultRecorder: Recorder | null = null;

function getDefault(): Recorder {
  if (!_defaultRecorder) {
    _defaultRecorder = createRecorder(DEFAULT_QUOTA_PATH, SESSION_ID);
  }
  return _defaultRecorder;
}

export function recordUsage(
  provider: string,
  model: string,
  opts?: Parameters<Recorder["recordUsage"]>[2],
): void {
  getDefault().recordUsage(provider, model, opts);
}

export function flushDefaultRecorder(): void {
  getDefault().flushSync();
}
