import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadWebConfig } from "./config/loader.ts";
import { KnowledgeDB } from "./runtime/db.ts";
import { registerWebBridge } from "../shared/web-bridge.ts";
import { getWebStatusOverride } from "./web-activity.ts";
import { createEmbedder } from "./runtime/embedder.ts";
import { SemanticCache } from "./runtime/semantic-cache.ts";
import { registerWebSearch } from "./tools/web-search.ts";
import { registerFetchContent } from "./tools/fetch-content.ts";
import { registerCodeSearch } from "./tools/code-search.ts";
import { registerVideoSearch } from "./tools/video-search.ts";

let _db: KnowledgeDB | null = null;
export function getDB(): KnowledgeDB | null {
  return _db;
}

export default function registerWebTools(pi: ExtensionAPI): void {
  const cfg = loadWebConfig();
  _db = new KnowledgeDB(cfg.paths.dbFile);
  _db.purgeExpired();
  registerWebBridge(() => _db, () => getWebStatusOverride());

  const embedder = createEmbedder(cfg);
  const semanticCache = new SemanticCache(_db, embedder, {
    enabled: cfg.semanticCache.enabled,
    hardThreshold: cfg.semanticCache.hardThreshold,
    softThreshold: cfg.semanticCache.softThreshold,
  });

  registerWebSearch(pi, { db: _db, semanticCache, cfg });
  registerFetchContent(pi, { db: _db, cfg });
  registerCodeSearch(pi, { db: _db, cfg });
  registerVideoSearch(pi, { db: _db, semanticCache, cfg });
}
