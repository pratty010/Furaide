"use strict";

// Ollama embedding via local HTTP API (/api/embed — current Ollama endpoint)
// Default model: nomic-embed-text-v2-moe:latest (768-dim)
// Nomic-family models require task-type prefixes for optimal retrieval quality:
//   taskType "search_document" — when embedding content to store
//   taskType "search_query"    — when embedding a query for KNN search
const id = "ollama";
const dimension = 768; // nomic-embed-text-v2-moe default; actual dim comes from embedding_config

async function embed(texts, {
  model = "nomic-embed-text-v2-moe:latest",
  baseUrl = "http://localhost:11434",
  taskType = "search_document",
} = {}) {
  // Prefix each text with the task type for nomic-family models
  const prefixed = taskType
    ? texts.map(t => `${taskType}: ${t}`)
    : texts;

  const res = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: prefixed }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.embeddings?.length) throw new Error("Ollama response missing 'embeddings' field");
  return json.embeddings; // number[][]
}

module.exports = { id, dimension, embed };
