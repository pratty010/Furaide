import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getArtifactById,
  getOutcomeLabel,
  getSessionOutcomeLabel,
  insertArtifact,
  readAllEvents,
  upsertEvidenceLedger,
} from "../store/repo.js";
import type { CapabilityInvokedPayload } from "../types/events.js";

// Phase 6 (Approve/Promote/Track/Curate, Task 6.3) — ExpeL evidence ledger:
// joins Phase 2's attributionSkill-derived `capability.invoked` events
// (`trigger:'chain'`) to Phase 4's Judge outcome labels, accumulating
// `evidence_ledger` counters per artifact. See docs/superpowers/plans/
// 2026-07-06-idisu-v2.md Task 6.3.

/**
 * Where installed Claude Code skills live on disk (the same convention the
 * plan's Task 6.1 promote step writes into: `~/.agents/skills/<name>/
 * SKILL.md`). Mirrors the `DEFAULT_SKILLS_DIR` pattern in
 * `adapters/codex.ts` — a plain module-level default, overridable per call
 * (tests point this at a scratch fixture dir).
 */
export const DEFAULT_SKILLS_DIR = join(homedir(), ".agents", "skills");

export interface ImportPreexistingSkillsResult {
  imported: number;
  skipped: number;
}

/**
 * Bootstraps `artifacts` rows (`origin='preexisting'`) for skills that exist
 * on disk today but were never mined/staged/promoted through this pipeline —
 * without a row here, `evidence_ledger.artifact_id REFERENCES artifacts(id)`
 * means attribution against them could never be tracked at all.
 *
 * **id scheme**: a preexisting skill's `artifacts.id` is set to its skill
 * directory's basename (e.g. `~/.agents/skills/brainstorming/` -> id
 * `"brainstorming"`) — deterministic, not a random/content hash. This
 * matters because `ClaudeCodeAdapter`'s attributionSkill-derived
 * `capability.invoked` events carry the skill's plain name string as
 * `capability_id` (see `adapters/claude-code.ts`'s `attributionSkill` field),
 * and that name IS the directory name Claude Code resolves the skill from.
 * Using the same string as the artifact id means `updateEvidenceLedger`
 * below can look artifacts up by `capability_id` directly with no separate
 * name->id mapping table.
 *
 * Idempotent by construction: only directories with no existing `artifacts`
 * row of that id are inserted, so this is safe to call on every dream pass
 * (see `dream.ts` wiring) rather than needing a separate "first dream" flag/
 * marker file. A directory is only treated as a skill if it IS a directory
 * (loose files alongside it, e.g. a stray README, are ignored); its
 * `surface_path` is `<dir>/SKILL.md` when that file exists, else the bare
 * directory path.
 */
export function importPreexistingSkills(
  db: Database,
  skillsDir: string = DEFAULT_SKILLS_DIR,
): ImportPreexistingSkillsResult {
  if (!existsSync(skillsDir)) return { imported: 0, skipped: 0 };

  let imported = 0;
  let skipped = 0;

  for (const name of readdirSync(skillsDir)) {
    const dirPath = join(skillsDir, name);
    if (!statSync(dirPath).isDirectory()) continue;

    if (getArtifactById(db, name)) {
      skipped++;
      continue;
    }

    const skillMdPath = join(dirPath, "SKILL.md");
    const surfacePath = existsSync(skillMdPath) ? skillMdPath : dirPath;

    insertArtifact(db, {
      id: name,
      type: "skill",
      origin: "preexisting",
      surface_path: surfacePath,
      state: "active",
      signature: null,
      created_at: new Date().toISOString(),
    });
    imported++;
  }

  return { imported, skipped };
}

export interface UpdateEvidenceLedgerResult {
  /** Number of attributionSkill occurrences that produced a ledger update
   * (an existing artifact row was found for the occurrence's capability_id). */
  updated: number;
  /** Number of attributionSkill occurrences skipped because no `artifacts`
   * row exists for that capability_id yet — see doc comment below. */
  skippedNoArtifact: number;
}

