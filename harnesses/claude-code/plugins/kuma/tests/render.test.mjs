import assert from "node:assert/strict"
import { test } from "node:test"
import { renderResult, renderStatusTable } from "../scripts/lib/render.mjs"

test("renderStatusTable includes all required columns", () => {
  const table = renderStatusTable([
    {
      id: "job-1",
      kind: "task",
      provider: "opencode-go",
      model: "kimi-k2.6",
      backend: "opencode",
      status: "done",
      resumable: true,
      resultReady: true,
    },
  ])
  for (const header of [
    "id",
    "task kind",
    "provider",
    "model",
    "backend",
    "phase",
    "resumable",
    "result ready",
  ]) {
    assert.ok(table.includes(header), `missing column: ${header}`)
  }
})

test("renderResult falls back to raw text on invalid JSON instead of throwing", () => {
  const job = {
    id: "job-2",
    kind: "review",
    provider: "opencode",
    model: "gpt-5.4",
    backend: "opencode",
    status: "done",
    phase: "done",
    resumable: false,
    result: { rawOutput: "not json at all" },
  }
  const output = renderResult(job)
  assert.ok(output.includes("did not receive valid structured JSON"))
  assert.ok(output.includes("not json at all"))
})

test("renderResult falls back to raw text on wrong shape instead of throwing", () => {
  const job = {
    id: "job-3",
    kind: "review",
    provider: "opencode",
    model: "gpt-5.4",
    backend: "opencode",
    status: "done",
    phase: "done",
    resumable: false,
    result: { rawOutput: JSON.stringify({ notAReview: true }) },
  }
  const output = renderResult(job)
  assert.ok(output.includes("unexpected review shape"))
})

test("renderResult renders verdict/summary/findings for a valid review", () => {
  const job = {
    id: "job-4",
    kind: "review",
    provider: "opencode",
    model: "gpt-5.4",
    backend: "opencode",
    status: "done",
    phase: "done",
    resumable: false,
    result: {
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine.",
        findings: [],
        next_steps: [],
      }),
    },
  }
  const output = renderResult(job)
  assert.ok(output.includes("Verdict: approve"))
  assert.ok(output.includes("Looks fine."))
})
