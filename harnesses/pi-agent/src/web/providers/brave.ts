import { run, binaryExists } from "../runtime/runner.ts";
import type { WebResult, VideoResult } from "../types.ts";
import type { WebConfig, FreshnessFilter } from "../config/schema.ts";

export interface BraveOpts {
  count?: number;
  freshness?: FreshnessFilter;
  includeSites?: string[];
  excludeSites?: string[];
  topic?: string;
}

export function braveAvailable(): boolean { return binaryExists("bx"); }

function timeoutMs(cfg: WebConfig): number {
  return cfg.providers.brave.timeoutSec * 1000;
}

function braveArgs(sub: string, query: string, opts: BraveOpts, cfg: WebConfig): string[] {
  const args = [sub, query, "--count", String(opts.count ?? cfg.webSearch.count)];
  args.push("--result-filter", cfg.providers.brave.resultFilter);
  if (opts.freshness) args.push("--freshness", opts.freshness);
  for (const s of opts.includeSites ?? []) args.push("--include-site", s);
  for (const s of opts.excludeSites ?? []) args.push("--exclude-site", s);
  return args;
}

export function braveSearch(query: string, opts: BraveOpts, cfg: WebConfig): WebResult[] {
  const sub = opts.topic === "news" ? "news" : "web";
  const result = run("bx", braveArgs(sub, query, opts, cfg), timeoutMs(cfg));
  if (!result.ok) throw new Error(`bx ${sub}: ${result.errorMsg}`);
  const data = result.data as any;
  const raw: any[] = data?.web?.results ?? data?.news?.results ?? data?.results ?? [];
  return raw.slice(0, 20).map(r => ({
    title:     r.title ?? "",
    url:       r.url ?? "",
    snippet:   (r.description ?? r.snippet ?? "").slice(0, 500),
    published: r.age ?? r.page_age,
    provider:  "brave" as const,
  }));
}

export function braveVideos(query: string, opts: { count?: number; freshness?: FreshnessFilter }, cfg: WebConfig): VideoResult[] {
  const args = ["videos", query, "--count", String(opts.count ?? 20)];
  if (opts.freshness) args.push("--freshness", opts.freshness);
  const result = run("bx", args, timeoutMs(cfg));
  if (!result.ok) throw new Error(`bx videos: ${result.errorMsg}`);
  const data = result.data as any;
  const raw: any[] = data?.results ?? [];
  return raw.slice(0, 20).map(r => ({
    title:     r.title ?? "",
    url:       r.url ?? "",
    duration:  r.video?.duration,
    thumbnail: r.thumbnail?.src,
    provider:  "brave" as const,
  }));
}
