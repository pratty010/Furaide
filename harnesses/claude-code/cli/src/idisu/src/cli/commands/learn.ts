import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { IDISU_DB, PENDING_DIR } from "../../paths.js";
import { openDb } from "../../store/db.js";
import { findActiveArtifactBySignature, insertArtifact } from "../../store/repo.js";

// Phase 7 (Finalize Command Surface, Task 7.1) — the `/idisu learn`
// prompt-builder. Mirrors the Hermes `/learn` pattern: a "no pipeline"
// command that expands a source (directory | file | URL | session id)
// into a markdown instruction block, persists the result like any other
// staged artifact (`origin='learned'`, `state='staged'`), and hands the
// block off to the live agent's `skill-creator` / `writing-skills` skill
// for actual authoring. Īdisu never authors artifacts itself — it only
// assembles evidence and prompts, per the spec's load-bearing principle
// (line 34).

const USAGE =
  "Usage: idisu learn --source <dir|file|url|session:id>";

export interface LearnOptions {
  /** Overrides `PENDING_DIR` — tests point this at a scratch temp dir, same
   * pattern as `mine/stage.ts#StageCandidateOptions` / `promote.ts#PromoteOptions`. */
  pendingDir?: string;
}

export interface LearnResult {
  id: string;
  draftPath: string;
  instructionBlock: string;
  /** `true` when an active artifact with the same signature already existed
   * and the duplicate-staging guard short-circuited the write. */
  skipped: boolean;
  /** Source kind classified from the `--source` value — useful for tests
   * and for any future caller that wants to route on it. */
  sourceKind: "dir" | "file" | "url" | "session";
}

type SourceKind = LearnResult["sourceKind"];

interface ResolvedSource {
  kind: SourceKind;
  /** Stable identifier used both as the artifacts `signature` prefix and as
   * the input to the deterministic id hash. Two `--source` values that should
   * dedup (e.g. the same path or the same URL) must produce the same `id`. */
  signatureKey: string;
  /** The human-readable evidence body embedded in the instruction block. */
  evidence: string;
}

/**
 * Classifies a raw `--source` value into one of `dir` / `file` / `url` /
 * `session` and produces the evidence body for the instruction block.
 * Throws on unrecognized input or on a missing filesystem path. URL
 * evidence is just the URL string — no fetching happens here, per spec
 * ("just embed the URL string in the evidence, no fetching").
 */