/**
 * For every attributionSkill-derived `capability.invoked` occurrence
 * (`trigger:'chain'` — see `adapters/claude-code.ts`'s emitFromAssistant),
 * finds the relevant segment's outcome label and accumulates it onto that
 * skill's `evidence_ledger` row.
 *
 * **Segment lookup — turn vs. session fallback**: tries the occurrence's own
 * turn segment first (`turn:<turn_index>`), since that's the most specific
 * label available for "what happened right around this skill's use" (see
 * `judge/tier1.ts#labelTurnSegments` — it only emits a `turn:<n>` row where a
 * concrete failure is attributable there, so a turn-specific row, when
 * present, is a meaningful, targeted signal). When no turn-specific row
 * exists, falls back to the session-level label
 * (`getSessionOutcomeLabel`/`segment_key='session'`) — the coarser judgment
 * for "was this whole session, which used the skill, a success" is still
 * better than nothing.
 *
 * **"Correction proxy" substitution**: the plan's Task 6.3 test description
 * calls for "a correction proxy right after skill-attributed work -> loss+1".
 * No real user-correction detector exists anywhere in this codebase today —
 * grepped for "correction" and found none; it's tracked in the project's own
 * research digest as a FUTURE metric ("user-correction rate"), not yet
 * built. Rather than fabricate a fake detector to satisfy the letter of the
 * test description, this implementation substitutes the Judge's actual
 * failure label on the relevant segment: `outcome_label==='failure'` counts
 * as `loss+1` (a failure right after/around skill-attributed work is the
 * best real proxy currently available for "this attribution was corrected
 * away from"), `outcome_label==='success'` counts as `win+1`, and
 * `unknown`/`abandoned`/no-label-at-all counts as `applied+1` only — no
 * score movement, since there's no real signal either way. This is an
 * honestly-scoped substitution, not the originally-envisioned correction
 * detector; revisit once a real correction-detection signal exists.
 *
 * Skips (does not create a ledger row, does not fabricate an `artifacts`
 * row) occurrences whose `capability_id` has no matching `artifacts` row —
 * `evidence_ledger.artifact_id REFERENCES artifacts(id)` is a real foreign
 * key; a skill that was neither mined/promoted nor bootstrap-imported via
 * `importPreexistingSkills` simply can't be tracked yet. Callers are
 * expected to run `importPreexistingSkills` first in the same dream pass
 * (see `dream.ts`) so on-disk skills are covered.
 */
export function updateEvidenceLedger(db: Database): UpdateEvidenceLedgerResult {
  let updated = 0;
  let skippedNoArtifact = 0;

  for (const e of readAllEvents(db)) {
    if (e.event_type !== "capability.invoked") continue;
    const p = e.payload as CapabilityInvokedPayload;
    if (p.trigger !== "chain") continue;

    const artifactId = p.capability_id;
    if (!getArtifactById(db, artifactId)) {
      skippedNoArtifact++;
      continue;
    }

    const turnLabel = getOutcomeLabel(db, p.session_id, `turn:${p.turn_index}`);
    const label = turnLabel ?? getSessionOutcomeLabel(db, p.session_id);

    if (label === "success") {
      upsertEvidenceLedger(
        db,
        artifactId,
        { applied: 1, win: 1, loss: 0, score: 1 },
        new Date().toISOString(),
      );
    } else if (label === "failure") {
      upsertEvidenceLedger(
        db,
        artifactId,
        { applied: 1, win: 0, loss: 1, score: -1 },
        new Date().toISOString(),
      );
    } else {
      // unknown/abandoned/no label at all — applied only, no score movement.
      upsertEvidenceLedger(db, artifactId, {
        applied: 1,
        win: 0,
        loss: 0,
        score: 0,
      });
    }

    updated++;
  }

  return { updated, skippedNoArtifact };
}
