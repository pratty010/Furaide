import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_DIR, IDISU_DB, STATE_DIR, STATE_MANIFEST } from "../paths.js";
import { openDb } from "../store/db.js";
import {
  type CatalogSnapshot,
  CatalogSnapshotSchema,
} from "../types/catalog.js";
import {
  type StateManifest,
  StateManifestSchema,
} from "../types/projections.js";

export interface OrientResult {
  manifest: StateManifest | null;
  catalogSnapshot: CatalogSnapshot | null;
  profileExists: boolean;
  backlogCount: number;
  findingsCount: number;
  // idisu.db handle — the write target for Gather onward, threaded through the
  // rest of the dream context in place of the old JSONL event-log.
  db: Database;
}

export function orient(dbPath: string = IDISU_DB): OrientResult {
  let manifest: StateManifest | null = null;
  if (existsSync(STATE_MANIFEST)) {
    try {
      manifest = StateManifestSchema.parse(
        JSON.parse(readFileSync(STATE_MANIFEST, "utf8")),
      );
    } catch {
      console.warn(
        "[idisu/orient] invalid manifest — will rebuild from scratch",
      );
    }
  }

  let catalogSnapshot: CatalogSnapshot | null = null;
  if (existsSync(CATALOG_DIR)) {
    const files = readdirSync(CATALOG_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    if (files[0]) {
      try {
        catalogSnapshot = CatalogSnapshotSchema.parse(
          JSON.parse(readFileSync(join(CATALOG_DIR, files[0]), "utf8")),
        );
      } catch {
        console.warn("[idisu/orient] invalid catalog snapshot");
      }
    }
  }

  const profilePath = join(STATE_DIR, "profile.md");
  const backlogPath = join(STATE_DIR, "backlog.jsonl");
  const findingsPath = join(STATE_DIR, "findings.jsonl");

  const countLines = (path: string) => {
    if (!existsSync(path)) return 0;
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim()).length;
  };

  const db = openDb(dbPath);

  return {
    manifest,
    catalogSnapshot,
    profileExists: existsSync(profilePath),
    backlogCount: countLines(backlogPath),
    findingsCount: countLines(findingsPath),
    db,
  };
}