function resolveSource(db: Database, source: string): ResolvedSource {
  if (source.startsWith("session:")) {
    const sessionId = source.slice("session:".length);
    if (sessionId.length === 0) {
      throw new Error(`Empty session id in --source '${source}'.`);
    }
    // Read events for this session directly from idisu.db. Mirrors
    // `store/repo.ts#getEventsForSession` but renders a compact summary
    // (count + event-type histogram + first/last observed-at) rather
    // than the full envelope list — the live agent's skill-creator
    // call is the place that reads the full event history, not this
    // prompt builder.
    const rows = db
      .query(
        "SELECT event_type, observed_at FROM events WHERE json_extract(payload, '$.session_id') = ? ORDER BY observed_at ASC",
      )
      .all(sessionId) as Array<{ event_type: string; observed_at: string }>;
    const histogram = new Map<string, number>();
    for (const r of rows) {
      histogram.set(r.event_type, (histogram.get(r.event_type) ?? 0) + 1);
    }
    const firstAt = rows[0]?.observed_at ?? "(none)";
    const lastAt = rows[rows.length - 1]?.observed_at ?? "(none)";
    const lines: string[] = [];
    lines.push(`Session id: ${sessionId}`);
    lines.push(`Events for this session: ${rows.length}`);
    lines.push(`First observed_at: ${firstAt}`);
    lines.push(`Last observed_at: ${lastAt}`);
    if (histogram.size > 0) {
      lines.push("");
      lines.push("Event-type histogram:");
      for (const [etype, n] of histogram) {
        lines.push(`- ${etype}: ${n}`);
      }
    }
    return {
      kind: "session",
      signatureKey: `session:${sessionId}`,
      evidence: lines.join("\n"),
    };
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    // No fetching — the spec is explicit: the live agent's skill-creator
    // call is the place that fetches the URL. The block flags this so
    // the agent knows the URL is evidence-by-pointer, not content.
    return {
      kind: "url",
      signatureKey: source,
      evidence: `URL: ${source}\n(Not fetched — the live agent should fetch this URL when authoring the skill.)`,
    };
  }

  // Anything else is treated as a filesystem path. The classification
  // between `file` and `dir` is determined by `statSync`-style probes via
  // `existsSync` + `readdirSync` (a missing path on a `readdirSync`
  // would throw and be caught as "not found").
  if (existsSync(source)) {
    let entries: string[] = [];
    let isDir = false;
    try {
      entries = readdirSync(source);
      isDir = true;
    } catch {
      isDir = false;
    }
    if (isDir) {
      // Per-file evidence with a sensible cap on a single file's size
      // (so a 1GB file doesn't OOM the process) — KISS, no streaming.
      const PER_FILE_CAP_BYTES = 256 * 1024;
      const lines: string[] = [];
      lines.push(`Directory: ${source}`);
      lines.push(`File count: ${entries.length}`);
      lines.push("");
      for (const name of entries.sort()) {
        const child = join(source, name);
        let stat: ReturnType<typeof readFileSync> | null = null;
        try {
          stat = readFileSync(child);
        } catch {
          lines.push(`### ${name}`);
          lines.push("(unable to read)");
          lines.push("");
          continue;
        }
        const truncated = stat.length > PER_FILE_CAP_BYTES;
        const body = truncated
          ? `${stat.subarray(0, PER_FILE_CAP_BYTES).toString("utf8")}\n\n[truncated at ${PER_FILE_CAP_BYTES} bytes]`
          : stat.toString("utf8");
        lines.push(`### ${name}`);
        lines.push("```");
        lines.push(body);
        lines.push("```");
        lines.push("");
      }
      return {
        kind: "dir",
        signatureKey: source,
        evidence: lines.join("\n").trimEnd(),
      };
    }
    const body = readFileSync(source, "utf8");
    return {
      kind: "file",
      signatureKey: source,
      evidence: `File: ${source}\n\n${body}`,
    };
  }

  // Distinguish "looks like a path but doesn't exist" from "unrecognized
  // source kind" so the caller's error message is actionable. A source
  // that starts with a path separator (or `./`/`../`) is path-shaped
  // even when the path doesn't resolve — different error category.
  const pathShaped = source.startsWith("/") || source.startsWith("./") || source.startsWith("../");
  if (pathShaped) {
    throw new Error(`Source path not found: '${source}'.`);
  }
  throw new Error(
    `Unrecognized source kind: '${source}'. Expected <dir>, <file>, https://... URL, or session:<id>.`,
  );
}

/** Deterministic id for a learn-source — same truncation style as
 * `mine/stage.ts#makeCandidateId` (sha256, 12-hex slice) so the directory
 * name under `pending/` is short and human-typeable. */
function makeLearnId(signature: string): string {
  return createHash("sha256").update(signature).digest("hex").slice(0, 12);
}

/**
 * Fixed authoring-standards block embedded at the top of every learn
 * instruction. The exact wording isn't load-bearing — the load-bearing
 * parts are (1) the standards are present and (2) the handoff to
 * `skill-creator` / `writing-skills` is unambiguous so the live agent
 * knows it must invoke the authoring skill rather than rewriting the
 * block inline (spec principle: Īdisu never authors artifacts).
 */
const AUTHORING_STANDARDS = [
  "## Authoring Standards",
  "",
  "- Frontmatter MUST include `name` (kebab-case) and `description` (one line, present-tense, when-to-invoke form).",
  "- Body uses imperative voice. Avoid second-person (\"you should ...\").",
  "- Include a \"When to use this skill\" section with concrete triggers, and a numbered \"Steps\" section where each step is a single concrete action.",
  "- Every claim in the body should be traceable to the source evidence below — if a step can't be sourced, omit it.",
  "- Prefer concrete, testable actions over abstract guidance.",
].join("\n");

const HANDOFF_MARKER = [
  "## Handoff",
  "",
  "<!-- handoff: skill-creator -->",
  "",
  "Invoke the `skill-creator` skill (or `writing-skills`) with the source evidence below to author the final `SKILL.md`. Do not rewrite the block inline — Īdisu only assembles evidence and prompts; the live authoring step belongs to the agent.",
].join("\n");

