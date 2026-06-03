import type { KnowledgeDB } from "../web/runtime/db.ts";
import type { WebStatusSnap } from "../web/web-activity.ts";
import type { QuotaOrchestrator } from "../web/runtime/quota-orchestrator.ts";
import type { ProviderRateLimits } from "../web/runtime/quota-probe.ts";
import type { ToolQuotaEntry } from "../runtime/tool-quota-store.ts";

let _getDB: () => KnowledgeDB | null = () => null;
let _getSnap: () => WebStatusSnap | null = () => null;
let _quotaOrch: QuotaOrchestrator | null = null;
let _sessionStartMs = 0;
let _toolQuotas: Record<string, ToolQuotaEntry> = {};

export function registerWebBridge(
  getDb: () => KnowledgeDB | null,
  getSnap: () => WebStatusSnap | null,
): void {
  _getDB = getDb;
  _getSnap = getSnap;
}

export function bridgeGetDB(): KnowledgeDB | null {
  return _getDB();
}

export function bridgeGetWebSnap(): WebStatusSnap | null {
  return _getSnap();
}

export function bridgeSetQuotaOrchestrator(o: QuotaOrchestrator | null) { _quotaOrch = o; }
export function bridgeGetQuotaOrchestrator(): QuotaOrchestrator | null { return _quotaOrch; }
export function bridgeGetQuotaSnapshots(): Record<string, ProviderRateLimits> {
  return _quotaOrch?.getAllSnapshots() ?? {};
}

export function bridgeSetSessionStartMs(ts: number): void { _sessionStartMs = ts; }
export function bridgeGetSessionStartMs(): number { return _sessionStartMs; }

export function bridgeGetToolQuotas(): Record<string, ToolQuotaEntry> { return _toolQuotas; }
export function bridgeSetToolQuotas(q: Record<string, ToolQuotaEntry>): void { _toolQuotas = q; }
