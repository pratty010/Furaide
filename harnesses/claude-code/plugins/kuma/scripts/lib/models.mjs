import { writeJsonFile, readJsonFile } from "./fs.mjs";
import { resolveStateDir } from "./state.mjs";
import path from "node:path";
import fs from "node:fs";

export const V1_PROVIDERS = ["opencode-go", "opencode", "ollama-cloud"];

const BASELLM_VENDOR_SLUG_MAP = {
  "OpenCode Go": "opencode-go",
  "OpenCode Zen": "opencode",
  "Ollama Cloud": "ollama-cloud"
};

export function mergeBackendListings({ opencodeModels = [], piModels = [] }) {
  const byKey = new Map();

  for (const entry of opencodeModels) {
    if (!V1_PROVIDERS.includes(entry.provider)) continue;
    const key = `${entry.provider}/${entry.model}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      model: entry.model,
      provider: entry.provider,
      backend: existing ? mergeBackendField(existing.backend, "opencode") : "opencode",
      capabilities: existing?.capabilities ?? null,
      context: existing?.context ?? null,
      status: "available"
    });
  }

  for (const entry of piModels) {
    if (!V1_PROVIDERS.includes(entry.provider)) continue;
    const key = `${entry.provider}/${entry.model}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      model: entry.model,
      provider: entry.provider,
      backend: existing ? mergeBackendField(existing.backend, "pi") : "pi",
      capabilities: existing?.capabilities ?? null,
      context: existing?.context ?? null,
      status: "available"
    });
  }

  return [...byKey.values()];
}

function mergeBackendField(existingBackend, newBackend) {
  if (existingBackend === newBackend) return existingBackend;
  return "both";
}

function parseTagsToken(tags, pattern) {
  if (typeof tags !== "string") return null;
  const tokens = tags.split(",").map((t) => t.trim());
  return tokens.find((t) => pattern.test(t)) ?? null;
}

export function enrichWithBaseLlm(indexEntries, baseLlmModels) {
  const bySlugAndModel = new Map();
  for (const raw of baseLlmModels) {
    const slug = BASELLM_VENDOR_SLUG_MAP[raw.vendor_name];
    if (!slug) continue;
    bySlugAndModel.set(`${slug}/${raw.model_name}`, raw);
  }

  return indexEntries.map((entry) => {
    const match = bySlugAndModel.get(`${entry.provider}/${entry.model}`);
    if (!match) return entry;
    const context = parseTagsToken(match.tags, /^\d+[KM]$/i);
    const capabilityTokens = typeof match.tags === "string"
      ? match.tags.split(",").map((t) => t.trim()).filter((t) => !/^\d+[KM]$/i.test(t))
      : [];
    return {
      ...entry,
      capabilities: capabilityTokens.length ? capabilityTokens.join(",") : entry.capabilities,
      context: context ?? entry.context
    };
  });
}

export function resolveModelIndexFile(cwd) {
  return path.join(resolveStateDir(cwd), "models.json");
}

export function saveModelIndex(cwd, entries) {
  const dir = path.dirname(resolveModelIndexFile(cwd));
  fs.mkdirSync(dir, { recursive: true });
  writeJsonFile(resolveModelIndexFile(cwd), { refreshedAt: new Date().toISOString(), entries });
}

export function loadModelIndex(cwd) {
  const filePath = resolveModelIndexFile(cwd);
  if (!fs.existsSync(filePath)) {
    return { refreshedAt: null, entries: [] };
  }
  return readJsonFile(filePath);
}
