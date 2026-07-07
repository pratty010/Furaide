// Phase 7 (Task 7.3) — end-to-end verification fixtures.
//
// Hand-crafted CC JSONL transcripts used by tests/integration/e2e.test.ts
// to walk the spec's 9 verification checks end-to-end.
//
// Transcript shape (CC v0.2 — see src/adapters/claude-code.ts):
// - `assistant` records carry `message.content` tool_use blocks and a
//   top-level `attributionSkill` (native skill-usage attribution).
// - `user` records carry `message.content` tool_result blocks (used to
//   detect exit-code / error signals).
// - `system` records with `subtype === 'turn_duration'` become
//   turn.observed events.
// - Top-level `pr-link` records mark sessions that landed in a PR.
//
// Each fixture file is one session in a project directory:
//
//   tests/integration/fixtures/transcripts/<slug>/<sessionId>.jsonl
//
// The `id` filenames match the `session_id` of the events the adapter
// derives, so the resulting `events` rows have a `payload.session_id`
// value the test can assert against.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURES_ROOT = "/tmp/idisu-e2e-fixtures";

const TRANSCRIPTS_DIR = join(FIXTURES_ROOT, "transcripts");

/**
 * Wipe and rebuild the fixture tree under `/tmp/idisu-e2e-fixtures/`.
 * Called from `beforeAll` in the e2e test so the per-suite fixture state
 * is deterministic (no leftover sessions from a previous run).
 */
export function resetFixtures(): void {
  rmSync(FIXTURES_ROOT, { recursive: true, force: true });
  mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
}

/** Per-suite session-id namespace prefix — keeps events from different
 * e2e tests in distinct groups, and matches the per-test `cc:<slug>/<id>`
 * `source_id` shape the adapter produces. */
const SUITE_SLUG = "e2e";

/**
 * One CC session with:
 *   - 1 Skill tool_use (model-triggered capability.invoked)
 *   - 1 attributionSkill (chain-triggered capability.invoked)
 *   - 3 tool.called events (Read/Edit/Bash — Phase 5 mine target)
 *   - 1 pr-link record (success outcome)
 */
export function writeSuccessSession(sessionId: string): void {
  const lines = [
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a1`,
      parentUuid: null,
      isSidechain: false,
      isMeta: false,
      turnIndex: 0,
      ts: "2026-07-06T10:00:00.000Z",
      attributionSkill: "brainstorming",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: `${sessionId}-tu1`,
            name: "Read",
            input: { file_path: "/tmp/foo.md" },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a2`,
      parentUuid: `${sessionId}-a1`,
      isSidechain: false,
      isMeta: false,
      turnIndex: 1,
      ts: "2026-07-06T10:00:05.000Z",
      attributionSkill: "brainstorming",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: `${sessionId}-tu2`,
            name: "Skill",
            input: { skill: "brainstorming" },
          },
        ],
        usage: { input_tokens: 120, output_tokens: 60 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a3`,
      parentUuid: `${sessionId}-a2`,
      isSidechain: false,
      isMeta: false,
      turnIndex: 2,
      ts: "2026-07-06T10:00:10.000Z",
      attributionSkill: "brainstorming",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: `${sessionId}-tu3`,
            name: "Edit",
            input: { file_path: "/tmp/foo.md", new_string: "x" },
          },
        ],
        usage: { input_tokens: 140, output_tokens: 70 },
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a4`,
      parentUuid: `${sessionId}-a3`,
      isSidechain: false,
      isMeta: false,
      turnIndex: 3,
      ts: "2026-07-06T10:00:15.000Z",
      attributionSkill: "brainstorming",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: `${sessionId}-tu4`,
            name: "Bash",
            input: { cmd: "ls" },
          },
        ],
        usage: { input_tokens: 160, output_tokens: 80 },
      },
    }),
    // pr-link success — the spec's "tier-1 deterministic success" signal.
    JSON.stringify({
      type: "pr-link",
      merged: true,
      pr_number: 1234,
      pr_url: `https://github.com/example/${SUITE_SLUG}/pull/1234`,
    }),
  ];
  writeTranscript(sessionId, lines);
}

/**
 * One CC session with a failing tool_result (non-zero exit code) so the
 * tier-1 judge labels it `failure`. Includes a `Read` tool call so the
 * session has tool.called events to drive any per-session rollup.
 */
export function writeFailureSession(sessionId: string): void {
  const lines = [
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a1`,
      parentUuid: null,
      isSidechain: false,
      isMeta: false,
      turnIndex: 0,
      ts: "2026-07-06T11:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: `${sessionId}-tu1`,
            name: "Bash",
            input: { cmd: "false" },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }),
    JSON.stringify({
      type: "user",
      uuid: `${sessionId}-u1`,
      parentUuid: `${sessionId}-a1`,
      isSidechain: false,
      isMeta: false,
      turnIndex: 0,
      ts: "2026-07-06T11:00:01.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `${sessionId}-tu1`,
            is_error: true,
            content: "Process exited with code 1",
          },
        ],
      },
    }),
  ];
  writeTranscript(sessionId, lines);
}

/**
 * One CC session with no pr-link, no failing tool_result, no
 * `session.observed { ended_cleanly: true }` — i.e. the events a tier-1
 * judge can deterministically rule-out on, so it falls through to
 * `unknown` (the segment the LLM tier is meant to label).
 */
export function writeUnknownSession(sessionId: string): void {
  const lines = [
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-a1`,
      parentUuid: null,
      isSidechain: false,
      isMeta: false,
      turnIndex: 0,
      ts: "2026-07-06T12:00:00.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: `${sessionId}-tu1`,
            name: "Read",
            input: { file_path: "/tmp/some.md" },
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    }),
  ];
  writeTranscript(sessionId, lines);
}

function writeTranscript(sessionId: string, lines: string[]): void {
  const projectDir = join(TRANSCRIPTS_DIR, SUITE_SLUG);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, `${sessionId}.jsonl`),
    `${lines.join("\n")}\n`,
  );
}

/** Path of the project directory the ClaudeCodeAdapter scans — one
 * project slug, multiple session files. */
export function transcriptsDir(): string {
  return TRANSCRIPTS_DIR;
}
