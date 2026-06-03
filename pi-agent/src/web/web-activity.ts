import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface WebStatusSnap {
  tool: string; provider?: string;
  phase: "inflight" | "done" | "error" | "cache";
  detail: string; expiresAt: number;
}

let _snap: WebStatusSnap | null = null;
let _clearTimer: ReturnType<typeof setTimeout> | null = null;

const WEB_TOOLS = new Set(["web_search", "fetch_content", "code_search", "video_search"]);

export function getWebStatusOverride(): WebStatusSnap | null {
  if (_snap && _snap.expiresAt < Date.now()) { _snap = null; }
  return _snap;
}

function set(snap: WebStatusSnap): void {
  _snap = snap;
  if (_clearTimer) clearTimeout(_clearTimer);
  if (snap.phase === "done" || snap.phase === "error" || snap.phase === "cache") {
    _clearTimer = setTimeout(() => { _snap = null; }, 4000);
  }
}

export default function registerWebActivity(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, _ctx) => { _snap = null; });

  pi.on("tool_execution_start", (event, _ctx) => {
    const ev = event as any;
    if (!WEB_TOOLS.has(ev.toolName)) return;
    set({ tool: ev.toolName, phase: "inflight", detail: "…", expiresAt: Date.now() + 60000 });
  });

  pi.on("tool_execution_end", (event, _ctx) => {
    const ev = event as any;
    if (!WEB_TOOLS.has(ev.toolName)) return;
    if (ev.error) {
      set({ tool: ev.toolName, phase: "error", detail: "all providers failed", expiresAt: Date.now() + 4000 });
      return;
    }
    const details = ev.result?.details ?? {};
    const provider: string = details.provider ?? "";
    const cached: boolean | "soft" = details.cached ?? false;
    const latencyMs: number = details.meta?.latencyMs ?? 0;
    const count: number = details.results?.length ?? 0;
    const similarity: number | undefined = details.similarity;

    if (cached === true) {
      set({ tool: ev.toolName, provider, phase: "cache",
            detail: `cache · ${similarity !== undefined ? similarity.toFixed(2) + " sim" : "hit"}`,
            expiresAt: Date.now() + 4000 });
    } else {
      set({ tool: ev.toolName, provider, phase: "done",
            detail: `${provider} · ${latencyMs}ms · ${count} results`,
            expiresAt: Date.now() + 4000 });
    }
  });
}

