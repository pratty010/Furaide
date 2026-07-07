import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { SessionAdapter } from "../adapters/base.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { loadConfig } from "../config.js";
import { dreamLock } from "../lock.js";
import { LAST_DREAM_FILE, STATE_DIR, STATE_MANIFEST } from "../paths.js";
import { writeProfile } from "../projections/profile.js";
import type { EventEnvelope, EventType, Harness } from "../types/events.js";
import type { IntentCluster, StateManifest } from "../types/projections.js";
import { ALL_TIME_WINDOW, buildMetricProjections, measure, readMetricRollups, rollupSessions } from "./consolidate.js";
import { gather } from "./gather.js";
import { ClaudeCliJudgeBackend } from "../judge/claude-cli.js";
import type { JudgeBackend } from "../judge/interface.js";
import { runJudgeOrchestrator } from "../judge/orchestrator.js";
import { generateCandidates, mineNgrams } from "../mine/mine.js";
import { stageCandidate } from "../mine/stage.js";
import { findActiveArtifactBySignature } from "../store/repo.js";
import { importPreexistingSkills, updateEvidenceLedger } from "../track/ledger.js";
import { runCurate } from "../curate/curate.js";
import { orient } from "./orient.js";
import { pruneAndIndex } from "./prune.js";

// Task 4.3: constructs the LLM judge backend for this dream pass, or `null`
// when it's unavailable/not configured — the orchestrator itself already
// treats a `null` backend and a `budgetTokens` too small for even one call
// as no-ops (Tier-1 results still persist either way), so this only needs
// to cheaply decide "is there a backend to hand it at all."
//   - `judge_backend: 'none'` in config -> explicitly disabled, skip.
//   - otherwise, only construct `ClaudeCliJudgeBackend` if the `claude`
//     binary is actually resolvable on PATH (`Bun.which`) — cheap presence
//     check, not a full health-check/auth probe.
function resolveJudgeBackend(judgeBackend: string): JudgeBackend | null {
  if (judgeBackend !== "claude_cli") return null;
  if (!Bun.which("claude")) return null;
  return new ClaudeCliJudgeBackend();
}

export interface DreamRunResult {
  eventsIngested: number;
  metricsComputed: number;
  clustersFound: number;
  sessionsRolledUp: number;
  durationMs: number;
}

interface EventTableRow {
  event_id: string;
  schema_version: number;
  source_id: string;
  source_position: number | string;
  observed_at: string;
  ingested_at: string;
  harness: string;
  event_type: string;
  payload_version: number;
  payload: string;
}

function rowToEnvelope(row: EventTableRow): EventEnvelope {
  return {
    schema_version: row.schema_version as 1,
    event_id: row.event_id,
    source_id: row.source_id,
    source_position: row.source_position,
    observed_at: row.observed_at,
    ingested_at: row.ingested_at,
    harness: row.harness as Harness,
    event_type: row.event_type as EventType,
    payload_version: row.payload_version,
    payload: JSON.parse(row.payload),
  };
}

// Consolidate reads the full historical corpus back out of idisu.db now that
// Gather writes there. (The old JSONL event-log module was deleted in Phase 5
// Task 5.4 once its last caller, cli/commands/report.ts, migrated to idisu.db.)
function readAllEventsFromDb(db: Database): EventEnvelope[] {
  const rows = db
    .query("SELECT * FROM events ORDER BY observed_at ASC")
    .all() as EventTableRow[];
  return rows.map(rowToEnvelope);
}

