import type { WebResult, FetchResult } from "../types.ts";
import type { WebConfig } from "../config/schema.ts";

export async function exaSearch(query: string, opts: {
  count?: number;
  freshness?: string;
  includeSites?: string[];
  excludeSites?: string[];
}, cfg: WebConfig): Promise<WebResult[]> {
  const key = exaApiKey(cfg);
  const body: any = { query, numResults: opts.count ?? 20, type: "auto", contents: { text: { maxCharacters: 500 } } };
  const startPublishedDate = mapFreshnessToStartPublishedDate(opts.freshness);
  if (startPublishedDate) body.startPublishedDate = startPublishedDate;
  if (opts.includeSites && opts.includeSites.length > 0) body.includeDomains = opts.includeSites;
  if (opts.excludeSites && opts.excludeSites.length > 0) body.excludeDomains = opts.excludeSites;

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Exa search ${res.status}`);
  const json = await res.json() as any;
  return (json.results ?? []).slice(0, 20).map((r: any) => ({
    title: r.title ?? "", url: r.url ?? "",
    snippet: (r.text ?? r.snippet ?? "").slice(0, 500),
    published: r.publishedDate, score: r.score,
    provider: "exa" as const,
  }));
}

export async function exaFetch(urls: string[], cfg: WebConfig): Promise<FetchResult[]> {
  const key = exaApiKey(cfg);
  const res = await fetch("https://api.exa.ai/contents", {
    method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ urls, contents: { text: { maxCharacters: cfg.fetchContent.maxChars } } }),
  });
  if (!res.ok) throw new Error(`Exa contents ${res.status}`);
  const json = await res.json() as any;
  return (json.results ?? []).map((r: any) => ({
    url: r.url ?? "", title: r.title,
    content: (r.text ?? "").slice(0, cfg.fetchContent.maxChars),
    provider: "exa" as const,
  }));
}

function exaApiKey(cfg: WebConfig): string {
  const env = cfg.providers.exa.apiKeyEnv;
  const key = cfg.secrets[env];
  if (!key) throw new Error(`no ${env}`);
  return key;
}

function mapFreshnessToStartPublishedDate(freshness?: string): string | undefined {
  if (!freshness) return undefined;

  const d = new Date();
  switch (freshness) {
    case "pd":
      d.setDate(d.getDate() - 1);
      break;
    case "pw":
      d.setDate(d.getDate() - 7);
      break;
    case "pm":
      d.setMonth(d.getMonth() - 1);
      break;
    case "py":
      d.setFullYear(d.getFullYear() - 1);
      break;
    default:
      return undefined;
  }

  return d.toISOString();
}
