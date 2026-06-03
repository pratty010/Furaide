import type { Prober } from "../quota-orchestrator.ts";
import { detectActiveProviders, getToken, getGoogleProjectId, getOpenCodeGoWorkspaceId } from "../provider-auth.ts";
import type { AuthOpts } from "../provider-auth.ts";
import { anthropicProbe } from "./anthropic.ts";
import { openaiProbe } from "./openai.ts";
import { googleProbe } from "./google.ts";
import { copilotProbe } from "./copilot.ts";
import { kimiProbe } from "./kimi.ts";
import { zaiProbe } from "./zai.ts";
import { openCodeGoProbe } from "./opencode-go.ts";
import { opencodeProbe } from "./opencode.ts";
import { googleVertexProbe } from "./google-vertex.ts";
import { vercelAiGatewayProbe } from "./vercel-ai-gateway.ts";

export interface ProberBuildOpts {
  authOpts?: AuthOpts;
  getMonthlyLimitUsd?: (provider: string) => number | null;
  getCombinedBudgetUsd?: (provider: string) => number | null;
  quotasPath?: string;
}

export function buildProbers(opts: ProberBuildOpts = {}): Record<string, Prober> {
  const auth = opts.authOpts ?? {};
  const available = detectActiveProviders(auth);
  const out: Record<string, Prober> = {};

  if (available.includes("anthropic")) {
    const token = getToken("anthropic", auth);
    out.anthropic = () => anthropicProbe({ token });
  }
  if (available.includes("openai-codex")) {
    const token = getToken("openai-codex", auth);
    out["openai-codex"] = () => openaiProbe({ token });
  }
  if (available.includes("google")) {
    const token = getToken("google", auth);
    const projectId = getGoogleProjectId(auth);
    out.google = () => googleProbe({ token, projectId });
  }
  if (available.includes("github-copilot")) {
    const token = getToken("github-copilot", auth);
    out["github-copilot"] = () => copilotProbe({ token });
  }
  if (available.includes("kimi-coding")) {
    const token = getToken("kimi-coding", auth);
    out["kimi-coding"] = () => kimiProbe({ token });
  }
  if (available.includes("zai")) {
    const token = getToken("zai", auth);
    out.zai = () => zaiProbe({ token });
  }
  if (available.includes("opencode-go")) {
    const workspaceId = getOpenCodeGoWorkspaceId(auth);
    const authCookie = getToken("opencode-go", auth);
    const limit = opts.getMonthlyLimitUsd?.("opencode-go") ?? null;
    out["opencode-go"] = () =>
      openCodeGoProbe({ workspaceId, authCookie, monthlyLimitUsd: limit, quotasPath: opts.quotasPath });
  }

  // Local passthroughs — always registered
  out.opencode = () =>
    opencodeProbe({
      quotasPath: opts.quotasPath,
      monthlyLimitUsd: opts.getMonthlyLimitUsd?.("opencode") ?? null,
    });
  out["google-vertex"] = () =>
    googleVertexProbe({
      quotasPath: opts.quotasPath,
      combinedBudgetUsd: opts.getCombinedBudgetUsd?.("google-vertex") ?? null,
    });
  out["vercel-ai-gateway"] = () => vercelAiGatewayProbe({ quotasPath: opts.quotasPath });

  return out;
}