export async function runDream(
  opts: { force?: boolean; scheduled?: boolean } = {},
): Promise<DreamRunResult> {
  const t0 = Date.now();
  const config = loadConfig();

  return dreamLock.withLock(async () => {
    if (opts.scheduled && !opts.force && existsSync(LAST_DREAM_FILE)) {
      const last = Number.parseInt(
        (await import("node:fs")).readFileSync(LAST_DREAM_FILE, "utf8").trim(),
        10,
      );
      if (Number.isFinite(last)) {
        const elapsedHours = (Date.now() / 1000 - last) / 3600;
        if (elapsedHours < config.dream_interval_hours) {
          return {
            eventsIngested: 0,
            metricsComputed: 0,
            clustersFound: 0,
            sessionsRolledUp: 0,
            durationMs: Date.now() - t0,
          };
        }
      }
    }

    const orientation = orient();
    const { db } = orientation;
    console.log("[idisu/dream] Phase 1 Orient complete");

    try {
      const adapters: SessionAdapter[] = [];
      if (config.harnesses.includes("claude_code")) {
        adapters.push(new ClaudeCodeAdapter());
      }
      if (config.harnesses.includes("codex")) {
        const { CodexAdapter } = await import("../adapters/codex.js");
        adapters.push(new CodexAdapter());
      }
      if (config.harnesses.includes("opencode")) {
        const { OpenCodeAdapter } = await import("../adapters/opencode.js");
        adapters.push(new OpenCodeAdapter());
      }

      const { spooledEvents, adapterEvents } = await gather(db, adapters);
      const eventsIngested = spooledEvents + adapterEvents;
      console.log(
        `[idisu/dream] Phase 2 Gather: +${eventsIngested} events (spool ${spooledEvents}, adapters ${adapterEvents})`,
      );

      const allEvents = readAllEventsFromDb(db);

      const metrics = buildMetricProjections(
        allEvents,
        config.min_sample_threshold,
      );

      // v0.1's intent-cluster feature had no producer for a 'prompt.observed'
      // event even before this rewrite (see analysis/dimensions.ts); v0.2's
      // event-kind union dropped it outright with nothing replacing it, so
      // there is currently no data to cluster.
      const clusters: IntentCluster[] = [];

      const sessionsRolledUp = rollupSessions(db);

      // Phase 3 Measure (Task 3.2): computes the v0.2 deterministic metric
      // catalog subset (invocation_count, model_trigger_rate,
      // attribution_rate) from idisu.db events and persists it to
      // `metric_rollups`. The profile projection writers below then read
      // invocation_count/model_trigger_rate/attribution_rate back out of
      // `metric_rollups` (reconciled into `metrics` here) so profile.json/profile.md report
      // the same durable numbers this pass wrote, rather than a second,
      // independently-derived in-memory count. used_downstream_rate and
      // load_success_rate aren't part of this task's metric set and remain
      // sourced from buildMetricProjections above.
      measure(db);

      // Phase 4 Judge (Task 4.3): two-tier (deterministic Tier-1 + budgeted
      // LLM) outcome labeling, run right after Measure so it sees the same
      // event corpus Consolidate just rolled up. Tier-1 always persists;
      // the LLM tier no-ops when the backend is unavailable/disabled or the
      // budget can't afford one call (see `resolveJudgeBackend` and
      // `runJudgeOrchestrator`).
      const judgeBackend = resolveJudgeBackend(config.judge_backend);
      const judgeResult = await runJudgeOrchestrator(db, {
        backend: judgeBackend,
        model: config.judge_model,
        budgetTokens: config.llm_budget_per_dream,
      });
      console.log(
        `[idisu/dream] Phase 4 Judge: ${judgeResult.segmentsLabeled} segments labeled (${judgeResult.llmCallsMade} LLM calls)`,
      );

      // Phase 6 (Approve/Promote/Track/Curate, Task 6.3): ExpeL evidence
      // ledger. `importPreexistingSkills` bootstraps `artifacts` rows for
      // skills already installed on disk (`~/.agents/skills/*`) that were
      // never mined/promoted through this pipeline — it's naturally
      // idempotent (only inserts a row when no `artifacts` row with that id
      // exists yet), so it's safe/cheap to call on every dream pass rather
      // than gating it behind a separate "first dream" flag. Placed here,
      // before `updateEvidenceLedger`, so a skill's `artifacts` row always
      // exists before the ledger join looks it up by capability_id.
      // `updateEvidenceLedger` runs right after Judge (not before) because it
      // needs this pass's freshly-written `outcome_labels` to join
      // attributionSkill occurrences against.
      const importResult = importPreexistingSkills(db);
      const ledgerResult = updateEvidenceLedger(db);
      console.log(
        `[idisu/dream] Phase 6 Track: ${importResult.imported} preexisting skills imported (${importResult.skipped} already present), ` +
          `${ledgerResult.updated} evidence-ledger updates (${ledgerResult.skippedNoArtifact} skipped, no artifact)`,
      );

      // Phase 6 (Curate, Task 6.4): surface stale/deprecate/overlap
      // proposals into the review queue (staged `artifacts` rows with
      // `type='instruction_edit'`) and move already-rejected/deprecated
      // artifacts' on-disk files to `archive/`. Never hard-deletes.
      // Placed right after Track so it sees this pass's freshly-updated
      // `evidence_ledger` (deprecation threshold) and the
      // `importPreexistingSkills`-populated `artifacts` table (stale /
      // overlap scans target active artifacts). Idempotent: re-running
      // curate on the same DB doesn't duplicate proposals or re-move
      // already-archived files.
      const curateResult = runCurate(db);
      console.log(
        `[idisu/dream] Phase 6 Curate: ${curateResult.deprecationProposals} deprecation, ` +
          `${curateResult.staleProposals} stale, ${curateResult.mergeProposals} merge proposals staged, ` +
          `${curateResult.archived} files moved to archive/`,
      );

      // Phase 5 Mine (Tasks 5.1-5.3): first live wiring of `mineNgrams` and
      // `generateCandidates` into the dream pipeline — both were built
      // standalone (see `mine.ts`'s own header comment) specifically so this
      // task could wire the full mine -> stage sequence at once rather than
      // half of it. Placed right after Judge so mining sees this pass's
      // freshly-labeled outcomes (`generateCandidates`'s success/failure
      // split comes from `outcome_labels`, which Judge just updated above).
      // `{ min: 2, n: 3 }` are untuned literal defaults (no config field for
      // these exists yet — only `generateCandidates`'s thresholds are
      // config-backed, see `config.ts`) matching the same values
      // `mine.test.ts`'s fixture already exercises. The duplicate-staging
      // guard (`findActiveArtifactBySignature`) is checked here too, even
      // though `stageCandidate` re-checks it itself, so this loop's log line
      // accurately reports how many candidates were newly staged vs.
      // already-active and skipped.
      mineNgrams(db, { min: 2, n: 3 });
      const candidates = generateCandidates(db);
      let candidatesStaged = 0;
      let candidatesSkipped = 0;
      for (const candidate of candidates) {
        if (findActiveArtifactBySignature(db, candidate.signature)) {
          candidatesSkipped++;
          continue;
        }
        stageCandidate(db, candidate);
        candidatesStaged++;
      }
      console.log(
        `[idisu/dream] Phase 5 Mine: ${candidates.length} candidates generated, ${candidatesStaged} staged, ${candidatesSkipped} already active`,
      );

      const rollups = readMetricRollups(db, ALL_TIME_WINDOW);
      for (const [capId, m] of metrics.entries()) {
        const rollup = rollups.get(capId);
        if (!rollup) continue;
        if (typeof rollup.invocation_count === "number") {
          m.invocation_count = rollup.invocation_count;
        }
        if (typeof rollup.model_trigger_rate === "number" && m.model_trigger_rate) {
          m.model_trigger_rate = { ...m.model_trigger_rate, shrunken: rollup.model_trigger_rate };
        }
        if (typeof rollup.attribution_rate === "number" && m.attribution_rate) {
          m.attribution_rate = { ...m.attribution_rate, shrunken: rollup.attribution_rate };
        }
      }

      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
      writeProfile(metrics, clusters);

      const lastEvent = allEvents.at(-1);
      const manifest: StateManifest = {
        schema_version: 1,
        built_through_event_id: lastEvent?.event_id ?? "none",
        built_at: new Date().toISOString(),
        generation: (orientation.manifest?.generation ?? 0) + 1,
      };
      writeFileSync(STATE_MANIFEST, JSON.stringify(manifest, null, 2));
      console.log(
        `[idisu/dream] Phase 3 Consolidate: ${metrics.size} capabilities, ${clusters.length} clusters, ${sessionsRolledUp} sessions rolled up`,
      );

      pruneAndIndex(config.evidence_retention_days);
      console.log("[idisu/dream] Phase 4 Prune complete");
      writeFileSync(LAST_DREAM_FILE, `${Math.floor(Date.now() / 1000)}\n`);

      return {
        eventsIngested,
        metricsComputed: metrics.size,
        clustersFound: clusters.length,
        sessionsRolledUp,
        durationMs: Date.now() - t0,
      };
    } finally {
      db.close();
    }
  });
}
