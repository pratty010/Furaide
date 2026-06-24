"use strict";

/**
 * Brand Builder Plugin — production runtime entry point.
 *
 * Phase 1: Opens the SQLite DB once on plugin init (WAL mode, idempotent
 * createTables).
 * Phase 2: Full tool map — all BB engine tools, intake tools, review/approval
 * tools, snapshot/admin tools, and ATS scan.
 *
 * @type {import("@opencode-ai/plugin").Plugin}
 */

const { Database } = require("bun:sqlite");
const sqliteVec = require("sqlite-vec");
const { createTables } = require("../brand-builder/memory/schema.js");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

// ---------------------------------------------------------------------------
// Engine imports
// ---------------------------------------------------------------------------
const { createRepositories } = require("../brand-builder/memory/repository.js");
const {
  getArtifactContext,
  getLatestProfileState,
  getRecentSnapshots,
  getStalenessReport,
} = require("../brand-builder/memory/retrieval.js");
const { runAssessment } = require("../brand-builder/assess/assessment.js");
const {
  runRoleFitAssessment,
  slugRoleFamily,
} = require("../brand-builder/assess/role-fit.js");
const { parseJobDescription } = require("../brand-builder/role-fit/jd-parser.js");
const { runLinkedInOptimization } = require("../brand-builder/linkedin/optimizer.js");
const { evaluateGitHubProof } = require("../brand-builder/github-proof/evaluator.js");
const { runBrandStrategy } = require("../brand-builder/brand/strategy.js");
const { runGrowthPlanning } = require("../brand-builder/growth/planner.js");
const { runProgressComparison } = require("../brand-builder/progress/comparison.js");
const { createIntakeModule } = require("../brand-builder/intake/index.js");
const { createSnapshot } = require("../brand-builder/snapshots/persist.js");
const { runAtsScan } = require("../brand-builder/ats/ats-scan.js");
const {
  makeRunId,
  argsDigest,
  persistResult,
  getResult,
  logRun,
  updateReviewStatus,
  checkAllReviewed,
} = require("../brand-builder/tools/tool-helpers.js");
const {
  isProtectedPath,
  checkRouting,
  checkHardPrereqs,
  checkSoftPrereqs,
  checkApproval,
  HARD_PREREQS,
} = require("../brand-builder/hooks/hook-predicates.js");

// ---------------------------------------------------------------------------
// Phase 5: Embedding imports
// ---------------------------------------------------------------------------
const { getProvider } = require("../brand-builder/embedding/index.js");
const {
  getEmbeddingConfig,
  setEmbeddingConfig,
} = require("../brand-builder/memory/schema.js");

// ---------------------------------------------------------------------------
// Zod (always available — it's a dep of @opencode-ai/plugin)
// ---------------------------------------------------------------------------
const z = require("zod");

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

