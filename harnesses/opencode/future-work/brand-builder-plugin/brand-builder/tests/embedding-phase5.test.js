/**
 * Phase 5: Semantic Retrieval Tests
 *
 * Covers:
 *   - EmbeddingProvider interface + adapters (unit, no network)
 *   - embedding_config schema and helpers
 *   - sqlite-vec KNN integration (in-memory DB)
 *   - transformers adapter functional tests (real local model, potentially slow)
 */

const { describe, it, expect, beforeAll } = require("bun:test");
const { Database } = require("bun:sqlite");
const sqliteVec = require("sqlite-vec");
const {
  createTables,
  getEmbeddingConfig,
  setEmbeddingConfig,
} = require("../memory/schema.js");
const { createTestDb } = require("./helpers.js");

// ---------------------------------------------------------------------------
// Unit tests: EmbeddingProvider interface
// ---------------------------------------------------------------------------

describe("EmbeddingProvider interface", () => {
  it("getProvider('transformers') returns object with id, dimension, embed", () => {
    const { getProvider } = require("../embedding/index.js");
    const p = getProvider("transformers");
    expect(p.id).toBe("transformers");
    expect(typeof p.dimension).toBe("number");
    expect(p.dimension).toBeGreaterThan(0);
    expect(typeof p.embed).toBe("function");
  });

  it("getProvider('ollama') returns correct shape", () => {
    const { getProvider } = require("../embedding/index.js");
    const p = getProvider("ollama");
    expect(p.id).toBe("ollama");
    expect(typeof p.dimension).toBe("number");
    expect(typeof p.embed).toBe("function");
  });

  it("getProvider('gemini') returns correct shape", () => {
    const { getProvider } = require("../embedding/index.js");
    const p = getProvider("gemini");
    expect(p.id).toBe("gemini");
    expect(typeof p.dimension).toBe("number");
    expect(typeof p.embed).toBe("function");
  });

  it("getProvider('unknown') throws with helpful message", () => {
    const { getProvider } = require("../embedding/index.js");
    expect(() => getProvider("unknown")).toThrow(/Unknown embedding provider: unknown/);
    expect(() => getProvider("unknown")).toThrow(/Available:/);
  });

  it("PROVIDERS exports all three adapters", () => {
    const { PROVIDERS } = require("../embedding/index.js");
    expect(Object.keys(PROVIDERS)).toContain("transformers");
    expect(Object.keys(PROVIDERS)).toContain("ollama");
    expect(Object.keys(PROVIDERS)).toContain("gemini");
  });
});

// ---------------------------------------------------------------------------
// Schema tests: embedding_config table
// ---------------------------------------------------------------------------

