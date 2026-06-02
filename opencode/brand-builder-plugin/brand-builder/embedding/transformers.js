"use strict";

const id = "transformers";
const dimension = 384; // all-MiniLM-L6-v2

let pipeline = null; // lazy-init, downloaded once to Hugging Face cache

async function embed(texts) {
  if (!pipeline) {
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    pipeline = await createPipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { revision: "main" }
    );
  }
  const results = [];
  for (const text of texts) {
    const output = await pipeline(text, { pooling: "mean", normalize: true });
    // output.data is a Float32Array of length 384
    results.push(Array.from(output.data));
  }
  return results;
}

module.exports = { id, dimension, embed };
