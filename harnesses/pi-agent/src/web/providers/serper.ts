import type { WebResult } from "../types.ts";
import type { FreshnessFilter, WebConfig } from "../config/schema.ts";

export async function serperSearch(query: string, opts: {
  count?: number;
  freshness?: FreshnessFilter;
}, cfg: WebConfig): Promise<WebResult[]> {
  const env = cfg.providers.serper.apiKeyEnv;
  const key = cfg.secrets[env];
  if (!key) throw new Error(`no ${env}`);

  const body: Record<string, unknown> = {
    q: query,
    num: opts.count ?? cfg.webSearch.count,
  };
  const tbs = mapFreshnessToTbs(opts.freshness);
  if (tbs) body.tbs = tbs;

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const json = await res.json() as any;
  return (json.organic ?? []).slice(0, 20).map((r: any) => ({
    title: r.title ?? "", url: r.link ?? "",
    snippet: (r.snippet ?? "").slice(0, 500),
    published: r.date,
    provider: "serper" as const,
  }));
}

function mapFreshnessToTbs(freshness?: FreshnessFilter): string | undefined {
  switch (freshness) {
    case "pd":
      return "qdr:d";
    case "pw":
      return "qdr:w";
    case "pm":
      return "qdr:m";
    case "py":
      return "qdr:y";
    default:
      return undefined;
  }
}
