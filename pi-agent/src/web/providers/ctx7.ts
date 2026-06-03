import { run, binaryExists } from "../runtime/runner.ts";
import type { CodeResult } from "../types.ts";
import type { WebConfig } from "../config/schema.ts";

export function ctx7Available(): boolean { return binaryExists("ctx7"); }

export function ctx7Search(query: string, opts: { library?: string } | string | undefined, cfg: WebConfig): CodeResult[] {
  const libHint = typeof opts === "string" ? opts : (opts?.library ?? query);
  const libResult = run("ctx7", ["library", libHint, query, "--json"], cfg.runner.timeoutMs);
  if (!libResult.ok) return [];
  const libData = libResult.data as any;
  const libId: string | undefined =
    libData?.libraries?.[0]?.id
    ?? (Array.isArray(libData?.results) ? libData.results[0]?.id : undefined)
    ?? (Array.isArray(libData) ? libData[0]?.id : undefined)
    ?? libData?.id;
  if (!libId) return [];

  const docsResult = run("ctx7", ["docs", libId, query, "--json"], cfg.runner.timeoutMs);
  if (!docsResult.ok) throw new Error(`ctx7 docs: ${docsResult.errorMsg}`);
  const docsData = docsResult.data as any;
  const sections: any[] = Array.isArray(docsData)
    ? docsData
    : docsData?.results ?? docsData?.sections ?? [docsData];
  return sections.slice(0, cfg.codeSearch.limit).map((s) => ({
    title:   s.title ?? s.heading ?? libId,
    url:     s.url ?? `https://context7.com/${libId}`,
    snippet: (s.content ?? s.text ?? "").slice(0, 1000),
    library: libId,
    provider: "ctx7" as const,
  }));
}