describe("embedding_config schema", () => {
  it("embedding_config table exists after createTables", () => {
    const { db, close } = createTestDb();
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_config'").get();
      expect(row).not.toBeNull();
      expect(row.name).toBe("embedding_config");
    } finally {
      close();
    }
  });

  it("singleton row exists with correct defaults after createTables", () => {
    const { db, close } = createTestDb();
    try {
      const row = getEmbeddingConfig(db);
      expect(row).not.toBeNull();
      expect(row.id).toBe(1);
      expect(row.provider).toBe("transformers");
      expect(row.model).toBe("Xenova/all-MiniLM-L6-v2");
      expect(row.dimension).toBe(384);
      expect(row.evidence_count).toBe(0);
    } finally {
      close();
    }
  });

  it("singleton constraint: inserting a second row is silently ignored (OR IGNORE)", () => {
    const { db, close } = createTestDb();
    try {
      // This should not throw because the constraint uses INSERT OR IGNORE
      expect(() => {
        db.prepare("INSERT OR IGNORE INTO embedding_config (id, provider, model, dimension) VALUES (1, 'ollama', 'test', 768)").run();
      }).not.toThrow();
      // Original row should be unchanged
      const row = getEmbeddingConfig(db);
      expect(row.provider).toBe("transformers");
    } finally {
      close();
    }
  });

  it("inserting a row with id != 1 should fail due to CHECK constraint", () => {
    const { db, close } = createTestDb();
    try {
      expect(() => {
        db.prepare("INSERT INTO embedding_config (id, provider, model, dimension) VALUES (2, 'ollama', 'test', 768)").run();
      }).toThrow();
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers: getEmbeddingConfig / setEmbeddingConfig
// ---------------------------------------------------------------------------

describe("embedding_config helpers", () => {
  it("getEmbeddingConfig returns the singleton row", () => {
    const { db, close } = createTestDb();
    try {
      const config = getEmbeddingConfig(db);
      expect(config).not.toBeNull();
      expect(config.id).toBe(1);
    } finally {
      close();
    }
  });

  it("setEmbeddingConfig updates provider and model", () => {
    const { db, close } = createTestDb();
    try {
      setEmbeddingConfig(db, { provider: "ollama", model: "nomic-embed-text", dimension: 768 });
      const config = getEmbeddingConfig(db);
      expect(config.provider).toBe("ollama");
      expect(config.model).toBe("nomic-embed-text");
      expect(config.dimension).toBe(768);
    } finally {
      close();
    }
  });

  it("setEmbeddingConfig updates evidence_count and last_embed_at", () => {
    const { db, close } = createTestDb();
    try {
      const now = new Date().toISOString();
      setEmbeddingConfig(db, { evidence_count: 42, last_embed_at: now });
      const config = getEmbeddingConfig(db);
      expect(config.evidence_count).toBe(42);
      expect(config.last_embed_at).toBe(now);
    } finally {
      close();
    }
  });

  it("setEmbeddingConfig with no args is a no-op", () => {
    const { db, close } = createTestDb();
    try {
      const before = getEmbeddingConfig(db);
      setEmbeddingConfig(db, {});
      const after = getEmbeddingConfig(db);
      expect(after.provider).toBe(before.provider);
      expect(after.dimension).toBe(before.dimension);
    } finally {
      close();
    }
  });
});

// ---------------------------------------------------------------------------
// sqlite-vec KNN integration (in-memory DB, no network)
// ---------------------------------------------------------------------------

describe("sqlite-vec KNN integration", () => {
  it("inserts a vector and queries it back with vec_distance_cosine", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE test_vecs USING vec0(embedding float[4])");
    const vec = new Float32Array([1, 0, 0, 0]);
    db.prepare("INSERT INTO test_vecs(rowid, embedding) VALUES (1, ?)").run(vec);
    const row = db.prepare("SELECT rowid, vec_distance_cosine(embedding, ?) AS dist FROM test_vecs LIMIT 1").get(vec);
    expect(row).not.toBeNull();
    expect(row.rowid).toBe(1);
    expect(row.dist).toBeCloseTo(0, 10); // same vector → distance ≈ 0
    db.close();
  });

  it("KNN returns closest vector when multiple are present", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE test_vecs USING vec0(embedding float[4])");
    const vecA = new Float32Array([1, 0, 0, 0]);
    const vecB = new Float32Array([0, 1, 0, 0]);
    const vecC = new Float32Array([0, 0, 1, 0]);
    db.prepare("INSERT INTO test_vecs(rowid, embedding) VALUES (1, ?)").run(vecA);
    db.prepare("INSERT INTO test_vecs(rowid, embedding) VALUES (2, ?)").run(vecB);
    db.prepare("INSERT INTO test_vecs(rowid, embedding) VALUES (3, ?)").run(vecC);
    // Query with vecA — should return rowid 1 as closest
    const rows = db.prepare("SELECT rowid, vec_distance_cosine(embedding, ?) AS dist FROM test_vecs ORDER BY dist LIMIT 1").all(vecA);
    expect(rows[0].rowid).toBe(1);
    expect(rows[0].dist).toBeCloseTo(0, 10);
    db.close();
  });

  it("JOIN between vec table and evidence_summaries works end-to-end", () => {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    createTables(db);
    // Insert a fake artifact chain so FK constraints are satisfied
    const now = "2026-06-01T00:00:00.000Z";
    db.prepare(
      "INSERT INTO artifacts (artifact_id, artifact_type, canonical_path, raw_digest, normalized_digest, first_ingested_at, last_updated_at) VALUES (?,?,?,?,?,?,?)"
    ).run("a1", "resume", "resume.txt", "a".repeat(64), "b".repeat(64), now, now);
    db.prepare(
      "INSERT INTO artifact_versions (version_id, artifact_id, version_number, canonical_path, raw_digest, normalized_digest, ingested_at, provenance_source) VALUES (?,?,?,?,?,?,?,?)"
    ).run("v1", "a1", 1, "resume.txt", "a".repeat(64), "b".repeat(64), now, "user_upload");
    db.prepare(
      "INSERT INTO evidence_summaries (summary_id, artifact_id, version_id, summary_type, content, created_at) VALUES (?,?,?,?,?,?)"
    ).run("e1", "a1", "v1", "field_extraction", "TypeScript engineer with 8 years experience", now);

    const rowRow = db.prepare("SELECT rowid FROM evidence_summaries WHERE summary_id = ?").get("e1");
    const vec = new Float32Array(384).fill(0.05);
    db.prepare("INSERT OR REPLACE INTO vec_evidence_embeddings(rowid, embedding) VALUES (?, ?)").run(rowRow.rowid, vec);

    const queryVec = new Float32Array(384).fill(0.05);
    const results = db.prepare(`
      SELECT e.summary_id AS id, e.content, vec_distance_cosine(v.embedding, ?) AS distance
      FROM vec_evidence_embeddings v
      JOIN evidence_summaries e ON v.rowid = e.rowid
      ORDER BY distance
      LIMIT 5
    `).all(queryVec);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe("e1");
    expect(results[0].content).toContain("TypeScript");
    expect(results[0].distance).toBeCloseTo(0, 10);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Functional tests: transformers adapter (real local model)
// These tests download the model on first run — can be slow.
// ---------------------------------------------------------------------------

describe("transformers adapter (real model)", () => {
  let transformersProvider;

  beforeAll(async () => {
    transformersProvider = require("../embedding/transformers.js");
  }, 120_000);

  it("embed(['test text']) returns a vector of length 384", async () => {
    const vectors = await transformersProvider.embed(["test text"]);
    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBe(1);
    expect(Array.isArray(vectors[0])).toBe(true);
    expect(vectors[0].length).toBe(384);
  }, 120_000);

  it("all vector values are finite numbers", async () => {
    const vectors = await transformersProvider.embed(["Hello world"]);
    for (const val of vectors[0]) {
      expect(typeof val).toBe("number");
      expect(isFinite(val)).toBe(true);
    }
  }, 60_000);

  it("same text produces same vector (deterministic)", async () => {
    const [v1] = await transformersProvider.embed(["deterministic test"]);
    const [v2] = await transformersProvider.embed(["deterministic test"]);
    expect(v1.length).toBe(v2.length);
    for (let i = 0; i < v1.length; i++) {
      expect(v1[i]).toBeCloseTo(v2[i], 6);
    }
  }, 60_000);

  it("different texts produce different vectors", async () => {
    const [vA] = await transformersProvider.embed(["software engineer"]);
    const [vB] = await transformersProvider.embed(["vegetarian recipes"]);
    // At least some dimensions must differ
    const diffCount = vA.filter((v, i) => Math.abs(v - vB[i]) > 1e-6).length;
    expect(diffCount).toBeGreaterThan(0);
  }, 60_000);

  it("embed returns 384-length vectors for multiple texts", async () => {
    const vectors = await transformersProvider.embed(["first text", "second text", "third text"]);
    expect(vectors.length).toBe(3);
    for (const v of vectors) {
      expect(v.length).toBe(384);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Adapter module shape tests (no network calls)
// ---------------------------------------------------------------------------

describe("ollama adapter module shape", () => {
  it("exports id, dimension, embed", () => {
    const ollama = require("../embedding/ollama.js");
    expect(ollama.id).toBe("ollama");
    expect(typeof ollama.dimension).toBe("number");
    expect(typeof ollama.embed).toBe("function");
  });
});

describe("gemini adapter module shape", () => {
  it("exports id, dimension, embed", () => {
    const gemini = require("../embedding/gemini.js");
    expect(gemini.id).toBe("gemini");
    expect(typeof gemini.dimension).toBe("number");
    expect(typeof gemini.embed).toBe("function");
  });

  it("embed throws if GEMINI_API_KEY is not set", async () => {
    const gemini = require("../embedding/gemini.js");
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await expect(gemini.embed(["test"])).rejects.toThrow(/GEMINI_API_KEY/);
    } finally {
      if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    }
  });
});
