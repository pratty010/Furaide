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
  const lines = table.split("\n")
  assert.ok(
    !lines[0].includes("status"),
    "header row should not include a standalone status column"
  )
  assert.ok(table.includes("done"), "phase column should carry the authoritative status value")
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
  assert.ok(output.includes("did not receive valid structured JSON"))
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

test("renderResult extracts review schema from opencode JSON-lines output", () => {
  const reviewSchema = {
    verdict: "approve",
    summary: "Code is well-structured.",
    findings: [
      {
        severity: "low",
        title: "Minor style issue",
        body: "The formatting could be clearer.",
        file: "main.js",
        line_start: 42,
        line_end: 42,
        confidence: 0.8,
        recommendation: "Tighten the formatting.",
      },
    ],
    next_steps: ["Consider adding more tests"],
  }
  const jsonLinesOutput = [
    { type: "message", text: "Analyzing code..." },
    { type: "message", text: "Found a few things to note." },
    { type: "final", ...reviewSchema }, // The final event contains the review schema
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")

  const job = {
    id: "job-5",
    kind: "review",
    provider: "opencode",
    model: "gpt-5.4",
    backend: "opencode",
    status: "done",
    phase: "done",
    resumable: false,
    result: { rawOutput: jsonLinesOutput },
  }
  const output = renderResult(job)
  assert.ok(output.includes("Verdict: approve"))
  assert.ok(output.includes("Code is well-structured."))
  assert.ok(output.includes("Minor style issue"))
})

test("renderResult extracts review schema from opencode JSON envelope", () => {
  const job = {
    id: "job-6",
    kind: "review",
    provider: "opencode",
    model: "gpt-5.4",
    backend: "opencode",
    status: "done",
    phase: "done",
    resumable: false,
    result: {
      rawOutput: JSON.stringify({
        messages: [
          { role: "assistant", content: "thinking" },
          {
            role: "assistant",
            content: JSON.stringify({
              verdict: "needs-attention",
              summary: "Found a problem.",
              findings: [
                {
                  severity: "high",
                  title: "Bug",
                  body: "This can fail at runtime.",
                  file: "app.js",
                  line_start: 9,
                  line_end: 9,
                  confidence: 0.9,
                  recommendation: "Fix the runtime failure.",
                },
              ],
              next_steps: ["Fix the bug"],
            }),
          },
        ],
      }),
    },
  }

  const output = renderResult(job)
  assert.ok(output.includes("Verdict: needs-attention"))
  assert.ok(output.includes("Found a problem."))
  assert.ok(output.includes("Bug"))
})

test("renderResult extracts review schema from pi assistant_message JSON", () => {
  const job = {
    id: "job-7",
    kind: "review",
    provider: "opencode-go",
    model: "deepseek-v4-pro",
    backend: "pi",
    status: "done",
    phase: "done",
    resumable: false,
    result: {
      rawOutput: `${JSON.stringify({
        event: "assistant_message",
        text: JSON.stringify({
          verdict: "approve",
          summary: "pi review",
          findings: [],
          next_steps: [],
        }),
      })}\n`,
    },
  }

  const output = renderResult(job)
  assert.ok(output.includes("Verdict: approve"))
  assert.ok(output.includes("pi review"))
})
