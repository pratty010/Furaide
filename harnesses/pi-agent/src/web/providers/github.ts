import * as runner from "../runtime/runner.ts";
import type { CodeResult } from "../types.ts";
import type { WebConfig } from "../config/schema.ts";

let authStatusCached: boolean | null = null;

export function __resetGithubAuthCacheForTests(): void {
  authStatusCached = null;
}

export async function githubAvailable(): Promise<boolean> {
  if (!runner.binaryExists("gh")) return false;
  if (authStatusCached === true) return true;

  const status = runner.run("gh", ["auth", "status"], 5000);
  if (!status.ok) return false;

  authStatusCached = true;
  return true;
}

export function ghAvailable(): boolean {
  return runner.binaryExists("gh");
}

export function ghSearchCode(query: string, opts: {
  language?: string; owner?: string; repo?: string; limit?: number;
}, cfg: WebConfig): CodeResult[] {
  const args = ["search", "code", query, "--json",
    "path,repository,url,textMatches",
    "--limit", String(opts.limit ?? cfg.codeSearch.limit),
  ];
  if (opts.language) args.push("--language", opts.language);
  if (opts.owner)    args.push("--owner", opts.owner);
  if (opts.repo)     args.push("--repo", opts.repo);
  const result = runner.run("gh", args, cfg.runner.timeoutMs);
  if (!result.ok) throw new Error(`gh search code: ${result.errorMsg}`);
  const raw: any[] = Array.isArray(result.data) ? result.data : [];
  return raw.map(r => ({
    title:    `${r.repository?.fullName ?? ""}/${r.path ?? ""}`,
    url:      r.url ?? "",
    snippet:  (r.textMatches?.[0]?.fragment ?? "").slice(0, 500),
    language: opts.language,
    provider: "github" as const,
  }));
}

export function ghSearchRepos(query: string, opts: {
  language?: string; limit?: number;
}, cfg: WebConfig): CodeResult[] {
  const args = ["search", "repos", query, "--json",
    "name,fullName,url,description,stargazersCount",
    "--limit", String(opts.limit ?? 10),
    "--sort", "stars",
  ];
  if (opts.language) args.push("--language", opts.language);
  const result = runner.run("gh", args, cfg.runner.timeoutMs);
  if (!result.ok) throw new Error(`gh search repos: ${result.errorMsg}`);
  const raw: any[] = Array.isArray(result.data) ? result.data : [];
  return raw.map(r => ({
    title:   r.fullName ?? r.name ?? "",
    url:     r.url ?? "",
    snippet: (r.description ?? "").slice(0, 500),
    provider: "github" as const,
  }));
}

export async function githubSearch(query: string, opts: {
  language?: string; owner?: string; repo?: string; limit?: number;
}, cfg: WebConfig): Promise<CodeResult[]> {
  if (!(await githubAvailable())) return [];
  return ghSearchCode(query, opts, cfg);
}