const BrandBuilderPlugin = async (input) => {
  // Resolve paths
  const pluginDir = path.join(input.directory, ".opencode");
  const dbPath = path.join(pluginDir, "brand-builder", "data", "brand-builder.db");
  const dataBasePath = path.join(pluginDir, "brand-builder", "data");

  // Ensure data/ directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // Open DB, load sqlite-vec extension, set WAL mode, bootstrap schema
  const db = new Database(dbPath);
  sqliteVec.load(db);
  db.exec("PRAGMA journal_mode=WAL;");
  createTables(db);

  console.log(`[BrandBuilder] Plugin loaded. DB: ${dbPath}`);

  // ---------------------------------------------------------------------------
  // Part A: Per-session flow-state
  // ---------------------------------------------------------------------------
  // Ephemeral — resets on plugin reload, never persisted to DB.
  const sessionState = new Map();

  function getOrCreateSession(sessionId) {
    if (!sessionState.has(sessionId)) {
      sessionState.set(sessionId, {
        activeIntent: null,
        enginesRun: new Set(),       // tool names of engines that ran this session
        artifactsPresent: new Set(), // artifact types in DB at session start
      });
    }
    return sessionState.get(sessionId);
  }

  // Create repositories (shared across all tools in this session)
  const repos = createRepositories(db);

  // Create intake module (shared across all tools in this session)
  const intake = createIntakeModule({ db, basePath: dataBasePath });

  // Session ID for run_log (stable for plugin lifetime; overridden per call from ctx)
  const pluginSessionId = `bb-plugin-${Date.now()}`;

  // -------------------------------------------------------------------------
  // Helper: timed tool execution with run_log
  // -------------------------------------------------------------------------
  function withLogging(toolName, args, ctx, fn) {
    const digest = argsDigest(args);
    const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
    const start = Date.now();
    try {
      const result = fn();
      const durationMs = Date.now() - start;
      logRun(db, {
        sessionId,
        toolName,
        argsDigest: digest,
        resultId: result && result.id ? result.id : null,
        status: "ok",
        durationMs,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      logRun(db, {
        sessionId,
        toolName,
        argsDigest: digest,
        resultId: null,
        status: "error",
        errorMessage: err.message,
        durationMs,
      });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Tool definitions
  // All execute() functions return JSON strings.
  // -------------------------------------------------------------------------

  const tools = {

    // -----------------------------------------------------------------------
    // Read/grounding tools
    // -----------------------------------------------------------------------

    bb_get_context: {
      description: "Get current artifact context from Brand Builder memory. Returns artifact summaries for the requested artifact types.",
      args: {
        artifactTypes: z.array(z.string()).optional()
          .describe("Artifact types to include. Defaults to all 6 types."),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const context = getArtifactContext({ repos, artifactTypes: args.artifactTypes });
          const summary = {};
          for (const [type, entry] of Object.entries(context)) {
            if (!entry) {
              summary[type] = null;
            } else {
              summary[type] = {
                artifactId: entry.artifact.artifact_id,
                status: entry.artifact.status,
                lastUpdated: entry.artifact.last_updated_at,
                summaryCount: entry.summaries.length,
                latestVersionId: entry.latestVersion ? entry.latestVersion.version_id : null,
              };
            }
          }
          logRun(db, { sessionId, toolName: "bb_get_context", argsDigest: digest, resultId: null, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({ ok: true, context: summary });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_get_context", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Check that the DB is accessible and artifacts have been ingested." });
        }
      },
    },

    bb_profile_state: {
      description: "Get the current Brand Builder profile state from the latest snapshot.",
      args: {},
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const state = getLatestProfileState({ repos });
          logRun(db, { sessionId, toolName: "bb_profile_state", argsDigest: digest, resultId: null, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({ ok: true, state });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_profile_state", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "No snapshots may exist yet." });
        }
      },
    },

    bb_snapshots: {
      description: "Get recent Brand Builder profile snapshots.",
      args: {
        limit: z.number().int().positive().optional()
          .describe("Maximum number of snapshots to return. Defaults to 10."),
      },
      async execute(args, ctx) {
        try {
          const snapshots = getRecentSnapshots({ repos, limit: args.limit ?? 10 });
          return JSON.stringify({ ok: true, snapshots, count: snapshots.length });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "DB read error." });
        }
      },
    },

    bb_staleness: {
      description: "Get a staleness report for Brand Builder evidence summaries.",
      args: {},
      async execute(args, ctx) {
        try {
          const report = getStalenessReport({ repos });
          return JSON.stringify({ ok: true, report, staleArtifactCount: report.length });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "DB read error." });
        }
      },
    },

    bb_evidence_search: {
      description: "Search Brand Builder evidence using KNN vector similarity.",
      args: {
        query: z.string().describe("Search query"),
        limit: z.number().int().positive().optional().describe("Max results (default 5)"),
      },
      async execute(args, ctx) {
        try {
          const config = getEmbeddingConfig(db);
          if (!config) {
            return JSON.stringify({ ok: false, error: "Embedding config not found", hint: "Run createTables first." });
          }
          const provider = getProvider(config.provider);
          const embedOpts = {};
          if (config.provider === "ollama") {
            embedOpts.model = config.model;
            embedOpts.taskType = "search_query"; // query-side prefix for nomic-family models
            if (process.env.OLLAMA_BASE_URL) embedOpts.baseUrl = process.env.OLLAMA_BASE_URL;
          }
          if (config.provider === "gemini") {
            embedOpts.model = config.model;
            embedOpts.outputDimensionality = config.dimension;
            if (process.env.GEMINI_API_KEY) embedOpts.apiKey = process.env.GEMINI_API_KEY;
          }
          const [queryVec] = await provider.embed([args.query], embedOpts);
          const limit = args.limit ?? 5;
          const rows = db.prepare(`
            SELECT e.summary_id AS id, e.content, vec_distance_cosine(v.embedding, ?) AS distance
            FROM vec_evidence_embeddings v
            JOIN evidence_summaries e ON v.rowid = e.rowid
            ORDER BY distance
            LIMIT ?
          `).all(new Float32Array(queryVec), limit);
          const results = rows.map((r) => ({ id: r.id, content: r.content, score: 1 - r.distance }));
          return JSON.stringify({ ok: true, results });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Ensure evidence has been embedded via bb_embed first." });
        }
      },
    },

    // -----------------------------------------------------------------------
    // Intake tools
    // -----------------------------------------------------------------------

    bb_intake: {
      description: "Ingest a new artifact into Brand Builder memory. Stores the artifact content and creates an initial version.",
      args: {
        artifactType: z.string()
          .describe("Artifact type: resume, linkedin, github_profile, github_repo, website, job_description"),
        content: z.string().describe("Full artifact text content"),
        sourceUrl: z.string().optional().describe("Optional source URL"),
      },
      async execute(args, ctx) {
        try {
          const result = intake.ingest({
            artifactType: args.artifactType,
            content: args.content,
            filename: `${args.artifactType}-${Date.now()}.txt`,
            provenanceSource: args.sourceUrl ? "user_upload" : "user_paste",
            updateContext: args.sourceUrl ? `Ingested from ${args.sourceUrl}` : "User pasted content",
          });
          return JSON.stringify({
            ok: true,
            artifactId: result.artifact.artifact_id,
            versionId: result.version.version_id,
            changeType: "new",
          });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check artifactType is valid and content is non-empty." });
        }
      },
    },

    bb_promote: {
      description: "Promote a pending artifact version to canonical (current) status.",
      args: {
        artifactId: z.string().describe("Artifact UUID"),
        versionId: z.string().describe("Version UUID to promote"),
      },
      async execute(args, ctx) {
        try {
          // Validate artifact exists
          const artifact = repos.artifacts.getById(args.artifactId);
          if (!artifact) {
            return JSON.stringify({ ok: false, error: `Artifact ${args.artifactId} not found`, hint: "Check the artifactId." });
          }
          // Validate version exists and belongs to this artifact
          const versions = repos.versions.listByArtifact(args.artifactId);
          const matchingVersion = versions.find((v) => v.version_id === args.versionId);
          if (!matchingVersion) {
            return JSON.stringify({ ok: false, error: `Version ${args.versionId} not found for artifact ${args.artifactId}`, hint: "Check versionId belongs to the artifact." });
          }
          // Promote the artifact to current status
          const updated = repos.artifacts.updateStatus(args.artifactId, "current");
          if (!updated) {
            return JSON.stringify({ ok: false, error: `Failed to update artifact ${args.artifactId}`, hint: "Check the artifactId." });
          }
          return JSON.stringify({ ok: true, artifactId: args.artifactId, versionId: args.versionId, status: "current" });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check the artifactId and versionId." });
        }
      },
    },

    bb_embed: {
      description: "Embed an evidence summary and write the vector to vec_evidence_embeddings.",
      args: {
        evidenceId: z.string().describe("Evidence summary UUID"),
      },
      async execute(args, ctx) {
        try {
          // 1. Fetch evidence row
          const evidence = repos.evidence.getById(args.evidenceId);
          if (!evidence) {
            return JSON.stringify({ ok: false, error: `Evidence ${args.evidenceId} not found`, hint: "Check evidenceId." });
          }
          // 2. Get active embedding config
          const config = getEmbeddingConfig(db);
          if (!config) {
            return JSON.stringify({ ok: false, error: "Embedding config not found", hint: "Run createTables first." });
          }
          // 3. Load provider and generate embedding
          const provider = getProvider(config.provider);
          const embedOpts = {};
          if (config.provider === "ollama") {
            embedOpts.model = config.model;
            embedOpts.taskType = "search_document"; // document-side prefix for nomic-family models
            if (process.env.OLLAMA_BASE_URL) embedOpts.baseUrl = process.env.OLLAMA_BASE_URL;
          }
          if (config.provider === "gemini") {
            embedOpts.model = config.model;
            embedOpts.outputDimensionality = config.dimension;
            if (process.env.GEMINI_API_KEY) embedOpts.apiKey = process.env.GEMINI_API_KEY;
          }
          const [vector] = await provider.embed([evidence.content], embedOpts);
          // 3a. Dimension guard
          if (vector.length !== config.dimension) {
            return JSON.stringify({
              ok: false,
              error: `Dimension mismatch: embedding has ${vector.length} dims but config expects ${config.dimension}`,
              hint: "Run bb_reembed with matching provider/dimension to reset the vector table",
            });
          }
          // 4. Resolve rowid for this evidence row
          const rowRow = db.prepare("SELECT rowid FROM evidence_summaries WHERE summary_id = ?").get(args.evidenceId);
          if (!rowRow) {
            return JSON.stringify({ ok: false, error: `Could not resolve rowid for ${args.evidenceId}` });
          }
          // 5. Write to vec_evidence_embeddings
          db.prepare("INSERT OR REPLACE INTO vec_evidence_embeddings(rowid, embedding) VALUES (?, ?)").run(rowRow.rowid, new Float32Array(vector));
          // 6. Update evidence_count in embedding_config
          const countRow = db.prepare("SELECT COUNT(*) AS n FROM vec_evidence_embeddings").get();
          setEmbeddingConfig(db, {
            evidence_count: countRow ? countRow.n : 0,
            last_embed_at: new Date().toISOString(),
          });
          return JSON.stringify({ ok: true, evidenceId: args.evidenceId, dimension: vector.length });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check evidenceId is valid and embedding provider is configured." });
        }
      },
    },

    // -----------------------------------------------------------------------
    // Assessment tools
    // -----------------------------------------------------------------------

    bb_assess: {
      description: "Run a deterministic current-state assessment across all four Brand Builder dimensions (signal, evidence, visibility, narrative). Persists result to engine_results.",
      args: {
        artifactTypes: z.array(z.string()).optional()
          .describe("Artifact types to include. Defaults to all 6."),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const runId = makeRunId();
          const assessmentResult = runAssessment({ repos, artifactTypes: args.artifactTypes });
          const assessProvenance = assessmentResult.dimensions
            ? JSON.stringify({
                dimensions: Object.fromEntries(
                  Object.entries(assessmentResult.dimensions).map(([k, v]) => [k, v.provenance ?? null])
                ),
              })
            : null;
          const id = persistResult(db, {
            workflow: "assess",
            runId,
            payload: assessmentResult,
            provenance: assessProvenance,
            reviewStatus: "pending",
          });
          logRun(db, { sessionId, toolName: "bb_assess", argsDigest: digest, resultId: id, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({
            ok: true,
            id,
            summary: {
              dimensions: {
                signal: assessmentResult.signal,
                evidence: assessmentResult.evidence,
                visibility: assessmentResult.visibility,
                narrative: assessmentResult.narrative,
              },
              dominantFailureMode: assessmentResult.dominantFailureMode,
              confidence: assessmentResult.confidence,
            },
            provenance: "bb_assess",
          });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_assess", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Ensure artifacts have been ingested before running assessment." });
        }
      },
    },

    bb_role_fit: {
      description: "Run a deterministic role-fit assessment against a job description. Parses the JD then scores profile evidence against it. Persists result to engine_results.",
      args: {
        roleTarget: z.string().describe("Target role title (e.g. 'Senior Frontend Engineer')"),
        jobDescriptionText: z.string().describe("Full job description text"),
        roleFamilySlug: z.string().optional().describe("Role family slug override"),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const runId = makeRunId();
          const parsedJob = parseJobDescription({
            roleTarget: args.roleTarget,
            jobDescriptionText: args.jobDescriptionText,
          });
          const slug = args.roleFamilySlug || slugRoleFamily({
            roleTitle: args.roleTarget,
            seniority: parsedJob.seniority,
            domainContext: parsedJob.domainContext,
          });
          const assessmentResult = runRoleFitAssessment({
            repos,
            parsedJob,
            roleFamilySlug: slug,
            roleTitle: args.roleTarget,
          });
          const roleFitProvenance = JSON.stringify({
            fitScore: assessmentResult.provenance ?? null,
            bucketProvenance: assessmentResult.bucketProvenance ?? null,
          });
          const id = persistResult(db, {
            workflow: "role-fit",
            runId,
            payload: { parsedJob, assessmentResult },
            provenance: roleFitProvenance,
            reviewStatus: "pending",
          });
          logRun(db, { sessionId, toolName: "bb_role_fit", argsDigest: digest, resultId: id, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({
            ok: true,
            id,
            summary: {
              fitScore: assessmentResult.fitScore,
              bracket: assessmentResult.bracket,
              blockers: assessmentResult.blockers,
              easyWins: assessmentResult.easyWins,
            },
            provenance: `Role: ${args.roleTarget}`,
          });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_role_fit", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Check roleTarget and jobDescriptionText are provided." });
        }
      },
    },

    bb_parse_jd: {
      description: "Parse a job description into a structured model. Pure parse — no DB write.",
      args: {
        roleTarget: z.string().describe("Target role title"),
        jobDescriptionText: z.string().describe("Job description text"),
        sourceType: z.string().optional().describe("Source type: text, markdown, fetched"),
      },
      async execute(args, ctx) {
        try {
          // Thin-text detection: reject if < 50 words (fetched page was a JS shell or empty)
          const wordCount = args.jobDescriptionText.split(/\s+/).filter(Boolean).length;
          if (wordCount < 50) {
            return JSON.stringify({
              ok: false,
              error: "Job description text is too thin (< 50 words)",
              hint: "Try fetching with browser-harness skill or paste the full JD text",
            });
          }
          const parsedJob = parseJobDescription({
            roleTarget: args.roleTarget,
            jobDescriptionText: args.jobDescriptionText,
            sourceType: args.sourceType,
          });
          return JSON.stringify({ ok: true, parsedJob });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check jobDescriptionText is a non-empty string." });
        }
      },
    },

    // -----------------------------------------------------------------------
    // Generative engine tools
    // -----------------------------------------------------------------------

    bb_linkedin: {
      description: "Run LinkedIn section optimization. Diagnoses current LinkedIn profile and generates section rewrite inputs. Persists result to engine_results with review_status pending.",
      args: {
        requestedSections: z.array(z.string()).optional()
          .describe("Sections to optimize: headline, about, experience, featured, skills"),
        assessmentResultId: z.string().optional()
          .describe("engine_results id from a prior bb_assess call for richer context"),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const runId = makeRunId();
          let assessmentContext = null;
          if (args.assessmentResultId) {
            const row = getResult(db, args.assessmentResultId);
            if (row) assessmentContext = JSON.parse(row.payload_json);
          }
          const result = runLinkedInOptimization({
            repos,
            requestedSections: args.requestedSections,
            assessmentContext,
            roleFitContext: null,
          });
          const linkedinProvenance = result.provenance != null
            ? JSON.stringify(result.provenance)
            : null;
          const id = persistResult(db, {
            workflow: "linkedin",
            runId,
            payload: result,
            provenance: linkedinProvenance,
            reviewStatus: "pending",
          });
          logRun(db, { sessionId, toolName: "bb_linkedin", argsDigest: digest, resultId: id, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({
            ok: true,
            id,
            summary: {
              artifactMissing: result.artifactMissing,
              sectionsGenerated: Object.keys(result.sections),
              staleRecommendation: result.staleRecommendation || null,
              nextBestAction: result.nextBestAction,
            },
            provenance: "bb_linkedin",
          });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_linkedin", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Ensure LinkedIn artifact is ingested for best results." });
        }
      },
    },

    bb_github_proof: {
      description: "Evaluate selected GitHub repos as proof artifacts. Scores portfolio value, proof quality, and engineering quality. Persists result to engine_results.",
      args: {
        selectedRepos: z.array(z.string())
          .describe("List of repo names/paths to evaluate (e.g. ['my-project', 'another-repo'])"),
        assessmentResultId: z.string().optional()
          .describe("engine_results id from a prior bb_assess call for richer context"),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const runId = makeRunId();
          let assessmentContext = null;
          if (args.assessmentResultId) {
            const row = getResult(db, args.assessmentResultId);
            if (row) assessmentContext = JSON.parse(row.payload_json);
          }
          const result = evaluateGitHubProof({
            repos,
            selectedRepos: args.selectedRepos,
            assessmentContext,
            roleFitContext: null,
          });
          const githubProvenance = result.provenance != null
            ? JSON.stringify(result.provenance)
            : null;
          const id = persistResult(db, {
            workflow: "github-proof",
            runId,
            payload: result,
            provenance: githubProvenance,
            reviewStatus: "pending",
          });
          logRun(db, { sessionId, toolName: "bb_github_proof", argsDigest: digest, resultId: id, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({
            ok: true,
            id,
            summary: {
              repoCount: result.repoResults ? result.repoResults.length : 0,
              nextBestAction: result.nextBestAction,
            },
            provenance: `Repos: ${args.selectedRepos.join(", ")}`,
          });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_github_proof", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Ensure selectedRepos is a non-empty array of repo names." });
        }
      },
    },

    bb_brand: {
      description: "Run brand strategy engine. Produces a narrative-first website/content brief. Persists result to engine_results.",
      args: {
        websiteMode: z.string().optional()
          .describe("Website mode: 'advisory' (default) or 'active'"),
        websiteGoal: z.string().optional()
          .describe("Website goal description"),
        brandDirection: z.string().optional()
          .describe("Brand direction or positioning statement"),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const runId = makeRunId();
          const result = runBrandStrategy({
            repos,
            websiteMode: args.websiteMode,
            websiteGoal: args.websiteGoal,
            brandDirection: args.brandDirection,
          });
          const brandProvenance = result.provenance != null
            ? JSON.stringify(result.provenance)
            : null;
          const id = persistResult(db, {
            workflow: "brand",
            runId,
            payload: result,
            provenance: brandProvenance,
            reviewStatus: "pending",
          });
          logRun(db, { sessionId, toolName: "bb_brand", argsDigest: digest, resultId: id, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({
            ok: true,
            id,
            summary: {
              siteRecommended: result.siteRecommended,
              recommendedNextAction: result.recommendedNextAction,
              staleRecommendation: result.staleRecommendation || null,
            },
            provenance: `mode=${args.websiteMode || "advisory"}`,
          });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_brand", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Check that repos are accessible." });
        }
      },
    },

    bb_growth: {
      description: "Run growth planning engine. Produces project/proof recommendations, certification guidance, and a timeline plan. Persists result to engine_results.",
      args: {
        roleTarget: z.string().optional()
          .describe("Target role (e.g. 'Senior Backend Engineer')"),
        timeHorizonMonths: z.number().int().positive().optional()
          .describe("Planning horizon in months (default 6)"),
      },
      async execute(args, ctx) {
        const digest = argsDigest(args);
        const sessionId = (ctx && ctx.sessionID) || pluginSessionId;
        const start = Date.now();
        try {
          const runId = makeRunId();
          const roleTarget = args.roleTarget
            ? { roleTitle: args.roleTarget, seniority: "mid", domainContext: [] }
            : { roleTitle: "Software Engineer", seniority: "mid", domainContext: [] };
          const result = runGrowthPlanning({
            repos,
            roleTarget,
            timeHorizonMonths: args.timeHorizonMonths,
          });
          const growthProvenance = result.provenance != null
            ? JSON.stringify(result.provenance)
            : null;
          const id = persistResult(db, {
            workflow: "growth",
            runId,
            payload: result,
            provenance: growthProvenance,
            reviewStatus: "pending",
          });
          logRun(db, { sessionId, toolName: "bb_growth", argsDigest: digest, resultId: id, status: "ok", durationMs: Date.now() - start });
          return JSON.stringify({
            ok: true,
            id,
            summary: {
              recurringGapCount: result.recurringGaps ? result.recurringGaps.length : 0,
              confidence: result.confidence,
              recommendedNextAction: result.recommendedNextAction,
            },
            provenance: `role=${args.roleTarget || "default"}`,
          });
        } catch (err) {
          logRun(db, { sessionId, toolName: "bb_growth", argsDigest: digest, status: "error", errorMessage: err.message, durationMs: Date.now() - start });
          return JSON.stringify({ ok: false, error: err.message, hint: "Ensure role-fit assessments have been run to generate snapshot history." });
        }
      },
    },

    bb_progress: {
      description: "Run progress comparison. Compares current snapshot against previous to show delta and trend. Display-only — no engine_results row.",
      args: {},
      async execute(args, ctx) {
        try {
          const comparison = runProgressComparison({ repos });
          return JSON.stringify({ ok: true, comparison });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "At least 2 snapshots are needed for progress comparison." });
        }
      },
    },

    // -----------------------------------------------------------------------
    // ATS tool
    // -----------------------------------------------------------------------

    bb_ats_scan: {
      description: "Run ATS keyword and format scan on the ingested resume against JD keywords.",
      args: {
        jdKeywords: z.array(z.string()).optional()
          .describe("All JD keywords to check coverage for"),
        requiredKeywords: z.array(z.string()).optional()
          .describe("Subset of keywords that are must-haves"),
      },
      async execute(args, ctx) {
        try {
          // Get the raw resume artifact record
          const resumeArtifact = repos.artifacts.getCurrentByType("resume");
          if (!resumeArtifact) {
            return JSON.stringify({ ok: false, error: "No resume artifact found", hint: "Run bb-intake with a resume first." });
          }
          // Get the latest version's file_path
          const latestVersion = repos.versions.getLatest(resumeArtifact.artifact_id);
          if (!latestVersion || !latestVersion.canonical_path) {
            return JSON.stringify({ ok: false, error: "No resume version file found", hint: "Run bb-intake with a resume first." });
          }
          // Read raw resume file content
          let resumeText = "";
          try {
            resumeText = fs.readFileSync(latestVersion.canonical_path, "utf8");
          } catch (readErr) {
            return JSON.stringify({ ok: false, error: `Failed to read resume file: ${readErr.message}`, hint: "The resume file may have been moved or deleted. Re-ingest the resume." });
          }
          const result = runAtsScan({
            resumeText,
            jdKeywords: args.jdKeywords ?? [],
            requiredKeywords: args.requiredKeywords ?? [],
          });
          return JSON.stringify({ ok: true, ...result });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Ensure resume artifact is ingested." });
        }
      },
    },

    // -----------------------------------------------------------------------
    // Review/approval tools
    // -----------------------------------------------------------------------

    bb_record_review: {
      description: "Record a review decision (pass or veto) on an engine_results row.",
      args: {
        resultId: z.string().describe("engine_results id to review"),
        verdict: z.enum(["pass", "veto"]).describe("Review verdict: pass or veto"),
        notes: z.string().optional().describe("Optional review notes"),
      },
      async execute(args, ctx) {
        try {
          const status = args.verdict === "pass" ? "passed" : "vetoed";
          const updated = updateReviewStatus(db, args.resultId, status, args.notes);
          if (!updated) {
            return JSON.stringify({ ok: false, error: `Result ${args.resultId} not found`, hint: "Check the resultId." });
          }
          return JSON.stringify({ ok: true, resultId: args.resultId, verdict: args.verdict, reviewStatus: status });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check the resultId is valid." });
        }
      },
    },

    bb_approve: {
      description: "Record an enrichment approval decision for a scope/artifact.",
      args: {
        artifactId: z.string().describe("Artifact UUID"),
        changeDigest: z.string().describe("Digest of the proposed change"),
        scope: z.string().describe("Approval scope (e.g. 'linkedin_rewrite', 'github_proof')"),
      },
      async execute(args, ctx) {
        try {
          const approvalId = randomUUID();
          const now = new Date().toISOString();
          const approval = repos.approvals.upsert({
            approval_id: approvalId,
            scope: args.scope,
            scope_key: args.artifactId,
            approved: true,
            reason_given: `Change digest: ${args.changeDigest}`,
            conditions_snapshot: null,
            stale: false,
            decided_at: now,
          });
          return JSON.stringify({ ok: true, approvalId: approval ? approval.approval_id : approvalId, scope: args.scope });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check artifactId, changeDigest, and scope are valid." });
        }
      },
    },

    bb_complete_run: {
      description: "Validate that all referenced engine_results rows have been reviewed (not pending). Returns ok:true only when all are reviewed.",
      args: {
        intent: z.string().describe("Workflow intent description"),
        resultIds: z.array(z.string()).optional()
          .describe("engine_results ids that must be reviewed before completion"),
      },
      async execute(args, ctx) {
        try {
          const ids = args.resultIds ?? [];
          if (ids.length === 0) {
            return JSON.stringify({ ok: true, intent: args.intent, completedAt: new Date().toISOString(), message: "No result IDs to validate." });
          }
          const { allReviewed, pending } = checkAllReviewed(db, ids);
          if (!allReviewed) {
            return JSON.stringify({
              ok: false,
              intent: args.intent,
              error: `${pending.length} result(s) still pending review`,
              pending,
              hint: "Use bb_record_review to pass or veto each pending result before completing.",
            });
          }
          return JSON.stringify({ ok: true, intent: args.intent, completedAt: new Date().toISOString(), reviewedCount: ids.length });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check resultIds are valid engine_results ids." });
        }
      },
    },

    // -----------------------------------------------------------------------
    // Snapshot/admin tools
    // -----------------------------------------------------------------------

    bb_snapshot: {
      description: "Create a Brand Builder profile snapshot capturing current dimension scores.",
      args: {
        dimensions: z.object({
          signal: z.number(),
          evidence: z.number(),
          visibility: z.number(),
          narrative: z.number(),
        }).describe("Dimension scores: signal, evidence, visibility, narrative (0-100 each)"),
        confidence: z.string().describe("Confidence level: high, medium, or low"),
        dominantFailureMode: z.string().optional()
          .describe("Dominant failure mode description"),
        nextRecommendedWorkflow: z.string().optional()
          .describe("Next workflow token (e.g. bb-role-fit)"),
      },
      async execute(args, ctx) {
        try {
          const context = getArtifactContext({ repos });
          const versionIds = [];
          for (const entry of Object.values(context)) {
            if (entry && entry.latestVersion) {
              versionIds.push(entry.latestVersion.version_id);
            }
          }
          if (versionIds.length === 0) {
            return JSON.stringify({ ok: false, error: "No artifact versions found", hint: "Ingest at least one artifact before creating a snapshot." });
          }
          const snapshot = createSnapshot({
            repos,
            triggerReason: "manual_request",
            profileState: JSON.stringify({
              created_by: "bb_snapshot",
              timestamp: new Date().toISOString(),
              dimensions: args.dimensions,
            }),
            dimensionSummary: args.dimensions,
            confidence: args.confidence,
            dominantFailureMode: args.dominantFailureMode,
            nextRecommendedWorkflow: args.nextRecommendedWorkflow,
            artifactVersionIds: versionIds,
          });
          return JSON.stringify({ ok: true, snapshotId: snapshot.snapshot_id });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check dimension values are 0-100 and confidence is high/medium/low." });
        }
      },
    },

    bb_reembed: {
      description: "Re-embed all evidence summaries using a new provider/dimension.",
      args: {
        provider: z.string().describe("Embedding provider: transformers, ollama, gemini"),
        dimension: z.number().int().positive().describe("Embedding dimension"),
        model: z.string().optional().describe("Model name override"),
      },
      async execute(args, ctx) {
        try {
          // 1. Validate provider
          const provider = getProvider(args.provider);

          // 2. Drop and recreate vec_evidence_embeddings at new dimension
          db.exec("DROP TABLE IF EXISTS vec_evidence_embeddings");
          db.exec(`CREATE VIRTUAL TABLE vec_evidence_embeddings USING vec0(embedding float[${args.dimension}])`);

          // 3. Re-embed all evidence_summaries rows
          const evidenceRows = db.prepare("SELECT rowid, summary_id, content FROM evidence_summaries WHERE stale = 0").all();
          let embeddedCount = 0;
          for (const row of evidenceRows) {
            try {
              const [vector] = await provider.embed([row.content]);
              db.prepare("INSERT OR REPLACE INTO vec_evidence_embeddings(rowid, embedding) VALUES (?, ?)").run(row.rowid, new Float32Array(vector));
              embeddedCount++;
            } catch (embedErr) {
              console.error(`[bb_reembed] Failed to embed ${row.summary_id}: ${embedErr.message}`);
            }
          }

          // 4. Update embedding_config
          const config = getEmbeddingConfig(db);
          const modelName = args.model || config?.model || (args.provider === "transformers" ? "Xenova/all-MiniLM-L6-v2" : args.provider);
          setEmbeddingConfig(db, {
            provider: args.provider,
            model: modelName,
            dimension: args.dimension,
            evidence_count: embeddedCount,
            last_embed_at: new Date().toISOString(),
          });

          return JSON.stringify({ ok: true, embeddedCount, provider: args.provider, dimension: args.dimension });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err.message, hint: "Check provider name is valid: transformers, ollama, gemini." });
        }
      },
    },

  }; // end tools

  // Engine tools whose completion should be tracked in session.enginesRun
  const ENGINE_TOOLS = new Set([
    "bb_assess", "bb_role_fit", "bb_parse_jd",
    "bb_linkedin", "bb_github_proof",
    "bb_brand", "bb_growth", "bb_progress",
  ]);

  // ---------------------------------------------------------------------------
  // Part C: Hook: tool.execute.before
  // ---------------------------------------------------------------------------
  async function toolExecuteBefore(input, output) {
    // input: { tool, sessionID, callID }
    // output: { args }
    const sid = input.sessionID || pluginSessionId;
    const session = getOrCreateSession(sid);

    // 1. ROUTING GUARD
    if (session.activeIntent) {
      const routingError = checkRouting(session.activeIntent, input.tool);
      if (routingError) throw new Error(`[BB routing] ${routingError}`);
    }

    // 2. HARD PREREQS
    // Only query snapshot count if the current tool has a snapshot prereq
    const needsSnapshotCount = HARD_PREREQS[input.tool]?.requiresMinSnapshots !== undefined;
    let snapshotCount = 0;
    if (needsSnapshotCount) {
      try {
        // listRecent with a large limit and take length, or fall back to a direct count
        const snaps = repos.snapshots.listRecent(9999);
        snapshotCount = Array.isArray(snaps) ? snaps.length : 0;
      } catch (_) {
        snapshotCount = 0;
      }
    }
    const prereqError = checkHardPrereqs(input.tool, session.enginesRun, output.args || {}, snapshotCount);
    if (prereqError) throw new Error(`[BB prereq] ${prereqError}`);

    // 3. SOFT PREREQS — warn only, never block
    const softWarn = checkSoftPrereqs(input.tool, session.enginesRun);
    if (softWarn) {
      console.warn(`[BB soft-prereq] ${softWarn}`);
    }

    // 4. APPROVAL GATE — block writes to artifact paths without approval token
    const toolLower = input.tool.toLowerCase();
    if (toolLower === "write" || toolLower === "edit") {
      const filePath = (output.args && (output.args.path || output.args.file_path)) || null;
      if (filePath && isProtectedPath(filePath)) {
        const changeDigest = argsDigest(output.args);
        let approvals = [];
        try {
          // Query for approvals covering this artifact path.
          // The approval scope_key holds the artifactId; here we look up by
          // scope="artifact_write" and let checkApproval validate the digest.
          approvals = repos.approvals.listByScope("artifact_write");
        } catch (_) {
          approvals = [];
        }
        const approvalError = checkApproval(approvals, filePath, changeDigest);
        if (approvalError) throw new Error(`[BB approval] ${approvalError}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Part C: Hook: tool.execute.after
  // ---------------------------------------------------------------------------
  async function toolExecuteAfter(input, output) {
    // input: { tool, sessionID, callID, args }
    // output: { title, output: string, metadata }
    const sid = input.sessionID || pluginSessionId;
    const session = getOrCreateSession(sid);

    // 1. Mark engine as run in session state
    if (ENGINE_TOOLS.has(input.tool)) {
      session.enginesRun.add(input.tool);
    }

    // 2. AUTO-EMBED: after bb_intake or bb_promote, embed newly created evidence
    //    summaries. Best-effort — errors are logged but do not fail the parent tool.
    if (input.tool === "bb_intake" || input.tool === "bb_promote") {
      try {
        // Parse the tool output to find the artifactId
        let outputData = {};
        if (output && output.output) {
          try { outputData = JSON.parse(output.output); } catch (_) {}
        }
        if (outputData.ok && outputData.artifactId) {
          // Get all non-stale evidence for this artifact that has no embedding yet
          const evidenceRows = db.prepare(
            "SELECT e.summary_id, e.rowid FROM evidence_summaries e WHERE e.artifact_id = ? AND e.stale = 0"
          ).all(outputData.artifactId);
          const config = getEmbeddingConfig(db);
          if (config && evidenceRows.length > 0) {
            const provider = getProvider(config.provider);
            const autoEmbedOpts = {};
            if (config.provider === "ollama") {
              autoEmbedOpts.model = config.model;
              autoEmbedOpts.taskType = "search_document";
              if (process.env.OLLAMA_BASE_URL) autoEmbedOpts.baseUrl = process.env.OLLAMA_BASE_URL;
            }
            if (config.provider === "gemini") {
              autoEmbedOpts.model = config.model;
              autoEmbedOpts.outputDimensionality = config.dimension;
              if (process.env.GEMINI_API_KEY) autoEmbedOpts.apiKey = process.env.GEMINI_API_KEY;
            }
            for (const row of evidenceRows) {
              try {
                const existing = db.prepare("SELECT rowid FROM vec_evidence_embeddings WHERE rowid = ?").get(row.rowid);
                if (!existing) {
                  const evidenceRow = db.prepare("SELECT content FROM evidence_summaries WHERE summary_id = ?").get(row.summary_id);
                  if (evidenceRow) {
                    const [vector] = await provider.embed([evidenceRow.content], autoEmbedOpts);
                    db.prepare("INSERT OR REPLACE INTO vec_evidence_embeddings(rowid, embedding) VALUES (?, ?)").run(row.rowid, new Float32Array(vector));
                  }
                }
              } catch (embedErr) {
                console.error(`[BB auto-embed] Failed to embed ${row.summary_id}: ${embedErr.message}`);
              }
            }
            // Update evidence_count
            const countRow = db.prepare("SELECT COUNT(*) AS n FROM vec_evidence_embeddings").get();
            setEmbeddingConfig(db, {
              evidence_count: countRow ? countRow.n : 0,
              last_embed_at: new Date().toISOString(),
            });
          }
        }
      } catch (autoEmbedErr) {
        console.error(`[BB auto-embed] Hook error: ${autoEmbedErr.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Part C: Hook: chat.message
  // ---------------------------------------------------------------------------
  async function chatMessage(input, output) {
    // input: { sessionID, agent?, model?, messageID?, variant? }
    // output: { message, parts }

    // Only inject context for the brand-builder agent
    if (input.agent !== "brand-builder") return;

    let header = "";
    try {
      const profileState = getLatestProfileState({ repos });
      const staleness = getStalenessReport({ repos });

      const staleCount = Array.isArray(staleness) ? staleness.length : 0;
      const dims = profileState && profileState.dimension_summary
        ? profileState.dimension_summary
        : null;

      const dimStr = dims
        ? `signal=${dims.signal} evidence=${dims.evidence} visibility=${dims.visibility} narrative=${dims.narrative}`
        : "no snapshot yet";

      const snapshotId = profileState ? (profileState.snapshot_id || "—") : "—";
      const confidence = profileState ? (profileState.confidence || "—") : "—";

      header = [
        "<!-- BB_PROFILE_STATE_HEADER -->",
        `Snapshot: ${snapshotId} | Confidence: ${confidence}`,
        `Dimensions: ${dimStr}`,
        staleCount > 0 ? `Stale artifacts: ${staleCount}` : "No stale artifacts.",
        "<!-- /BB_PROFILE_STATE_HEADER -->",
      ].join("\n");
    } catch (_) {
      header = "<!-- BB_PROFILE_STATE_HEADER: unavailable (no snapshots yet) -->";
    }

    if (output.parts && Array.isArray(output.parts)) {
      output.parts.unshift({ type: "text", text: header });
    }
  }

  // ---------------------------------------------------------------------------
  // Part D: Hook: experimental.session.compacting
  // ---------------------------------------------------------------------------
  async function sessionCompacting(input, output) {
    // input: { sessionID }
    // output: { context: string[], prompt?: string }

    let contextLines = [];
    try {
      const profileState = getLatestProfileState({ repos });
      const dims = profileState && profileState.dimension_summary
        ? profileState.dimension_summary
        : null;

      if (dims) {
        contextLines.push(
          `[Brand Builder] Latest profile snapshot: ` +
          `signal=${dims.signal} evidence=${dims.evidence} ` +
          `visibility=${dims.visibility} narrative=${dims.narrative} ` +
          `confidence=${profileState.confidence || "unknown"}`
        );
      }

      // Include active session workflow if known
      const sid = input.sessionID || pluginSessionId;
      if (sessionState.has(sid)) {
        const session = sessionState.get(sid);
        if (session.activeIntent) {
          contextLines.push(`[Brand Builder] Active intent: ${session.activeIntent}`);
        }
        if (session.enginesRun.size > 0) {
          contextLines.push(`[Brand Builder] Engines run this session: ${[...session.enginesRun].join(", ")}`);
        }
      }
    } catch (_) {
      contextLines.push("[Brand Builder] Profile state unavailable at compaction time.");
    }

    if (contextLines.length > 0 && output.context && Array.isArray(output.context)) {
      output.context.push(...contextLines);
    }
  }

  return {
    tool: tools,

    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after":  toolExecuteAfter,
    "chat.message":        chatMessage,
    "experimental.session.compacting": sessionCompacting,
  };
};

export default BrandBuilderPlugin;
