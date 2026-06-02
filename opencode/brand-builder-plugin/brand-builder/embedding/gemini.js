"use strict";

const id = "gemini";
// Default to 384 via Matryoshka output_dimensionality (Gemini supports it)
let dimension = 384;

async function embed(texts, { apiKey, model = "models/text-embedding-004", outputDimensionality = 384 } = {}) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY env var required for Gemini embeddings");

  const results = [];
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality,
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini embedding failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    results.push(json.embedding.values);
  }
  return results;
}

module.exports = { id, dimension, embed };