/**
 * Renders the full instruction block that the live agent parses and
 * hands off to `skill-creator`. Three sections in order: a header +
 * authoring standards, the source evidence, the handoff marker. Kept
 * as a pure function so the CLI smoke test can assert on the shape
 * without depending on filesystem ordering.
 */
function renderInstructionBlock(
  source: ResolvedSource,
  draftPath: string,
): string {
  return [
    "# Īdisu Learn — Skill Authoring Prompt",
    "",
    "Author a reusable skill from the following source. Treat every part of the request as load-bearing.",
    "",
    `**Source kind**: \`${source.kind}\``,
    `**Staged draft**: \`${draftPath}\``,
    "",
    AUTHORING_STANDARDS,
    "",
    "## Source Evidence",
    "",
    source.evidence,
    "",
    HANDOFF_MARKER,
    "",
  ].join("\n");
}

/**
 * Core learn logic, split out from `cmdLearn` (the CLI wrapper below) so
 * tests can call it directly without going through argv parsing / stdout /
 * exit codes — same split as `promoteCandidate` vs. `cmdPromote`,
 * `rejectCandidate` vs. `cmdReject`, `stageCandidate` vs. `dream.ts`.
 *
 * Resolves the source (dir / file / url / session), classifies it,
 * renders the instruction block, writes it to `<pendingDir>/<id>/draft.md`,
 * and registers the resulting artifacts row with `origin='learned'`,
 * `state='staged'`, `type='skill'`. The `signature` is `learn:<source>`
 * so a re-run of `learn <source>` short-circuits via
 * `findActiveArtifactBySignature` (same dedup contract as
 * `mine/stage.ts#stageCandidate`).
 *
 * Throws (does not print/exit) on: unrecognized source kind, missing
 * filesystem path, or a malformed `session:` value. The CLI wrapper
 * turns throws into stderr + exit 1 via the index.ts dispatch's
 * `.catch`.
 */
export function learnCandidate(
  db: Database,
  source: string,
  opts: LearnOptions = {},
): LearnResult {
  const pendingDir = opts.pendingDir ?? PENDING_DIR;
  const resolved = resolveSource(db, source);
  const signature = `learn:${resolved.signatureKey}`;
  const id = makeLearnId(signature);

  // Duplicate-staging guard — same contract as `stageCandidate`. A re-run
  // of `learn <source>` for an already-active signature short-circuits
  // (no files re-written, no new artifacts row).
  const existing = findActiveArtifactBySignature(db, signature);
  if (existing) {
    const draftPath = join(pendingDir, existing.id, "draft.md");
    return {
      id: existing.id,
      draftPath,
      instructionBlock: readFileSync(draftPath, "utf8"),
      skipped: true,
      sourceKind: resolved.kind,
    };
  }

  const candidateDir = join(pendingDir, id);
  if (!existsSync(candidateDir)) mkdirSync(candidateDir, { recursive: true });
  const draftPath = join(candidateDir, "draft.md");
  const instructionBlock = renderInstructionBlock(resolved, draftPath);
  writeFileSync(draftPath, instructionBlock);

  insertArtifact(db, {
    id,
    type: "skill",
    origin: "learned",
    surface_path: draftPath,
    state: "staged",
    signature,
    created_at: new Date().toISOString(),
  });

  return {
    id,
    draftPath,
    instructionBlock,
    skipped: false,
    sourceKind: resolved.kind,
  };
}

function parseArgs(args: string[]): { source?: string } {
  const sourceIdx = args.indexOf("--source");
  const source = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;
  if (!source) {
    throw new Error(USAGE);
  }
  return { source };
}

/**
 * `idisu learn --source <dir|file|url|session:id>` — headless-safe:
 * parses argv, runs, prints the instruction block to stdout, and returns
 * the `LearnResult` (the index.ts handler ignores the return; the live
 * agent reads the printed block, and tests read the return value).
 *
 * Throws on a missing or unrecognized `--source`; the index.ts dispatch
 * converts that throw into `console.error` + `process.exit(1)`.
 */
export function cmdLearn(args: string[]): LearnResult {
  const { source } = parseArgs(args);
  // `source` is guaranteed non-undefined here — `parseArgs` throws otherwise.
  const db = openDb(IDISU_DB);
  try {
    const result = learnCandidate(db, source as string);
    console.log(result.instructionBlock);
    return result;
  } finally {
    db.close();
  }
}
