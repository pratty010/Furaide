import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

let totalAccumulatedSessionMs = 0;
let currentSessionStartMs: number | null = null;

export type SessionMetrics = {
    userCount: number;
    assistantCount: number;
    toolCount: number;
    tokenIn: number;
    tokenOut: number;
    cacheRead: number;
    cacheWrite: number;
    totalCost: number;
};

export function collectSessionMetrics(ctx: ExtensionContext): SessionMetrics {
    const metrics: SessionMetrics = {
        userCount: 0,
        assistantCount: 0,
        toolCount: 0,
        tokenIn: 0,
        tokenOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalCost: 0
    };

    const branch = ctx.sessionManager?.getBranch?.() ?? [];

    for (const entry of branch) {
        if (!entry || typeof entry !== 'object') continue;

        if ('type' in entry && entry.type === 'message' && 'message' in entry) {
            const message = (entry as any).message;
            if (!message || typeof message !== 'object') continue;

            if (message.role === 'user') {
                metrics.userCount++;
            } else if (message.role === 'assistant') {
                metrics.assistantCount++;

                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part && typeof part === 'object' && 'type' in part && part.type === 'toolCall') {
                            metrics.toolCount++;
                        }
                    }
                }

                if (message.usage && typeof message.usage === 'object') {
                    metrics.tokenIn += message.usage.input ?? 0;
                    metrics.tokenOut += message.usage.output ?? 0;
                    metrics.cacheRead += message.usage.cacheRead ?? 0;
                    metrics.cacheWrite += message.usage.cacheWrite ?? 0;
                    if (message.usage.cost && typeof message.usage.cost === 'object') {
                        metrics.totalCost += message.usage.cost.total ?? 0;
                    }
                }
            }
        }
    }

    return metrics;
}

export function startAccumulatedSession(startMs: number = Date.now()): void {
    if (currentSessionStartMs !== null) {
        totalAccumulatedSessionMs += Math.max(0, startMs - currentSessionStartMs);
    }
    currentSessionStartMs = startMs;
}

export function stopAccumulatedSession(endMs: number = Date.now()): void {
    if (currentSessionStartMs === null) return;
    totalAccumulatedSessionMs += Math.max(0, endMs - currentSessionStartMs);
    currentSessionStartMs = null;
}

export function getTotalAccumulatedSessionMs(now: number = Date.now()): number {
    if (currentSessionStartMs === null) return totalAccumulatedSessionMs;
    return totalAccumulatedSessionMs + Math.max(0, now - currentSessionStartMs);
}

export const DEFAULT_TOTAL_MS_PATH = join(
    homedir(), ".pi", "agent", "extensions", "friday", "state", "total-ms.json",
);

export function loadPersistedTotal(path: string = DEFAULT_TOTAL_MS_PATH): number {
    if (!existsSync(path)) return 0;
    try {
        const raw = readFileSync(path, "utf8");
        const obj = JSON.parse(raw);
        return typeof obj?.totalMs === "number" && obj.totalMs >= 0 ? obj.totalMs : 0;
    } catch { return 0; }
}

export function writePersistedTotal(path: string = DEFAULT_TOTAL_MS_PATH, totalMs: number): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ totalMs }), "utf8");
}

export function seedAccumulatedTotal(totalMs: number): void {
    totalAccumulatedSessionMs = Math.max(0, totalMs);
}
