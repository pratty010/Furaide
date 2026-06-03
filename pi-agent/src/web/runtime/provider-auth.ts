import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type KnownProvider =
  | "anthropic"
  | "openai-codex"
  | "google"
  | "google-vertex"
  | "github-copilot"
  | "kimi-coding"
  | "zai"
  | "opencode-go"
  | "opencode"
  | "vercel-ai-gateway";

export interface AuthOpts {
  home?: string;
  env?: Record<string, string | undefined>;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function piAuth(home: string): Record<string, unknown> | null {
  return readJson(join(home, ".pi", "agent", "auth.json"));
}

function ocAuth(home: string): Record<string, unknown> | null {
  return readJson(join(home, ".local", "share", "opencode", "auth.json"));
}

function ocGoConfig(home: string): { workspaceId: string; authCookie: string } | null {
  const raw = readJson(join(home, ".config", "opencode", "opencode-quota", "opencode-go.json"));
  if (raw?.workspaceId && raw?.authCookie)
    return raw as { workspaceId: string; authCookie: string };
  return null;
}

export function detectActiveProviders(opts: AuthOpts = {}): KnownProvider[] {
  const home = opts.home ?? process.env.HOME ?? "";
  const env = opts.env ?? process.env;
  const found = new Set<KnownProvider>();

  const pi = piAuth(home);
  const oc = ocAuth(home);

  if (pi?.anthropic || pi?.["anthropic-cc"] || env.ANTHROPIC_API_KEY) found.add("anthropic");
  if (pi?.["openai-codex"] || env.OPENAI_API_KEY) found.add("openai-codex");
  if (
    pi?.["google-antigravity"] ||
    pi?.["google-gemini-cli"] ||
    env.GEMINI_API_KEY ||
    env.GOOGLE_API_KEY
  )
    found.add("google");
  if (
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_LOCATION)
  )
    found.add("google-vertex");
  if (
    oc?.["github-copilot"] ||
    oc?.copilot ||
    existsSync(join(home, ".config", "opencode", "copilot-quota-token.json"))
  )
    found.add("github-copilot");
  if (env.KIMI_API_KEY || oc?.["kimi-for-coding"]) found.add("kimi-coding");
  if (env.ZAI_API_KEY || oc?.zai) found.add("zai");
  if (
    (env.OPENCODE_GO_WORKSPACE_ID && env.OPENCODE_GO_AUTH_COOKIE) ||
    ocGoConfig(home)
  )
    found.add("opencode-go");

  // local passthrough providers — always active
  found.add("opencode");
  found.add("vercel-ai-gateway");

  return [...found];
}

export function getToken(
  provider: KnownProvider,
  opts: AuthOpts = {},
): string | null {
  const home = opts.home ?? process.env.HOME ?? "";
  const env = opts.env ?? process.env;
  const pi = piAuth(home);
  const oc = ocAuth(home);

  if (provider === "anthropic") {
    const e = (pi?.["anthropic-cc"] ?? pi?.anthropic) as
      | Record<string, unknown>
      | undefined;
    return (e?.access as string | undefined) ?? env.ANTHROPIC_API_KEY ?? null;
  }
  if (provider === "openai-codex") {
    const e = pi?.["openai-codex"] as Record<string, unknown> | undefined;
    return (e?.access as string | undefined) ?? env.OPENAI_API_KEY ?? null;
  }
  if (provider === "google") {
    const e = (pi?.["google-antigravity"] ?? pi?.["google-gemini-cli"]) as
      | Record<string, unknown>
      | undefined;
    if (e?.access) {
      try {
        return (
          (
            JSON.parse(e.access as string) as Record<string, string>
          ).token ?? (e.access as string)
        );
      } catch {
        return e.access as string;
      }
    }
    return env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? null;
  }
  if (provider === "github-copilot") {
    const e = (oc?.["github-copilot"] ?? oc?.copilot) as
      | Record<string, unknown>
      | undefined;
    const token = e?.access as string | undefined;
    if (token) return token;
    const copilotFile = join(home, ".config", "opencode", "copilot-quota-token.json");
    if (existsSync(copilotFile)) {
      const content = readFileSync(copilotFile, "utf8").trim();
      if (content) return content;
    }
    return null;
  }
  if (provider === "kimi-coding") {
    return (
      env.KIMI_API_KEY ??
      ((oc?.["kimi-for-coding"] as Record<string, unknown> | undefined)
        ?.access as string | undefined) ??
      null
    );
  }
  if (provider === "zai") {
    return (
      env.ZAI_API_KEY ??
      ((oc?.zai as Record<string, unknown> | undefined)?.access as
        | string
        | undefined) ??
      null
    );
  }
  if (provider === "opencode-go") {
    return (
      env.OPENCODE_GO_AUTH_COOKIE ?? ocGoConfig(home)?.authCookie ?? null
    );
  }
  return null;
}

export function getGoogleProjectId(opts: AuthOpts = {}): string | null {
  const home = opts.home ?? process.env.HOME ?? "";
  const env = opts.env ?? process.env;
  const pi = piAuth(home);
  const e = pi?.["google-antigravity"] as Record<string, unknown> | undefined;
  if (e?.access) {
    try {
      const parsed = JSON.parse(e.access as string) as Record<string, string>;
      if (parsed?.projectId) return parsed.projectId;
    } catch {}
  }
  return env.GOOGLE_CLOUD_PROJECT ?? null;
}

export function getOpenCodeGoWorkspaceId(
  opts: AuthOpts = {},
): string | null {
  const home = opts.home ?? process.env.HOME ?? "";
  const env = opts.env ?? process.env;
  return (
    env.OPENCODE_GO_WORKSPACE_ID ??
    ((readJson(
      join(home, ".config", "opencode", "opencode-quota", "opencode-go.json"),
    )?.workspaceId as string) ??
      null)
  );
}
