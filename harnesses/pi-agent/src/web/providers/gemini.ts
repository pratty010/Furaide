import type { WebResult, FetchResult } from "../types.ts";
import type { WebConfig } from "../config/schema.ts";

function geminiApiKey(cfg: WebConfig): string {
  const env = cfg.providers.gemini.apiKeyEnv;
  const k = cfg.secrets[env];
  if (!k) throw new Error(`no ${env}`);
  return k;
}

export async function geminiSearch(
  query: string, _opts: { count?: number }, cfg: WebConfig
): Promise<WebResult[]> {
  const key = geminiApiKey(cfg);
  const model = cfg.providers.gemini.searchModel;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini search ${res.status}: ${await res.text()}`);
  const json = await res.json() as any;
  const chunks: any[] = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const answer: string | undefined = json.candidates?.[0]?.content?.parts?.[0]?.text;
  return chunks.slice(0, 20).map((c: any) => ({
    title: c.web?.title ?? "",
    url: c.web?.uri ?? "",
    snippet: (c.web?.title ?? "").slice(0, 500),
    answer,
    provider: "gemini" as const,
  }));
}

export async function geminiUrlContext(url: string, cfg: WebConfig): Promise<FetchResult> {
  const key = geminiApiKey(cfg);
  const model = cfg.providers.gemini.urlContextModel;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: `Extract the readable content of this URL as clean markdown: ${url}` },
        ] }],
        tools: [{ url_context: {} }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini URL context ${res.status}: ${await res.text()}`);
  const json = await res.json() as any;
  const content: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { url, title: undefined, content, provider: "builtin" };
}
