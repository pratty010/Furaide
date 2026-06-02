"use strict";

/**
 * EmbeddingProvider interface.
 * Each adapter must export: { id, dimension, embed }
 *
 * embed(texts: string[]) → Promise<number[][]>
 *   Returns an array of vectors, one per input text.
 *   Each vector is a plain number[] of length `dimension`.
 */

const PROVIDERS = {
  transformers: require("./transformers.js"),
  ollama: require("./ollama.js"),
  gemini: require("./gemini.js"),
};

function getProvider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown embedding provider: ${id}. Available: ${Object.keys(PROVIDERS).join(", ")}`);
  return p;
}

module.exports = { PROVIDERS, getProvider };
