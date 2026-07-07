import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PENDING_DIR } from "../paths.js";
import {
  findActiveArtifactBySignature,
  insertArtifact,
  insertEdge,
  insertNode,
} from "../store/repo.js";
import type { Candidate } from "./mine.js";

// Phase 5 (Mine, Task 5.3) — turns a Task 5.2 `Candidate` into a staged,
// on-disk + DB-registered artifact awaiting human review (Phase 6's
// `/idisu review` -> skill-creator handoff, not built yet).

export interface StageCandidateOptions {
  /** Overrides `PENDING_DIR` — tests point this at a scratch temp dir so
   * staging never touches the real `~/.idisu/pending`. Defaults to the
   * real `PENDING_DIR` for production callers (dream.ts). */
  pendingDir?: string;
}

export interface StageCandidateResult {
  id: string;
  draftPath: string;
  evidencePath: string;
  /** `true` when an active artifact for this signature already existed and
   * staging was skipped (no new files/rows written). `stage.ts`'s own
   * duplicate guard — `dream.ts`'s wiring also checks
   * `findActiveArtifactBySignature` itself before calling this, so this
   * flag mostly matters for direct/standalone callers (e.g. this file's own
   * tests) that skip that pre-check. */
  skipped: boolean;
}

/**
 * Deterministic candidate id: sha256 of the n-gram `signature`, truncated to
 * 12 hex chars. 12 hex chars (48 bits) is short enough to read/type as a
 * directory name (matches the git-short-hash convention humans are already
 * used to) while keeping collision probability negligible at the scale this
 * system mines candidates (a handful to low hundreds per dream pass, not
 * millions) — same truncation *style* as `types/events.ts#makeEventId`
 * (sha256 -> hex -> `.slice`), just a shorter cut since this id is meant to
 * be human-facing (a directory the user browses under `~/.idisu/pending/`)
 * rather than purely a machine dedup key.
 */
function makeCandidateId(signature: string): string {
  return createHash("sha256").update(signature).digest("hex").slice(0, 12);
}

function renderDraftMd(candidate: Candidate): string {
  return [
    "# TODO: name this skill",
    "",
    "> **UNAUTHORED** — raw mined material awaiting human review. This is a",
    "> placeholder, not a finished `SKILL.md`. Phase 6's `/idisu review` command",
    "> will hand this candidate to `skill-creator` for actual authoring; nothing",
    "> in this file should be treated as ready to install or run.",
    "",
    `**Signature**: \`${candidate.signature}\``,
    `**Frequency**: ${candidate.frequency} occurrence(s) across ${candidate.sampleSessions.length} sampled session(s)`,
    "",
    "## Suggested name",
    "TODO",
    "",
    "## Suggested description",
    "TODO — describe when this workflow applies and what it accomplishes.",
    "",
  ].join("\n");
}

function renderEvidenceMd(candidate: Candidate): string {
  const lines = [
    `# Evidence — \`${candidate.signature}\``,
    "",
    "## Outcome split",
    `- Successes: ${candidate.successCount}`,
    `- Failures: ${candidate.failureCount}`,
    "",
    "## Sample sessions",
  ];
  if (candidate.sampleSessions.length === 0) {
    lines.push("(none recorded)");
  } else {
    for (const sessionId of candidate.sampleSessions) {
      lines.push(`- ${sessionId}`);
    }
  }
  lines.push(
    "",
    "## Closest existing skills (informational only)",
    "_Near-duplicates found during candidate generation that did NOT cross the",
    "suppression threshold — surfaced here for the reviewer's awareness, not",
    "the reason this candidate was staged or blocked._",
    "",
  );
  if (candidate.closestSkills.length === 0) {
    lines.push("(none)");
  } else {
    for (const skill of candidate.closestSkills) {
      lines.push(`- ${skill}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Writes a candidate's `draft.md` + `evidence.md` to
 * `<pendingDir>/<id>/` and registers it in the `artifacts`/`nodes`/`edges`
 * tables.
 *
 * Duplicate-staging guard: checks `findActiveArtifactBySignature` first and
 * no-ops (no files written, no rows inserted) if an active artifact for this
 * signature already exists — a signature already staged (or promoted) from
 * a previous dream pass isn't re-staged. This mirrors the guard `dream.ts`'s
 * wiring also performs before calling this function; duplicated here so
 * this function is safe to call standalone (e.g. from tests, or a future
 * `/idisu review` re-stage path) without relying on the caller remembering
 * to check first.
 *
 * `surface_path` is set to the `draft.md` path (not the bare pending
 * directory): once Phase 6 authoring replaces the placeholder content in
 * place, `surface_path` keeps pointing at the same file that becomes the
 * real skill surface — no path rewrite needed at promotion time.
 *
 * Node/edge graph shape: one `nodes` row for the artifact itself
 * (`type='artifact'`), one `nodes` row per sample session (`type='session'`,
 * `INSERT OR IGNORE` so a session already referenced by an earlier
 * candidate isn't duplicated), and one `edges` row per sample session
 * (`type='evidenced_by'`, artifact -> session, `valid_at=now`,
 * `invalid_at=null`). `edges.src`/`edges.dst` are plain TEXT columns with no
 * `REFERENCES` clause in `schema.ts` (unlike e.g.
 * `evidence_ledger.artifact_id REFERENCES artifacts(id)`), so they could
 * technically hold bare session-id strings with no backing `nodes` row —
 * but creating a `nodes` row per session keeps the graph traversable from
 * either endpoint (e.g. "what artifacts does session X support" via
 * `edges.dst`) without a special case for session ids.
 */
export function stageCandidate(
  db: Database,
  candidate: Candidate,
  opts: StageCandidateOptions = {},
): StageCandidateResult {
  const pendingDir = opts.pendingDir ?? PENDING_DIR;
  const id = makeCandidateId(candidate.signature);
  const dir = join(pendingDir, id);
  const draftPath = join(dir, "draft.md");
  const evidencePath = join(dir, "evidence.md");

  const existing = findActiveArtifactBySignature(db, candidate.signature);
  if (existing) {
    return { id: existing.id, draftPath, evidencePath, skipped: true };
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(draftPath, renderDraftMd(candidate));
  writeFileSync(evidencePath, renderEvidenceMd(candidate));

  const now = new Date().toISOString();

  insertArtifact(db, {
    id,
    type: "skill",
    origin: "mined",
    surface_path: draftPath,
    state: "staged",
    signature: candidate.signature,
    created_at: now,
  });

  insertNode(db, { id, type: "artifact", label: candidate.signature });

  for (const sessionId of candidate.sampleSessions) {
    insertNode(db, { id: sessionId, type: "session" });
    insertEdge(db, {
      src: id,
      dst: sessionId,
      type: "evidenced_by",
      valid_at: now,
      invalid_at: null,
    });
  }

  return { id, draftPath, evidencePath, skipped: false };
}
