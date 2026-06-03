import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { parseHTML } from "linkedom";
import type { FetchResult } from "../types.ts";
import type { WebConfig } from "../config/schema.ts";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export async function builtinFetch(url: string, cfg: WebConfig): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FridayBot/1.0)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const html = await res.text();
  const { document } = parseHTML(html);
  const reader = new Readability(document as any);
  const article = reader.parse();
  const markdown = article?.content
    ? td.turndown(article.content).slice(0, cfg.fetchContent.maxChars)
    : td.turndown(html).slice(0, cfg.fetchContent.maxChars);
  return {
    url, title: article?.title ?? undefined,
    content: markdown,
    provider: "builtin" as const,
  };
}
