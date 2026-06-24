import type { WebConfig } from "../config/schema.ts";

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  readonly providerName: string;
}

export function createEmbedder(cfg: WebConfig): Embedder {
  switch (cfg.semanticCache.provider) {
    case "google":
      return googleEmbedder(cfg);
    case "ollama":
      return ollamaEmbedder(cfg);
    case "openai-compat":
      return openaiCompatEmbedder(cfg);
    case "local":
      return localEmbedder(cfg);
  }
}

function googleEmbedder(cfg: WebConfig): Embedder {
  return {
    providerName: "google",
    async embed(text) {
      const envName = cfg.semanticCache.google.apiKeyEnv;
      const key = cfg.secrets[envName];
      if (!key) throw new Error(`no ${envName}`);

      const model = cfg.semanticCache.google.model;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text }] } }),
        },
      );

      if (!res.ok) throw new Error(`Gemini embed ${res.status}`);
      const j = (await res.json()) as { embedding: { values: number[] } };
      return new Float32Array(j.embedding.values);
    },
  };
}

function ollamaEmbedder(cfg: WebConfig): Embedder {
  return {
    providerName: "ollama",
    async embed(text) {
      const { baseUrl, model } = cfg.semanticCache.ollama;
      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!res.ok) throw new Error(`Ollama embed ${res.status}`);
      const j = (await res.json()) as { embedding: number[] };
      return new Float32Array(j.embedding);
    },
  };
}

function openaiCompatEmbedder(cfg: WebConfig): Embedder {
  return {
    providerName: "openai-compat",
    async embed(text) {
      const { baseUrl, model, apiKeyEnv } = cfg.semanticCache.openaiCompat;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const key = apiKeyEnv ? cfg.secrets[apiKeyEnv] : undefined;
      if (key) headers.authorization = `Bearer ${key}`;

      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: text }),
      });

      if (!res.ok) throw new Error(`openai-compat embed ${res.status}`);
      const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return new Float32Array(j.data[0]!.embedding);
    },
  };
}

let _localPipe: any = null;
async function getLocalPipe(model: string): Promise<any> {
  if (_localPipe) return _localPipe;
  const { pipeline, env } = await import("@xenova/transformers");
  env.allowLocalModels = true;
  _localPipe = await pipeline("feature-extraction", model);
  return _localPipe;
}

function localEmbedder(cfg: WebConfig): Embedder {
  return {
    providerName: "local",
    async embed(text) {
      const pipe = await getLocalPipe(cfg.semanticCache.local.model);
      const output = await pipe(text, { pooling: "mean", normalize: true });
      return new Float32Array(output.data);
    },
  };
}
